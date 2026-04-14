import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Search, 
  Camera, 
  Bell, 
  Package, 
  MapPin, 
  Barcode, 
  ChevronRight, 
  Filter, 
  X, 
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileUp,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { BrowserMultiFormatReader, NotFoundException, BarcodeFormat, DecodeHintType } from '@zxing/library';
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
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [itemsLimit, setItemsLimit] = useState(20);
  const [isImporting, setIsImporting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const categories = useMemo(() => {
    const cats = new Set(catalogItems.map(item => item.category));
    return Array.from(cats).filter(cat => {
      const normalized = String(cat || '').toLowerCase().trim();
      return normalized !== 'général' && normalized !== 'non spécifié' && normalized !== '';
    });
  }, [catalogItems]);

  const filteredItems = useMemo(() => {
    return catalogItems.filter(item => {
      const name = String(item.name || '').toLowerCase();
      const sapCode = String(item.sapCode || '').toLowerCase();
      const location = String(item.location || '').toLowerCase();
      const query = searchQuery.toLowerCase();
      const locQuery = locationQuery.toLowerCase();
      
      const matchesSearch = name.includes(query) || sapCode.includes(query);
      const matchesLocation = location.includes(locQuery);
      const matchesCategory = !selectedCategory || item.category === selectedCategory;
      return matchesSearch && matchesLocation && matchesCategory;
    });
  }, [searchQuery, locationQuery, selectedCategory, catalogItems]);

  // Reset pagination when filters change
  useEffect(() => {
    setItemsLimit(20);
  }, [searchQuery, locationQuery, selectedCategory, catalogItems]);

  const displayedItems = useMemo(() => {
    return filteredItems.slice(0, itemsLimit);
  }, [filteredItems, itemsLimit]);

  const reminders = useMemo(() => {
    return catalogItems.filter(item => item.reminderActive);
  }, [catalogItems]);

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
          name: String(getValue(['Désignation article', 'Désignation', 'Designation', 'Nom', 'Name', 'Description']) || 'Article sans nom'),
          category: String(getValue(['Catégorie', 'Category', 'Famille', 'Type', 'Groupe']) || 'Non spécifié'),
          sapCode: String(getValue(['Article', 'SAP', 'Code SAP', 'Code', 'Référence', 'Reference', 'Ref']) || 'N/A'),
          location: String(getValue(['Emplacemt', 'Emplacement', 'Location', 'Place', 'Casier', 'Zone']) || 'Non spécifié'),
          reminderActive: false,
          lastExitDate: getValue(['Dernière Sortie', 'Last Exit', 'Date', 'Sortie']) ? String(getValue(['Dernière Sortie', 'Last Exit', 'Date', 'Sortie'])) : undefined
        };
      });
    } catch (err) {
      console.error("Error parsing Excel:", err);
      return null;
    }
  };

  // Auto-load catalogue.xlsx if it exists in the public folder
  useEffect(() => {
    const autoLoadCatalogue = async () => {
      try {
        const response = await fetch('/catalogue.xlsx');
        const contentType = response.headers.get('content-type');
        
        // Ensure we are not receiving an HTML fallback page (common in SPA routing when file is missing)
        if (response.ok && (!contentType || !contentType.includes('text/html'))) {
          const arrayBuffer = await response.arrayBuffer();
          const importedItems = parseExcelData(arrayBuffer);
          if (importedItems && importedItems.length > 0) {
            setCatalogItems(importedItems);
            console.log("Catalogue chargé automatiquement depuis /catalogue.xlsx");
          }
        } else {
          console.log("Fichier /catalogue.xlsx introuvable ou invalide (reçu HTML).");
        }
      } catch (err) {
        console.log("Erreur lors de la tentative de chargement de /catalogue.xlsx", err);
      }
    };
    autoLoadCatalogue();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    setIsImporting(true);
    reader.onload = (evt) => {
      setTimeout(() => {
        const data = evt.target?.result;
        const importedItems = parseExcelData(data);
        
        if (importedItems && importedItems.length > 0) {
          setCatalogItems(importedItems);
          setSelectedCategory(null);
          setSearchQuery('');
          alert(`${importedItems.length} articles importés avec succès !`);
        } else {
          alert("Erreur lors de la lecture du fichier ou fichier vide.");
        }
        setIsImporting(false);
      }, 100);
    };
    reader.readAsArrayBuffer(file);
  };

  // FIX 1 : on ne met stopCamera() que dans le cleanup, pas dans le else.
  // Cela évite le double appel stopCamera() qui tuait le reader au retour en vue scan.
  useEffect(() => {
    if (view === 'scan') {
      startCamera();
    }
    return () => stopCamera();
  }, [view]);

  const startCamera = async () => {
    try {
      // Wait for video element to be mounted in the DOM (up to 2 seconds)
      let attempts = 0;
      while (!videoRef.current && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      if (!videoRef.current) {
        throw new Error("Élément vidéo non trouvé dans le DOM.");
      }

      // Configure hints for better performance
      const hints = new Map();
      const formats = [
        BarcodeFormat.CODE_128,
        BarcodeFormat.EAN_13,
        BarcodeFormat.CODE_39,
        BarcodeFormat.QR_CODE
      ];
      hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(DecodeHintType.TRY_HARDER, true);

      codeReaderRef.current = new BrowserMultiFormatReader(hints);
      
      // Try to find the back camera explicitly
      const videoDevices = await codeReaderRef.current.listVideoInputDevices();
      const backCamera = videoDevices.find(device => 
        device.label.toLowerCase().includes('back') || 
        device.label.toLowerCase().includes('arrière') ||
        device.label.toLowerCase().includes('rear') ||
        device.label.toLowerCase().includes('environment')
      );

      const deviceId = backCamera ? backCamera.deviceId : undefined;

      // Start decoding with specific constraints for better quality
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      };

      // DO NOT await this call as it runs continuously and would block the rest of the function
      codeReaderRef.current.decodeFromConstraints(
        constraints,
        videoRef.current,
        (result, err) => {
          if (result) {
            handleScanResult(result.getText());
          }
        }
      ).catch(err => {
        console.error("Decoding error:", err);
      });

      // Give a small delay for the stream to initialize
      setTimeout(() => {
        if (videoRef.current && videoRef.current.srcObject) {
          setIsScanning(true);
          
          // Check for flash support
          const stream = videoRef.current.srcObject as MediaStream;
          const track = stream.getVideoTracks()[0];
          const capabilities = track.getCapabilities() as any;
          if (capabilities && capabilities.torch) {
            setHasFlash(true);
          }
        }
      }, 500);
      
    } catch (err) {
      console.error("Error accessing camera:", err);
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      if (view === 'scan') {
        alert(`Impossible d'accéder à la caméra : ${message}. Veuillez vérifier les permissions.`);
        setView('list');
      }
    }
  };

  const toggleFlash = async () => {
    if (!videoRef.current || !hasFlash) return;
    
    try {
      const stream = videoRef.current.srcObject as MediaStream;
      const track = stream.getVideoTracks()[0];
      const newFlashState = !isFlashOn;
      
      await track.applyConstraints({
        advanced: [{ torch: newFlashState }]
      } as any);
      
      setIsFlashOn(newFlashState);
    } catch (err) {
      console.error("Error toggling flash:", err);
    }
  };

  const stopCamera = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsFlashOn(false);
    setHasFlash(false);
    setIsScanning(false);
  };

  const analyzePhoto = async () => {
    if (!videoRef.current || isAnalyzing) return;

    try {
      setIsAnalyzing(true);
      
      if (videoRef.current.readyState < 2 || videoRef.current.videoWidth === 0) {
        throw new Error("La caméra n'est pas encore prête. Attendez une seconde et réessayez.");
      }

      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1024 / Math.max(videoRef.current.videoWidth, videoRef.current.videoHeight));
      canvas.width = videoRef.current.videoWidth * scale;
      canvas.height = videoRef.current.videoHeight * scale;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Impossible de créer le contexte de capture d'image.");
      
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const base64Image = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];

      // Prepare the list of item names
      const itemsToAnalyze = catalogItems.slice(0, 300);
      const itemNames = itemsToAnalyze.map(item => `- ${item.name} (Code: ${item.sapCode})`).join('\n');

      // Call our backend API instead of Gemini directly
      const apiResponse = await fetch('/api/analyze-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image, itemNames })
      });

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json();
        throw new Error(errorData.error || "Erreur serveur lors de l'analyse.");
      }

      const { sapCode } = await apiResponse.json();
      
      if (sapCode) {
        const foundItem = catalogItems.find(item => item.sapCode === sapCode || sapCode.includes(item.sapCode));
        if (foundItem) {
          setSelectedItem(foundItem);
          setView('list');
        } else {
          setSearchQuery(sapCode);
          setView('list');
        }
      } else {
        throw new Error("L'IA n'a pas pu identifier l'article.");
      }
    } catch (err) {
      console.error("Erreur d'analyse AI:", err);
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      alert(`Erreur d'analyse : ${message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleScanResult = (code: string) => {
    // Stop scanning immediately to prevent multiple triggers
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    
    // Clean up common Code 128 / GS1 prefixes (like ]C1)
    let cleanCode = code.trim();
    if (cleanCode.startsWith(']C1')) {
      cleanCode = cleanCode.substring(3);
    }
    
    setScanResult(`Code détecté: ${cleanCode}`);
    
    // Find item with matching SAP code (exact or partial)
    const foundItem = catalogItemsRef.current.find(item => {
      const itemSap = String(item.sapCode || '').trim();
      return itemSap === cleanCode || 
             (cleanCode.length > 4 && itemSap.includes(cleanCode)) ||
             (itemSap.length > 4 && cleanCode.includes(itemSap));
    });
    
    setTimeout(() => {
      if (foundItem) {
        setSelectedItem(foundItem);
      } else {
        // If not found, just pre-fill the search
        setSearchQuery(code);
      }
      setView('list');
      setScanResult(null);
      setIsScanning(false);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-blue-100">
      {/* Loading Overlay */}
      <AnimatePresence>
        {isImporting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-white/80 backdrop-blur-md flex flex-col items-center justify-center"
          >
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-lg font-bold text-gray-900">Importation en cours...</p>
            <p className="text-sm text-gray-500">Veuillez patienter, nous préparons votre catalogue.</p>
          </motion.div>
        )}
        {isAnalyzing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-blue-600/90 backdrop-blur-md flex flex-col items-center justify-center text-white"
          >
            <div className="w-20 h-20 relative mb-8">
              <div className="absolute inset-0 border-4 border-white/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-white border-t-transparent rounded-full animate-spin" />
              <Camera className="absolute inset-0 m-auto" size={32} />
            </div>
            <p className="text-2xl font-bold mb-2">Analyse de l'article...</p>
            <p className="text-blue-100 max-w-xs text-center">L'IA identifie l'article pour trouver son code SAP.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept=".xlsx, .xls, .csv"
        onChange={handleFileUpload}
      />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
            <Package size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight tracking-tight">Catalogue Magasin Nesle</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-600 transition-all flex items-center gap-2"
            title="Importer Excel"
          >
            <FileUp size={22} />
            <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider">Importer</span>
          </button>
          <button 
            onClick={() => setView('reminders')}
            className={cn(
              "p-2 rounded-full transition-all relative",
              view === 'reminders' ? "bg-blue-50 text-blue-600" : "hover:bg-gray-100 text-gray-600"
            )}
          >
            <Bell size={22} />
            {reminders.length > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                {reminders.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto p-4 pb-24">
        <AnimatePresence mode="wait">
          {view === 'list' && (
            <motion.div
              key="list"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Search and Filter */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3">
                  <div className="relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                    <input 
                      type="text"
                      placeholder="Rechercher un article ou code SAP..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-lg"
                    />
                  </div>
                  <div className="relative group">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                    <input 
                      type="text"
                      placeholder="Filtrer par emplacement (Allée, Rayon...)"
                      value={locationQuery}
                      onChange={(e) => setLocationQuery(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-base"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                    {filteredItems.length} article{filteredItems.length > 1 ? 's' : ''} trouvé{filteredItems.length > 1 ? 's' : ''}
                  </h2>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                      className={cn(
                        "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all border",
                        selectedCategory === cat 
                          ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100" 
                          : "bg-white border-gray-200 text-gray-600 hover:border-blue-200 hover:bg-blue-50"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Catalog List */}
              <div className="space-y-2">
                {displayedItems.map(item => (
                  <motion.div
                    layoutId={item.id}
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group"
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      {item.category && item.category.toLowerCase().trim() !== 'non spécifié' && (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">{item.category}</span>
                        </div>
                      )}
                      <h3 className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{item.name}</h3>
                      <div className="flex items-center gap-4 mt-1">
                        <div className="flex items-center gap-1 text-gray-500">
                          <Barcode size={12} />
                          <span className="text-[11px] font-mono">{item.sapCode}</span>
                        </div>
                        <div className="flex items-center gap-1 text-gray-500">
                          <MapPin size={12} />
                          <span className="text-[11px]">{item.location}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="text-gray-300 group-hover:text-blue-500 transition-colors" size={20} />
                  </motion.div>
                ))}
              </div>

              {filteredItems.length > itemsLimit && (
                <div className="flex justify-center pt-4">
                  <button 
                    onClick={() => setItemsLimit(prev => prev + 20)}
                    className="px-8 py-3 bg-white border border-gray-200 text-blue-600 font-bold rounded-xl hover:bg-blue-50 transition-all shadow-sm"
                  >
                    Charger plus d'articles ({filteredItems.length - itemsLimit} restants)
                  </button>
                </div>
              )}

              {filteredItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <Package size={48} strokeWidth={1} className="mb-4 opacity-20" />
                  <p className="text-lg font-medium">Aucun article trouvé</p>
                  <p className="text-sm">Essayez une autre recherche ou catégorie</p>
                </div>
              )}
            </motion.div>
          )}

          {view === 'scan' && (
            <motion.div
              key="scan"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black flex flex-col"
            >
              <div className="p-4 flex items-center justify-between text-white">
                <button onClick={() => { setView('list'); stopCamera(); }} className="p-2 hover:bg-white/10 rounded-full">
                  <ArrowLeft size={24} />
                </button>
                <h2 className="font-bold">Scanner Code SAP</h2>
                {hasFlash ? (
                  <button 
                    onClick={toggleFlash}
                    className={cn(
                      "p-2 rounded-full transition-colors",
                      isFlashOn ? "bg-yellow-500 text-black" : "hover:bg-white/10 text-white"
                    )}
                  >
                    <Zap size={24} className={isFlashOn ? "fill-current" : ""} />
                  </button>
                ) : (
                  <div className="w-10" />
                )}
              </div>

              <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                {/* FIX 2 : suppression du onCanPlay={() => setIsScanning(true)}
                    C'est uniquement le setTimeout dans startCamera() qui gère isScanning,
                    une fois que ZXing est réellement prêt à décoder. */}
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted
                  className={cn(
                    "w-full h-full object-cover transition-opacity duration-500",
                    isScanning ? "opacity-100" : "opacity-0"
                  )}
                />

                {!isScanning && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center space-y-4 p-8 bg-black">
                    <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-6">
                      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                    <h3 className="text-xl font-bold text-white">Initialisation...</h3>
                    <p className="text-gray-400 max-w-xs mx-auto">Activation de la caméra en cours.</p>
                  </div>
                )}

                {isScanning && (
                  <>
                    <div className="absolute inset-0 border-[40px] border-black/40 flex items-center justify-center pointer-events-none">
                      <div className="w-80 h-48 border-2 border-blue-500 rounded-2xl relative">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white -translate-x-1 -translate-y-1 rounded-tl-lg" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white translate-x-1 -translate-y-1 rounded-tr-lg" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white -translate-x-1 translate-y-1 rounded-bl-lg" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white translate-x-1 translate-y-1 rounded-br-lg" />
                        
                        <motion.div 
                          animate={{ top: ['10%', '90%', '10%'] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                          className="absolute left-4 right-4 h-0.5 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"
                        />
                      </div>
                    </div>
                    <div className="absolute bottom-12 left-0 right-0 flex flex-col items-center gap-4 px-4">
                      <p className="text-white text-sm bg-black/60 px-6 py-3 rounded-full backdrop-blur-md border border-white/10">
                        Alignez le code-barres horizontalement
                      </p>
                      
                      <button 
                        onClick={analyzePhoto}
                        disabled={isAnalyzing}
                        className={cn(
                          "flex items-center gap-2 px-6 py-4 bg-white text-blue-600 rounded-2xl font-bold shadow-xl active:scale-95 transition-all",
                          isAnalyzing && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {isAnalyzing ? (
                          <>
                            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                            Analyse en cours...
                          </>
                        ) : (
                          <>
                            <Camera size={20} />
                            Chercher par photo
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {scanResult && (
                <div className="absolute top-20 left-4 right-4 bg-blue-600 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-bounce">
                  <CheckCircle2 size={24} />
                  <p className="font-bold">{scanResult}</p>
                </div>
              )}
            </motion.div>
          )}

          {view === 'reminders' && (
            <motion.div
              key="reminders"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4 mb-8">
                <button onClick={() => setView('list')} className="p-2 hover:bg-gray-100 rounded-full">
                  <ArrowLeft size={24} />
                </button>
                <h2 className="text-2xl font-bold">Rappels Sortie SAP</h2>
              </div>

              <div className="space-y-4">
                {reminders.map(item => (
                  <div key={item.id} className="bg-white p-4 rounded-2xl border border-gray-200 flex items-center gap-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-gray-900">{item.name}</h3>
                      <div className="flex items-center gap-3 mt-1">
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Barcode size={12} />
                          <span className="font-mono">{item.sapCode}</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-orange-600 font-medium">
                          <Clock size={12} />
                          <span>Sortie le {item.lastExitDate}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="px-2 py-1 bg-orange-50 text-orange-700 text-[10px] font-bold rounded-lg uppercase tracking-wider">En attente SAP</span>
                      <button className="text-xs text-blue-600 font-bold hover:underline">Valider sortie</button>
                    </div>
                  </div>
                ))}

                {reminders.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <CheckCircle2 size={48} strokeWidth={1} className="mb-4 opacity-20" />
                    <p className="text-lg font-medium">Tous les rappels sont à jour</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Item Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItem(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              layoutId={selectedItem.id}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-blue-600 text-white">
                <div>
                  {selectedItem.category && selectedItem.category.toLowerCase().trim() !== 'non spécifié' && (
                    <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest mb-1">{selectedItem.category}</p>
                  )}
                  <h2 className="text-lg font-bold">{selectedItem.name}</h2>
                </div>
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="p-2 hover:bg-white/10 rounded-full transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Code SAP</p>
                    <p className="font-mono font-bold text-gray-900">{selectedItem.sapCode}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Emplacement</p>
                    <p className="font-bold text-gray-900">{selectedItem.location}</p>
                  </div>
                </div>

                {selectedItem.reminderActive && (
                  <div className="bg-orange-50 border border-orange-100 p-4 rounded-2xl flex items-start gap-3">
                    <AlertCircle className="text-orange-600 shrink-0" size={20} />
                    <div>
                      <p className="text-sm font-bold text-orange-800">Rappel de sortie SAP actif</p>
                      <p className="text-xs text-orange-700 mt-0.5">Cet article a été sorti physiquement mais n'a pas encore été validé dans SAP.</p>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      const isTaking = !selectedItem.reminderActive;
                      
                      setCatalogItems(prev => prev.map(item => 
                        item.id === selectedItem.id 
                          ? { ...item, reminderActive: !item.reminderActive }
                          : item
                      ));
                      setSelectedItem(prev => prev ? { ...prev, reminderActive: !prev.reminderActive } : null);

                      if (isTaking) {
                        const subject = encodeURIComponent(`Sortie Article : ${selectedItem.name}`);
                        const body = encodeURIComponent(
                          `Bonjour,\n\n` +
                          `L'article suivant a été sorti du stock :\n` +
                          `- Désignation : ${selectedItem.name}\n` +
                          `- Code SAP : ${selectedItem.sapCode}\n` +
                          `- Emplacement : ${selectedItem.location}\n\n` +
                          `Merci d'effectuer la sortie dans SAP.`
                        );
                        // Remplacez l'adresse ci-dessous par l'adresse réelle
                        window.location.href = `mailto:votre-email@exemple.com?subject=${subject}&body=${body}`;
                      }
                    }}
                    className={cn(
                      "flex-1 py-4 rounded-2xl font-bold active:scale-95 transition-all",
                      selectedItem.reminderActive 
                        ? "bg-white border border-gray-200 text-gray-900 hover:bg-gray-50"
                        : "bg-blue-600 text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700"
                    )}
                  >
                    {selectedItem.reminderActive ? "Retirer des rappels" : "Prendre"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-200 px-6 py-3 flex items-center justify-around z-50 safe-area-bottom">
        <button 
          onClick={() => setView('list')}
          className={cn(
            "flex flex-col items-center gap-1 transition-all",
            view === 'list' ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
          )}
        >
          <Package size={24} strokeWidth={view === 'list' ? 2.5 : 2} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Catalogue</span>
        </button>
        
        <button 
          onClick={() => setView('scan')}
          className="relative -top-6 w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-200 active:scale-90 transition-all border-4 border-white"
        >
          <Camera size={32} />
        </button>

        <button 
          onClick={() => setView('reminders')}
          className={cn(
            "flex flex-col items-center gap-1 transition-all",
            view === 'reminders' ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
          )}
        >
          <Bell size={24} strokeWidth={view === 'reminders' ? 2.5 : 2} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Rappels</span>
        </button>
      </nav>

      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .safe-area-bottom {
          padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
        }
      `}</style>
    </div>
  );
}
