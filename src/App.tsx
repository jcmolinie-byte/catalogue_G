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
  // --- MÉMOIRE PERSISTANTE (LocalStorage) ---
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>(() => {
    try {
      const saved = localStorage.getItem('nesle_catalog');
      // Si on trouve un catalogue sauvegardé, on l'utilise, sinon on prend le Mock
      return saved ? JSON.parse(saved) : MOCK_CATALOG;
    } catch (e) {
      return MOCK_CATALOG;
    }
  });

  const catalogItemsRef = useRef(catalogItems);
  
  // Sauvegarde automatique à chaque modification (Import ou Rappel)
  useEffect(() => {
    catalogItemsRef.current = catalogItems;
    localStorage.setItem('nesle_catalog', JSON.stringify(catalogItems));
  }, [catalogItems]);

  const [view, setView] = useState<View>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [hasFlash, setHasFlash] = useState(false);
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [itemsLimit, setItemsLimit] = useState(20);
  const [isImporting, setIsImporting] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scanLoopRef = useRef<number | null>(null);
  const zxingReaderRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- LOGIQUE D'IMPORT XLSX ---
  const parseExcelData = (data: any) => {
    try {
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet);
      if (!json || json.length === 0) return null;

      return json.map((row: any, index) => {
        const getValue = (keys: string[]) => {
          const foundKey = Object.keys(row).find(k => 
            keys.some(key => k.toLowerCase().trim() === key.toLowerCase())
          );
          return foundKey ? row[foundKey] : null;
        };
        return {
          id: `import-${index}-${Date.now()}`,
          name: String(getValue(['Désignation article', 'Désignation', 'Nom', 'Description']) || 'Article sans nom'),
          category: String(getValue(['Catégorie', 'Category', 'Famille']) || 'Non spécifié'),
          sapCode: String(getValue(['Article', 'SAP', 'Code SAP', 'Référence']) || 'N/A'),
          location: String(getValue(['Emplacemt', 'Emplacement', 'Location', 'Zone']) || 'Non spécifié'),
          reminderActive: false,
          lastExitDate: getValue(['Dernière Sortie', 'Date']) ? String(getValue(['Dernière Sortie', 'Date'])) : undefined
        };
      });
    } catch (err) {
      console.error("Error parsing Excel:", err);
      return null;
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    setIsImporting(true);
    reader.onload = (evt) => {
      const importedItems = parseExcelData(evt.target?.result);
      if (importedItems) {
        setCatalogItems(importedItems);
        alert(`${importedItems.length} articles chargés et sauvegardés dans l'appareil !`);
      }
      setIsImporting(false);
    };
    reader.readAsArrayBuffer(file);
  };

  // --- LOGIQUE DE SCAN ASYNCHRONE ---
  const startCamera = async () => {
    let isActive = true;
    try {
      let attempts = 0;
      while (!videoRef.current && attempts < 10) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }
      if (!videoRef.current) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment', 
          width: { ideal: 1920 }, 
          height: { ideal: 1080 } 
        }
      });

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities() as any;
      if (caps.torch) setHasFlash(true);

      const BarcodeDetectorAPI = (window as any).BarcodeDetector;
      if (BarcodeDetectorAPI && (await BarcodeDetectorAPI.getSupportedFormats()).includes('code_128')) {
        const detector = new BarcodeDetectorAPI({ formats: ['code_128', 'code_39', 'ean_13'] });
        const scanLoop = async () => {
          if (!isActive || !videoRef.current) return;
          if (videoRef.current.readyState >= 2) {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0 && isActive) {
              isActive = false;
              handleScanResult(barcodes[0].rawValue);
              return;
            }
          }
          scanLoopRef.current = requestAnimationFrame(scanLoop);
        };
        scanLoopRef.current = requestAnimationFrame(scanLoop);
      } else {
        const { BrowserMultiFormatReader } = await import('@zxing/library');
        const reader = new BrowserMultiFormatReader();
        zxingReaderRef.current = reader;
        reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result && isActive) {
            isActive = false;
            handleScanResult(result.getText());
          }
        });
      }
      setIsScanning(true);
    } catch (e) { 
      console.error(e); 
      setView('list'); 
    }
  };

  const stopCamera = () => {
    if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    if (zxingReaderRef.current) zxingReaderRef.current.reset();
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
    setIsFlashOn(false);
  };

  const handleScanResult = (code: string) => {
    let cleanCode = code.trim();
    if (cleanCode.startsWith(']C1')) cleanCode = cleanCode.substring(3);
    setScanResult(`Code détecté : ${cleanCode}`);
    
    const foundItem = catalogItemsRef.current.find(item => 
      String(item.sapCode).trim() === cleanCode || 
      cleanCode.includes(String(item.sapCode).trim())
    );

    setTimeout(() => {
      if (foundItem) setSelectedItem(foundItem);
      else setSearchQuery(cleanCode);
      setView('list');
      setScanResult(null);
    }, 800);
  };

  useEffect(() => {
    if (view === 'scan') startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [view]);

  // --- FILTRES ---
  const categories = useMemo(() => Array.from(new Set(catalogItems.map(i => i.category))).filter(c => c !== 'Non spécifié'), [catalogItems]);
  const filteredItems = useMemo(() => {
    return catalogItems.filter(item => {
      const matchesSearch = String(item.name).toLowerCase().includes(searchQuery.toLowerCase()) || String(item.sapCode).toLowerCase().includes(searchQuery.toLowerCase());
      const matchesLocation = String(item.location).toLowerCase().includes(locationQuery.toLowerCase());
      const matchesCategory = !selectedCategory || item.category === selectedCategory;
      return matchesSearch && matchesLocation && matchesCategory;
    });
  }, [searchQuery, locationQuery, selectedCategory, catalogItems]);

  const reminders = useMemo(() => catalogItems.filter(item => item.reminderActive), [catalogItems]);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A]">
      <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx" onChange={handleFileUpload} />
      
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg"><Package size={24} /></div>
          <h1 className="font-bold text-lg">Magasin Nesle</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-600"><FileUp size={22} /></button>
          <button onClick={() => setView('reminders')} className="p-2 relative text-gray-600">
            <Bell size={22} />
            {reminders.length > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">{reminders.length}</span>}
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 pb-24">
        <AnimatePresence mode="wait">
          {view === 'list' && (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="flex flex-col gap-3">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input type="text" placeholder="Rechercher article ou SAP..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl shadow-sm outline-none" />
                </div>
                <div className="relative">
                  <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input type="text" placeholder="Filtrer par emplacement..." value={locationQuery} onChange={(e) => setLocationQuery(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl outline-none" />
                </div>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {categories.map(cat => (
                  <button key={cat} onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)} className={cn("px-4 py-2 rounded-full text-sm font-medium border whitespace-nowrap", selectedCategory === cat ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-600")}>{cat}</button>
                ))}
              </div>

              <div className="space-y-2">
                {filteredItems.slice(0, itemsLimit).map(item => (
                  <div key={item.id} onClick={() => setSelectedItem(item)} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between active:scale-[0.98] transition-transform">
                    <div className="flex-1 min-w-0 pr-4">
                      <span className="text-[10px] font-bold text-blue-600 uppercase">{item.category}</span>
                      <h3 className="font-bold text-gray-900 truncate">{item.name}</h3>
                      <p className="text-gray-500 text-[11px] font-mono">{item.sapCode} — {item.location}</p>
                    </div>
                    <ChevronRight className="text-gray-300" size={20} />
                  </div>
                ))}
              </div>
              {filteredItems.length > itemsLimit && <button onClick={() => setItemsLimit(l => l + 20)} className="w-full py-4 text-blue-600 font-bold bg-white border rounded-2xl shadow-sm">Afficher plus d'articles</button>}
            </motion.div>
          )}

          {view === 'scan' && (
            <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[60] bg-black flex flex-col">
              <div className="p-4 flex items-center justify-between text-white z-10">
                <button onClick={() => setView('list')} className="p-2"><ArrowLeft size={24} /></button>
                <h2 className="font-bold">Scanner Code SAP</h2>
                {hasFlash && <button onClick={() => {
                  const track = (videoRef.current?.srcObject as MediaStream).getVideoTracks()[0];
                  track.applyConstraints({ advanced: [{ torch: !isFlashOn }] } as any);
                  setIsFlashOn(!isFlashOn);
                }} className={cn("p-2 rounded-full", isFlashOn && "bg-yellow-500 text-black")}><Zap size={24} /></button>}
              </div>
              <div className="flex-1 relative flex items-center justify-center">
                <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                <div className="relative w-80 h-48 border-2 border-white/40 rounded-3xl">
                   <div className="absolute inset-0 border-2 border-blue-500 rounded-3xl animate-pulse" />
                   <motion.div animate={{ top: ['10%', '90%', '10%'] }} transition={{ duration: 2, repeat: Infinity }} className="absolute left-4 right-4 h-0.5 bg-red-500 shadow-lg" />
                </div>
              </div>
              {scanResult && <div className="absolute top-24 left-6 right-6 bg-blue-600 text-white p-4 rounded-2xl text-center font-bold shadow-2xl">{scanResult}</div>}
            </motion.div>
          )}

          {view === 'reminders' && (
             <motion.div key="reminders" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <button onClick={() => setView('list')} className="flex items-center gap-2 text-blue-600 font-bold"><ArrowLeft size={20}/> Retour</button>
                <h2 className="text-xl font-bold">Mes Rappels SAP ({reminders.length})</h2>
                {reminders.length === 0 ? (
                  <div className="bg-white p-8 rounded-3xl text-center border border-dashed border-gray-300">
                    <p className="text-gray-500">Aucun rappel en attente.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {reminders.map(item => (
                      <div key={item.id} className="bg-white p-4 rounded-xl border-l-4 border-l-orange-500 flex justify-between items-center shadow-sm">
                        <div>
                          <p className="font-bold">{item.name}</p>
                          <p className="text-xs font-mono text-gray-500">SAP: {item.sapCode}</p>
                        </div>
                        <button onClick={() => setCatalogItems(prev => prev.map(i => i.id === item.id ? { ...i, reminderActive: false } : i))} className="p-2 text-red-500"><X /></button>
                      </div>
                    ))}
                  </div>
                )}
             </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modal Détails */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedItem(null)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="relative w-full max-w-lg bg-white rounded-3xl overflow-hidden p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">{selectedItem.name}</h2>
                <button onClick={() => setSelectedItem(null)} className="p-2 bg-gray-100 rounded-full"><X size={20}/></button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Code SAP</p>
                  <p className="font-mono font-bold text-blue-600 text-lg">{selectedItem.sapCode}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Emplacement</p>
                  <p className="font-bold text-lg">{selectedItem.location}</p>
                </div>
              </div>
              <button 
                onClick={() => {
                   const isActivating = !selectedItem.reminderActive;
                   setCatalogItems(prev => prev.map(item => item.id === selectedItem.id ? { ...item, reminderActive: !item.reminderActive } : item));
                   setSelectedItem(null);
                   if (isActivating) {
                     const sujet = encodeURIComponent(`Sortie SAP à effectuer — Article ${selectedItem.sapCode}`);
                     const corps = encodeURIComponent(
                       `Bonjour,\n\n` +
                       `Une sortie de stock SAP est à effectuer pour l'article suivant :\n\n` +
                       `• N° Article   : ${selectedItem.sapCode}\n` +
                       `• Désignation  : ${selectedItem.name}\n` +
                       `• Emplacement  : ${selectedItem.location}\n\n` +
                       `Merci de procéder à la sortie SAP dès que possible.\n\n` +
                       `— Catalogue Magasin Nesle`
                     );
                     window.location.href = `mailto:SHR-NSL-magasin_nesle@tereos.com?subject=${sujet}&body=${corps}`;
                   }
                }}
                className={cn("w-full py-4 rounded-2xl font-bold transition-all shadow-md", selectedItem.reminderActive ? "bg-orange-100 text-orange-700" : "bg-blue-600 text-white")}
              >
                {selectedItem.reminderActive ? "Annuler le rappel" : "Prendre l'article (Rappel SAP)"}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>{isImporting && <div className="fixed inset-0 z-[100] bg-white/90 flex flex-col items-center justify-center"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" /><p className="font-bold">Mise à jour du catalogue...</p></div>}</AnimatePresence>

      {/* Navigation Basse */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 flex justify-around sm:hidden z-40 shadow-[0_-4px_10px_rgba(0,0,0,0.03)]">
        <button onClick={() => setView('list')} className={cn("p-2 transition-colors", view === 'list' ? "text-blue-600" : "text-gray-400")}><Package /></button>
        <button onClick={() => setView('scan')} className="p-4 bg-blue-600 text-white rounded-full -mt-10 shadow-xl active:scale-90 transition-transform"><Camera size={28} /></button>
        <button onClick={() => setView('reminders')} className={cn("p-2 transition-colors", view === 'reminders' ? "text-blue-600" : "text-gray-400")}><Bell /></button>
      </div>
    </div>
  );
}
