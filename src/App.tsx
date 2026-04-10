import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Search, Camera, Bell, Package, MapPin, Barcode, ChevronRight, 
  X, ArrowLeft, AlertCircle, CheckCircle2, Clock, FileUp, Zap 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { CatalogItem, View } from './types';
import { MOCK_CATALOG } from './constants';
import { cn } from './lib/utils';

export default function App() {
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>(MOCK_CATALOG);
  const catalogItemsRef = useRef(catalogItems);
  
  useEffect(() => {
    catalogItemsRef.current = catalogItems;
  }, [catalogItems]);

  const [view, setView] = useState<View>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [hasFlash, setHasFlash] = useState(false);
  const [isFlashOn, setIsFlashOn] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanLoopRef = useRef<number | null>(null);
  const zxingReaderRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [itemsLimit, setItemsLimit] = useState(20);
  const [isImporting, setIsImporting] = useState(false);

  // --- LOGIQUE DE SCAN OPTIMISÉE ---

  const startCamera = async () => {
    let stream: MediaStream | null = null;
    let isActive = true;

    try {
      // 1. Attente du DOM
      let attempts = 0;
      while (!videoRef.current && attempts < 10) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }

      if (!videoRef.current) return;

      // 2. Flux vidéo haute résolution + Focus
      stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 }, 
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        }
      });

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // 3. Configuration Flash et Focus avancé
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as any;
      
      if (capabilities.torch) setHasFlash(true);
      if (capabilities.focusMode?.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any);
      }

      // 4. Choix du moteur
      const BarcodeDetectorAPI = (window as any).BarcodeDetector;
      const supportedFormats = BarcodeDetectorAPI ? await BarcodeDetectorAPI.getSupportedFormats() : [];
      const canUseNative = supportedFormats.includes('code_128');

      if (canUseNative) {
        const detector = new BarcodeDetectorAPI({ 
          formats: ['code_128', 'code_39', 'ean_13', 'qr_code'] 
        });

        const scanLoop = async () => {
          if (!isActive || !videoRef.current) return;
          
          if (videoRef.current.readyState >= 2) {
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0 && isActive) {
                isActive = false;
                handleScanResult(barcodes[0].rawValue);
                return;
              }
            } catch (e) {
              console.error("Erreur détecteur natif:", e);
            }
          }
          scanLoopRef.current = requestAnimationFrame(scanLoop);
        };
        scanLoopRef.current = requestAnimationFrame(scanLoop);
      } else {
        // Fallback ZXing (iOS / Firefox)
        const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import('@zxing/library');
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128, 
          BarcodeFormat.CODE_39, 
          BarcodeFormat.EAN_13
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        const reader = new BrowserMultiFormatReader(hints);
        zxingReaderRef.current = reader;

        reader.decodeFromVideoElement(videoRef.current, (result, error) => {
          if (result && isActive) {
            isActive = false;
            handleScanResult(result.getText());
          }
        });
      }

      setIsScanning(true);
    } catch (err) {
      console.error("Erreur caméra:", err);
      alert("Erreur d'accès à la caméra. Vérifiez les permissions HTTPS.");
      setView('list');
    }
  };

  const stopCamera = () => {
    if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    if (zxingReaderRef.current) zxingReaderRef.current.reset();
    
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
    setIsFlashOn(false);
  };

  const handleScanResult = (code: string) => {
    stopCamera();
    let cleanCode = code.trim();
    if (cleanCode.startsWith(']C1')) cleanCode = cleanCode.substring(3);

    const foundItem = catalogItemsRef.current.find(item => 
      String(item.sapCode).trim() === cleanCode || 
      cleanCode.includes(String(item.sapCode).trim())
    );

    if (foundItem) {
      setSelectedItem(foundItem);
    } else {
      setSearchQuery(cleanCode);
    }
    setView('list');
  };

  useEffect(() => {
    if (view === 'scan') startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [view]);

  // --- RESTE DE LA LOGIQUE (Filtrage, Import...) ---

  const filteredItems = useMemo(() => {
    return catalogItems.filter(item => {
      const query = searchQuery.toLowerCase();
      const locQuery = locationQuery.toLowerCase();
      const matchesSearch = String(item.name).toLowerCase().includes(query) || String(item.sapCode).toLowerCase().includes(query);
      const matchesLocation = String(item.location).toLowerCase().includes(locQuery);
      const matchesCategory = !selectedCategory || item.category === selectedCategory;
      return matchesSearch && matchesLocation && matchesCategory;
    });
  }, [searchQuery, locationQuery, selectedCategory, catalogItems]);

  const displayedItems = useMemo(() => filteredItems.slice(0, itemsLimit), [filteredItems, itemsLimit]);

  const toggleFlash = async () => {
    if (!videoRef.current || !hasFlash) return;
    try {
      const track = (videoRef.current.srcObject as MediaStream).getVideoTracks()[0];
      const newState = !isFlashOn;
      await track.applyConstraints({ advanced: [{ torch: newState }] } as any);
      setIsFlashOn(newState);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
            <Package size={24} />
          </div>
          <h1 className="font-bold text-lg">Magasin Nesle</h1>
        </div>
        <div className="flex gap-2">
           <button onClick={() => setView('scan')} className="p-2 bg-blue-600 text-white rounded-full">
            <Camera size={22} />
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-600">
            <FileUp size={22} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 pb-24">
        <AnimatePresence mode="wait">
          {view === 'list' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input 
                    type="text"
                    placeholder="Article ou code SAP..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500/20 outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                {displayedItems.map(item => (
                  <div 
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className="bg-white p-4 rounded-xl border border-gray-200 flex items-center justify-between active:scale-[0.98] transition-transform"
                  >
                    <div>
                      <h3 className="font-bold">{item.name}</h3>
                      <p className="text-xs text-gray-500 font-mono">{item.sapCode} — {item.location}</p>
                    </div>
                    <ChevronRight className="text-gray-300" size={20} />
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'scan' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-black flex flex-col">
              <div className="p-4 flex items-center justify-between text-white z-10">
                <button onClick={() => setView('list')} className="p-2"><ArrowLeft size={24} /></button>
                <h2 className="font-bold">Scanner SAP</h2>
                <button onClick={toggleFlash} className={cn("p-2 rounded-full", isFlashOn && "bg-yellow-500 text-black")}>
                  <Zap size={24} />
                </button>
              </div>

              <div className="flex-1 relative overflow-hidden">
                <video 
                  ref={videoRef} 
                  className="absolute inset-0 w-full h-full object-cover"
                  playsInline
                  muted
                />
                
                {/* Overlay de visée */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-72 h-40 border-2 border-white/50 rounded-3xl relative">
                    <div className="absolute inset-0 border-2 border-blue-500 rounded-3xl animate-pulse" />
                    <motion.div 
                      animate={{ top: ['10%', '90%', '10%'] }} 
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute left-2 right-2 h-0.5 bg-red-500 shadow-lg"
                    />
                  </div>
                </div>
                
                <div className="absolute bottom-10 left-0 right-0 text-center">
                  <p className="text-white/80 text-sm bg-black/40 inline-block px-4 py-2 rounded-full backdrop-blur-md">
                    Placez le code-barres dans le cadre
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modal Détail (Simplifié pour l'exemple) */}
      {selectedItem && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 relative">
            <button onClick={() => setSelectedItem(null)} className="absolute top-4 right-4"><X /></button>
            <h2 className="text-xl font-bold mb-4">{selectedItem.name}</h2>
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-xs text-gray-400 uppercase font-bold">Code SAP</p>
                <p className="font-mono text-lg">{selectedItem.sapCode}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-xs text-gray-400 uppercase font-bold">Emplacement</p>
                <p className="text-lg">{selectedItem.location}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx" onChange={() => {}} />
    </div>
  );
}
