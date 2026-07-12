// Types partagés entre le tool fetch_terrain_stats_commune (route API) et
// le composant TerrainStatsCards (frontend).

// Marqueur ajouté en fin de flux texte par la route API : tout ce qui suit
// est le JSON des statistiques terrain, destiné au composant dédié.
export const TERRAIN_MARKER = '@@TERRAIN_STATS@@';

export interface TerrainTransaction {
  date_mutation: string;
  valeur_fonciere: number;
  surface_terrain: number;
  prix_m2: number;
  natures: string[];
  parcelles: string[];
  adresse_nom_voie: string | null;
}

export interface TerrainGroup {
  category: string;
  year: string;
  count: number;
  reliable: boolean;
  medianPricePerM2: number;
  minPricePerM2: number;
  maxPricePerM2: number;
  medianSurface: number;
  transactions: TerrainTransaction[];
}

export interface TerrainStats {
  count: number;
  availableCategories: string[];
  byCategory: TerrainGroup[];
}

// Arrondi affichage : entier si ≥ 10 €/m², 2 décimales sinon (virgule française)
export function fmtPrixM2(v: number): string {
  return v >= 10
    ? Math.round(v).toLocaleString('fr-FR')
    : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtEuros(v: number): string {
  return Math.round(v).toLocaleString('fr-FR');
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export const CATEGORY_TERRAIN_A_BATIR = 'terrains a bâtir';

export function displayCategory(category: string): string {
  if (category === CATEGORY_TERRAIN_A_BATIR) return 'Terrain à bâtir (déclaré à la vente)';
  return category.charAt(0).toUpperCase() + category.slice(1);
}
