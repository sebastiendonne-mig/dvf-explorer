# Nouveau tool : fetch_terrain_stats_commune

À intégrer dans `app/api/chat/route.ts`, en complément (pas en remplacement)
de `geocode_address` et `fetch_dvf_data`.

## Instructions pour Claude Code

1. Ajouter ce tool dans l'objet `tools: {}` de route.ts, à côté de `fetch_dvf_data`
2. Compléter le `systemPrompt` avec la section "Terrain" fournie plus bas
3. Réutiliser la fonction `parseCSV` déjà définie (ne pas la dupliquer) —
   si besoin, la sortir du scope de `fetch_dvf_data` pour la partager entre tools

## Différence clé avec fetch_dvf_data

- Pas de filtre par rayon/lat/lon : on veut TOUTES les ventes de terrain nu
  de la commune (insee), pas juste celles autour d'une adresse précise
- Filtre sur `type_local` vide/null (= pas de bâti) ET `surface_terrain > 0`
  ET `nature_mutation === 'Vente'`
- Catégories extraites dynamiquement des données réelles (pas de liste hardcodée)

---

## Code du tool

```typescript
fetch_terrain_stats_commune: tool({
  description:
    "Récupère les statistiques de prix des terrains non bâtis (terrains nus) " +
    "vendus dans une commune, groupées par catégorie de nature de culture DGFiP " +
    "et par année. Les catégories disponibles varient selon la commune et sont " +
    "extraites dynamiquement des données réelles.",
  inputSchema: z.object({
    insee: z.string().describe('Code INSEE commune (5 chars) retourné par geocode_address'),
    dept:  z.string().describe('Code département retourné par geocode_address'),
    yearFrom: z.number().optional().describe('Année de début (défaut: 2021)'),
    yearTo:   z.number().optional().describe('Année de fin (défaut: 2025)'),
    category: z.string().nullable().optional()
      .describe('Filtrer sur une catégorie nature_culture précise (ex: "terrains a bâtir"). Null = toutes catégories.'),
  }),
  execute: async ({ insee, dept, yearFrom, yearTo, category }: {
    insee: string; dept: string; yearFrom?: number; yearTo?: number; category?: string | null;
  }) => {

    function parseCSV(text: string): Record<string, string>[] {
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) return [];
      const headers = lines[0].split(',').map(h => h.trim());
      return lines.slice(1).map(line => {
        const values = line.split(',');
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim(); });
        return row;
      });
    }

    const urlDept = insee.startsWith('97') ? insee.substring(0, 3) : dept;
    const BASE = 'https://files.data.gouv.fr/geo-dvf/2025-12/csv';
    const startYear = yearFrom ?? 2021;
    const endYear = yearTo ?? 2025;
    const years = Array.from(
      { length: endYear - startYear + 1 },
      (_, i) => startYear + i
    );

    async function fetchYear(year: number): Promise<Record<string, string>[]> {
      const url = `${BASE}/${year}/communes/${urlDept}/${insee}.csv`;
      const res = await fetch(url, { headers: { Accept: 'text/csv,*/*' } });
      if (!res.ok) return [];
      const text = await res.text();
      if (text.trimStart().startsWith('<?xml')) return [];
      return parseCSV(text).map(row => ({ ...row, __year: String(year) }));
    }

    try {
      const allRows = (await Promise.all(years.map(fetchYear))).flat();

      // Filtre : terrain nu vendu (pas de bâti, surface_terrain renseignée)
      let terrainRows = allRows.filter(r =>
        (!r.type_local || r.type_local.trim() === '') &&
        r.nature_mutation === 'Vente' &&
        parseFloat(r.surface_terrain) > 0 &&
        parseFloat(r.valeur_fonciere) > 0
      );

      // Catégories réellement présentes dans cette commune (pour construire le filtre côté UI)
      const availableCategories = [...new Set(
        terrainRows
          .map(r => r.nature_culture)
          .filter(Boolean)
      )].sort();

      if (category) {
        terrainRows = terrainRows.filter(r => r.nature_culture === category);
      }

      if (terrainRows.length === 0) {
        return {
          count: 0,
          availableCategories,
          byCategory: [],
        };
      }

      // Dédup par id_mutation + id_parcelle (une vente peut avoir plusieurs lignes
      // si plusieurs subdivisions fiscales sur la même parcelle)
      const seen = new Set<string>();
      const dedup = terrainRows.filter(r => {
        const key = `${r.id_mutation}-${r.id_parcelle}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Groupement par catégorie + année
      type Group = { category: string; year: string; prices: number[]; surfaces: number[]; transactions: any[] };
      const groups = new Map<string, Group>();

      for (const r of dedup) {
        const cat = r.nature_culture || 'Non renseigné';
        const year = r.__year;
        const key = `${cat}__${year}`;
        const valeur = parseFloat(r.valeur_fonciere);
        const surface = parseFloat(r.surface_terrain);
        const pricePerM2 = valeur / surface;

        if (!groups.has(key)) {
          groups.set(key, { category: cat, year, prices: [], surfaces: [], transactions: [] });
        }
        const g = groups.get(key)!;
        g.prices.push(pricePerM2);
        g.surfaces.push(surface);
        g.transactions.push({
          date_mutation: r.date_mutation,
          valeur_fonciere: valeur,
          surface_terrain: surface,
          prix_m2: Math.round(pricePerM2 * 100) / 100,
          adresse_numero: r.adresse_numero || null,
          adresse_nom_voie: r.adresse_nom_voie || null,
          id_parcelle: r.id_parcelle,
        });
      }

      function median(arr: number[]): number {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      }

      const MIN_SAMPLE_FOR_AVERAGE = 5;

      const byCategory = [...groups.values()]
        .sort((a, b) => a.category.localeCompare(b.category) || b.year.localeCompare(a.year))
        .map(g => ({
          category: g.category,
          year: g.year,
          count: g.transactions.length,
          reliable: g.transactions.length >= MIN_SAMPLE_FOR_AVERAGE,
          medianPricePerM2: Math.round(median(g.prices) * 100) / 100,
          medianSurface: Math.round(median(g.surfaces)),
          transactions: g.transactions.sort(
            (a, b) => new Date(b.date_mutation).getTime() - new Date(a.date_mutation).getTime()
          ),
        }));

      return {
        count: dedup.length,
        availableCategories,
        byCategory,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      throw new Error(`Récupération statistiques terrain échouée: ${message}`);
    }
  }
}),
```

---

## Ajout au system prompt

À ajouter dans `systemPrompt`, après les règles existantes sur `fetch_dvf_data` :

```
RÈGLES POUR LES DEMANDES DE PRIX DE TERRAIN PAR COMMUNE :
- Si l'utilisateur demande le prix des terrains / foncier nu d'une commune
  (pas une adresse précise), appelle geocode_address puis fetch_terrain_stats_commune.
