# DVF Explorer

Explorez l'historique complet des transactions immobilières françaises directement depuis une adresse.

**Demo** : [dvf.tkoidra.com](https://dvf.tkoidra.com)

---

## Fonctionnement

1. Saisissez une adresse (autocomplétion BAN)
2. L'agent géocode l'adresse via l'API Adresse (data.gouv.fr)
3. Il télécharge les CSV DVF officiels pour les années 2021–2025
4. Il filtre les transactions à 200 m, puis par numéro de rue exact
5. Les résultats s'affichent groupés par année

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Framework | Next.js 16 (App Router, Turbopack) |
| IA | Anthropic Claude Sonnet 4.6 via Vercel AI SDK v6 |
| Géocodage | API Adresse — Base Adresse Nationale (BAN) |
| Données DVF | Fichiers CSV statiques — data.gouv.fr / DGFiP |
| Style | CSS custom properties + Tailwind CSS v4 |
| Tests | Vitest (intégration réelle, sans mock) |
| Déploiement | Vercel |

---

## Architecture

```
dvf-explorer/
├── app/
│   ├── api/chat/route.ts   # Agent IA : géocodage + fetch CSV + filtre haversine
│   ├── globals.css         # Design system (variables CSS, composants)
│   ├── layout.tsx          # Layout racine, Inter font
│   └── page.tsx            # Interface : hero, autocomplete, résultats streaming
├── lib/
│   └── sanitize.ts         # Sanitization adresses, extraction département INSEE
├── __tests__/
│   ├── dvf.test.ts         # Tests intégration — Le Beausset (83016)
│   └── sete.test.ts        # Tests intégration — Sète (34301)
└── components/
    └── ChatResponse.tsx    # Composant chat (non utilisé en prod, conservé)
```

---

## Variables d'environnement

Créez un fichier `.env.local` à la racine :

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

La clé est disponible sur [console.anthropic.com](https://console.anthropic.com).

---

## Lancer en local

```bash
# Installer les dépendances
npm install

# Lancer le serveur de développement (port 3000)
npm run dev

# Lancer les tests d'intégration
npm test
```

Ouvrez [http://localhost:3000](http://localhost:3000).

---

## Sources des données

### API Adresse (BAN)
- **URL** : `https://api-adresse.data.gouv.fr`
- **Fournisseur** : DINUM / IGN / La Poste
- **Licence** : Licence Ouverte / Open Licence 2.0

### DVF — Demandes de Valeurs Foncières
- **URL** : `https://files.data.gouv.fr/geo-dvf/2025-12/csv/{year}/communes/{dept}/{insee}.csv`
- **Fournisseur** : DGFiP (Direction Générale des Finances Publiques)
- **Licence** : Licence Ouverte / Open Licence 2.0
- **Couverture** : Années 2021–2025, toute la France métropolitaine et DOM (hors Alsace-Moselle, Mayotte)
- **Mise à jour** : Annuelle, décalage ~6 mois

### Départements exclus
Les départements **57** (Moselle), **67** (Bas-Rhin), **68** (Haut-Rhin) et **976** (Mayotte) utilisent un régime foncier différent (livre foncier alsacien-mosellan) et ne figurent pas dans la base DVF.

---

## Mentions légales

Les données DVF sont issues de la base publique des Demandes de Valeurs Foncières, publiée par la Direction Générale des Finances Publiques (DGFiP) sous Licence Ouverte. Elles sont fournies à titre informatif. Les prix affichés correspondent aux valeurs déclarées lors des mutations ; ils peuvent inclure des charges, des lots multiples ou des conditions particulières de vente.
