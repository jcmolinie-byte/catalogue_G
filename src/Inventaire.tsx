// =====================================================================
// SAM - MODE INVENTAIRE
// A placer dans src/pages/Inventaire.tsx (ou src/components/)
//
// Prerequis : le SQL sam_inventaire_schema.sql doit etre installe.
//
// Branchement du scanner : voir le bloc "SCANNER" plus bas (ligne ~250).
// En attendant, la saisie clavier et la douchette fonctionnent deja.
// =====================================================================

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// Si SAM expose deja un client, remplace ces 3 lignes par :
// import { supabase } from '../lib/supabase';
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type Zone = { zone: string; articles: number };

type Article = {
  id: string;
  sap_code: string;
  name: string;
  location_brute: string | null;
  location_norm: string | null;
  zone: string | null;
};

type Session = {
  id: string;
  libelle: string;
  zone: string | null;
  statut: string;
  compteur: string | null;
};

type Count = {
  id: string;
  sap_code: string;
  quantite: number;
  emplacement_prevu: string | null;
  emplacement_reel: string | null;
  compte_le: string;
};

// ---------------------------------------------------------------------
// File d'attente hors ligne (localStorage)
// ---------------------------------------------------------------------
const QUEUE_KEY = 'sam_inv_queue';

const readQueue = (): any[] => {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch { return []; }
};

const writeQueue = (q: any[]) =>
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));

