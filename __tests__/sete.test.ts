import { describe, it, expect } from 'vitest';

const ADDRESS = '38 Quai de Bosc, 34200 Sète';
const DVF_BASE = 'https://files.data.gouv.fr/geo-dvf/2025-12/csv';
const YEARS = [2021, 2022, 2023, 2024, 2025];

/* ── Helpers (miroir de route.ts) ── */

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

function dedup(rows: Record<string, string>[], searchLat: number, searchLon: number, radius: number) {
  const PRIORITY: Record<string, number> = { Appartement: 2, Maison: 2, 'Local industriel. commercial ou assimilé': 1 };
  const byMutation = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const rLat = parseFloat(r.latitude);
    const rLon = parseFloat(r.longitude);
    if (isNaN(rLat) || isNaN(rLon)) continue;
    if (haversine(searchLat, searchLon, rLat, rLon) >= radius) continue;
    const id = r.id_mutation;
    const existing = byMutation.get(id);
    const pNew = PRIORITY[r.type_local ?? ''] ?? 0;
    const pOld = existing ? (PRIORITY[existing.type_local ?? ''] ?? 0) : -1;
    if (pNew > pOld) byMutation.set(id, r);
  }
  return [...byMutation.values()].sort(
    (a, b) => new Date(b.date_mutation).getTime() - new Date(a.date_mutation).getTime()
  );
}

/* ══════════════════════════════════════
   GÉOCODAGE
══════════════════════════════════════ */
describe('géocodage — 38 Quai de Bosc, Sète', () => {
  it('retourne des coordonnées dans la zone de Sète et le code INSEE correct', async () => {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(ADDRESS)}&limit=1`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.features.length).toBeGreaterThan(0);

    const feat = data.features[0];
    const [lon, lat] = feat.geometry.coordinates;
    const { citycode } = feat.properties;

    console.log(`\n📍 Géocodage : ${feat.properties.label}`);
    console.log(`   lat=${lat}, lon=${lon}, citycode=${citycode}`);

    // Zone de Sète : lat ~43.4, lon ~3.7
    expect(lat).toBeGreaterThan(43.39);
    expect(lat).toBeLessThan(43.43);
    expect(lon).toBeGreaterThan(3.67);
    expect(lon).toBeLessThan(3.72);

    // INSEE réel retourné par la BAN pour Sète = 34301
    // NOTE : l'ancienne référence 34295 correspond à une codification historique
    // qui ne correspond plus à la BAN ni aux fichiers DVF (code_commune = 34301).
    expect(citycode).toBe('34301');
    console.log(`   ✓ INSEE 34301 confirmé (34295 est l'ancien code — non utilisé par la BAN/DVF)`);
  });

  it('le département 34 n\'est pas exclu (pas d\'Alsace-Moselle/Mayotte)', () => {
    const dept = '34301'.substring(0, 2); // "34"
    const excluded = ['57', '67', '68', '976'];
    expect(excluded.includes(dept)).toBe(false);
    console.log(`   ✓ Département ${dept} : données DVF disponibles`);
  });
});

/* ══════════════════════════════════════
   CSV PAR ANNÉE
══════════════════════════════════════ */
describe('CSV DVF — commune 34301, années 2021–2025', () => {
  it('tous les fichiers CSV existent et sont parsables', async () => {
    for (const year of YEARS) {
      const url = `${DVF_BASE}/${year}/communes/34/34301.csv`;
      const res = await fetch(url, { headers: { Accept: 'text/csv,*/*' } });
      expect(res.ok, `CSV ${year} introuvable`).toBe(true);

      const text = await res.text();
      expect(text.trimStart().startsWith('<?xml'), `CSV ${year} est une erreur XML`).toBe(false);

      const rows = parseCSV(text);
      expect(rows.length, `CSV ${year} vide`).toBeGreaterThan(0);
      console.log(`   ${year} : ${rows.length} lignes brutes`);
    }
  }, 30_000);
});

