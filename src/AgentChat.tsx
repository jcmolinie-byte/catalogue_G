import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Wrench, ChevronDown, Loader2 } from 'lucide-react';
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

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const geminiKey = localStorage.getItem('gemini_api_key');
    if (!geminiKey) {
      setMessages(prev => [...prev, {
        role: 'model',
        text: "⚠️ Clé API Gemini non configurée. Va dans **Paramètres** pour l'ajouter."
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
        throw new Error(err.error?.message || `Erreur Gemini ${response.status}`);
      }

      const data = await response.json();
      const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Pas de réponse.';
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
            className="fixed bottom-24 right-4 z-50 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-2xl flex items-center justify-center transition-colors"
            title="JC - Assistant magasinier"
          >
            <Wrench size={24} />
            <span className="absolute inset-0 rounded-full bg-blue-600 animate-ping opacity-20" />
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
              <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
                <Wrench size={18} className="text-white" />
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
                    <div className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
                      <Wrench size={12} className="text-white" />
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
                    <Wrench size={12} className="text-white" />
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
