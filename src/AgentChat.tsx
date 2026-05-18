import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Wrench, ChevronDown, Loader2 } from 'lucide-react';
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
  'Montage d\'un roulement à billes',
  'Procédure de graissage',
  'Diagnostic vibration anormale',
  'Consignation / déconsignation',
  'Remplacement d\'un joint d\'étanchéité',
  'Lecture d\'un plan de maintenance',
];

// ─── Construction du system prompt ───────────────────────────────────────────

function buildSystemPrompt(catalogItems: CatalogItem[], equipments: EquipmentItem[]): string {
  // Catalogue : on prend tous les articles (Gemini 2.5 Flash a 1M tokens)
  const catalogLines = catalogItems
    .slice(0, 3000) // limite de sécurité raisonnable
    .map(a => `${a.sapCode} | ${a.name} | Empl: ${a.location}`)
    .join('\n');

  // Postes techniques
  const equipLines = equipments
    .slice(0, 500)
    .map(e => `${e.equipment} | ${e.equipmentLabel} | Réf: ${e.sapCode} | ${e.designation}`)
    .join('\n');

  return `Tu es MAXI, expert en maintenance industrielle sur le site sucrier de Nesle (Tereos).
Tu accompagnes les techniciens de maintenance au quotidien avec bienveillance et précision.

## Tes compétences
- Mécanique industrielle : roulements, accouplements, réducteurs, arbres, joints
- Électromécanique : moteurs, variateurs, capteurs, schémas
- Pneumatique et hydraulique
- Lubrification et tribologie
- Procédures de sécurité : consignation LOTO, permis de travail
- Normes : ISO, SKF, FAG, NF
- SAP et gestion de stocks magasin

## Catalogue magasin Nesle (${catalogItems.length} articles)
Format : Code SAP | Désignation | Emplacement

${catalogLines}

## Postes techniques Nesle (${equipments.length} postes)
Format : Poste | Libellé | Référence article | Désignation

${equipLines}

## Comportement
- Réponds en français, de façon concise et pratique
- Si un article du catalogue est utile pour répondre, cite-le avec son code SAP et son emplacement
- Si une question concerne un poste technique, croise avec les données ci-dessus
- Pour les procédures de sécurité, sois rigoureux et rappelle toujours les précautions
- Tu peux donner des étapes numérotées pour les procédures de montage/démontage
- Si tu ne sais pas, dis-le clairement plutôt que d'inventer
- Reste focalisé sur la maintenance industrielle ; pour les sujets hors périmètre, redirige poliment`;
}

// ─── Formatage du texte (markdown basique) ───────────────────────────────────

function formatMessage(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // Titres ##
    if (line.startsWith('## ')) {
      return <p key={i} className="font-bold text-blue-400 mt-2 mb-1 text-sm">{line.replace('## ', '')}</p>;
    }
    // Listes numérotées
    const numMatch = line.match(/^(\d+)\.\s(.+)/);
    if (numMatch) {
      return (
        <div key={i} className="flex gap-2 my-0.5">
          <span className="font-bold text-blue-400 min-w-[18px] text-xs mt-0.5">{numMatch[1]}.</span>
          <span className="text-sm leading-relaxed">{formatInline(numMatch[2])}</span>
        </div>
      );
    }
    // Listes à puces
    if (line.startsWith('- ') || line.startsWith('• ')) {
      return (
        <div key={i} className="flex gap-2 my-0.5">
          <span className="text-blue-400 min-w-[12px] text-xs mt-1">•</span>
          <span className="text-sm leading-relaxed">{formatInline(line.replace(/^[-•]\s/, ''))}</span>
        </div>
      );
    }
    // Ligne vide
    if (!line.trim()) return <div key={i} className="h-1.5" />;
    // Paragraphe normal
    return <p key={i} className="text-sm leading-relaxed">{formatInline(line)}</p>;
  });
}