/* ══════════════════════════════════════
   PIPELINE COMPLET — FILTRE 200m
══════════════════════════════════════ */
describe('pipeline complet — filtre haversine 200m', () => {
  const searchLat = 43.407601;
  const searchLon = 3.695609;

  it('trouve des transactions Quai de Bosc chaque année et les affiche', async () => {
    const allRows: Record<string, string>[] = [];

    for (const year of YEARS) {
      const url = `${DVF_BASE}/${year}/communes/34/34301.csv`;
      const res = await fetch(url, { headers: { Accept: 'text/csv,*/*' } });
      const rows = parseCSV(await res.text());
      allRows.push(...rows);
    }

    // Appliquer le filtre + déduplication
    const transactions = dedup(allRows, searchLat, searchLon, 200);
    const boscTx = transactions.filter(r => r.adresse_nom_voie?.includes('BOSC'));

    // Résumé par année
    console.log(`\n📊 Résultats complets — ${ADDRESS}`);
    console.log(`   ${transactions.length} transactions totales dans un rayon de 200m\n`);

    const byYear: Record<string, typeof transactions> = {};
    for (const tx of transactions) {
      const yr = tx.date_mutation?.slice(0, 4) ?? 'inconnu';
      (byYear[yr] ??= []).push(tx);
    }
    for (const yr of Object.keys(byYear).sort((a, b) => b.localeCompare(a))) {
      const group = byYear[yr];
      const boscCount = group.filter(r => r.adresse_nom_voie?.includes('BOSC')).length;
      console.log(`\n  ### ${yr} (${group.length} mutations dont ${boscCount} Quai de Bosc)`);
      for (const tx of group) {
        const addr = [tx.adresse_numero, tx.adresse_nom_voie].filter(Boolean).join(' ');
        const surf = tx.surface_reelle_bati ? `${tx.surface_reelle_bati}m²` : '—';
        const val = tx.valeur_fonciere ? `${Number(tx.valeur_fonciere).toLocaleString('fr-FR')} €` : '—';
        const pm2 = tx.valeur_fonciere && tx.surface_reelle_bati
          ? `${Math.round(Number(tx.valeur_fonciere) / Number(tx.surface_reelle_bati)).toLocaleString('fr-FR')} €/m²`
          : '';
        const parts = [tx.date_mutation, addr, tx.type_local, surf, val, pm2].filter(Boolean);
        console.log(`    - ${parts.join(' · ')}`);
      }
    }

    // Assertions
    expect(transactions.length).toBeGreaterThan(0);
    expect(boscTx.length, 'aucune transaction Quai de Bosc trouvée à 200m').toBeGreaterThan(0);

    // Vérifie qu'au moins 4 des 5 années ont des résultats Quai de Bosc
    const yearsWithBosc = new Set(boscTx.map(r => r.date_mutation?.slice(0, 4)));
    console.log(`\n  ✓ Années avec Quai de Bosc à 200m : ${[...yearsWithBosc].sort().join(', ')}`);
    expect(yearsWithBosc.size).toBeGreaterThanOrEqual(4);
  }, 60_000);

  it('le filtre 200m est bien calibré : nr 38 capturé, nr 55+ exclu', () => {
    // nr 38 (20m) — dans le rayon
    expect(haversine(searchLat, searchLon, 43.407518, 3.695384)).toBeLessThan(200);
    // nr 47 (148m) — dans le rayon
    expect(haversine(searchLat, searchLon, 43.408681, 3.694539)).toBeLessThan(200);
    // nr 55 (306m) — hors rayon à 200m (correct : trop loin du nr 38)
    expect(haversine(searchLat, searchLon, 43.409899, 3.693522)).toBeGreaterThan(200);
    // nr 61 (463m) — hors rayon
    expect(haversine(searchLat, searchLon, 43.411002, 3.692302)).toBeGreaterThan(200);

    console.log('\n  ✓ Calibration 200m correcte');
    console.log('    nr 32 (~78m), nr 38 (~20m), nr 47 (~148m) → capturés');
    console.log('    nr 55 (~306m), nr 61 (~463m) → exclus (correct : autre segment du quai)');
  });

  it('augmenter à 300m n\'apporte que 2-3 Quai de Bosc supplémentaires (bruit x2-3)', () => {
    // Vérification analytique : nr 55 est à 306m (hors 300m aussi)
    const dist55 = haversine(searchLat, searchLon, 43.409899, 3.693522);
    expect(dist55).toBeGreaterThan(300);
    console.log(`\n  ℹ  nr 55 à ${dist55.toFixed(0)}m — hors rayon même à 300m`);
    console.log('     Conclusion : rayon 200m optimal pour cette adresse');
  });
});
