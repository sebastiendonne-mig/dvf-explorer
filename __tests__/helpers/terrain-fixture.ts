// Ventes de terrain fictives, pour exercer fetch_terrain_stats_commune sans réseau.
import type { TerrainSale } from '@/lib/terrain-data';

export const TERRAIN_INPUT = { insee: '34301', dept: '34', yearFrom: 2024, yearTo: 2024 };

export const FAKE_SALES: TerrainSale[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  date_mutation: `2024-0${n}-15`,
  year: '2024',
  valeur_fonciere: 100_000 + n * 1000,
  surface_terrain: 500,
  prix: 200 + n,
  unit: '€/m²',
  category: 'terrains a bâtir',
  natures: ['terrains a bâtir'],
  parcelles: [`34301000AB00${n}`],
  adresse_nom_voie: 'CHEMIN FICTIF',
  excludedFromCalc: false,
}));
