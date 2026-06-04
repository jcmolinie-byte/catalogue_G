import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, ChevronDown, Loader2 } from 'lucide-react';
import { CatalogItem, EquipmentItem } from './types';
import { cn } from './lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface AgentChatProps {
  catalogItems: CatalogItem[];
  equipments: EquipmentItem[];
  isDark: boolean;
}

// ─── Suggestions rapides ──────────────────────────────────────────────────────

const QUICK_SUGGESTIONS = [
  "Montage d'un roulement à billes",
  'Procédure de graissage',
  'Diagnostic vibration anormale',
  'Consignation / déconsignation',
  "Remplacement d'un joint d'étanchéité",
  'Quels EPI avons-nous en stock ?',
];

// ─── Mots vides ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'le','la','les','de','du','des','un','une','en','au','aux','et','ou','est',
  'je','tu','il','nous','vous','ils','on','me','te','se','ce','qui','que','quoi',
  'quel','quels','quelle','quelles','mon','ton','son','ma','ta','sa','nos','vos',
  'ses','avec','pour','par','sur','sous','dans','vers','chez','avons','avez',
  'ont','avoir','être','fait','faire','faut','peut','dois','doit','votre','notre',
  'cette','tout','tous','toute','toutes','plus','très','bien','bon','ici','là',
  'comme','quand','comment','pourquoi','combien','est-ce','pas','non','oui','si',
  'aussi','donc','car','mais','alors','même','encore','déjà',
]);

// ─── Détection du type de question ───────────────────────────────────────────

function detectQuestionType(query: string): 'catalog' | 'technical' | 'summary' {
  const q = query.toLowerCase();

  // Questions techniques pures sans nom de pièce
  const technicalTriggers = [
    'procédure','comment monter','comment démonter','comment remplacer',
    'comment régler','comment aligner','comment consigner','comment déconsigner',
    'serrage','couple de serrage','vibration anormale','diagnostic',
    'loto','permis de travail','norme iso','schéma électrique',
  ];
  if (technicalTriggers.some(t => q.includes(t))) {
    const pieceWords = [
      'roulement','joint','courroie','filtre','vanne','pompe','moteur',
      'palier','accouplement','réducteur','engrenage','poulie',
      'chaussure','gant','casque','lunette','combinaison','harnais',
    ];
    if (pieceWords.some(p => q.includes(p))) return 'catalog';
    return 'technical';
  }

  // Tout le reste -> recherche catalogue directe
  return 'catalog';
}
// ─── Filtrage intelligent ─────────────────────────────────────────────────────

