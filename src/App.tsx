import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Search, Camera, Bell, Package, MapPin, Barcode, ChevronRight, 
  X, ArrowLeft, AlertCircle, CheckCircle2, Clock, FileUp, Zap, Mic,
  LayoutGrid, ScanLine, Home, StickyNote, Trash2, Plus, Pencil, ImageIcon, Share2, ShoppingCart, Minus, Wrench, Settings, Sun, Moon, Sparkles, Bot, Send, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { CatalogItem, View, EquipmentItem } from './types';
import { MOCK_CATALOG } from './constants';
import { cn } from './lib/utils';

const CATALOG_URL = 'https://raw.githubusercontent.com/jcmolinie-byte/catalogue_G/main/public/catalogue.xlsx';
const EQUIPMENTS_URL = 'https://raw.githubusercontent.com/jcmolinie-byte/catalogue_G/main/public/catalogue_postes_techniques_nesle.xlsx';

// --- UTILITAIRES DE NORMALISATION ---
const normalizeText = (text: string) => {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') 
    .replace(/,/g, '.') 
    .replace(/[^a-z0-9.]/g, '') 
    .trim();
};

const HighlightedText = ({ text, highlight }: { text: string; highlight: string }) => {
  if (!highlight.trim()) return <>{text}</>;
  
  const words = highlight.trim().split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return <>{text}</>;
  
  // Fonction pour enlever les accents
  const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  const textNorm = strip(text);
  
  // Tolérance singulier/pluriel : on cherche la racine ET la forme exacte
  const wordsNorm = words.map(w => {
    let cleaned = strip(w);
    // Si le mot fait plus de 3 lettres et finit par 's' ou 'x', on enlève la terminaison
    if (cleaned.length > 3 && (cleaned.endsWith('s') || cleaned.endsWith('x'))) {
      return cleaned.slice(0, -1);
    }
    return cleaned;
  });
  
  // Trouver tous les segments à surligner
  let matches: {start: number, end: number}[] = [];
  wordsNorm.forEach(rootWord => {
    // On cherche la racine dans le texte (trouvera "chaussure" ET "chaussures")
    let pos = textNorm.indexOf(rootWord);
    while (pos !== -1) {
      // Déterminer la fin réelle du mot dans le texte (inclure s/x final éventuel)
      let endPos = pos + rootWord.length;
      if (endPos < textNorm.length && (textNorm[endPos] === 's' || textNorm[endPos] === 'x')) {
        endPos++;
      }
      matches.push({ start: pos, end: endPos });
      pos = textNorm.indexOf(rootWord, pos + 1);
    }
  });

  if (matches.length === 0) return <>{text}</>;

  // Fusionner les segments qui se chevauchent
  matches.sort((a, b) => a.start - b.start);
  const merged: {start: number, end: number}[] = [];
  if (matches.length > 0) {
    let current = matches[0];
    for (let i = 1; i < matches.length; i++) {
      if (matches[i].start <= current.end) {
        current.end = Math.max(current.end, matches[i].end);
      } else {
        merged.push(current);
        current = matches[i];
      }
    }
    merged.push(current);
  }

  // Construire le résultat final
  const result: (string | JSX.Element)[] = [];
  let lastPos = 0;
  merged.forEach((m, i) => {
    // Texte avant le match
    if (m.start > lastPos) {
      result.push(text.substring(lastPos, m.start));
    }
    // Texte surligné (on prend le texte ORIGINAL avec les accents)
    result.push(
      <span key={i} className="text-yellow-400 font-extrabold bg-yellow-400/10 rounded-sm px-0.5">
        {text.substring(m.start, m.end)}
      </span>
    );
    lastPos = m.end;
  });
  
  // Reste du texte
  if (lastPos < text.length) {
    result.push(text.substring(lastPos));
  }

  return <>{result}</>;
};

interface AIAnalysis {
  type: string;
  brand: string;
  model: string;
  specs: string[];
  description: string;
  raw_ocr?: string;
}

interface Note {
  id: string;
  title: string;
  content: string;
  image?: string; // Image en Base64
  createdAt: string;
  updatedAt: string;
}

interface CompanionResult {
  id: string;
  score: number;
  title: string;
  subtitle: string;
  equipmentId?: string;
  equipmentLabel?: string;
  sapCode?: string;
  quantity?: number;
  catalogItem?: CatalogItem;
}

interface CompanionSource {
  label: string;
  url: string;
}

interface CompanionMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  results?: CompanionResult[];
  sources?: CompanionSource[];
}

interface CompanionIntent {
  intent: 'stock_search' | 'equipment_search' | 'technical_info' | 'unknown';
  itemTerms: string[];
  requiredTerms: string[];
  optionalTerms: string[];
  equipmentCode?: string;
  sapCode?: string;
  needsInternet?: boolean;
}