function formatInline(text: string): React.ReactNode {
  // Gras **texte**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    // Code `inline`
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="font-mono text-xs bg-slate-700 px-1 py-0.5 rounded text-cyan-300">{part.slice(1, -1)}</code>;
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
  const [showSuggestions, setShowSuggestions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll automatique vers le bas
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [messages, isOpen]);

  // Focus input à l'ouverture
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
        text: '⚠️ Clé API Gemini non configurée. Va dans **Paramètres** pour l\'ajouter.'
      }]);
      setIsOpen(true);
      return;
    }

    // Ajout du message utilisateur
    const newUserMessage: Message = { role: 'user', text: trimmed };
    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);
    setInput('');
    setShowSuggestions(false);
    setIsLoading(true);

    try {
      const systemPrompt = buildSystemPrompt(catalogItems, equipments);

      // Construction de l'historique pour Gemini
      const contents = updatedMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey.trim()}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1500,
          }
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
        text: `Bonjour ! Je suis **MAXI**, ton assistant maintenance sur le site de Nesle.\n\nJ'ai accès au catalogue magasin (${catalogItems.length} articles) et aux postes techniques (${equipments.length} postes).\n\nPose-moi n'importe quelle question sur la maintenance, les pièces ou les équipements !`
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
            className="fixed bottom-24 right-4 z-50 w-14 h-14 bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-full shadow-2xl flex items-center justify-center"
            title="Assistant maintenance MAXI"
          >
            <Wrench size={24} />
            {/* Pulse animé */}
            <span className="absolute inset-0 rounded-full bg-orange-500 animate-ping opacity-20" />
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
            className="fixed inset-x-0 bottom-0 top-0 z-[60] flex flex-col bg-slate-950 sm:inset-auto sm:bottom-24 sm:right-4 sm:w-[400px] sm:h-[600px] sm:rounded-3xl shadow-2xl overflow-hidden border border-slate-700/60"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3.5 bg-gradient-to-r from-orange-600 to-orange-500 flex-shrink-0">
              <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
                <Wrench size={18} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white text-sm leading-tight">MAXI</p>
                <p className="text-orange-100 text-[11px]">Expert Maintenance Nesle</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 bg-white/15 hover:bg-white/25 rounded-xl flex items-center justify-center transition-colors"
              >
                <ChevronDown size={18} className="text-white" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-slate-700">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}
                >
                  {msg.role === 'model' && (
                    <div className="w-6 h-6 bg-orange-500 rounded-lg flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
                      <Wrench size={12} className="text-white" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[82%] px-3.5 py-2.5 rounded-2xl",
                      msg.role === 'user'
                        ? "bg-orange-500 text-white rounded-tr-sm"
                        : "bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700/50"
                    )}
                  >
                    {msg.role === 'user'
                      ? <p className="text-sm leading-relaxed">{msg.text}</p>
                      : <div className="space-y-0.5">{formatMessage(msg.text)}</div>
                    }
                  </div>
                </div>
              ))}

              {/* Loader */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="w-6 h-6 bg-orange-500 rounded-lg flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
                    <Wrench size={12} className="text-white" />
                  </div>
                  <div className="bg-slate-800 border border-slate-700/50 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                    <Loader2 size={14} className="text-orange-400 animate-spin" />
                    <span className="text-slate-400 text-sm">MAXI réfléchit...</span>
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
                      className="flex-shrink-0 text-[11px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 px-3 py-1.5 rounded-full transition-colors whitespace-nowrap"
                    >
                      {s}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Zone de saisie */}
            <div className="px-3 pb-4 pt-2 bg-slate-950 border-t border-slate-800 flex-shrink-0">
              <div className="flex items-end gap-2 bg-slate-800 rounded-2xl px-3 py-2 border border-slate-700/60 focus-within:border-orange-500/60 transition-colors">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Pose ta question à MAXI..."
                  rows={1}
                  className="flex-1 bg-transparent text-white text-sm placeholder-slate-500 outline-none resize-none leading-relaxed max-h-28 py-1"
                  style={{ scrollbarWidth: 'none' }}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isLoading}
                  className="w-8 h-8 bg-orange-500 hover:bg-orange-400 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl flex items-center justify-center transition-all flex-shrink-0 active:scale-90"
                >
                  <Send size={14} />
                </button>
              </div>
              <p className="text-center text-[10px] text-slate-600 mt-1.5">
                Entrée pour envoyer · Shift+Entrée pour sauter une ligne
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
