import { describe, it, expect } from 'vitest';

const ADDRESS = '561 chemin du claou, 83330 le beausset';
const DVF_BASE = 'https://files.data.gouv.fr/geo-dvf/2025-12/csv';

/* ── Helpers (mirrored from route.ts) ── */

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

/* ── Tests ── */

describe('haversine', () => {
  it('retourne 0 pour deux points identiques', () => {
    expect(haversine(43.202206, 5.825992, 43.202206, 5.825992)).toBe(0);
  });

  it('calcule ~111km entre deux points espacés de 1° de latitude', () => {
    const d = haversine(48.0, 2.0, 49.0, 2.0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('la transaction DVF du Claou est à moins de 50m de l\'adresse géocodée', () => {
    // Coordonnées de l'adresse géocodée
    const searchLat = 43.202206;
    const searchLon = 5.825992;
    // Coordonnées dans le CSV DVF pour 561 CHE DU CLAOU
    const dvfLat = 43.202401;
    const dvfLon = 5.826019;
    const dist = haversine(searchLat, searchLon, dvfLat, dvfLon);
    expect(dist).toBeLessThan(50);
  });
});

describe('géocodage — 561 chemin du claou, Le Beausset', () => {
  it('retourne le code INSEE 83016 et le département 83', async () => {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(ADDRESS)}&limit=1`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.features.length).toBeGreaterThan(0);

    const feat = data.features[0];
    expect(feat.properties.citycode).toBe('83016');
    expect(feat.properties.citycode.substring(0, 2)).toBe('83');
    expect(feat.geometry.coordinates[1]).toBeCloseTo(43.202206, 2); // lat
    expect(feat.geometry.coordinates[0]).toBeCloseTo(5.825992, 2);  // lon
  });
});

describe('CSV DVF — commune 83016, année 2024', () => {
  let rows: Record<string, string>[] = [];

  it('télécharge et parse le CSV sans erreur', async () => {
    const url = `${DVF_BASE}/2024/communes/83/83016.csv`;
    const res = await fetch(url, { headers: { Accept: 'text/csv,*/*' } });
    expect(res.ok).toBe(true);

    const text = await res.text();
    expect(text.trimStart().startsWith('<?xml')).toBe(false);

    rows = parseCSV(text);
    expect(rows.length).toBeGreaterThan(0);
    // Vérifie la présence des colonnes attendues
    const required = ['date_mutation', 'valeur_fonciere', 'surface_reelle_bati',
                      'nombre_pieces_principales', 'type_local', 'longitude', 'latitude'];
    for (const col of required) {
      expect(rows[0]).toHaveProperty(col);
    }
  });

  it('contient la vente du 561 CHE DU CLAOU (738 021 €, Maison 5p 126m²)', async () => {
    if (rows.length === 0) {
      // Re-fetch si le test précédent n'a pas peuplé rows (ordre d'exécution indépendant)
      const res = await fetch(`${DVF_BASE}/2024/communes/83/83016.csv`, { headers: { Accept: 'text/csv,*/*' } });
      rows = parseCSV(await res.text());
    }

    const claou = rows.filter(r => r.adresse_nom_voie?.includes('CLAOU'));
    expect(claou.length).toBeGreaterThan(0);

    const maison = claou.find(r => r.type_local === 'Maison');
    expect(maison).toBeDefined();
    expect(maison!.valeur_fonciere).toBe('738021');
    expect(maison!.surface_reelle_bati).toBe('126');
    expect(maison!.nombre_pieces_principales).toBe('5');
    expect(maison!.date_mutation).toBe('2024-09-23');
  });
});

describe('pipeline complet — filtre haversine 200m', () => {
  it('retourne exactement 1 mutation unique à moins de 200m du 561 Chemin du Claou', async () => {
    const searchLat = 43.202206;
    const searchLon = 5.825992;

    const res = await fetch(`${DVF_BASE}/2024/communes/83/83016.csv`, { headers: { Accept: 'text/csv,*/*' } });
    const rows = parseCSV(await res.text());

    const PRIORITY: Record<string, number> = { Maison: 2, Appartement: 2, 'Local industriel. commercial ou assimilé': 1 };
    const byMutation = new Map<string, Record<string, string>>();

    for (const r of rows) {
      const rLat = parseFloat(r.latitude);
      const rLon = parseFloat(r.longitude);
      if (isNaN(rLat) || isNaN(rLon)) continue;
      if (haversine(searchLat, searchLon, rLat, rLon) >= 200) continue;
      const id = r.id_mutation;
      const existing = byMutation.get(id);
      const pNew = PRIORITY[r.type_local ?? ''] ?? 0;
      const pOld = existing ? (PRIORITY[existing.type_local ?? ''] ?? 0) : -1;
      if (pNew > pOld) byMutation.set(id, r);
    }

    expect(byMutation.size).toBe(1);

    const [tx] = [...byMutation.values()];
    expect(tx.type_local).toBe('Maison');
    expect(tx.valeur_fonciere).toBe('738021');
    expect(tx.surface_reelle_bati).toBe('126');
    expect(tx.nombre_pieces_principales).toBe('5');
    expect(tx.date_mutation).toBe('2024-09-23');

    const prixM2 = Math.round(parseFloat(tx.valeur_fonciere) / parseFloat(tx.surface_reelle_bati));
    expect(prixM2).toBe(5857);
  });
});