export default function App() {
  // --- ÉTATS ---
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>(() => {
    try {
      const saved = localStorage.getItem('nesle_catalog');
      return saved ? JSON.parse(saved) : MOCK_CATALOG;
    } catch (e) {
      return MOCK_CATALOG;
    }
  });

  const catalogItemsRef = useRef(catalogItems);

  useEffect(() => {
    catalogItemsRef.current = catalogItems;
    try {
      localStorage.setItem('nesle_catalog', JSON.stringify(catalogItems));
    } catch (e) {
      console.warn('Quota localStorage dépassé pour le catalogue');
    }
  }, [catalogItems]);

  const [equipments, setEquipments] = useState<EquipmentItem[]>(() => {
    try {
      const saved = localStorage.getItem('nesle_equipments');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('nesle_equipments', JSON.stringify(equipments));
    } catch (e) {
      console.warn('Quota localStorage dépassé pour les équipements');
    }
  }, [equipments]);

  const [view, setView] = useState<View>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [equipmentSearchQuery, setEquipmentSearchQuery] = useState('');
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [hasFlash, setHasFlash] = useState(false);
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [itemsLimit, setItemsLimit] = useState(20);
  const [isImporting, setIsImporting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [aiMatches, setAiMatches] = useState<(CatalogItem & { score: number })[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSendingRestock, setIsSendingRestock] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [companionInput, setCompanionInput] = useState('');
  const [isCompanionThinking, setIsCompanionThinking] = useState(false);
  const [companionMessages, setCompanionMessages] = useState<CompanionMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Bonjour, je suis votre compagnon magasin. Demandez-moi par exemple : trouve le débitmètre dans le 9x918-22, ou quelles sont les caractéristiques de cet article ?"
    }
  ]);
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : true; // Sombre par défaut
  });

  useEffect(() => {
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const handleRequestRestock = async (item: CatalogItem) => {
    try {
      setIsSendingRestock(true);
      const emailBody = `Demande de réapprovisionnement pour l'article :\n\nDésignation : ${item.name}\nCode SAP : ${item.sapCode}\nEmplacement : ${item.location}`;
      
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: 'service_t0kr7ei',
          template_id: 'template_uqdy7bd',
          user_id: 've1No9SWlFGQ5ujQ0',
          template_params: {
            message: emailBody
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`EmailJS a refusé (${response.status}) : ${errorText}`);
      }
      
      setToastMessage('Demande de réapprovisionnement envoyée avec succès au magasin !');
      setTimeout(() => setToastMessage(null), 3000);
      setSelectedItem(null); // On ferme la fenêtre après succès
    } catch (err: any) {
      console.error(err);
      alert(`Erreur d'envoi :\n${err.message}\n\nVérifiez votre console F12 pour plus de détails.`);
    } finally {
      setIsSendingRestock(false);
    }
  };

  // --- BLOC-NOTES ---
  const [notes, setNotes] = useState<Note[]>(() => {
    try {
      const saved = localStorage.getItem('nesle_notes');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteImage, setNoteImage] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('nesle_notes', JSON.stringify(notes));
  }, [notes]);

  const saveNote = () => {
    if (!noteTitle.trim() && !noteContent.trim() && !noteImage) return;
    if (editingNote) {
      setNotes(prev => prev.map(n => n.id === editingNote.id ? { ...n, title: noteTitle, content: noteContent, image: noteImage || undefined, updatedAt: new Date().toISOString() } : n));
    } else {
      const newNote: Note = {
        id: `note-${Date.now()}`,
        title: noteTitle || 'Sans titre',
        content: noteContent,
        image: noteImage || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setNotes(prev => [newNote, ...prev]);
    }
    setEditingNote(null);
    setNoteTitle('');
    setNoteContent('');
    setNoteImage(null);
  };

  const deleteNote = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    if (editingNote?.id === id) {
      setEditingNote(null);
      setNoteTitle('');
      setNoteContent('');
      setNoteImage(null);
    }
  };

  const startEditNote = (note: Note) => {
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteContent(note.content);
    setNoteImage(note.image || null);
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const scanLoopRef = useRef<number | null>(null);
  const zxingReaderRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  // --- RECHERCHE VOCALE ---
  const toggleVoiceSearch = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const SpeechGrammarList = (window as any).SpeechGrammarList || (window as any).webkitSpeechGrammarList;
    
    if (!SpeechRecognition) {
      alert("La reconnaissance vocale n'est pas supportée.");
      return;
    }

    const recognition = new SpeechRecognition();
    
    // Grammaire ultra-simplifiée pour éviter la latence
    if (SpeechGrammarList && catalogItemsRef.current.length < 500) {
      try {
        const words = Array.from(new Set(catalogItemsRef.current.map(i => i.name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')))).slice(0, 50);
        const grammar = `#JSGF V1.0; grammar words; public <word> = ${words.join(' | ')} ;`;
        const speechRecognitionList = new SpeechGrammarList();
        speechRecognitionList.addFromString(grammar, 1);
        recognition.grammars = speechRecognitionList;
      } catch (e) { console.error(e); }
    }

    recognitionRef.current = recognition;
    recognition.lang = 'fr-FR';
    recognition.continuous = true; // On écoute en continu pour ne pas rater les petits mots
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };
    
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        transcript += event.results[i][0].transcript;
      }
      
      const cleanTranscript = transcript
        .toLowerCase()
        .replace(/[.,!?]/g, '')
        .trim();
        
      setSearchQuery(cleanTranscript);
    };
    
    recognition.onnomatch = (event: any) => {
    };
    
    recognition.onerror = (e: any) => {
      setIsListening(false);
    };
    
    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onspeechend = () => {
      recognition.stop();
      setIsListening(false);
    };
    recognition.start();
  };

  // --- LOGIQUE IMAGE (PHOTOS & GALERIE) ---
  const handleImageSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 800;
        let width = img.width;
        let height = img.height;

        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = width * ratio;
          height = height * ratio;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const base64 = canvas.toDataURL('image/jpeg', 0.7);
        setPendingPhoto(base64);
        setView('photo-preview');
        // On vide l'input pour permettre de sélectionner à nouveau la même photo
        e.target.value = '';
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const capturePhotoForNote = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    const width = videoRef.current.videoWidth;
    const height = videoRef.current.videoHeight;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(videoRef.current, 0, 0, width, height);
    
    const base64 = canvas.toDataURL('image/jpeg', 0.7);
    setPendingPhoto(base64);
    setView('photo-preview');
  };

  // --- LOGIQUE D'IMPORT XLSX ---
  const parseEquipmentsExcelData = (data: any) => {
    try {
      const workbook = XLSX.read(data, { type: 'array' });
      let allEquipments: any[] = [];

      // On parcourt TOUS les onglets (Données, Index_Equipement, etc.)
      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        
        if (json && json.length > 0) {
          const sheetItems = json.map((row: any, index) => {
            const getValue = (keys: string[]) => {
              const foundKey = Object.keys(row).find(k =>
                keys.some(key => k.toLowerCase().trim() === key.toLowerCase())
              );
              return foundKey ? row[foundKey] : null;
            };

            // Définition des colonnes à chercher (on ignore désormais Sous_Zone)
            let keysToSearch = ['Equipement', 'équipement', 'poste technique'];
            
            if (sheetName === 'Index_Equipement') {
              // Si l'onglet Index_Equipement ne contient que des Sous_Zone, on cherche quand même Equipement
              // S'il n'y en a pas, la ligne sera ignorée plus bas.
              keysToSearch = ['Equipement', 'équipement', 'poste technique'];
            }

            const equipmentId = String(getValue(keysToSearch) || '');
            
            // Si on ne trouve pas d'identifiant de poste sur cette ligne, on l'ignore
            if (!equipmentId) return null;

            return {
              id: `equip-${sheetName}-${index}-${Date.now()}`,
              equipment: equipmentId,
              equipmentLabel: String(getValue(['Libellé équipement', 'libelle equipement', 'Libelle_Equipement', 'Libellé_Equipement', 'libelle', 'description equipement']) || ''),
              sapCode: String(getValue(['Article', 'SAP', 'Code SAP', 'Référence']) || ''),
              designation: String(getValue(['Désignation', 'designation', 'nom', 'description']) || ''),
              quantity: Number(getValue(['Quantité', 'quantite', 'qte', 'qté']) || 0)
            };
          }).filter(Boolean); // On retire les lignes vides

          allEquipments = [...allEquipments, ...sheetItems];
        }
      });

      return allEquipments.length > 0 ? allEquipments : null;
    } catch (err) {
      console.error("Error parsing Equipments Excel:", err);
      return null;
    }
  };

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
          sapCode: String(getValue(['Code Article', 'Code article', 'Article', 'SAP', 'Code SAP', 'Référence']) || 'N/A'),
          location: String(getValue(['Emplacemt', 'Emplacement', 'Location', 'Zone']) || 'Non spécifié'),
          cartQuantity: 0
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
        alert(`${importedItems.length} articles chargés !`);
      }
      setIsImporting(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const fetchGitHubCatalog = async () => {
    try {
      setIsSyncing(true);

      // Synchro des équipements depuis GitHub
      try {
        const eqResp = await fetch(EQUIPMENTS_URL);
        if (eqResp.ok) {
          const eqData = await eqResp.arrayBuffer();
          const importedEquips = parseEquipmentsExcelData(eqData);
          if (importedEquips) setEquipments(importedEquips);
        }
      } catch (err) { console.error("Erreur sync Equipements GitHub:", err); }

      const response = await fetch(CATALOG_URL);
      if (!response.ok) throw new Error('Erreur lors du téléchargement du catalogue');
      
      const data = await response.arrayBuffer();
      const importedItems = parseExcelData(data);
      
      if (importedItems) {
        setCatalogItems(importedItems);
        console.log(`${importedItems.length} articles synchronisés depuis GitHub !`);
      }
    } catch (err) {
      console.error("Erreur sync GitHub:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchGitHubCatalog();
  }, []);

  // --- LOGIQUE DE SCAN CODE-BARRES ---
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
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const track = stream.getVideoTracks()[0];
      try {
        const caps = track.getCapabilities() as any;
        if (caps?.torch) setHasFlash(true);
      } catch (e) {
        console.warn("Torch capabilities check failed (common on iOS/some browsers)", e);
      }

      // Petite pause pour laisser Safari stabiliser le flux vidéo
      await new Promise(r => setTimeout(r, 300));

      if (view === 'scan') {
        const BarcodeDetectorAPI = (window as any).BarcodeDetector;
        if (BarcodeDetectorAPI && (await BarcodeDetectorAPI.getSupportedFormats()).includes('code_128')) {
          const detector = new BarcodeDetectorAPI({ formats: ['code_128', 'code_39', 'ean_13'] });
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
              } catch (e) {}
            }
            scanLoopRef.current = requestAnimationFrame(scanLoop);
          };
          scanLoopRef.current = requestAnimationFrame(scanLoop);
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          zxingReaderRef.current = reader;
          const scan = async () => {
            while (isActive && videoRef.current) {
              try {
                const result = await reader.decodeFromVideoElement(videoRef.current);
                if (result && isActive) {
                  isActive = false;
                  handleScanResult(result.getText());
                  break;
                }
              } catch (e) {}
              await new Promise(r => setTimeout(r, 200));
            }
          };
          scan();
        }
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
    setHasFlash(false);
  };

  const shareNote = async (note: Note) => {
    try {
      const shareData: any = {
        title: note.title || 'Note Magasin',
        text: note.content
      };

      if (note.image && navigator.canShare) {
        try {
          const res = await fetch(note.image);
          const blob = await res.blob();
          const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
          if (navigator.canShare({ files: [file] })) {
            shareData.files = [file];
          }
        } catch (e) {
          console.error("Erreur conversion image:", e);
        }
      }

      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        const body = `${note.content}${note.image ? "\n\n(Note avec photo - partageable sur mobile)" : ""}`;
        window.location.href = `mailto:?subject=${encodeURIComponent(note.title || 'Note Magasin')}&body=${encodeURIComponent(body)}`;
      }
    } catch (err) {
      console.error("Erreur partage:", err);
    }
  };

  const handleScanResult = (code: string) => {
    if (navigator.vibrate) navigator.vibrate(100);
    let cleanCode = code.trim();
    if (cleanCode.startsWith(']C1')) cleanCode = cleanCode.substring(3);
    setScanResult(`Code détecté : ${cleanCode}`);
    const foundItem = catalogItemsRef.current.find(item =>
      String(item.sapCode).trim() === cleanCode || cleanCode.includes(String(item.sapCode).trim())
    );
    setTimeout(() => {
      if (foundItem) setSelectedItem(foundItem);
      else setSearchQuery(cleanCode);
      setView('list');
      setScanResult(null);
    }, 800);
  };

  useEffect(() => {
    if (view === 'scan' || view === 'ai-scan' || view === 'camera-simple') startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [view]);

  const scoreItem = (item: CatalogItem, ai: AIAnalysis): number => {
    const cleanString = (s: string | undefined) => s ? String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/,/g, '.') : '';
    
    // Pour une recherche plus tolérante, on remplace certains raccourcis du catalogue
    let itemName = cleanString(item.name);
    // Remplacement des abréviations courantes
    itemName = itemName.replace(/\bmot\./g, 'moteur ').replace(/\bmot\b/g, 'moteur ');
    
    const itemNameClean = itemName;
    const itemSapClean = cleanString(item.sapCode);
    const searchableText = `${itemNameClean} ${itemSapClean} ${cleanString(item.category)}`;
    const searchableNoSpace = searchableText.replace(/[^a-z0-9.]/g, '');
    
    let score = 0;
    const aiSpecs = Array.isArray(ai.specs) ? ai.specs : (ai.specs ? [String(ai.specs)] : []);
    const aiFullText = cleanString(`${ai.raw_ocr || ''} ${ai.type || ''} ${ai.description || ''}`);
    const aiSearchText = cleanString(`${ai.raw_ocr || ''} ${ai.type || ''} ${ai.brand || ''} ${ai.model || ''} ${ai.description || ''} ${aiSpecs.join(' ')}`);
    const aiLooksForMotor = /\bmoteur\b|\bmotor\b/.test(aiFullText);
    const itemLooksLikeMotor = /\bmoteur\b|\bmotor\b/.test(itemNameClean);
    const extractKwValues = (text: string) => {
      const values: number[] = [];
      const regex = /(\d+(?:\.\d+)?)\.?\s*k\s*w/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const value = Number(match[1].replace(/\.$/, ''));
        if (Number.isFinite(value)) values.push(value);
      }
      return values;
    };
    const aiKwValues = extractKwValues(aiSearchText);
    const itemKwValues = extractKwValues(itemNameClean);
    const hasCompatibleKw = aiKwValues.length > 0 && itemKwValues.some(itemKw =>
      aiKwValues.some(aiKw => Math.abs(itemKw - aiKw) <= Math.max(0.05, aiKw * 0.03))
    );
    if (aiKwValues.length > 0 && itemKwValues.length > 0 && !hasCompatibleKw) {
      return 0;
    }
    if (aiLooksForMotor && itemLooksLikeMotor) {
      score += 500;
    }

    // --- MOTS BANIS pour la recherche de modèle (ne doivent pas rapporter de points de modèle) ---
    const stopWords = ['moteur', 'pompe', 'capteur', 'abb', 'sew', 'siemens', 'danfoss', 'variateur', 'reducteur', 'ventilateur', 'triphase', 'monophase'];

    // 1. RECHERCHE DU MODÈLE (Priorité Absolue)
    if (ai.model) {
      const modelClean = cleanString(ai.model).replace(/[^a-z0-9]/g, '');
      // Match exact très strict et puissant (ex: "K37")
      if (modelClean.length > 3 && searchableNoSpace.replace(/\./g, '').includes(modelClean)) {
        score += 2000;
      } else {
        // Match partiel (ex: "K37" dans "Moteur K37-A")
        const modelParts = cleanString(ai.model).split(/[\s\-_/]+/);
        modelParts.forEach(p => {
          // Uniquement si ce n'est pas un mot générique
          if (p.length > 2 && !stopWords.includes(p)) {
            // Si la partie contient des chiffres, c'est un identifiant fort
            const isNumeric = /\d/.test(p);
            if (searchableText.includes(p)) {
              score += isNumeric ? 300 : 50; 
            } else if (searchableNoSpace.includes(p)) {
              score += isNumeric ? 150 : 25; // partiel sans espaces
            }
          }
        });
      }
    }

    // 2. MARQUE
    if (ai.brand) {
      const brandWords = cleanString(ai.brand).split(/[\s\-_/]+/);
      brandWords.forEach(w => {
        if (w.length > 2 && searchableText.includes(w)) {
          score += 150;
        }
      });
    }

    // 3. VALEURS TECHNIQUES (Puissance, tension, etc.)
    if (aiSpecs.length > 0) {
      aiSpecs.forEach(spec => {
        const specClean = cleanString(spec);
        const specNoSpace = specClean.replace(/[^a-z0-9.]/g, '');
        
        // BONUS MAJEUR POUR LA PUISSANCE (ex: 15kW)
        if (specClean.includes('kw')) {
          const kwMatch = specClean.match(/(\d+(?:\.\d+)?)\.?\s*k\s*w/);
          const kwValue = kwMatch ? String(Number(kwMatch[1].replace(/\.$/, ''))) : specNoSpace.replace('kw', '').replace(/\.$/, '');
          const itemPowerText = itemNameClean.replace(/\s+/g, '').replace(/(\d+)\.kw/g, '$1kw');
          if (kwValue && itemPowerText.includes(`${kwValue}kw`)) {
            score += 6000; // Un match sur la puissance est prioritaire
          }
        }

        const commonSpec = specClean.includes('kw') || ['50hz', '60hz', '230v', '240v', '380v', '400v', '415v', '460v'].includes(specNoSpace);
        if (!commonSpec && specNoSpace.length > 1 && searchableNoSpace.includes(specNoSpace)) {
          score += 150; // Match complet avec l'unité
        } else if (!commonSpec) {
          // Extraction du nombre uniquement (ex: "0.75" dans "0.75kW" ou "220" dans "220D")
          const numMatch = specNoSpace.match(/[0-9]+([.][0-9]+)?/);
          if (numMatch) {
            const num = numMatch[0];
            if (num !== "0" && num !== "1" && searchableText.includes(num)) {
               score += 80;
            }
          }
        }
      });
    }

    // 4. TYPE GÉNÉRIQUE
    if (ai.type) {
      const typeWords = cleanString(ai.type).split(/[\s\-_/]+/);
      typeWords.forEach(w => {
        if (w.length > 3 && searchableText.includes(w)) {
           score += 100;
        }
      });
    }

    // BONUS : Si le N° SAP exact a été lu par l'IA (sur une étiquette par ex)
    if (item.sapCode && item.sapCode !== 'N/A') {
      const sapStr = String(item.sapCode).trim();
      if (sapStr.length >= 5) {
        const aiRawDesc = cleanString(`${ai.raw_ocr || ''} ${ai.model} ${ai.description} ${aiSpecs.join(' ')}`);
        if (aiRawDesc.includes(cleanString(sapStr))) {
          score += 5000;
        }
      }
    }

    if (aiLooksForMotor && !itemLooksLikeMotor) {
      score -= 2500;
      if (score < 3000) return 0;
    }

    return score;
  };

  // --- ANALYSE PHOTO AVEC GEMINI (VISION) ---
  const analyzePhoto = async () => {
    if (!videoRef.current || isAnalyzing) return;
    try {
      setIsAnalyzing(true);
      setAiMatches([]);

      let geminiKey = localStorage.getItem('gemini_api_key') || process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        setView('settings');
        throw new Error('Veuillez configurer votre clé API Gemini dans les paramètres.');
      }

      // Capture image depuis la vidéo
      const canvas = document.createElement('canvas');
      const maxSize = 1200; // Gemini supporte bien la haute résolution
      let width = videoRef.current.videoWidth;
      let height = videoRef.current.videoHeight;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Erreur canvas');
      ctx.drawImage(videoRef.current, 0, 0, width, height);
      
      // On sépare le préfixe data:image/jpeg;base64, pour Gemini
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64Data = dataUrl.split(',')[1];

      // Nettoyage de la clé (supprime les espaces invisibles)
      const cleanKey = geminiKey.trim();

      // Utilisation du dernier modèle Gemini 2.0 Flash (plus robuste et performant)
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cleanKey}`;
      
      const promptIA = `Analyse cette plaque technique industrielle. 
      Extrais les informations suivantes au format JSON :
      - raw_ocr: Tout le texte lisible sur une seule ligne.
      - type: Type de pièce (moteur, pompe, etc.).
      - brand: Marque fabricant.
      - model: Référence précise du modèle.
      - specs: Liste des valeurs techniques (kW, RPM, V, A, Hz...). Identifie surtout la puissance en kW.
      - description: Un court résumé (ex: Moteur 15kW).
      
      Réponds uniquement par le JSON.`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: promptIA },
              { 
                inline_data: { 
                  mime_type: "image/jpeg", 
                  data: base64Data 
                } 
              }
            ]
          }]
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message || `Erreur Google ${response.status}`);
      }

      const data = await response.json();
      const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      const firstBrace = textContent.indexOf('{');
      const lastBrace = textContent.lastIndexOf('}');
      
      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error("Aucun JSON trouvé dans la réponse");
      }
      
      let jsonContent = textContent.substring(firstBrace, lastBrace + 1);

      // --- RÉPARATEUR DE JSON ULTRA-ROBUSTE ---
      // Supprime les caractères de contrôle et tente de gérer les retours à la ligne sauvages
      const sanitized = jsonContent
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ") // Supprime les caractères de contrôle
        .replace(/\n/g, " "); // Remplace les vrais retours à la ligne par des espaces

      let result: AIAnalysis;
      try {
        result = JSON.parse(sanitized);
      } catch (e) {
        // Tentative désespérée : on essaie de nettoyer encore plus
        try {
          const desperateClean = sanitized.replace(/\\/g, "\\\\");
          result = JSON.parse(desperateClean);
        } catch {
          throw new Error(`Analyse illisible : ${sanitized.substring(0, 100)}`);
        }
      }

      const normalizeSpecs = (specs: unknown): string[] => {
        if (Array.isArray(specs)) return specs.map(s => String(s)).filter(Boolean);
        if (specs && typeof specs === 'object') return Object.values(specs as Record<string, unknown>).map(s => String(s)).filter(Boolean);
        return specs ? [String(specs)] : [];
      };
      result.specs = normalizeSpecs((result as any).specs);

      const scored = catalogItemsRef.current
        .map(item => ({ ...item, score: scoreItem(item, result) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (scored.length === 0) {
        const specsText = Array.isArray(result.specs) ? result.specs.join(', ') : String(result.specs || '');
        alert(`IA détecte : ${result.description || 'Inconnu'}\n\nSpécifications lues : ${specsText}\n\nAucun article correspondant dans le catalogue.`);
        return;
      }

      if (scored.length === 1 && scored[0].score >= 500) {
        setSelectedItem(scored[0]);
        setView('list');
      } else {
        const specsText = Array.isArray(result.specs) ? result.specs.join(', ') : String(result.specs || '');
        setAiMatches(scored);
        setScanResult(result.raw_ocr || `${result.brand ? result.brand + ' — ' : ''}${specsText}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Analyse échouée : ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- COMPAGNON IA ---
  const normalizeForCompanion = (value: unknown) =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const companionSearchData = useMemo(() => {
    const sapMap = new Map<string, CatalogItem>();
    const catalogRows = catalogItems.map(item => {
      const sap = String(item.sapCode || '').trim();
      if (sap) {
        sapMap.set(sap, item);
        sapMap.set(normalizeForCompanion(sap), item);
      }

      return {
        item,
        searchable: normalizeForCompanion(`${item.name} ${item.sapCode} ${item.category}`)
      };
    });

    const getCatalogBySap = (sapCode?: string) => {
      const sap = String(sapCode || '').trim();
      if (!sap) return undefined;
      return sapMap.get(sap) || sapMap.get(normalizeForCompanion(sap));
    };

    const equipmentRows = equipments.map(part => {
      const catalogItem = getCatalogBySap(part.sapCode);
      return {
        part,
        catalogItem,
        compactEquipment: normalizeForCompanion(part.equipment).replace(/\s/g, ''),
        compactLabel: normalizeForCompanion(part.equipmentLabel).replace(/\s/g, ''),
        searchable: normalizeForCompanion(`${part.designation} ${part.sapCode} ${part.equipment} ${part.equipmentLabel} ${catalogItem?.name || ''} ${catalogItem?.category || ''}`)
      };
    });

    return { sapMap, catalogRows, equipmentRows };
  }, [catalogItems, equipments]);

  const findCatalogItemBySap = (sapCode?: string) => {
    const cleanSap = String(sapCode || '').trim();
    if (!cleanSap) return undefined;
    return companionSearchData.sapMap.get(cleanSap) || companionSearchData.sapMap.get(normalizeForCompanion(cleanSap)) || catalogItemsRef.current.find(item => {
      const itemSap = String(item.sapCode || '').trim();
      return itemSap === cleanSap || cleanSap.includes(itemSap) || itemSap.includes(cleanSap);
    });
  };

  const buildCompanionSources = (question: string, bestResult?: CompanionResult): CompanionSource[] => {
    const sourceQuery = [
      bestResult?.catalogItem?.name,
      bestResult?.subtitle,
      bestResult?.sapCode,
      question
    ].filter(Boolean).join(' ');

    const encoded = encodeURIComponent(sourceQuery || question);
    const pdfEncoded = encodeURIComponent(`${sourceQuery || question} datasheet pdf fiche technique`);

    return [
      { label: 'Recherche web', url: `https://www.google.com/search?q=${encoded}` },
      { label: 'Fiche technique PDF', url: `https://www.google.com/search?q=${pdfEncoded}` },
      { label: 'Recherche fabricant', url: `https://www.bing.com/search?q=${encoded}` }
    ];
  };

  const extractKwValues = (value: unknown) => {
    const text = String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/,/g, '.');
    const values: number[] = [];
    const regex = /(\d+(?:\.\d+)?)\s*k\s*w/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const value = Number(match[1]);
      if (!Number.isNaN(value)) values.push(value);
    }

    return values;
  };

  const scoreKwMatch = (requestedKwValues: number[], searchableText: string) => {
    if (requestedKwValues.length === 0) return 0;

    const itemKwValues = extractKwValues(searchableText);
    if (itemKwValues.length === 0) return 0;

    const hasExactMatch = requestedKwValues.some(requested =>
      itemKwValues.some(found => Math.abs(found - requested) < 0.01)
    );

    return hasExactMatch ? 600 : -220;
  };

  const companionStopWords = new Set([
    'trouve', 'trouver', 'cherche', 'chercher', 'moi', 'dans', 'sur', 'avec', 'pour', 'les', 'des',
    'une', 'un', 'le', 'la', 'du', 'de', 'd', 'l', 'quel', 'quelle', 'quels', 'quelles', 'sont',
    'caracteristiques', 'caracteristique', 'article', 'articles', 'poste', 'technique', 'ref',
    'reference', 'sap', 'est', 'ce', 'cet', 'cette', 'avons', 'nous', 'magasin', 'stock',
    'disponible', 'disponibles', 'avoir', 'avez', 'as', 'tu', 'il', 'y', 'a'
  ]);

  const technicalShortTokens = new Set(['ph', 'mv', 'kw', 'hz', 'v', 'a']);

  const expandCompanionTerm = (term: string) => {
    const token = normalizeForCompanion(term);
    if (!token) return [];
    const variants = new Set([token]);

    if (token === 'debimetre' || token === 'debitmetre') ['debimetre', 'debitmetre', 'debit', 'flowmeter'].forEach(v => variants.add(v));
    if (token === 'sonde' || token === 'sondes') ['sonde', 'electrode', 'capteur', 'probe'].forEach(v => variants.add(v));
    if (token === 'capteur' || token === 'capteurs') ['capteur', 'sensor', 'sonde'].forEach(v => variants.add(v));
    if (token === 'pompe' || token === 'pompes') ['pompe', 'pump'].forEach(v => variants.add(v));
    if (token === 'moteur' || token === 'moteurs') ['moteur', 'motor'].forEach(v => variants.add(v));
    if (token.length > 3 && (token.endsWith('s') || token.endsWith('x'))) variants.add(token.slice(0, -1));

    return Array.from(variants);
  };

  const matchesCompanionTerm = (searchable: string, term: string) => {
    const variants = expandCompanionTerm(term);
    return variants.some(variant => {
      if (technicalShortTokens.has(variant)) {
        return searchable.includes(variant);
      }
      return searchable.includes(variant);
    });
  };

  const buildFallbackCompanionIntent = (question: string): CompanionIntent => {
    const normalizedQuestion = normalizeForCompanion(question);
    const tokens = normalizedQuestion.split(/\s+/).filter(Boolean);
    const equipmentCodeFromText = question.match(/[a-z0-9]+(?:[-_/][a-z0-9]+)+/i)?.[0];
    const sapCode = question.match(/\b\d{6,}\b/)?.[0];
    const itemTerms = tokens.filter(token =>
      (token.length > 2 || technicalShortTokens.has(token)) &&
      !companionStopWords.has(token) &&
      token !== normalizeForCompanion(equipmentCodeFromText || '') &&
      token !== sapCode
    );

    return {
      intent: /caracteristique|fiche|technique|manuel|datasheet|internet|web/i.test(normalizedQuestion) ? 'technical_info' : 'stock_search',
      itemTerms,
      requiredTerms: itemTerms.slice(0, 4),
      optionalTerms: [],
      equipmentCode: equipmentCodeFromText,
      sapCode,
      needsInternet: /caracteristique|fiche|technique|manuel|datasheet|internet|web/i.test(normalizedQuestion)
    };
  };

  const interpretCompanionQuestion = async (question: string): Promise<CompanionIntent> => {
    const fallback = buildFallbackCompanionIntent(question);
    const geminiKey = localStorage.getItem('gemini_api_key') || process.env.GEMINI_API_KEY;
    if (!geminiKey) return fallback;

    try {
      const cleanKey = geminiKey.trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cleanKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Analyse cette demande d'un magasin industriel et retourne uniquement un JSON.
Question: ${question}

Schema:
{
  "intent": "stock_search" | "equipment_search" | "technical_info" | "unknown",
  "itemTerms": ["mots metier importants, sans mots generiques"],
  "requiredTerms": ["concepts obligatoires pour accepter un resultat"],
  "optionalTerms": ["concepts utiles mais non obligatoires"],
  "equipmentCode": "code poste technique si present, sinon chaine vide",
  "sapCode": "code SAP si present, sinon chaine vide",
  "needsInternet": true | false
}

Regles:
- Pour "avons nous des sondes ph au magasin", requiredTerms doit contenir "sonde" et "ph".
- "magasin", "stock", "avons nous", "article" ne sont jamais des itemTerms.
- Ne devine pas un article si les concepts obligatoires ne sont pas presents.`
            }]
          }]
        })
      });

      if (!response.ok) return fallback;
      const data = await response.json();
      const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const firstBrace = textContent.indexOf('{');
      const lastBrace = textContent.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1) return fallback;

      const parsed = JSON.parse(textContent.substring(firstBrace, lastBrace + 1));
      const cleanTerms = (value: unknown) =>
        (Array.isArray(value) ? value : [])
          .map(term => normalizeForCompanion(term))
          .filter(term => term && !companionStopWords.has(term));

      const intent: CompanionIntent = {
        intent: ['stock_search', 'equipment_search', 'technical_info', 'unknown'].includes(parsed.intent) ? parsed.intent : fallback.intent,
        itemTerms: cleanTerms(parsed.itemTerms),
        requiredTerms: cleanTerms(parsed.requiredTerms),
        optionalTerms: cleanTerms(parsed.optionalTerms),
        equipmentCode: parsed.equipmentCode || fallback.equipmentCode,
        sapCode: parsed.sapCode || fallback.sapCode,
        needsInternet: Boolean(parsed.needsInternet ?? fallback.needsInternet)
      };

      if (intent.requiredTerms.length === 0) intent.requiredTerms = fallback.requiredTerms;
      if (intent.itemTerms.length === 0) intent.itemTerms = fallback.itemTerms;
      return intent;
    } catch (err) {
      console.warn('Interpretation compagnon en fallback', err);
      return fallback;
    }
  };

  const findCompanionResults = (question: string, intent: CompanionIntent): CompanionResult[] => {
    const normalizedQuestion = normalizeForCompanion(question);
    const requestedKwValues = extractKwValues(question);
    const tokens = normalizedQuestion.split(/\s+/).filter(Boolean);
    const equipmentLikeTokens = tokens.filter(token => /\d/.test(token) && token.length >= 4);
    const equipmentCodeFromText = intent.equipmentCode || question.match(/[a-z0-9]+(?:[-_/][a-z0-9]+)+/i)?.[0];
    const normalizedEquipmentCode = normalizeForCompanion(equipmentCodeFromText || '').replace(/\s/g, '');
    const requiredTerms = intent.requiredTerms.length > 0 ? intent.requiredTerms : intent.itemTerms;
    const optionalTerms = Array.from(new Set([...intent.itemTerms, ...intent.optionalTerms]));

    const equipmentPool = companionSearchData.equipmentRows.filter(({ part, compactEquipment, compactLabel }) => {
      if (!normalizedEquipmentCode && equipmentLikeTokens.length === 0) return true;
      if (normalizedEquipmentCode && (compactEquipment.includes(normalizedEquipmentCode) || compactLabel.includes(normalizedEquipmentCode))) return true;
      return equipmentLikeTokens.some(token => compactEquipment.includes(token) || compactLabel.includes(token));
    });

    const equipmentResults = equipmentPool.map(({ part, catalogItem, searchable, compactEquipment }) => {
      const rawTechnicalText = `${part.designation} ${catalogItem?.name || ''}`;
      let score = 0;

      if (requiredTerms.length > 0 && !requiredTerms.every(term => matchesCompanionTerm(searchable, term))) return null;
      if (normalizedEquipmentCode && compactEquipment.includes(normalizedEquipmentCode)) score += 100;
      requiredTerms.forEach(term => {
        if (matchesCompanionTerm(searchable, term)) score += term.length > 4 ? 90 : 70;
      });
      optionalTerms.forEach(term => {
        if (!requiredTerms.includes(term) && matchesCompanionTerm(searchable, term)) score += term.length > 4 ? 35 : 20;
      });
      score += scoreKwMatch(requestedKwValues, rawTechnicalText);
      if (catalogItem) score += 15;
      if (part.sapCode && normalizedQuestion.includes(normalizeForCompanion(part.sapCode))) score += 120;

      return {
        id: part.id,
        score,
        title: catalogItem?.name || part.designation || 'Article sans designation',
        subtitle: part.designation,
        equipmentId: part.equipment,
        equipmentLabel: part.equipmentLabel,
        sapCode: part.sapCode,
        quantity: part.quantity,
        catalogItem
      };
    }).filter((result): result is CompanionResult => Boolean(result && result.score > 0));

    const catalogResults = companionSearchData.catalogRows.map(({ item, searchable }) => {
      const rawTechnicalText = `${item.name} ${item.category}`;
      let score = 0;

      if (requiredTerms.length > 0 && !requiredTerms.every(term => matchesCompanionTerm(searchable, term))) return null;
      requiredTerms.forEach(term => {
        if (matchesCompanionTerm(searchable, term)) score += term.length > 4 ? 80 : 60;
      });
      optionalTerms.forEach(term => {
        if (!requiredTerms.includes(term) && matchesCompanionTerm(searchable, term)) score += term.length > 4 ? 25 : 15;
      });
      score += scoreKwMatch(requestedKwValues, rawTechnicalText);
      if (item.sapCode && normalizedQuestion.includes(normalizeForCompanion(item.sapCode))) score += 120;
      return {
        id: `catalog-${item.id}`,
        score,
        title: item.name,
        subtitle: `${item.category} - ${item.location}`,
        sapCode: item.sapCode,
        catalogItem: item
      };
    }).filter((result): result is CompanionResult => Boolean(result && result.score > 0));

    return [...equipmentResults, ...catalogResults]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  };

  const buildFallbackCompanionAnswer = (question: string, results: CompanionResult[], intent?: CompanionIntent) => {
    if (results.length === 0) {
      const terms = intent?.requiredTerms?.length ? ` pour : ${intent.requiredTerms.join(', ')}` : '';
      return `Je n'ai pas trouvé de correspondance fiable${terms} dans le catalogue ou les postes techniques. Je préfère ne pas proposer un article qui ne correspond pas à la demande.`;
    }

    const best = results[0];
    const locationText = best.catalogItem?.location ? ` Emplacement magasin : ${best.catalogItem.location}.` : '';
    const equipmentText = best.equipmentId ? ` Poste technique : ${best.equipmentId}.` : '';
    const quantityText = typeof best.quantity === 'number' ? ` Quantité dans la nomenclature : ${best.quantity}.` : '';
    const webHint = /caracteristique|fiche|technique|manuel|datasheet|internet|web/i.test(normalizeForCompanion(question))
      ? " J'ai aussi préparé des recherches web ciblées pour retrouver une fiche technique ou un manuel fabricant."
      : " Vous pouvez ouvrir l'article, consulter le poste technique ou lancer une recherche web ciblée.";

    return `J'ai trouvé une piste principale : ${best.title}. Code SAP : ${best.sapCode || 'non renseigné'}.${equipmentText}${quantityText}${locationText}${webHint}`;
  };

  const askCompanionWithGemini = async (question: string, intent: CompanionIntent, results: CompanionResult[]) => {
    const geminiKey = localStorage.getItem('gemini_api_key') || process.env.GEMINI_API_KEY;
    if (!geminiKey) return buildFallbackCompanionAnswer(question, results, intent);

    const cleanKey = geminiKey.trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cleanKey}`;
    const compactResults = results.map(result => ({
      designation: result.title,
      detail: result.subtitle,
      sap: result.sapCode,
      poste: result.equipmentId,
      libellePoste: result.equipmentLabel,
      quantite: result.quantity,
      emplacement: result.catalogItem?.location
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Tu es un compagnon IA pour un magasin industriel. Reponds en francais, clairement et prudemment.
Question utilisateur: ${question}
Intention comprise: ${JSON.stringify(intent)}
Resultats locaux trouves dans le catalogue et les postes techniques: ${JSON.stringify(compactResults)}

Si des resultats existent, explique le meilleur choix, cite le SAP, le poste technique, la quantite et l'emplacement quand presents.
Si aucun resultat ne respecte les requiredTerms, dis clairement que tu n'as rien trouve. Ne propose jamais un article hors sujet.
Si la question demande des caracteristiques techniques, precise que les liens web proposes doivent etre verifies avec la fiche fabricant.
Ne pretend pas avoir consulte internet directement.`
          }]
        }]
      })
    });

    if (!response.ok) return buildFallbackCompanionAnswer(question, results, intent);
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || buildFallbackCompanionAnswer(question, results, intent);
  };

  const submitCompanionQuestion = async (questionOverride?: string) => {
    const question = (questionOverride || companionInput).trim();
    if (!question || isCompanionThinking) return;

    const userMessage: CompanionMessage = { id: `user-${Date.now()}`, role: 'user', text: question };
    setCompanionMessages(prev => [...prev, userMessage]);
    setCompanionInput('');
    setIsCompanionThinking(true);

    try {
      await new Promise<void>(resolve => setTimeout(resolve, 30));
      const intent = await interpretCompanionQuestion(question);
      const results = findCompanionResults(question, intent);
      const sources = results.length > 0 || intent.needsInternet ? buildCompanionSources(question, results[0]) : [];
      const answer = await askCompanionWithGemini(question, intent, results);
      setCompanionMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: answer,
        results,
        sources
      }]);
    } catch (err: any) {
      console.error(err);
      setCompanionMessages(prev => [...prev, {
        id: `assistant-error-${Date.now()}`,
        role: 'assistant',
        text: `Je n'ai pas réussi à traiter la demande : ${err.message || 'erreur inconnue'}.`
      }]);
    } finally {
      setIsCompanionThinking(false);
    }
  };

  const addCompanionItemToCart = (item: CatalogItem) => {
    setCatalogItems(prev => prev.map(catalogItem =>
      catalogItem.id === item.id
        ? { ...catalogItem, cartQuantity: Math.max(1, catalogItem.cartQuantity || 0) }
        : catalogItem
    ));
    setToastMessage('Article ajouté au panier');
    setTimeout(() => setToastMessage(null), 2500);
  };

  const categories = useMemo(() => Array.from(new Set(catalogItems.map(i => i.category))).filter(c => c !== 'Non spécifié'), [catalogItems]);
  
  const filteredItems = useMemo(() => {
    // Si pas de recherche, on retourne le catalogue tel quel
    if (!searchQuery && !locationQuery && !selectedCategory) return catalogItems;

    // Découpage de la recherche et création de conditions strictes pour les nombres et pluriels
    const searchRegexes = searchQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 0)
      .map(word => {
        // Enlève les accents du mot recherché
        let cleanWord = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        // Tolérance singulier/pluriel : si le mot de plus de 3 lettres finit par 's' ou 'x', on recule d'une lettre
        if (cleanWord.length > 3 && (cleanWord.endsWith('s') || cleanWord.endsWith('x'))) {
           cleanWord = cleanWord.slice(0, -1);
        }

        let pattern = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // On permet au mot de se terminer par s ou x dans le catalogue (si ce n'est pas juste un nombre)
        if (!/^\d+$/.test(cleanWord)) {
           pattern = pattern + '[sx]?';
        }
        
        // Anti-faux-positif (ex: chercher "15" dans "315")
        // Si le mot commence par un chiffre, le caractère d'avant ne doit pas être un chiffre
        if (/^\d/.test(cleanWord)) pattern = '(^|\\D)' + pattern;
        
        // Si le mot finit par un chiffre, le caractère d'après ne doit pas être un chiffre
        if (/\d$/.test(cleanWord)) pattern = pattern + '(\\D|$)';
        
        return new RegExp(pattern, 'i');
      });

    return catalogItems.filter(item => {
      // On retire les accents du texte du catalogue avant de tester
      const normalize = (s: any) => s ? String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
      const itemText = normalize(item.name) + ' ' + normalize(item.sapCode);
      
      // La correspondance est valide OBLIGATOIREMENT si tous les mots valident leur RegExp
      const matchesSearch = searchRegexes.length === 0 || searchRegexes.every(regex => regex.test(itemText));
      
      const matchesLocation = normalize(item.location).includes(normalize(locationQuery));
      const matchesCategory = !selectedCategory || item.category === selectedCategory;
      
      return matchesSearch && matchesLocation && matchesCategory;
    });
  }, [searchQuery, locationQuery, selectedCategory, catalogItems]);

  const cartItems = useMemo(() => catalogItems.filter(item => item.cartQuantity && item.cartQuantity > 0), [catalogItems]);

  return (
    <div className={cn(
      "min-h-screen transition-colors duration-300",
      isDark ? "bg-slate-900 text-white dark" : "bg-slate-50 text-slate-900"
    )}>
      <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx" onChange={handleFileUpload} />
      <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleImageSelection} />



      <main className="max-w-5xl mx-auto p-4 pb-24">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
              className="flex flex-col items-center justify-center pt-8 sm:pt-16"
            >
              {/* Greeting & Theme Toggle */}
              <div className="w-full max-w-md flex justify-between items-center mb-10 px-2">
                <div className="w-10" /> {/* Spacer */}
                <h2 className="text-3xl font-bold">Magasin Nesle</h2>
                <button 
                  onClick={() => setIsDark(!isDark)}
                  className="p-3 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 text-amber-500 dark:text-yellow-400 hover:scale-110 transition-transform"
                >
                  {isDark ? <Sun size={20} /> : <Moon size={20} />}
                </button>
              </div>



              {/* Tiles Grid */}
              <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                {/* Ligne 1 : Catalogue | Postes Tech */}
                <motion.button
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setView('list')}
                  className="group relative bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 flex flex-col items-center gap-3 shadow-sm hover:shadow-xl hover:border-blue-300 transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-blue-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <Search size={26} />
                  </div>
                  <div className="relative text-center">
                    <p className="font-bold text-gray-900 dark:text-white text-sm">Catalogue</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-400 mt-0.5">Recherche Article</p>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setView('equipments')}
                  className="group relative bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 flex flex-col items-center gap-3 shadow-sm hover:shadow-xl hover:border-cyan-300 transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-cyan-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative w-14 h-14 bg-cyan-50 rounded-2xl flex items-center justify-center text-cyan-600 group-hover:bg-cyan-600 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <Wrench size={26} />
                  </div>
                  <div className="relative text-center">
                    <p className="font-bold text-gray-900 dark:text-white text-sm">Postes Tech</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-400 mt-0.5">Nomenclature</p>
                  </div>
                </motion.button>

                {/* Ligne 2 : Scanner | Analyse IA */}
                <motion.button
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setView('scan')}
                  className="group relative bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 flex flex-col items-center gap-3 shadow-sm hover:shadow-xl hover:border-purple-300 transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <ScanLine size={26} />
                  </div>
                  <div className="relative text-center">
                    <p className="font-bold text-gray-900 dark:text-white text-sm">Scanner</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-400 mt-0.5">Code barre</p>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setView('ai-scan')}
                  className="group relative bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 flex flex-col items-center gap-3 shadow-sm hover:shadow-xl hover:border-violet-300 transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-violet-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center text-violet-600 group-hover:bg-violet-600 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <Sparkles size={26} />
                  </div>
                  <div className="relative text-center">
                    <p className="font-bold text-gray-900 dark:text-white text-sm">Analyse IA</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-400 mt-0.5">Plaque technique</p>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setView('companion')}
                  className="col-span-2 group relative bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 flex items-center justify-center gap-6 shadow-sm hover:shadow-xl hover:border-teal-300 transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-blue-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative w-14 h-14 bg-teal-50 rounded-2xl flex items-center justify-center text-teal-600 group-hover:bg-teal-600 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <Bot size={26} />
                  </div>
                  <div className="relative">
                    <p className="font-bold text-gray-900 dark:text-white text-base">Compagnon IA</p>
                    <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">Chat, articles, postes et sources web</p>
                  </div>
                </motion.button>

                {/* Ligne 3 : Photo | Galerie */}
                <motion.button
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setView('camera-simple')}
                  className="group relative bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 flex flex-col items-center gap-3 shadow-sm hover:shadow-xl hover:border-emerald-300 transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-emerald-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <Camera size={26} />
                  </div>
                  <div className="relative text-center">
                    <p className="font-bold text-gray-900 dark:text-white text-sm">Photo</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-400 mt-0.5">Prise directe vers note</p>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => imageInputRef.current?.click()}
                  className="group relative bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 flex flex-col items-center gap-3 shadow-sm hover:shadow-xl hover:border-indigo-300 transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-indigo-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <ImageIcon size={26} />
                  </div>
                  <div className="relative text-center">
                    <p className="font-bold text-gray-900 dark:text-white text-sm">Galerie</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-400 mt-0.5">Ajouter à une note</p>
                  </div>
                </motion.button>

                {/* Ligne 4 : Bloc-notes (Pleine largeur) */}
                <motion.button
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setEditingNote(null); setNoteTitle(''); setNoteContent(''); setNoteImage(null); setView('notes'); }}
                  className="col-span-2 group relative bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-6 flex items-center justify-center gap-6 shadow-sm hover:shadow-xl hover:border-amber-300 transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-amber-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <StickyNote size={26} />
                  </div>
                  <div className="relative">
                    <p className="font-bold text-gray-900 dark:text-white text-base">Bloc-notes</p>
                    <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">{notes.length} note{notes.length !== 1 ? 's' : ''} enregistrée{notes.length !== 1 ? 's' : ''}</p>
                  </div>
                </motion.button>
              </div>

              {/* Controls & Article count */}
              <div className="mt-8 flex justify-between items-center w-full max-w-md">
                <div className="px-5 py-3 bg-white dark:bg-slate-800 backdrop-blur-sm rounded-full border border-gray-200 dark:border-slate-700 shadow-sm">
                  <p className="text-xs text-gray-600 dark:text-gray-300 font-medium">
                    <span className="text-blue-600 font-bold">{catalogItems.length}</span> articles
                  </p>
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => fetchGitHubCatalog()}
                    disabled={isSyncing}
                    className={cn(
                      "p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full transition-all active:scale-90 flex items-center gap-2 shadow-sm",
                      isSyncing ? "text-yellow-500 border-yellow-400" : "text-gray-400 hover:text-blue-600 hover:border-blue-300"
                    )}
                    title="Synchroniser avec GitHub"
                  >
                    <Zap size={18} className={isSyncing ? "animate-pulse" : ""} />
                    {isSyncing && <span className="text-xs font-medium pr-1">Sync...</span>}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full text-gray-400 hover:text-blue-600 hover:border-blue-300 transition-all active:scale-90 shadow-sm"
                    title="Importer un catalogue Excel"
                  >
                    <FileUp size={18} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'companion' && (
            <motion.div key="companion" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5 max-w-3xl mx-auto">
              <div className="flex items-center gap-3">
                <button onClick={() => setView('home')} className="p-2 -ml-2 text-gray-500 hover:text-blue-600"><ArrowLeft size={24} /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-teal-50 dark:bg-teal-900/30 text-teal-600 flex items-center justify-center">
                    <Bot size={23} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold dark:text-white">Compagnon IA</h2>
                    <p className="text-xs text-gray-400">Recherche magasin, postes techniques et pistes web</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {[
                  'Trouve le débitmètre dans le 9x918-22',
                  'Quelles sont les caractéristiques de cet article ?',
                  'Donne-moi la référence du capteur sur ce poste',
                  'Où se trouve cette pièce au magasin ?'
                ].map(example => (
                  <button
                    key={example}
                    onClick={() => submitCompanionQuestion(example)}
                    disabled={isCompanionThinking}
                    className="px-4 py-2 rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap disabled:opacity-50"
                  >
                    {example}
                  </button>
                ))}
              </div>

              <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-3 sm:p-4 shadow-sm min-h-[55vh] flex flex-col gap-4">
                <div className="flex-1 space-y-4 overflow-y-auto pr-1">
                  {companionMessages.map(message => (
                    <div key={message.id} className={cn("flex", message.role === 'user' ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[92%] rounded-2xl px-4 py-3",
                        message.role === 'user'
                          ? "bg-blue-600 text-white"
                          : "bg-gray-50 dark:bg-slate-900 text-gray-800 dark:text-gray-100 border border-gray-100 dark:border-slate-700"
                      )}>
                        <p className="text-sm leading-relaxed whitespace-pre-line">{message.text}</p>

                        {message.results && message.results.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {message.results.map(result => (
                              <div key={result.id} className="rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="font-bold text-sm text-gray-900 dark:text-white line-clamp-2">{result.title}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{result.subtitle}</p>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                      {result.sapCode && <span className="text-[11px] font-mono font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-lg">{result.sapCode}</span>}
                                      {result.equipmentId && <span className="text-[11px] font-bold bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 px-2 py-1 rounded-lg">{result.equipmentId}</span>}
                                      {typeof result.quantity === 'number' && <span className="text-[11px] font-bold bg-gray-100 dark:bg-slate-900 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-lg">Qté {result.quantity}</span>}
                                    </div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                                  {result.catalogItem && (
                                    <button
                                      onClick={() => setSelectedItem(result.catalogItem!)}
                                      className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold active:scale-[0.98] transition-transform"
                                    >
                                      Ouvrir l'article
                                    </button>
                                  )}
                                  {result.equipmentId && (
                                    <button
                                      onClick={() => { setSelectedEquipmentId(result.equipmentId!); setEquipmentSearchQuery(result.equipmentId!); setView('equipments'); }}
                                      className="px-3 py-2 rounded-xl bg-cyan-600 text-white text-xs font-bold active:scale-[0.98] transition-transform"
                                    >
                                      Voir poste
                                    </button>
                                  )}
                                  {result.catalogItem && (
                                    <button
                                      onClick={() => addCompanionItemToCart(result.catalogItem!)}
                                      className="px-3 py-2 rounded-xl bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 text-xs font-bold active:scale-[0.98] transition-transform"
                                    >
                                      Ajouter au panier
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {message.sources && message.sources.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Sources internet</p>
                            <div className="flex flex-wrap gap-2">
                              {message.sources.map(source => (
                                <a
                                  key={source.url}
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs font-bold text-blue-600 dark:text-blue-300"
                                >
                                  {source.label}
                                  <ExternalLink size={13} />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {isCompanionThinking && (
                    <div className="flex justify-start">
                      <div className="bg-gray-50 dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm text-gray-500 dark:text-gray-300 flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                        Recherche en cours...
                      </div>
                    </div>
                  )}
                </div>

                <form
                  onSubmit={(e) => { e.preventDefault(); submitCompanionQuestion(); }}
                  className="flex items-center gap-2 border-t border-gray-100 dark:border-slate-700 pt-3"
                >
                  <input
                    value={companionInput}
                    onChange={(e) => setCompanionInput(e.target.value)}
                    placeholder="Posez une question au compagnon..."
                    className="flex-1 px-4 py-3 rounded-2xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 outline-none focus:border-teal-500 text-sm text-gray-900 dark:text-white placeholder:text-gray-400"
                  />
                  <button
                    type="submit"
                    disabled={isCompanionThinking || !companionInput.trim()}
                    className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
                  >
                    <Send size={20} />
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {view === 'list' && (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex flex-col gap-3">
                <div className="relative flex items-center">
                  <Search className="absolute left-4 text-gray-400" size={20} />
                  <input 
                    type="text" 
                    placeholder="Rechercher article ou SAP..." 
                    value={searchQuery} 
                    onChange={(e) => setSearchQuery(e.target.value)} 
                    className="w-full pl-12 pr-14 py-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-gray-900 dark:text-white placeholder:text-gray-400 dark:text-gray-400" 
                  />
                  <button 
                    onClick={toggleVoiceSearch}
                    className={cn(
                      "absolute right-3 p-2 rounded-xl transition-colors",
                      isListening ? "bg-red-100 text-red-600 animate-pulse" : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-blue-600"
                    )}
                  >
                    <Mic size={20} />
                  </button>
                </div>

                <div className="relative">
                  <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input type="text" placeholder="Filtrer par emplacement..." value={locationQuery} onChange={(e) => setLocationQuery(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl outline-none text-gray-900 dark:text-white placeholder:text-gray-400 dark:text-gray-400" />
                </div>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {categories.map(cat => (
                  <button key={cat} onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)} className={cn("px-4 py-2 rounded-full text-sm font-medium border whitespace-nowrap", selectedCategory === cat ? "bg-blue-600 border-blue-600 text-white" : "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300")}>{cat}</button>
                ))}
              </div>

              <div className="space-y-2">
                {filteredItems.slice(0, itemsLimit).map(item => (
                  <div key={item.id} onClick={() => setSelectedItem(item)} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 flex items-center justify-between active:scale-[0.98] transition-transform cursor-pointer group">
                    <div className="flex-1 min-w-0 pr-4">
                      <h3 className="font-bold text-gray-900 dark:text-white line-clamp-2 group-hover:text-blue-600">
                        <HighlightedText text={item.name} highlight={searchQuery} />
                      </h3>
                      <p className="text-[11px] font-mono mt-1">
                        <span className="text-gray-400 font-bold">{item.sapCode}</span>
                        <span className="text-gray-300 mx-2">—</span>
                        <span className="text-red-500 font-bold">{item.location}</span>
                      </p>
                    </div>
                    <ChevronRight className="text-gray-300" size={20} />
                  </div>
                ))}
              </div>
              {filteredItems.length > itemsLimit && <button onClick={() => setItemsLimit(l => l + 20)} className="w-full py-4 text-blue-600 font-bold bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm">Afficher plus d'articles</button>}
            </motion.div>
          )}

          {view === 'scan' && (
            <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[60] bg-black flex flex-col">
              <div className="p-4 flex items-center justify-between text-white z-10">
                <button onClick={() => setView('home')} className="p-2"><ArrowLeft size={24} /></button>
                <h2 className="font-bold">Scanner Code-barres</h2>
                {hasFlash && <button onClick={() => {
                  const track = (videoRef.current?.srcObject as MediaStream).getVideoTracks()[0];
                  track.applyConstraints({ advanced: [{ torch: !isFlashOn }] } as any);
                  setIsFlashOn(!isFlashOn);
                }} className={cn("p-2 rounded-full", isFlashOn && "bg-yellow-500 text-black")}><Zap size={24} /></button>}
              </div>

              <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                <video ref={videoRef} autoPlay playsInline webkit-playsinline="true" muted className="absolute inset-0 w-full h-full object-cover" />
                <div className="relative w-80 h-48 border-2 border-white/40 rounded-3xl">
                  <div className="absolute inset-0 border-2 border-blue-500 rounded-3xl animate-pulse" />
                  <motion.div animate={{ top: ['10%', '90%', '10%'] }} transition={{ duration: 2, repeat: Infinity }} className="absolute left-4 right-4 h-0.5 bg-red-500 shadow-lg" />
                </div>
              </div>
            </motion.div>
          )}

          {view === 'ai-scan' && (
            <motion.div key="ai-scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[60] bg-black flex flex-col">
              <div className="p-4 flex items-center justify-between text-white z-10">
                <button onClick={() => { setAiMatches([]); setScanResult(null); setView('home'); }} className="p-2"><ArrowLeft size={24} /></button>
                <h2 className="font-bold">Analyse Technique (IA)</h2>
                {hasFlash && <button onClick={() => {
                  const track = (videoRef.current?.srcObject as MediaStream).getVideoTracks()[0];
                  track.applyConstraints({ advanced: [{ torch: !isFlashOn }] } as any);
                  setIsFlashOn(!isFlashOn);
                }} className={cn("p-2 rounded-full", isFlashOn && "bg-yellow-500 text-black")}><Zap size={24} /></button>}
              </div>

              <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                <video ref={videoRef} autoPlay playsInline webkit-playsinline="true" muted className="absolute inset-0 w-full h-full object-cover" />
                <div className="relative w-80 h-48 border-2 border-white/40 rounded-3xl">
                  <div className="absolute inset-0 border-2 border-blue-500 rounded-3xl animate-pulse" />
                  <motion.div animate={{ top: ['10%', '90%', '10%'] }} transition={{ duration: 2, repeat: Infinity }} className="absolute left-4 right-4 h-0.5 bg-red-500 shadow-lg" />
                </div>

                <div className="absolute bottom-12 left-0 right-0 flex flex-col items-center gap-4 px-4">
                  <button onClick={analyzePhoto} disabled={isAnalyzing} className="w-full max-w-sm flex items-center justify-center gap-2 px-6 py-4 bg-white text-purple-600 rounded-2xl font-bold shadow-xl active:scale-95 transition-all">
                    {isAnalyzing ? <div className="w-5 h-5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" /> : <Sparkles size={20} />}
                    {isAnalyzing ? 'Analyse...' : 'Identifier la pièce'}
                  </button>
                </div>
              </div>

              {scanResult && aiMatches.length === 0 && (
                <div className="absolute top-24 left-6 right-6 bg-blue-600 text-white p-4 rounded-2xl text-center font-bold shadow-2xl">{scanResult}</div>
              )}

              {aiMatches.length > 1 && (
                <div className="absolute inset-0 bg-black/70 flex items-end z-10">
                  <div className="w-full bg-white dark:bg-slate-800 rounded-t-3xl p-5 max-h-[75vh] overflow-y-auto">
                    {scanResult && scanResult.includes('{') === false && (
                      <div className="mb-4 p-3 bg-gray-50 dark:bg-slate-900 rounded-xl border border-dashed border-gray-200 dark:border-slate-700">
                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Texte brut détecté (OCR) :</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 italic">"{scanResult}"</p>
                      </div>
                    )}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1 pr-3">
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-1">Suggestions IA</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">{scanResult}</p>
                      </div>
                      <button onClick={() => { setAiMatches([]); setScanResult(null); }} className="p-2 bg-gray-100 dark:bg-slate-700 rounded-full flex-shrink-0"><X size={18} /></button>
                    </div>
                    <div className="space-y-2">
                      {aiMatches.map(item => (
                        <button key={item.id} onClick={() => { setAiMatches([]); setScanResult(null); setSelectedItem(item); setView('list'); }} className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-4 text-left flex items-center justify-between active:scale-[0.98] transition-transform">
                          <div className="flex-1 min-w-0 pr-3">
                            <p className="font-bold text-gray-900 dark:text-white line-clamp-2">{item.name}</p>
                            <p className="text-[11px] font-mono mt-1">
                              <span className="text-blue-600 font-bold">{item.sapCode}</span>
                              <span className="text-gray-300 mx-2">—</span>
                              <span className="text-red-500 font-bold">{item.location}</span>
                            </p>
                          </div>
                          <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full">{item.score} pts</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'camera-simple' && (
            <motion.div key="camera-simple" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[60] bg-black flex flex-col">
              <div className="p-4 flex items-center justify-between text-white z-10">
                <button onClick={() => setView('home')} className="p-2"><ArrowLeft size={24} /></button>
                <h2 className="font-bold">Prendre une Photo</h2>
                <div className="w-10" />
              </div>

              <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                <video ref={videoRef} autoPlay playsInline webkit-playsinline="true" muted className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute bottom-12 left-0 right-0 flex justify-center px-4">
                  <button 
                    onClick={capturePhotoForNote} 
                    className="w-20 h-20 bg-white rounded-full border-4 border-gray-200 shadow-2xl active:scale-90 transition-transform flex items-center justify-center"
                  >
                    <div className="w-16 h-16 bg-white border-2 border-gray-400 rounded-full" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'photo-preview' && pendingPhoto && (
            <motion.div key="photo-preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[60] bg-black flex flex-col">
              {/* Photo en grand */}
              <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                <img src={pendingPhoto} alt="Aperçu" className="w-full h-full object-contain" />
                
                {/* Petit bouton X discret en haut à droite pour pouvoir quand même annuler si besoin */}
                <button onClick={() => { setPendingPhoto(null); setView('home'); }} className="absolute top-6 right-6 p-3 bg-black/40 backdrop-blur-md rounded-full text-white/70">
                  <X size={24} />
                </button>
              </div>

              {/* Bouton unique en bas */}
              <div className="p-6 bg-gradient-to-t from-black to-transparent absolute bottom-0 left-0 right-0">
                <button 
                  onClick={() => {
                    setNoteImage(pendingPhoto);
                    if (!editingNote && !noteTitle && !noteContent) {
                      setNoteTitle('');
                      setNoteContent('');
                    }
                    setPendingPhoto(null);
                    setView('notes');
                  }}
                  className="w-full flex items-center justify-center gap-3 py-5 bg-amber-500 text-white rounded-2xl font-bold shadow-2xl active:scale-95 transition-all text-lg"
                >
                  <CheckCircle2 size={24} />
                  Envoyer au bloc-note
                </button>
              </div>
            </motion.div>
          )}

          {view === 'cart' && (
            <motion.div key="cart" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <button onClick={() => setView('home')} className="flex items-center gap-2 text-blue-600 font-bold"><ArrowLeft size={20} /> Retour</button>
              <h2 className="text-xl font-bold dark:text-white">Mon Panier ({cartItems.length})</h2>
              {cartItems.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl text-center border border-dashed border-gray-300 dark:border-slate-700"><p className="text-gray-500">Votre panier est vide.</p></div>
              ) : (
                <>
                  <div className="space-y-2">
                    {cartItems.map(item => (
                      <div key={item.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl flex flex-col gap-3 shadow-sm border border-gray-100 dark:border-slate-700">
                        <div className="flex justify-between items-start">
                          <div className="flex-1 pr-4">
                            <p className="font-bold dark:text-white leading-tight">{item.name}</p>
                            <p className="text-xs font-mono text-gray-500 mt-1">SAP: {item.sapCode} — {item.location}</p>
                          </div>
                          <button onClick={() => setCatalogItems(prev => prev.map(i => i.id === item.id ? { ...i, cartQuantity: 0 } : i))} className="p-2 text-red-500 bg-red-50 rounded-lg hover:bg-red-100"><X size={18} /></button>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setCatalogItems(prev => prev.map(i => i.id === item.id ? { ...i, cartQuantity: Math.max(0, (i.cartQuantity || 0) - 1) } : i))} className="p-2 bg-gray-100 rounded-full dark:bg-slate-700 hover:bg-gray-200 active:scale-95"><Minus size={16} /></button>
                          <span className="font-bold w-4 text-center dark:text-white">{item.cartQuantity}</span>
                          <button onClick={() => setCatalogItems(prev => prev.map(i => i.id === item.id ? { ...i, cartQuantity: (i.cartQuantity || 0) + 1 } : i))} className="p-2 bg-gray-100 rounded-full dark:bg-slate-700 hover:bg-gray-200 active:scale-95"><Plus size={16} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button 
                    onClick={() => {
                      const lines = cartItems.map(i => `- ${i.cartQuantity}x ${i.name} (SAP: ${i.sapCode} - Emplacement: ${i.location})`).join('\n');
                      const subject = encodeURIComponent('Sortie Magasin - Liste d\'articles');
                      const body = encodeURIComponent(`Bonjour,\n\nVoici la liste des articles à sortir du stock ce jour :\n\n${lines}\n\nMerci,\nRégulation Magasin (via App)`);
                      window.location.href = `mailto:SHR-NSL-magasin_nesle@tereos.com?subject=${subject}&body=${body}`;
                    }}
                    className="w-full py-4 mt-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-xl flex items-center justify-center gap-2 transition-colors active:scale-95"
                  >
                    <CheckCircle2 size={20} /> Envoyer le panier par Email
                  </button>
                </>
              )}
            </motion.div>
          )}

          {view === 'equipments' && (
            <motion.div key="equipments" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <button onClick={() => { setView('home'); setSelectedEquipmentId(null); }} className="p-2 -ml-2 text-gray-500 hover:text-blue-600"><ArrowLeft size={24} /></button>
                <h2 className="text-xl font-bold dark:text-white">Postes Techniques</h2>
              </div>
              
              <div className="relative flex items-center">
                <Search className="absolute left-4 text-gray-400" size={20} />
                <input 
                  type="text" 
                  placeholder="Rechercher équipement (ex: SAA...)" 
                  value={equipmentSearchQuery} 
                  onChange={(e) => setEquipmentSearchQuery(e.target.value)} 
                  className="w-full pl-12 pr-4 py-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-gray-900 dark:text-white placeholder:text-gray-400 dark:text-gray-400" 
                />
              </div>

              {!selectedEquipmentId ? (
                <div className="space-y-2">
                  {Array.from(new Set(equipments.filter(e => {
                    const query = equipmentSearchQuery.toLowerCase().trim();
                    if (!query) return true;

                    // Normalisation basique pour la comparaison
                    const eq = (e.equipment || '').toLowerCase();
                    const label = (e.equipmentLabel || '').toLowerCase();
                    const sap = String(e.sapCode || '').toLowerCase();
                    const des = (e.designation || '').toLowerCase();

                    // Si la recherche est très courte (ex: "9x"), on ne cherche que dans le code ou le libellé de l'équipement
                    // Cela évite de ressortir toutes les pièces qui ont un "x" dans leurs dimensions
                    if (query.length <= 3) {
                      return eq.includes(query) || label.includes(query);
                    }

                    // Sinon (recherche plus longue), on cherche partout (SAP, désignation, etc.)
                    return eq.includes(query) || label.includes(query) || sap.includes(query) || des.includes(query);
                  }).map(e => e.equipment)))
                    .slice(0, 50)
                    .map(eqName => {
                      const eqData = equipments.find(e => e.equipment === eqName);
                      const partsCount = equipments.filter(e => e.equipment === eqName).length;
                      
                      // On cherche si un article spécifique correspond à la recherche dans cet équipement
                      const matchingPart = equipmentSearchQuery.length > 2 ? equipments.find(e => 
                        e.equipment === eqName && 
                        ((e.sapCode && String(e.sapCode).toLowerCase().includes(equipmentSearchQuery.toLowerCase())) ||
                         (e.designation && e.designation.toLowerCase().includes(equipmentSearchQuery.toLowerCase())))
                      ) : null;
                      return (
                        <div key={eqName} onClick={() => setSelectedEquipmentId(eqName)} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 flex items-center justify-between active:scale-[0.98] transition-transform cursor-pointer group hover:border-cyan-300 shadow-sm">
                          <div className="flex-1 min-w-0 pr-4">
                            <h3 className="font-bold text-gray-900 dark:text-white line-clamp-1 group-hover:text-cyan-600">
                              <HighlightedText text={eqName} highlight={equipmentSearchQuery} />
                            </h3>
                            {eqData?.equipmentLabel && (
                              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">
                                <HighlightedText text={eqData.equipmentLabel} highlight={equipmentSearchQuery} />
                              </p>
                            )}
                             <p className="text-[11px] font-bold text-cyan-600 mt-2 bg-cyan-50 dark:bg-slate-900 inline-block px-2 py-1 rounded-md">{partsCount} pièce(s) de rechange</p>
                             
                             {matchingPart && (
                               <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800/30">
                                 <p className="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase">Article trouvé :</p>
                                 <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-1">
                                   <span className="font-mono font-bold mr-2"><HighlightedText text={String(matchingPart.sapCode)} highlight={equipmentSearchQuery} /></span>
                                   <HighlightedText text={matchingPart.designation} highlight={equipmentSearchQuery} />
                                 </p>
                               </div>
                             )}
                          </div>
                          <ChevronRight className="text-gray-300 group-hover:text-cyan-500" size={20} />
                        </div>
                      );
                    })}
                  {equipments.length === 0 && (
                    <div className="p-8 text-center text-gray-500 bg-white dark:bg-slate-800 rounded-3xl border border-dashed border-gray-300 dark:border-slate-700">
                      <p>Aucun équipement chargé.</p>
                      <button onClick={() => fetchGitHubCatalog()} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-full font-bold shadow-md hover:bg-blue-700">Synchroniser</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-cyan-50 dark:bg-slate-900 border border-cyan-100 dark:border-slate-700 p-5 rounded-3xl shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-xl text-gray-900 dark:text-white">{selectedEquipmentId}</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1.5">{equipments.find(e => e.equipment === selectedEquipmentId)?.equipmentLabel}</p>
                      </div>
                      <button onClick={() => setSelectedEquipmentId(null)} className="p-2 bg-white dark:bg-slate-800 rounded-full text-gray-500 hover:text-red-500 shadow-sm"><X size={18} /></button>
                    </div>
                  </div>
                  
                  <h4 className="font-bold text-gray-900 dark:text-white pt-2 flex items-center gap-2">
                    <Settings size={18} className="text-gray-400" /> 
                    {equipments.find(e => e.equipment === selectedEquipmentId)?.equipmentLabel || 'Nomenclature'} ({equipments.filter(e => e.equipment === selectedEquipmentId).length})
                  </h4>
                  
                  <div className="space-y-2 pb-10">
                    {equipments.filter(e => e.equipment === selectedEquipmentId).map(part => (
                      <div 
                        key={part.id} 
                        onClick={() => {
                          const cleanSap = part.sapCode.trim();
                          const foundInCatalog = catalogItemsRef.current.find(c => String(c.sapCode).trim() === cleanSap || cleanSap.includes(String(c.sapCode).trim()));
                          if (foundInCatalog) {
                            setSelectedItem(foundInCatalog);
                          } else {
                            alert(`L'article SAP ${part.sapCode} n'a pas été trouvé dans le magasin principal.`);
                          }
                        }}
                        className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 flex items-center justify-between active:scale-[0.98] transition-transform cursor-pointer hover:border-blue-300 group shadow-sm"
                      >
                        <div className="flex-1 min-w-0 pr-3">
                          <p className="font-bold text-gray-900 dark:text-white text-sm line-clamp-2">{part.designation}</p>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-[11px] font-mono text-blue-600 font-bold bg-blue-50 dark:bg-slate-900 px-2 py-0.5 rounded">{part.sapCode}</span>
                            <span className="text-[11px] font-bold text-gray-500">Qté: {part.quantity}</span>
                          </div>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-slate-900 flex items-center justify-center text-gray-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                          <Search size={16} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'notes' && (
            <motion.div key="notes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="flex items-center justify-between">
                <button onClick={() => setView('home')} className="flex items-center gap-2 text-blue-600 font-bold"><ArrowLeft size={20} /> Retour</button>
                <h2 className="text-xl font-bold dark:text-white">Bloc-notes</h2>
                <div className="w-20" />
              </div>

              {/* Formulaire d'ajout / édition */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm p-5 space-y-3">
                {noteImage && (
                  <div className="relative w-full aspect-video rounded-xl overflow-hidden mb-3 border border-gray-200 dark:border-slate-700">
                    <img src={noteImage} alt="Capture" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => setNoteImage(null)}
                      className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
                {!noteImage && (
                  <button 
                    onClick={() => imageInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-xl text-gray-400 hover:text-amber-500 hover:border-amber-200 transition-all mb-2"
                  >
                    <ImageIcon size={20} />
                    <span className="text-sm font-medium">Importer une photo</span>
                  </button>
                )}
                <input
                  type="text"
                  placeholder="Titre de la note..."
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl outline-none font-bold text-gray-900 dark:text-white focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
                />
                <textarea
                  placeholder="Contenu de la note..."
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl outline-none text-gray-700 dark:text-gray-300 resize-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveNote}
                    disabled={!noteTitle.trim() && !noteContent.trim() && !noteImage}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500 text-white rounded-xl font-bold shadow-md hover:bg-amber-600 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {editingNote ? <><Pencil size={18} /> Modifier</> : <><Plus size={18} /> Ajouter</>}
                  </button>
                  {editingNote && (
                    <button
                      onClick={() => { setEditingNote(null); setNoteTitle(''); setNoteContent(''); }}
                      className="px-4 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                    >
                      Annuler
                    </button>
                  )}
                </div>
              </div>

              {/* Liste des notes */}
              {notes.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl text-center border border-dashed border-gray-300 dark:border-slate-700">
                  <StickyNote size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-gray-500">Aucune note pour le moment.</p>
                  <p className="text-gray-400 text-sm mt-1">Créez votre première note ci-dessus !</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {notes.map(note => (
                    <motion.div
                      key={note.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "bg-white dark:bg-slate-800 rounded-xl border p-4 shadow-sm transition-all cursor-pointer group",
                        editingNote?.id === note.id ? "border-amber-400 ring-2 ring-amber-100 dark:ring-amber-900/30" : "border-gray-200 dark:border-slate-700 hover:border-amber-200"
                      )}
                    >
                      <div className="flex gap-4">
                        {note.image && (
                          <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border border-gray-100 dark:border-slate-700">
                            <img src={note.image} alt="Note" className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0" onClick={() => startEditNote(note)}>
                          <div className="flex justify-between items-start">
                            <h3 className="font-bold text-gray-900 dark:text-white line-clamp-1 group-hover:text-amber-600 transition-colors">{note.title}</h3>
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 leading-snug">{note.content}</p>
                          <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-2 font-mono">
                            {new Date(note.updatedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => shareNote(note)} className="p-2 text-gray-300 hover:text-blue-500 rounded-lg hover:bg-blue-50 transition-colors">
                            <Share2 size={16} />
                          </button>
                          <button onClick={() => startEditNote(note)} className="p-2 text-gray-300 hover:text-amber-500 rounded-lg hover:bg-amber-50 transition-colors">
                            <Pencil size={16} />
                          </button>
                          <button onClick={() => deleteNote(note.id)} className="p-2 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
          {view === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 max-w-lg mx-auto">
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Settings size={32} />
                </div>
                <h2 className="text-2xl font-bold dark:text-white">Paramètres</h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm">Configuration des services IA</p>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-gray-200 dark:border-slate-700 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-xl flex items-center justify-center">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold dark:text-white">Analyse de Plaques</h3>
                    <p className="text-[11px] text-gray-400">Propulsé par Google Gemini 2.5 Flash</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 px-1">Clé API Gemini</label>
                    <input 
                      type="password" 
                      placeholder="Saisir votre clé api Google..."
                      defaultValue={localStorage.getItem('gemini_api_key') || ''}
                      onChange={(e) => {
                        localStorage.setItem('gemini_api_key', e.target.value);
                        localStorage.removeItem('mistral_api_key'); // Nettoyage Mistral
                      }}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:border-blue-500 transition-all font-mono text-sm dark:text-white"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 px-1 leading-relaxed">
                    Obtenez une clé gratuite sur <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">aistudio.google.com</a>.
                  </p>
                </div>
              </div>

              <div className="pt-4">
                <button 
                  onClick={() => setView('home')}
                  className="w-full py-4 bg-gray-900 dark:bg-white dark:text-slate-900 text-white rounded-2xl font-bold shadow-xl active:scale-95 transition-all"
                >
                  Enregistrer et Fermer
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {isAnalyzing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[95] bg-black/75 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.94, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 10 }}
              className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-7 shadow-2xl border border-white/20 text-center"
            >
              <div className="relative w-20 h-20 mx-auto mb-5">
                <div className="absolute inset-0 rounded-full border-4 border-purple-100 dark:border-purple-900/40" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-purple-600 border-r-purple-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center text-purple-600">
                  <Sparkles size={26} />
                </div>
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Analyse IA en cours</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                Lecture de la plaque signalétique et recherche de l'article correspondant...
              </p>
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-4">
                Attention, l'IA peut faire des erreurs
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSyncing && !isAnalyzing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[94] bg-white/90 dark:bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.94, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 10 }}
              className="w-full max-w-sm text-center"
            >
              <div className="relative w-28 h-28 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full border-8 border-blue-100 dark:border-blue-900/40" />
                <div className="absolute inset-0 rounded-full border-8 border-transparent border-t-blue-600 border-r-cyan-500 animate-spin" />
                <div className="absolute inset-5 rounded-full bg-white dark:bg-slate-900 shadow-xl flex items-center justify-center text-blue-600">
                  <Package size={34} />
                </div>
              </div>
              <h3 className="text-2xl font-extrabold text-gray-900 dark:text-white">Chargement des données</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                Synchronisation du catalogue et des équipements en cours...
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {selectedItem && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm" onClick={() => setSelectedItem(null)} />
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl overflow-hidden p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold dark:text-white">{selectedItem.name}</h2>
              <button onClick={() => setSelectedItem(null)} className="p-2 bg-gray-100 dark:bg-slate-700 rounded-full dark:text-white"><X size={20} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-gray-50 dark:bg-slate-900 p-4 rounded-2xl border border-gray-100 dark:border-slate-700">
                <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Code SAP</p>
                <p className="font-mono font-bold text-gray-400 text-lg">{selectedItem.sapCode}</p>
              </div>
              <div className="bg-gray-50 dark:bg-slate-900 p-4 rounded-2xl border border-gray-100 dark:border-slate-700">
                <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Emplacement</p>
                <p className="font-bold text-lg dark:text-white">{selectedItem.location}</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  const isInCart = selectedItem.cartQuantity && selectedItem.cartQuantity > 0;
                  setCatalogItems(prev => prev.map(item => item.id === selectedItem.id ? { ...item, cartQuantity: isInCart ? 0 : 1 } : item));
                  setSelectedItem(null);
                }}
                className={cn("w-full py-4 rounded-2xl font-bold transition-all shadow-md active:scale-[0.98]", (selectedItem.cartQuantity && selectedItem.cartQuantity > 0) ? "bg-orange-100 text-orange-700 hover:bg-orange-200" : "bg-blue-600 text-white hover:bg-blue-700")}
              >
                {(selectedItem.cartQuantity && selectedItem.cartQuantity > 0) ? "Retirer du panier" : "Prélever article ?"}
              </button>

              <button
                onClick={() => handleRequestRestock(selectedItem)}
                disabled={isSendingRestock}
                className="w-full py-4 rounded-2xl font-bold transition-all active:scale-[0.98] border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSendingRestock ? (
                  <>
                    <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    Envoi en cours...
                  </>
                ) : (
                  <>
                    <AlertCircle size={20} className="text-orange-500" /> Demander Réappro
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {isImporting && (
        <div className="fixed inset-0 z-[100] bg-white/90 flex flex-col items-center justify-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="font-bold">Mise à jour du catalogue...</p>
        </div>
      )}

      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 w-max max-w-[90vw] z-[100] bg-green-600 text-white px-6 py-3 rounded-full font-bold shadow-2xl flex items-center gap-2 text-sm text-center"
          >
            <CheckCircle2 size={20} className="flex-shrink-0" />
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-0 left-0 right-0 sm:bottom-6 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-full sm:max-w-lg bg-white dark:bg-slate-800 border-t sm:border border-gray-200 dark:border-slate-700 p-4 sm:px-8 sm:rounded-full flex justify-around z-40 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] sm:shadow-2xl dark:shadow-none">
        <button onClick={() => setView('home')} className={cn("p-2 transition-colors", view === 'home' ? "text-blue-600" : "text-gray-400 dark:text-gray-500")}><Home /></button>
        <button onClick={() => setView('list')} className={cn("p-2 transition-colors", view === 'list' ? "text-blue-600" : "text-gray-400 dark:text-gray-500")}><Search /></button>
        <button onClick={() => setView('scan')} className="p-4 bg-blue-600 text-white rounded-full -mt-10 shadow-xl active:scale-90 transition-transform"><Camera size={28} /></button>
        <button onClick={() => setView('cart')} className={cn("p-2 transition-colors relative", view === 'cart' ? "text-blue-600" : "text-gray-400 dark:text-gray-500")}>
          <ShoppingCart />
          {cartItems.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white dark:border-slate-800">
              {cartItems.length}
            </span>
          )}
        </button>
        <button onClick={() => setView('settings')} className={cn("p-2 transition-colors", view === 'settings' ? "text-blue-600" : "text-gray-400 dark:text-gray-500")}><Settings /></button>
      </div>
    </div>
  );
}