- Utilise "medianPricePerM2" (médiane), jamais une moyenne — plus robuste
  face aux terrains de tailles très différentes.
- Si reliable=false (moins de 5 transactions), affiche une fourchette
  (min-max des prix/m²) plutôt qu'un chiffre unique, et précise
  "échantillon faible, à interpréter avec prudence".
- N'affiche JAMAIS le mot "constructible" pour décrire une catégorie DVF.
  Utilise "terrain à bâtir (déclaré à la vente)" et précise systématiquement :
  "Cette catégorie reflète la déclaration faite au moment de la vente,
  pas un certificat de constructibilité au titre du PLU."
- Groupe l'affichage par catégorie, jamais un tableau mélangeant plusieurs
  catégories sans distinction (un terrain à bâtir et une terre agricole
  n'ont pas le même ordre de grandeur de prix/m²).
- Précise toujours la période couverte et le décalage de mise à jour DGFiP
  (environ 6 mois).
```

---

## Points à vérifier / tester avec Claude Code

1. **Fiabilité du champ `type_local` vide** : à confirmer sur un vrai CSV que
   les lignes de terrain nu ont bien `type_local` vide et pas juste absent
   d'une colonne mal indexée (le parseCSV actuel est un split naïf sur virgule,
   fragile si des valeurs contiennent des virgules échappées).

2. **Performance** : ce tool télécharge les mêmes CSV que `fetch_dvf_data`
   (5 ans × commune). Si les deux tools sont appelés dans la même conversation
   pour la même commune, ça double les téléchargements — un cache partagé
   (même basique, en mémoire avec TTL) serait utile ici en priorité.

3. **`code_nature_culture_speciale` / `nature_culture_speciale`** : non
   utilisé dans cette V1, mais pourrait affiner encore certaines catégories
   ("terrains de camping" vs "terrains d'agrément" génériques). À évaluer
   après un premier retour d'usage.

4. **Dédoublonnage** : la logique actuelle dédoublonne par
   `id_mutation + id_parcelle`. À vérifier sur des cas réels que ça ne
   supprime pas de vraies transactions distinctes (ex: deux ventes du
   même terrain à des dates différentes auraient le même `id_parcelle`
   mais un `id_mutation` différent — normalement géré correctement,
   mais à tester).
