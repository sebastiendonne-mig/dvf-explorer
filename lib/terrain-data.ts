// Logique serveur partagée entre le tool fetch_terrain_stats_commune
// (app/api/chat/route.ts) et la route /api/terrain-transactions :
// téléchargement des CSV DVF, parsing, filtrage terrain nu et agrégation
// par mutation. Côté serveur uniquement (fetch réseau).

import {
  priceUnitFor,
  PriceUnit,
  MIN_VALEUR_CALC,
  MIN_SURFACE_CALC,
} from './terrain';

const BASE = 'https://files.data.gouv.fr/geo-dvf/2025-12/csv';

// Naive comma split: geo-dvf CSVs contain no quoted fields (verified on real files).
export function parseCSV(text: string): Record<string, string>[] {
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

// Cache mémoire des CSV parsés (clé insee-année), partagé entre le tool et
// la route transactions tant que la lambda reste chaude. Les fichiers d'une
// release DVF sont statiques ; TTL et taille bornée pour contenir la mémoire
// (une grosse commune ≈ 20 000 lignes parsées). Le data cache de Next ne
// convient pas ici : limite ~2 Mo par entrée, dépassée par les grandes communes.
const CSV_TTL_MS = 15 * 60 * 1000;
const CSV_CACHE_MAX = 12;
// Un socket qui pend vers files.data.gouv.fr bloquerait la lambda jusqu'au
// 504 (cause du timeout du 16/07) : on borne chaque téléchargement.
const CSV_FETCH_TIMEOUT_MS = 10_000;
const csvCache = new Map<string, { rows: Record<string, string>[]; at: number }>();

async function fetchYearRows(urlDept: string, insee: string, year: number): Promise<Record<string, string>[]> {
  const key = `${insee}-${year}`;
  const hit = csvCache.get(key);
  if (hit && Date.now() - hit.at < CSV_TTL_MS) return hit.rows;

  const url = `${BASE}/${year}/communes/${urlDept}/${insee}.csv`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'text/csv,*/*' },
      signal: AbortSignal.timeout(CSV_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new Error(
      timedOut
        ? `Le service de données DGFiP ne répond pas (${insee}, ${year}). Réessayez dans quelques instants.`
        : `Téléchargement DVF échoué (${insee}, ${year}).`
    );
  }
  if (!res.ok) return [];
  const text = await res.text();
  if (text.trimStart().startsWith('<?xml')) return [];
  const rows = parseCSV(text);

  if (csvCache.size >= CSV_CACHE_MAX) {
    const oldest = [...csvCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) csvCache.delete(oldest[0]);
  }
  csvCache.set(key, { rows, at: Date.now() });
  return rows;
}

export interface TerrainSale {
  date_mutation: string;
  year: string;
  valeur_fonciere: number;
  surface_terrain: number;
  prix: number;
  unit: PriceUnit;
  category: string;
  natures: string[];
  parcelles: string[];
  adresse_nom_voie: string | null;
  excludedFromCalc: boolean;
}

// Bornes des données disponibles dans la release DVF utilisée
export function clampYears(yearFrom?: number, yearTo?: number): { startYear: number; endYear: number } {
  return {
    startYear: Math.max(yearFrom ?? 2021, 2014),
    endYear: Math.min(yearTo ?? 2025, 2025),
  };
}

export function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Ventes de terrain nu d'une commune sur la période, agrégées par mutation.
// valeur_fonciere est le prix TOTAL de la mutation, répété sur chaque ligne,
// et une vente de maison porte aussi des lignes sans type_local (son sol) :
// on ne garde que les mutations sans aucun bâti, et le prix unitaire se
// calcule sur la surface totale dédoublonnée de la mutation.
export async function fetchTerrainSales({ insee, dept, startYear, endYear }: {
  insee: string; dept: string; startYear: number; endYear: number;
}): Promise<TerrainSale[]> {
  // Overseas departments (971–974) need 3-char dept in URL path
  const urlDept = insee.startsWith('97') ? insee.substring(0, 3) : dept;
  const years = Array.from(
    { length: Math.max(endYear - startYear + 1, 0) },
    (_, i) => startYear + i
  );

  const allRows = (await Promise.all(years.map(y => fetchYearRows(urlDept, insee, y)))).flat();

  const byMutation = new Map<string, Record<string, string>[]>();
  for (const r of allRows) {
    if (r.nature_mutation !== 'Vente') continue;
    const rows = byMutation.get(r.id_mutation);
    if (rows) rows.push(r); else byMutation.set(r.id_mutation, [r]);
  }

  const sales: TerrainSale[] = [];

  for (const rows of byMutation.values()) {
    if (rows.some(r => r.type_local && r.type_local.trim() !== '')) continue;
    const valeur = parseFloat(rows[0].valeur_fonciere);
    if (!(valeur > 0)) continue;

    // A parcelle can appear once per subdivision fiscale, and the same
    // subdivision can repeat across dispositions: dedup on the full triplet.
    const seen = new Set<string>();
    const surfaceByNature = new Map<string, number>();
    const parcelles = new Set<string>();
    let totalSurface = 0;
    for (const r of rows) {
      const surface = parseFloat(r.surface_terrain);
      if (!(surface > 0)) continue;
      const key = `${r.id_parcelle}|${r.nature_culture}|${r.surface_terrain}`;
      if (seen.has(key)) continue;
      seen.add(key);
      totalSurface += surface;
      const nature = r.nature_culture || 'Non renseigné';
      surfaceByNature.set(nature, (surfaceByNature.get(nature) ?? 0) + surface);
      parcelles.add(r.id_parcelle);
    }
    if (totalSurface <= 0) continue;

    const natures = [...surfaceByNature.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([nature]) => nature);

    // Unité selon la catégorie dominante : €/m² en urbain,
    // €/ha en rural (même calcul, diviseur en hectares)
    const unit = priceUnitFor(natures[0]);
    const divisor = unit === '€/ha' ? totalSurface / 10000 : totalSurface;

    sales.push({
      date_mutation: rows[0].date_mutation,
      year: (rows[0].date_mutation ?? '').slice(0, 4),
      valeur_fonciere: valeur,
      surface_terrain: totalSurface,
      prix: Math.round((valeur / divisor) * 100) / 100,
      unit,
      category: natures[0], // dominant nature_culture by surface
      natures,
      parcelles: [...parcelles],
      adresse_nom_voie: rows.find(r => r.adresse_nom_voie)?.adresse_nom_voie ?? null,
      // Toujours affichée, mais exclue des médianes/fourchettes :
      // valeur symbolique ou surface quasi nulle
      excludedFromCalc: valeur <= MIN_VALEUR_CALC || totalSurface <= MIN_SURFACE_CALC,
    });
  }

  return sales;
}