function filterCatalog(query: string, items: CatalogItem[], maxResults = 60): CatalogItem[] {
  const words = query
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  if (words.length === 0) return [];

  const scored = items.map(item => {
    const haystack = (item.name + ' ' + item.sapCode + ' ' + (item.location || ''))
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let score = 0;
    for (const word of words) {
      // Mot exact
      if (haystack.includes(word)) {
        score += haystack.startsWith(word) ? 3 : 1;
      // Pluriel en -s (chaussures -> chaussure)
      } else if (word.endsWith('s') && word.length > 4 && haystack.includes(word.slice(0, -1))) {
        score += haystack.startsWith(word.slice(0, -1)) ? 3 : 1;
      // Pluriel en -es (bottes -> botte)
      } else if (word.endsWith('es') && word.length > 5 && haystack.includes(word.slice(0, -2))) {
        score += 1;
      }
    }
    return { item, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.item);
}

// ─── Résumé catalogue ─────────────────────────────────────────────────────────

function buildCatalogSummary(items: CatalogItem[]): string {
  const categories: Record<string, number> = {};
  for (const item of items) {
    const key = item.name.split(' ').slice(0, 2).join(' ').toUpperCase();
    categories[key] = (categories[key] || 0) + 1;
  }
  return Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([cat, count]) => `${cat} : ${count} article(s)`)
    .join('\n');
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  query: string,
  catalogItems: CatalogItem[],
  equipments: EquipmentItem[]
): { prompt: string; mode: string } {

  const questionType = detectQuestionType(query);

  const equipLines = equipments
    .slice(0, 400)
    .map(e => `${e.equipment} | ${e.equipmentLabel} | Réf: ${e.sapCode} | ${e.designation}`)
    .join('\n');

  const basePrompt = `Tu es JC, expert en maintenance industrielle sur le site sucrier de Nesle (Tereos).
Tu accompagnes les techniciens de maintenance au quotidien avec bienveillance et précision.

## Tes compétences
- Mécanique industrielle : roulements, accouplements, réducteurs, arbres, joints
- Électromécanique : moteurs, variateurs, capteurs, schémas
- Pneumatique et hydraulique
- Lubrification et tribologie
- Procédures de sécurité : consignation LOTO, permis de travail
- Normes : ISO, SKF, FAG, NF
- SAP et gestion de stocks magasin

## Postes techniques Nesle (${equipments.length} postes)
Format : Poste | Libellé | Référence article | Désignation

${equipLines}

## Comportement
- Réponds en français, de façon concise et pratique
- Si un article du catalogue est utile, cite son code SAP et son emplacement
- Pour les procédures de sécurité, rappelle toujours les précautions
- Donne des étapes numérotées pour les procédures de montage/démontage
- Si tu ne sais pas, dis-le clairement plutôt que d'inventer`;

  if (questionType === 'technical') {
    return {
      prompt: basePrompt + `\n\nNote : Cette question est de nature technique. Si l'utilisateur mentionne une pièce précise, indique-lui de la nommer pour que tu puisses chercher dans le stock.`,
      mode: 'technique'
    };
  }

  if (questionType === 'summary') {
    const summary = buildCatalogSummary(catalogItems);
    return {
      prompt: basePrompt + `\n\n## Résumé catalogue magasin (${catalogItems.length} articles)\n${summary}\n\nSi l'utilisateur veut des détails sur une famille, propose-lui de préciser.`,
      mode: 'résumé stock'
    };
  }

  const filtered = filterCatalog(query, catalogItems, 60);

  if (filtered.length === 0) {
    return {
      prompt: basePrompt + `\n\n## Catalogue\nAucun article correspondant à "${query}" n'a été trouvé dans les ${catalogItems.length} articles. Informe l'utilisateur et propose-lui de reformuler.`,
      mode: 'introuvable'
    };
  }

  const catalogLines = filtered
    .map(a => `${a.sapCode} | ${a.name} | Empl: ${a.location}`)
    .join('\n');

  return {
    prompt: basePrompt + `\n\n## Articles catalogue correspondants (${filtered.length} résultats sur ${catalogItems.length})\nFormat : Code SAP | Désignation | Emplacement\n\n${catalogLines}`,
    mode: `${filtered.length} articles`
  };
}

// ─── Formatage markdown ───────────────────────────────────────────────────────

function formatMessage(text: string, isDark: boolean) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('## ')) {
      return (
        <p key={i} className="font-bold text-blue-600 dark:text-blue-400 mt-2 mb-1 text-sm">
          {line.replace('## ', '')}
        </p>
      );
    }
    const numMatch = line.match(/^(\d+)\.\s(.+)/);
    if (numMatch) {
      return (
        <div key={i} className="flex gap-2 my-0.5">
          <span className="font-bold text-blue-600 dark:text-blue-400 min-w-[18px] text-xs mt-0.5">{numMatch[1]}.</span>
          <span className="text-sm leading-relaxed">{formatInline(numMatch[2])}</span>
        </div>
      );
    }
    if (line.startsWith('- ') || line.startsWith('• ')) {
      return (
        <div key={i} className="flex gap-2 my-0.5">
          <span className="text-blue-600 dark:text-blue-400 min-w-[12px] text-xs mt-1">•</span>
          <span className="text-sm leading-relaxed">{formatInline(line.replace(/^[-•]\s/, ''))}</span>
        </div>
      );
    }
    if (!line.trim()) return <div key={i} className="h-1.5" />;
    return <p key={i} className="text-sm leading-relaxed">{formatInline(line)}</p>;
  });
}

function formatInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="font-mono text-xs bg-gray-100 dark:bg-slate-700 px-1 py-0.5 rounded text-blue-600 dark:text-blue-300">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function AgentChat({ catalogItems, equipments, isDark }: AgentChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [filterInfo, setFilterInfo] = useState<string>('');
  const [showSuggestions, setShowSuggestions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  // ── Appel Gemini ──────────────────────────────────────────────────────────
  const callGemini = async (prompt: string, contents: any[]): Promise<string> => {
    const geminiKey = localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY;
    if (!geminiKey) throw new Error('NO_KEY');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey.trim()}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: prompt }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
      })
    });
    if (!response.ok) {
      const err = await response.json();
      const msg = err.error?.message || '';
      // Quota dépassé ou rate limit → on signale pour basculer sur Groq
      if (
        response.status === 429 ||
        msg.toLowerCase().includes('quota') ||
        msg.toLowerCase().includes('rate') ||
        msg.toLowerCase().includes('exceeded') ||
        msg.toLowerCase().includes('limit')
      ) {
        throw new Error('QUOTA_EXCEEDED');
      }
      throw new Error(msg || `Erreur Gemini ${response.status}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Pas de réponse.';
  };

  // ── Appel Groq (fallback) ─────────────────────────────────────────────────
  const callGroq = async (prompt: string, contents: any[]): Promise<string> => {
    const groqKey = localStorage.getItem('groq_api_key') || import.meta.env.VITE_GROQ_API_KEY;
    if (!groqKey) throw new Error('Clé Groq non configurée. Ajoute-la dans les Paramètres.');
    const messages = [
      { role: 'system', content: prompt },
      ...contents.map((m: any) => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.parts[0].text
      }))
    ];
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey.trim()}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.7,
        max_tokens: 4096
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `Erreur Groq ${response.status}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Pas de réponse.';
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const geminiKey = localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY;
    const groqKey = localStorage.getItem('groq_api_key') || import.meta.env.VITE_GROQ_API_KEY;

    if (!geminiKey && !groqKey) {
      setMessages(prev => [...prev, {
        role: 'model',
        text: "⚠️ Aucune clé API configurée. Va dans **Paramètres** pour ajouter ta clé Gemini ou Groq."
      }]);
      return;
    }

    const newUserMessage: Message = { role: 'user', text: trimmed };
    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);
    setInput('');
    setShowSuggestions(false);
    setIsLoading(true);
    setFilterInfo('');

    try {
      const { prompt, mode } = buildSystemPrompt(trimmed, catalogItems, equipments);
      setFilterInfo(mode);

      const contents = updatedMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      let replyText = '';
      let usedFallback = false;

      // Tentative Gemini en premier
      if (geminiKey) {
        try {
          replyText = await callGemini(prompt, contents);
        } catch (geminiErr: any) {
          if (geminiErr.message === 'QUOTA_EXCEEDED' && groqKey) {
            // Bascule silencieuse sur Groq
            usedFallback = true;
            replyText = await callGroq(prompt, contents);
          } else if (geminiErr.message === 'NO_KEY' && groqKey) {
            replyText = await callGroq(prompt, contents);
          } else {
            throw geminiErr;
          }
        }
      } else if (groqKey) {
        // Pas de clé Gemini → Groq directement
        replyText = await callGroq(prompt, contents);
      }

      if (usedFallback) setFilterInfo(prev => prev + ' · via Groq');
      setMessages(prev => [...prev, { role: 'model', text: replyText }]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'model',
        text: `❌ Erreur : ${err.message}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    if (messages.length === 0) {
      setMessages([{
        role: 'model',
        text: `Bonjour ! Je suis **JC**, ton assistant magasinier sur le site de Nesle.\n\nJ'ai accès au catalogue magasin (${catalogItems.length} articles) et aux postes techniques (${equipments.length} postes).\n\nPose-moi n'importe quelle question sur la maintenance, les pièces ou les équipements !`
      }]);
    }
  };

  return (
    <>
      {/* ── Bulle flottante ── */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.93 }}
            onClick={handleOpen}
            className="fixed bottom-24 right-4 z-50 w-16 h-16 flex items-end justify-center"
            title="JC - Assistant magasinier"
            style={{ filter: 'drop-shadow(0 4px 16px rgba(37,99,235,0.6))' }}
          >
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 6 Q4 2 8 2 L56 2 Q60 2 60 6 L60 42 Q60 46 56 46 L22 46 L10 58 L14 46 L8 46 Q4 46 4 42 Z" fill="#2563eb"/>
              <rect x="20" y="13" width="24" height="20" rx="4" fill="white" opacity="0.95"/>
              <line x1="32" y1="13" x2="32" y2="8" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.95"/>
              <circle cx="32" cy="7" r="2.5" fill="white" opacity="0.95"/>
              <rect x="23" y="18" width="6" height="5" rx="1.5" fill="#2563eb"/>
              <rect x="35" y="18" width="6" height="5" rx="1.5" fill="#2563eb"/>
              <circle cx="25" cy="19.5" r="1" fill="white" opacity="0.6"/>
              <circle cx="37" cy="19.5" r="1" fill="white" opacity="0.6"/>
              <rect x="24" y="27" width="16" height="3" rx="1.5" fill="#2563eb" opacity="0.7"/>
              <rect x="16" y="18" width="4" height="8" rx="2" fill="white" opacity="0.8"/>
              <rect x="44" y="18" width="4" height="8" rx="2" fill="white" opacity="0.8"/>
            </svg>
            <span className="absolute inset-0 animate-ping opacity-20 rounded-full bg-blue-500" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Panneau chat ── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.97 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={cn(
              "fixed inset-x-0 bottom-0 top-0 z-[60] flex flex-col",
              "sm:inset-auto sm:bottom-24 sm:right-4 sm:w-[400px] sm:h-[600px] sm:rounded-3xl",
              "shadow-2xl overflow-hidden border",
              isDark
                ? "bg-slate-900 border-slate-700"
                : "bg-white border-gray-200"
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3.5 bg-blue-600 flex-shrink-0">
              <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center overflow-hidden">
                <svg width="28" height="28" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="14" y="16" width="36" height="28" rx="5" fill="white" opacity="0.9"/>
                  <line x1="32" y1="16" x2="32" y2="10" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.9"/>
                  <circle cx="32" cy="8" r="3" fill="white" opacity="0.9"/>
                  <rect x="17" y="22" width="9" height="7" rx="2" fill="#2563eb"/>
                  <rect x="38" y="22" width="9" height="7" rx="2" fill="#2563eb"/>
                  <circle cx="19.5" cy="23.5" r="1.5" fill="white" opacity="0.5"/>
                  <circle cx="40.5" cy="23.5" r="1.5" fill="white" opacity="0.5"/>
                  <rect x="19" y="33" width="26" height="4" rx="2" fill="#2563eb" opacity="0.6"/>
                  <rect x="10" y="23" width="4" height="11" rx="2" fill="white" opacity="0.7"/>
                  <rect x="50" y="23" width="4" height="11" rx="2" fill="white" opacity="0.7"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white text-sm leading-tight">JC</p>
                <p className="text-blue-100 text-[11px]">Assistant virtuel magasinier</p>
              </div>
              {filterInfo && (
                <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full flex-shrink-0">
                  {filterInfo}
                </span>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 bg-white/15 hover:bg-white/25 rounded-xl flex items-center justify-center transition-colors"
              >
                <ChevronDown size={18} className="text-white" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                  {msg.role === 'model' && (
                    <div className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center mr-2 mt-0.5 flex-shrink-0 overflow-hidden">
                      <svg width="18" height="18" viewBox="0 0 64 64" fill="none"><rect x="14" y="16" width="36" height="28" rx="5" fill="white" opacity="0.9"/><rect x="17" y="22" width="9" height="7" rx="2" fill="#2563eb"/><rect x="38" y="22" width="9" height="7" rx="2" fill="#2563eb"/><rect x="19" y="33" width="26" height="4" rx="2" fill="#2563eb" opacity="0.6"/></svg>
                    </div>
                  )}
                  <div className={cn(
                    "max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm",
                    msg.role === 'user'
                      ? "bg-blue-600 text-white rounded-tr-sm"
                      : isDark
                        ? "bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700"
                        : "bg-gray-50 text-gray-900 rounded-tl-sm border border-gray-200"
                  )}>
                    {msg.role === 'user'
                      ? <p className="leading-relaxed">{msg.text}</p>
                      : <div className="space-y-0.5">{formatMessage(msg.text, isDark)}</div>
                    }
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
                    <svg width="16" height="16" viewBox="0 0 64 64" fill="none"><rect x="14" y="16" width="36" height="28" rx="5" fill="white" opacity="0.9"/><rect x="17" y="22" width="9" height="7" rx="2" fill="#2563eb"/><rect x="38" y="22" width="9" height="7" rx="2" fill="#2563eb"/><rect x="19" y="33" width="26" height="4" rx="2" fill="#2563eb" opacity="0.6"/></svg>
                  </div>
                  <div className={cn(
                    "rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 border",
                    isDark ? "bg-slate-800 border-slate-700" : "bg-gray-50 border-gray-200"
                  )}>
                    <Loader2 size={14} className="text-blue-600 animate-spin" />
                    <span className={cn("text-sm", isDark ? "text-slate-400" : "text-gray-500")}>
                      JC réfléchit...
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Suggestions rapides */}
            <AnimatePresence>
              {showSuggestions && messages.length <= 1 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-3 pb-2 flex gap-2 overflow-x-auto scrollbar-none flex-shrink-0"
                >
                  {QUICK_SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(s)}
                      className={cn(
                        "flex-shrink-0 text-[11px] px-3 py-1.5 rounded-full transition-colors whitespace-nowrap border",
                        isDark
                          ? "bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300"
                          : "bg-white hover:bg-gray-50 border-gray-200 text-gray-600"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Zone de saisie */}
            <div className={cn(
              "px-3 pb-4 pt-2 border-t flex-shrink-0",
              isDark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-200"
            )}>
              <div className={cn(
                "flex items-end gap-2 rounded-2xl px-3 py-2 border transition-colors",
                isDark
                  ? "bg-slate-800 border-slate-700 focus-within:border-blue-500"
                  : "bg-gray-50 border-gray-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200"
              )}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Pose ta question à JC..."
                  rows={1}
                  className={cn(
                    "flex-1 bg-transparent text-sm outline-none resize-none leading-relaxed max-h-28 py-1",
                    isDark ? "text-white placeholder-slate-500" : "text-gray-900 placeholder-gray-400"
                  )}
                  style={{ scrollbarWidth: 'none' }}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isLoading}
                  className="w-8 h-8 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 text-white rounded-xl flex items-center justify-center transition-all flex-shrink-0 active:scale-90"
                >
                  <Send size={14} />
                </button>
              </div>
              <p className={cn(
                "text-center text-[10px] mt-1.5",
                isDark ? "text-slate-600" : "text-gray-400"
              )}>
                Entrée pour envoyer · Shift+Entrée pour sauter une ligne
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