// =====================================================================
// COMPOSANT
// =====================================================================
export default function Inventaire() {
  const [etape, setEtape] = useState<'zones' | 'session' | 'comptage'>('zones');

  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneChoisie, setZoneChoisie] = useState<string | null>(null);
  const [compteur, setCompteur] = useState(
    localStorage.getItem('sam_inv_compteur') || ''
  );

  const [session, setSession] = useState<Session | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [comptages, setComptages] = useState<Count[]>([]);

  const [recherche, setRecherche] = useState('');
  const [articleActif, setArticleActif] = useState<Article | null>(null);
  const [quantite, setQuantite] = useState('');
  const [emplacementReel, setEmplacementReel] = useState('');

  const [enLigne, setEnLigne] = useState(navigator.onLine);
  const [enAttente, setEnAttente] = useState(readQueue().length);
  const [message, setMessage] = useState('');
  const [chargement, setChargement] = useState(false);

  const champRecherche = useRef<HTMLInputElement>(null);
  const champQuantite = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------
  // Reseau
  // -------------------------------------------------------------------
  useEffect(() => {
    const on = () => { setEnLigne(true); viderFile(); };
    const off = () => setEnLigne(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [session]);

  // -------------------------------------------------------------------
  // Chargement des zones
  // -------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      setChargement(true);
      const { data, error } = await supabase
        .from('v_catalog_locations')
        .select('zone, type_emplacement')
        .in('type_emplacement', ['RAYON', 'ZONE']);

      if (error) { setMessage('Erreur chargement zones : ' + error.message); }
      else {
        const compte: Record<string, number> = {};
        (data || []).forEach((r: any) => {
          if (r.zone) compte[r.zone] = (compte[r.zone] || 0) + 1;
        });
        const liste = Object.entries(compte)
          .map(([zone, articles]) => ({ zone, articles }))
          .sort((a, b) => {
            const na = /^\d+$/.test(a.zone), nb = /^\d+$/.test(b.zone);
            if (na && nb) return Number(a.zone) - Number(b.zone);
            if (na) return -1;
            if (nb) return 1;
            return a.zone.localeCompare(b.zone);
          });
        setZones(liste);
      }
      setChargement(false);
    })();
  }, []);

  // -------------------------------------------------------------------
  // Demarrer une session
  // -------------------------------------------------------------------
  const demarrer = async () => {
    if (!zoneChoisie || !compteur.trim()) {
      setMessage('Choisis une zone et indique ton nom.');
      return;
    }
    setChargement(true);
    localStorage.setItem('sam_inv_compteur', compteur.trim());

    const { data: s, error: e1 } = await supabase
      .from('inventory_sessions')
      .insert({
        libelle: `Inventaire ${zoneChoisie} - ${new Date().toLocaleDateString('fr-FR')}`,
        zone: zoneChoisie,
        compteur: compteur.trim(),
      })
      .select()
      .single();

    if (e1) { setMessage('Erreur : ' + e1.message); setChargement(false); return; }

    const { data: arts, error: e2 } = await supabase
      .from('v_catalog_locations')
      .select('id, sap_code, name, location_brute, location_norm, zone')
      .eq('zone', zoneChoisie)
      .order('location_norm');

    if (e2) { setMessage('Erreur : ' + e2.message); setChargement(false); return; }

    setSession(s);
    setArticles(arts || []);
    setComptages([]);
    // cache hors ligne
    localStorage.setItem('sam_inv_articles', JSON.stringify(arts || []));
    localStorage.setItem('sam_inv_session', JSON.stringify(s));
    setEtape('comptage');
    setChargement(false);
    setTimeout(() => champRecherche.current?.focus(), 100);
  };

  // -------------------------------------------------------------------
  // Reprendre une session en cours
  // -------------------------------------------------------------------
  const reprendre = async () => {
    const s = localStorage.getItem('sam_inv_session');
    const a = localStorage.getItem('sam_inv_articles');
    if (!s || !a) { setMessage('Aucune session a reprendre.'); return; }
    const sess = JSON.parse(s);
    setSession(sess);
    setArticles(JSON.parse(a));
    setCompteur(sess.compteur || '');
    if (navigator.onLine) {
      const { data } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('session_id', sess.id);
      setComptages(data || []);
    }
    setEtape('comptage');
  };

  // -------------------------------------------------------------------
  // Selection d'un article (scan, douchette ou clic)
  // -------------------------------------------------------------------
  const choisirArticle = (a: Article) => {
    setArticleActif(a);
    const deja = comptages.find(c => c.sap_code === a.sap_code);
    setQuantite(deja ? String(deja.quantite) : '');
    setEmplacementReel('');
    setRecherche('');
    setTimeout(() => champQuantite.current?.select(), 100);
  };

  // Recherche directe par code (scan / douchette / saisie + Entree)
  const validerRecherche = () => {
    const q = recherche.trim().toUpperCase();
    if (!q) return;
    const exact = articles.find(a => a.sap_code === q);
    if (exact) { choisirArticle(exact); return; }
    // article hors zone : on le cherche dans tout le catalogue
    chercherHorsZone(q);
  };

  const chercherHorsZone = async (code: string) => {
    const { data } = await supabase
      .from('v_catalog_locations')
      .select('id, sap_code, name, location_brute, location_norm, zone')
      .eq('sap_code', code)
      .maybeSingle();

    if (data) {
      setMessage(`Attention : cet article est cense etre en ${data.location_brute || 'aucun emplacement'}.`);
      choisirArticle(data as Article);
    } else {
      setMessage(`Code ${code} inconnu au catalogue.`);
    }
  };

  // -------------------------------------------------------------------
  // Enregistrer un comptage
  // -------------------------------------------------------------------
  const enregistrer = async () => {
    if (!articleActif || !session) return;
    const q = Number(quantite.replace(',', '.'));
    if (isNaN(q) || q < 0) { setMessage('Quantite invalide.'); return; }

    const ligne = {
      session_id: session.id,
      sap_code: articleActif.sap_code,
      article_id: articleActif.id,
      quantite: q,
      emplacement_prevu: articleActif.location_brute,
      emplacement_reel: emplacementReel.trim() || null,
      passage: 1,
      compteur: session.compteur,
    };

    // optimiste : on affiche tout de suite
    setComptages(prev => [
      ...prev.filter(c => c.sap_code !== ligne.sap_code),
      { ...ligne, id: 'local-' + Date.now(), compte_le: new Date().toISOString() } as Count,
    ]);
    setArticleActif(null);
    setQuantite('');
    setEmplacementReel('');
    setMessage(`${ligne.sap_code} : ${q} enregistre.`);
    setTimeout(() => champRecherche.current?.focus(), 100);

    if (navigator.onLine) {
      const { error } = await supabase
        .from('inventory_counts')
        .upsert(ligne, { onConflict: 'session_id,sap_code,passage' });
      if (error) empiler(ligne);
    } else {
      empiler(ligne);
    }
  };

  const empiler = (ligne: any) => {
    const q = readQueue();
    q.push(ligne);
    writeQueue(q);
    setEnAttente(q.length);
  };

  const viderFile = async () => {
    const q = readQueue();
    if (!q.length) return;
    const { error } = await supabase
      .from('inventory_counts')
      .upsert(q, { onConflict: 'session_id,sap_code,passage' });
    if (!error) { writeQueue([]); setEnAttente(0); setMessage('Comptages synchronises.'); }
  };

  // -------------------------------------------------------------------
  // Export CSV pour SAP
  // -------------------------------------------------------------------
  const exporter = () => {
    const lignes = [['Code SAP', 'Designation', 'Quantite', 'Emplacement prevu', 'Emplacement reel', 'Compteur', 'Date']];
    comptages.forEach(c => {
      const a = articles.find(x => x.sap_code === c.sap_code);
      lignes.push([
        c.sap_code,
        (a?.name || '').replace(/;/g, ' '),
        String(c.quantite),
        c.emplacement_prevu || '',
        c.emplacement_reel || '',
        session?.compteur || '',
        new Date(c.compte_le).toLocaleString('fr-FR'),
      ]);
    });
    const csv = '\uFEFF' + lignes.map(l => l.join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventaire_${session?.zone}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // -------------------------------------------------------------------
  // Terminer
  // -------------------------------------------------------------------
  const terminer = async () => {
    if (!session) return;
    if (!confirm('Cloturer cette session de comptage ?')) return;
    await viderFile();
    await supabase
      .from('inventory_sessions')
      .update({ statut: 'termine', termine_le: new Date().toISOString() })
      .eq('id', session.id);
    localStorage.removeItem('sam_inv_session');
    localStorage.removeItem('sam_inv_articles');
    setEtape('zones');
    setSession(null);
    setMessage('Session cloturee.');
  };

  // -------------------------------------------------------------------
  // Derives
  // -------------------------------------------------------------------
  const comptes = new Set(comptages.map(c => c.sap_code));
  const restants = articles.filter(a => !comptes.has(a.sap_code));
  const filtres = recherche.trim()
    ? articles.filter(a =>
        a.sap_code.includes(recherche.trim()) ||
        a.name.toUpperCase().includes(recherche.trim().toUpperCase()))
    : restants;

  // ===================================================================
  // RENDU
  // ===================================================================
  const badge = (
    <div style={S.badges}>
      <span style={{ ...S.badge, background: enLigne ? '#16a34a' : '#dc2626' }}>
        {enLigne ? 'En ligne' : 'Hors ligne'}
      </span>
      {enAttente > 0 && (
        <span style={{ ...S.badge, background: '#f59e0b' }}>
          {enAttente} en attente
        </span>
      )}
    </div>
  );

  // --- Ecran 1 : choix de la zone -------------------------------------
  if (etape === 'zones') {
    return (
      <div style={S.page}>
        <h1 style={S.h1}>Inventaire</h1>
        {badge}

        <label style={S.label}>Ton nom</label>
        <input
          style={S.input}
          value={compteur}
          onChange={e => setCompteur(e.target.value)}
          placeholder="JC"
        />

        {localStorage.getItem('sam_inv_session') && (
          <button style={S.btnSecondaire} onClick={reprendre}>
            Reprendre la session en cours
          </button>
        )}

        <label style={S.label}>Zone a compter</label>
        {chargement && <p style={S.info}>Chargement...</p>}
        <div style={S.grille}>
          {zones.map(z => (
            <button
              key={z.zone}
              onClick={() => setZoneChoisie(z.zone)}
              style={{
                ...S.carte,
                borderColor: zoneChoisie === z.zone ? '#2563eb' : '#e5e7eb',
                background: zoneChoisie === z.zone ? '#eff6ff' : '#fff',
              }}
            >
              <div style={S.carteTitre}>{z.zone}</div>
              <div style={S.carteSous}>{z.articles} art.</div>
            </button>
          ))}
        </div>

        {zoneChoisie && (
          <button style={S.btnPrincipal} onClick={demarrer} disabled={chargement}>
            Commencer le comptage de {zoneChoisie}
          </button>
        )}
        {message && <p style={S.info}>{message}</p>}
      </div>
    );
  }

  // --- Ecran 2 : comptage ---------------------------------------------
  return (
    <div style={S.page}>
      <div style={S.entete}>
        <div>
          <h1 style={S.h1}>Zone {session?.zone}</h1>
          <p style={S.sous}>
            {comptages.length} / {articles.length} comptes
            {restants.length > 0 && ` - ${restants.length} restants`}
          </p>
        </div>
        {badge}
      </div>

      <div style={S.barre}>
        <div style={{ ...S.barreRemplie, width: `${(comptages.length / Math.max(articles.length, 1)) * 100}%` }} />
      </div>

      {/* ============================================================
          SCANNER
          Si SAM expose deja un composant de scan ZXing, branche-le ici :

            <MonScanner onScan={(code) => {
              setRecherche(code);
              setTimeout(validerRecherche, 0);
            }} />

          Sans ca, la douchette et le clavier fonctionnent deja
          via le champ ci-dessous (scan + Entree).
         ============================================================ */}

      <input
        ref={champRecherche}
        style={S.inputGros}
        value={recherche}
        onChange={e => setRecherche(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && validerRecherche()}
        placeholder="Scanner ou taper un code / un nom"
        autoComplete="off"
      />

      {/* Fiche de saisie */}
      {articleActif && (
        <div style={S.fiche}>
          <div style={S.ficheCode}>{articleActif.sap_code}</div>
          <div style={S.ficheNom}>{articleActif.name}</div>
          <div style={S.ficheEmpl}>Emplacement prevu : {articleActif.location_brute || '-'}</div>

          <label style={S.label}>Quantite comptee</label>
          <input
            ref={champQuantite}
            style={S.inputGros}
            type="number"
            inputMode="decimal"
            value={quantite}
            onChange={e => setQuantite(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && enregistrer()}
            placeholder="0"
          />

          <label style={S.label}>Emplacement reel (si different)</label>
          <input
            style={S.input}
            value={emplacementReel}
            onChange={e => setEmplacementReel(e.target.value)}
            placeholder="laisser vide si conforme"
          />

          <div style={S.ligneBtn}>
            <button style={S.btnPrincipal} onClick={enregistrer}>Valider</button>
            <button style={S.btnSecondaire} onClick={() => setArticleActif(null)}>Annuler</button>
          </div>
        </div>
      )}

      {message && <p style={S.info}>{message}</p>}

      {/* Liste */}
      <h2 style={S.h2}>
        {recherche.trim() ? 'Resultats' : `A compter (${restants.length})`}
      </h2>
      <div style={S.liste}>
        {filtres.slice(0, 100).map(a => (
          <button key={a.id} style={S.item} onClick={() => choisirArticle(a)}>
            <div>
              <div style={S.itemNom}>{a.name}</div>
              <div style={S.itemMeta}>{a.sap_code} - {a.location_brute}</div>
            </div>
            {comptes.has(a.sap_code) && <span style={S.coche}>OK</span>}
          </button>
        ))}
        {filtres.length === 0 && (
          <p style={S.info}>
            {restants.length === 0 ? 'Tout est compte.' : 'Aucun resultat.'}
          </p>
        )}
      </div>

      <div style={S.piedPage}>
        <button style={S.btnSecondaire} onClick={exporter} disabled={!comptages.length}>
          Exporter pour SAP ({comptages.length})
        </button>
        <button style={S.btnDanger} onClick={terminer}>Cloturer</button>
      </div>
    </div>
  );
}

// =====================================================================
// STYLES (inline, aucune dependance)
// =====================================================================
const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 680, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif', paddingBottom: 120 },
  entete: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  h1: { fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
  h2: { fontSize: 15, fontWeight: 600, margin: '20px 0 8px', color: '#374151' },
  sous: { fontSize: 13, color: '#6b7280', margin: 0 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', margin: '14px 0 6px' },
  input: { width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box' },
  inputGros: { width: '100%', padding: '14px 12px', fontSize: 18, border: '2px solid #2563eb', borderRadius: 8, boxSizing: 'border-box', marginTop: 6 },
  grille: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, marginTop: 4 },
  carte: { padding: '12px 6px', border: '2px solid #e5e7eb', borderRadius: 10, cursor: 'pointer', textAlign: 'center' },
  carteTitre: { fontSize: 16, fontWeight: 700 },
  carteSous: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  btnPrincipal: { width: '100%', padding: 16, fontSize: 16, fontWeight: 600, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 10, cursor: 'pointer', marginTop: 16 },
  btnSecondaire: { width: '100%', padding: 14, fontSize: 15, fontWeight: 600, color: '#374151', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 10, cursor: 'pointer', marginTop: 10 },
  btnDanger: { width: '100%', padding: 14, fontSize: 15, fontWeight: 600, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, cursor: 'pointer', marginTop: 10 },
  ligneBtn: { display: 'flex', gap: 10 },
  fiche: { border: '2px solid #2563eb', borderRadius: 12, padding: 16, marginTop: 16, background: '#f8fafc' },
  ficheCode: { fontSize: 13, fontWeight: 700, color: '#2563eb' },
  ficheNom: { fontSize: 16, fontWeight: 600, margin: '4px 0' },
  ficheEmpl: { fontSize: 13, color: '#6b7280' },
  liste: { display: 'flex', flexDirection: 'column', gap: 6 },
  item: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', textAlign: 'left' },
  itemNom: { fontSize: 14, fontWeight: 500 },
  itemMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  coche: { fontSize: 12, fontWeight: 700, color: '#16a34a' },
  barre: { height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden', margin: '12px 0' },
  barreRemplie: { height: '100%', background: '#16a34a', transition: 'width .3s' },
  badges: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  badge: { fontSize: 11, fontWeight: 700, color: '#fff', padding: '4px 8px', borderRadius: 999 },
  info: { fontSize: 13, color: '#6b7280', marginTop: 10 },
  piedPage: { position: 'fixed', bottom: 0, left: 0, right: 0, padding: 12, background: '#fff', borderTop: '1px solid #e5e7eb', maxWidth: 680, margin: '0 auto' },
};
