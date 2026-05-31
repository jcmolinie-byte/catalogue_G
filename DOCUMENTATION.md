# Catalogue G — Documentation de l'application

## Vue d'ensemble

**Magasin Nesle** est une application web mobile-first permettant aux agents du magasin de Nesle de :
- Rechercher des articles dans le catalogue de stock
- Scanner des codes-barres pour identifier un article
- Consulter les nomenclatures des postes techniques
- Prendre des photos et les associer à des notes
- Envoyer des demandes de réapprovisionnement par email

L'application est accessible sur : **https://catalogue-g-two.vercel.app**

---

## Stack technique

| Élément | Technologie |
|---|---|
| Framework UI | React 19 + TypeScript |
| Build tool | Vite |
| Styles | Tailwind CSS v4 |
| Base de données | Supabase (PostgreSQL) |
| Animations | Motion (Framer Motion) |
| Icônes | Lucide React |
| Scan code-barres | @zxing/browser + BarcodeDetector API |
| Intelligence artificielle | Google Gemini (analyse de photos) |
| Envoi d'emails | EmailJS |
| Déploiement | Vercel (auto-déploiement depuis GitHub) |
| Dépôt source | https://github.com/jcmolinie-byte/catalogue_G |

---

## Structure des fichiers

```
catalogue_G/
├── src/
│   ├── App.tsx              ← Composant principal (toute l'UI + logique)
│   ├── AgentChat.tsx        ← Chat IA avec Gemini
│   ├── types.ts             ← Types TypeScript (CatalogItem, EquipmentItem…)
│   ├── constants.ts         ← Données de démonstration (fallback)
│   ├── lib/
│   │   ├── utils.ts         ← Fonction utilitaire cn()
│   │   └── supabase.ts      ← Client Supabase (URL + clé anon)
│   └── index.css            ← Styles globaux
├── public/
│   ├── catalogue.xlsx                          ← Sauvegarde Excel (non utilisé)
│   └── catalogue_postes_techniques_nesle.xlsx  ← Sauvegarde Excel (non utilisé)
├── package.json
├── vite.config.ts
└── .env.example
```

---

## Base de données Supabase

**Projet :** `lhtgdaxexvdbswkycaxr`
**URL dashboard :** https://supabase.com/dashboard/project/lhtgdaxexvdbswkycaxr

### Table `catalog_items` — 12 667 articles

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid (PK) | Identifiant unique auto-généré |
| `name` | text | Désignation de l'article |
| `sap_code` | text | Code article SAP |
| `location` | text | Emplacement dans le magasin (ex: EPI 4 2B) |
| `category` | text | Catégorie (non utilisée actuellement) |

### Table `equipments` — 51 701 lignes

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid (PK) | Identifiant unique auto-généré |
| `equipment` | text | Code du poste technique (ex: 2A810-01) |
| `equipment_label` | text | Libellé du poste (ex: AGITATEUR F1A) |
| `sap_code` | text | Code article SAP |
| `designation` | text | Désignation de la pièce |
| `quantity` | integer | Quantité |

---

## Comment mettre à jour les données

### Modifier un article existant
1. Aller sur https://supabase.com/dashboard/project/lhtgdaxexvdbswkycaxr/editor
2. Cliquer sur la table `catalog_items`
3. Double-cliquer sur la cellule à modifier
4. Enregistrer — les changements sont visibles immédiatement sur l'appli

### Ajouter un article
1. Dans le Table Editor, cliquer sur **Insert > Insert row**
2. Remplir `sap_code`, `name`, `location`
3. Enregistrer

### Importer depuis Excel
1. Dans le Table Editor, cliquer sur **"Import data from CSV"**
2. Convertir l'Excel en CSV (Excel → Fichier → Enregistrer sous → CSV)
3. Mapper les colonnes et importer

---

## Vues de l'application

| Vue | Description |
|---|---|
| `home` | Accueil avec menu des fonctions |
| `list` | Liste et recherche des articles |
| `scan` | Scan de code-barres via caméra |
| `ai-scan` | Analyse de photo par Gemini IA |
| `cart` | Panier de demandes |
| `notes` | Bloc-notes avec photos |
| `equipments` | Postes techniques / nomenclature |
| `settings` | Paramètres et import manuel |

---

## Déploiement

Chaque `git push` sur `main` déclenche un redéploiement automatique sur Vercel.

- **URL de production :** https://catalogue-g-two.vercel.app
- **Dépôt GitHub :** https://github.com/jcmolinie-byte/catalogue_G

---

## Historique de migration

**Mai 2026** — Migration Excel → Supabase :
- Avant : l'appli téléchargeait les fichiers `.xlsx` depuis GitHub à chaque démarrage
- Après : l'appli lit directement dans Supabase
- 12 667 articles et 51 701 équipements migrés
- Les fichiers Excel restent dans `/public` comme sauvegarde
