// Types partagés entre le tool fetch_terrain_stats_commune (route API) et
// le composant TerrainStatsCards (frontend).

// Marqueur ajouté en fin de flux texte par la route API : tout ce qui suit
// est le JSON des statistiques terrain, destiné au composant dédié.
export const TERRAIN_MARKER = '@@TERRAIN_STATS@@';

export type PriceUnit = '€/m²' | '€/ha';

// Catégories urbaines/résidentielles : prix affiché en €/m². Toutes les
// autres natures de culture DGFiP (agricoles, forestières, naturelles)
// s'expriment en €/ha (1 ha = 10 000 m²), l'unité du marché rural.
const M2_CATEGORIES = new Set([
  'terrains a bâtir',
  "terrains d'agrément",
  'sols',
  'jardins',
  'chemin de fer',
  'chemins de fer',
  'Non renseigné',
]);

export function priceUnitFor(category: string): PriceUnit {
  return M2_CATEGORIES.has(category) ? '€/m²' : '€/ha';
}

// Seuils d'exclusion du CALCUL (jamais de l'affichage) : ventes à valeur
// symbolique (donations/successions passées en "Vente" à 1 €) et surfaces
// quasi nulles qui font exploser le prix unitaire. Volontairement bas pour
// ne pas écarter de vraies petites transactions.
export const MIN_VALEUR_CALC = 10; // €
export const MIN_SURFACE_CALC = 20; // m²

export interface TerrainTransaction {
  date_mutation: string;
  valeur_fonciere: number;
  surface_terrain: number;
  prix: number;
  natures: string[];
  parcelles: string[];
  adresse_nom_voie: string | null;
  excludedFromCalc: boolean;
}

export interface TerrainGroup {
  category: string;
  year: string;
  unit: PriceUnit;
  count: number; // toutes les ventes du groupe, y compris hors calcul
  calcCount: number; // ventes prises en compte dans médiane/min/max
  reliable: boolean;
  medianPrice: number | null; // null si aucune vente utilisable pour le calcul
  minPrice: number | null;
  maxPrice: number | null;
  medianSurface: number;
  transactions: TerrainTransaction[];
}

export interface TerrainStats {
  count: number;
  availableCategories: string[];
  byCategory: TerrainGroup[];
}

// Arrondi affichage : entier si ≥ 10, 2 décimales sinon (virgule française)
export function fmtPrix(v: number): string {
  return v >= 10
    ? Math.round(v).toLocaleString('fr-FR')
    : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Surface : en ha (2 décimales max) pour les catégories rurales, sinon en m²
export function fmtSurface(m2: number, unit: PriceUnit): string {
  return unit === '€/ha'
    ? `${(m2 / 10000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ha`
    : `${Math.round(m2).toLocaleString('fr-FR')} m²`;
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
