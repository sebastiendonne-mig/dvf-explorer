import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import {
  sanitizeAddress,
  extractDepartmentFromInsee,
  isDepartmentExcluded
} from '@/lib/sanitize';
import { TERRAIN_MARKER, priceUnitFor, MIN_VALEUR_CALC, MIN_SURFACE_CALC } from '@/lib/terrain';

export const maxDuration = 60;

// Shared between fetch_dvf_data and fetch_terrain_stats_commune.
// Naive comma split: geo-dvf CSVs contain no quoted fields (verified on real files).
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

const systemPrompt = `Tu es un agent DVF. RÈGLE ABSOLUE : n'écris AUCUN texte avant d'avoir exécuté les outils nécessaires — appelle-les directement.

Étapes :
1. Appelle \`geocode_address\` avec l'adresse fournie.
2. Si le département est 57, 67, 68 ou 976 : réponds "Données DVF non disponibles pour ce département (Alsace-Moselle / Mayotte)."
3. Appelle \`fetch_dvf_data\` avec lat, lon, insee, dept, housenumber, street.
4. Réponds UNIQUEMENT dans ce format exact, rien d'autre :

Si fallback=false :
📍 {label géocodé}
*Résultats dans un rayon de {radius}m*

### {YYYY}
- {JJ/MM/AAAA} — {adresse_numero} {adresse_nom_voie} · {type_local} {nombre_pieces_principales}p · {surface_reelle_bati}m² · {valeur_fonciere} € · {prix_m2} €/m²

Si fallback=true :
📍 {label géocodé}
*Résultats dans un rayon de {radius}m*

Aucune transaction trouvée au n°{housenumber}, voici les plus proches :

### {YYYY}
- {JJ/MM/AAAA} — {adresse_numero} {adresse_nom_voie} · {type_local} ...

Règles de formatage :
- Groupe par année décroissante, une section ### YYYY par année présente
- Date en format JJ/MM/AAAA (ex : 23/09/2024)
- Adresse = adresse_numero + " " + adresse_nom_voie ; omets si les deux sont vides
- prix_m2 = round(valeur_fonciere / surface_reelle_bati) — omets si surface nulle ou 0
- Omets "Np ·" si nombre_pieces_principales est nul ou 0
- Si count=0 : "Aucune transaction trouvée dans ce périmètre."
INTERDIT : introduction, conclusion, commentaire, tout texte hors format.

RÈGLES POUR LES DEMANDES DE PRIX DE TERRAIN PAR COMMUNE :
Si l'utilisateur demande le prix des terrains ou du foncier nu d'une commune entière (pas d'une adresse précise) : appelle \`geocode_address\` puis \`fetch_terrain_stats_commune\` (pas \`fetch_dvf_data\`). Les statistiques détaillées (prix par catégorie et par année, note légale, lien officiel) s'affichent automatiquement sous ta réponse via un composant dédié — ne les écris PAS toi-même.
Réponds UNIQUEMENT :

📍 {label géocodé}

Si count=0, ajoute une seconde ligne : "Aucune vente de terrain nu trouvée pour cette commune sur la période."
INTERDIT : tableau, chiffres, résumé, commentaire — aucune autre ligne.`;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: systemPrompt,
      messages,
      stopWhen: stepCountIs(5),
      tools: {
        geocode_address: tool({
          description:
            "Convertit une adresse textuelle en coordonnées GPS via l'API Adresse française. Retourne latitude, longitude, code INSEE, label et nom de voie.",
          inputSchema: z.object({
            address: z
              .string()
              .min(5, 'Adresse trop courte')
              .max(200, 'Adresse trop longue')
              .describe('Adresse à géocoder (ex: "10 Rue de la Paix, Paris")')
          }),
          execute: async ({ address }) => {
            try {
              const cleanAddress = sanitizeAddress(address);

              const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(cleanAddress)}&limit=1`;
              const res = await fetch(url, {
                headers: { 'Accept': 'application/json' }
              });

              if (!res.ok) {
                throw new Error(`API Adresse error: ${res.status}`);
              }

              const data = await res.json();

              if (!data.features || data.features.length === 0) {
                throw new Error(
                  "Adresse introuvable. Vérifiez l'orthographe ou soyez plus spécifique."
                );
              }

              const feat = data.features[0];
              const coords = feat.geometry.coordinates;
              const insee = feat.properties.citycode;

              const dept = extractDepartmentFromInsee(insee);
              if (isDepartmentExcluded(dept)) {
                throw new Error(
                  `Les données DVF ne sont pas disponibles pour ce département (${dept}). Cette région (Alsace-Moselle ou Mayotte) utilise un régime foncier différent.`
                );
              }

              return {
                lat: coords[1],
                lon: coords[0],
                insee: insee,
                dept: dept,
                label: feat.properties.label,
                postcode: feat.properties.postcode,
                housenumber: (feat.properties.housenumber as string | undefined) ?? null,
                street: (feat.properties.street as string | undefined) ?? null,
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Erreur inconnue';
              throw new Error(`Géocodage échoué: ${message}`);
            }
          }
        }),

        fetch_dvf_data: tool({
          description:
            'Récupère les transactions DVF depuis les fichiers CSV statiques data.gouv.fr. Rayon adaptatif : 50m si housenumber présent, 150m sinon, retry 300m si aucun résultat. Filtre sur numéro ET nom de voie normalisé. Données disponibles de 2014 à 2025.',
          inputSchema: z.object({
            lat:         z.number().min(-90).max(90).describe('Latitude du point'),
            lon:         z.number().min(-180).max(180).describe('Longitude du point'),
            insee:       z.string().describe('Code INSEE commune (5 chars) retourné par geocode_address'),
            dept:        z.string().describe('Code département retourné par geocode_address'),
            housenumber: z.string().nullable().describe('Numéro de rue retourné par geocode_address (ex: "21"), null si absent'),
            street:      z.string().nullable().describe('Nom de voie retourné par geocode_address (ex: "Rue Pierre Semard"), null si absent'),
          }),
          execute: async ({ lat, lon, insee, dept, housenumber, street }: {
            lat: number; lon: number; insee: string; dept: string;
            housenumber: string | null; street: string | null;
          }) => {
            function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
              const R = 6_371_000;
              const φ1 = lat1 * Math.PI / 180;
              const φ2 = lat2 * Math.PI / 180;
              const Δφ = (lat2 - lat1) * Math.PI / 180;
              const Δλ = (lon2 - lon1) * Math.PI / 180;
              const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
              return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            }

            // Normalize voie: uppercase, strip accents, remove generic type words
            function normalizeVoie(s: string): string {
              return s
                .toUpperCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/\b(RUE|AVENUE|AV|BOULEVARD|BD|BLVD|CHEMIN|CHE|IMPASSE|IMP|ALLEE|ROUTE|RTE|PLACE|PL|PASSAGE|SQUARE|VOIE|CITE|DOMAINE|HAMEAU|LOTISSEMENT|LOT|VILLA|RESIDENCE|RES|SENTE|TRAVERSE|TRAVERSE)\b/g, '')
                .replace(/[^A-Z0-9\s]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            }

            // Overseas departments (971–974) need 3-char dept in URL path
            const urlDept = insee.startsWith('97') ? insee.substring(0, 3) : dept;
            const BASE = 'https://files.data.gouv.fr/geo-dvf/2025-12/csv';

            async function fetchYear(year: number): Promise<Record<string, string>[]> {
              const url = `${BASE}/${year}/communes/${urlDept}/${insee}.csv`;
              const res = await fetch(url, { headers: { Accept: 'text/csv,*/*' } });
              if (!res.ok) return [];
              const text = await res.text();
              if (text.trimStart().startsWith('<?xml')) return [];
              return parseCSV(text);
            }

            const PRIORITY: Record<string, number> = {
              'Appartement': 2, 'Maison': 2,
              'Local industriel. commercial ou assimilé': 1,
            };

            function filterAndDedup(rows: Record<string, string>[], radius: number) {
              const byMutation = new Map<string, Record<string, string>>();
              for (const r of rows) {
                const rLat = parseFloat(r.latitude);
                const rLon = parseFloat(r.longitude);
                if (isNaN(rLat) || isNaN(rLon)) continue;
                if (haversine(lat, lon, rLat, rLon) >= radius) continue;
                const id = r.id_mutation;
                const existing = byMutation.get(id);
                const pNew = PRIORITY[r.type_local ?? ''] ?? 0;
                const pOld = existing ? (PRIORITY[existing.type_local ?? ''] ?? 0) : -1;
                if (pNew > pOld) byMutation.set(id, r);
              }
              return [...byMutation.values()];
            }

            try {
              const allRows = (await Promise.all(
                [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(fetchYear)
              )).flat();

              if (allRows.length === 0) return { count: 0, transactions: [], radius: 0 };

              // Adaptive radius
              const initialRadius = housenumber ? 50 : 150;
              let candidates = filterAndDedup(allRows, initialRadius);
              let usedRadius = initialRadius;

              if (candidates.length === 0) {
                candidates = filterAndDedup(allRows, 300);
                usedRadius = 300;
              }

              if (candidates.length === 0) return { count: 0, transactions: [], fallback: false, radius: usedRadius };

              let fallback = false;

              if (housenumber) {
                const numericHN = housenumber.match(/^\d+/)?.[0] ?? housenumber;
                const normalizedSearchStreet = street ? normalizeVoie(street) : '';

                const exact = candidates.filter(r => {
                  const numMatch = r.adresse_numero === housenumber || r.adresse_numero === numericHN;
                  if (!numMatch) return false;
                  if (!normalizedSearchStreet) return true;
                  const dvfStreet = normalizeVoie(r.adresse_nom_voie ?? '');
                  return dvfStreet.includes(normalizedSearchStreet) || normalizedSearchStreet.includes(dvfStreet);
                });

                if (exact.length > 0) {
                  candidates = exact;
                } else {
                  // Fallback: 5 closest by distance
                  candidates = candidates
                    .map(r => ({ r, dist: haversine(lat, lon, parseFloat(r.latitude), parseFloat(r.longitude)) }))
                    .sort((a, b) => a.dist - b.dist)
                    .slice(0, 5)
                    .map(({ r }) => r);
                  fallback = true;
                }
              }

              const transactions = candidates
                .sort((a, b) => new Date(b.date_mutation).getTime() - new Date(a.date_mutation).getTime())
                .map(r => ({
                  date_mutation:             r.date_mutation,
                  valeur_fonciere:           r.valeur_fonciere           ? parseFloat(r.valeur_fonciere)           : null,
                  surface_reelle_bati:       r.surface_reelle_bati       ? parseFloat(r.surface_reelle_bati)       : null,
                  nombre_pieces_principales: r.nombre_pieces_principales ? parseInt(r.nombre_pieces_principales)   : null,
                  type_local:                r.type_local                || null,
                  nature_mutation:           r.nature_mutation           || null,
                  adresse_numero:            r.adresse_numero            || null,
                  adresse_nom_voie:          r.adresse_nom_voie          || null,
                }));

              return { count: transactions.length, transactions, fallback, housenumber, radius: usedRadius };
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Erreur inconnue';
              throw new Error(`Récupération DVF échouée: ${message}`);
            }
          }
        }),

        fetch_terrain_stats_commune: tool({
          description:
            "Récupère les statistiques de prix des terrains non bâtis (terrains nus) vendus dans une commune entière, sans filtre par adresse, groupées par catégorie de nature de culture DGFiP et par année. Les catégories disponibles varient selon la commune et sont extraites dynamiquement des données réelles.",
          inputSchema: z.object({
            insee:    z.string().describe('Code INSEE commune (5 chars) retourné par geocode_address'),
            dept:     z.string().describe('Code département retourné par geocode_address'),
            yearFrom: z.number().optional().describe('Année de début (défaut: 2021, min: 2014)'),
            yearTo:   z.number().optional().describe('Année de fin (défaut: 2025)'),
            category: z.string().nullable().optional().describe('Filtrer sur une catégorie nature_culture précise (ex: "terrains a bâtir"). Null = toutes catégories.'),
          }),
          execute: async ({ insee, dept, yearFrom, yearTo, category }: {
            insee: string; dept: string; yearFrom?: number; yearTo?: number; category?: string | null;
          }) => {
            // Overseas departments (971–974) need 3-char dept in URL path
            const urlDept = insee.startsWith('97') ? insee.substring(0, 3) : dept;
            const BASE = 'https://files.data.gouv.fr/geo-dvf/2025-12/csv';
            const startYear = Math.max(yearFrom ?? 2021, 2014);
            const endYear = Math.min(yearTo ?? 2025, 2025);
            const years = Array.from(
              { length: Math.max(endYear - startYear + 1, 0) },
              (_, i) => startYear + i
            );

            async function fetchYear(year: number): Promise<Record<string, string>[]> {
              const url = `${BASE}/${year}/communes/${urlDept}/${insee}.csv`;
              const res = await fetch(url, { headers: { Accept: 'text/csv,*/*' } });
              if (!res.ok) return [];
              const text = await res.text();
              if (text.trimStart().startsWith('<?xml')) return [];
              return parseCSV(text);
            }

            function median(arr: number[]): number {
              const sorted = [...arr].sort((a, b) => a - b);
              const mid = Math.floor(sorted.length / 2);
              return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
            }

            const MIN_SAMPLE_RELIABLE = 5;
            const MAX_TRANSACTIONS_PER_GROUP = 10;

            try {
              const allRows = (await Promise.all(years.map(fetchYear))).flat();

              // valeur_fonciere is the TOTAL price of the whole mutation, repeated
              // on every row, and a house sale also carries bare type_local rows
              // for its land. Stats must therefore be computed per mutation:
              // keep only sales where no row has a type_local at all.
              const byMutation = new Map<string, Record<string, string>[]>();
              for (const r of allRows) {
                if (r.nature_mutation !== 'Vente') continue;
                const rows = byMutation.get(r.id_mutation);
                if (rows) rows.push(r); else byMutation.set(r.id_mutation, [r]);
              }

              type Sale = {
                date_mutation: string;
                year: string;
                valeur_fonciere: number;
                surface_terrain: number;
                prix: number;
                unit: ReturnType<typeof priceUnitFor>;
                category: string;
                natures: string[];
                parcelles: string[];
                adresse_nom_voie: string | null;
                excludedFromCalc: boolean;
              };
              const sales: Sale[] = [];
              const allCategories = new Set<string>();

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
                natures.forEach(n => allCategories.add(n));

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

              const availableCategories = [...allCategories].sort();
              const filtered = category ? sales.filter(s => s.category === category) : sales;

              if (filtered.length === 0) {
                return { count: 0, availableCategories, byCategory: [] };
              }

              // Group by dominant category + year
              type Group = { category: string; year: string; sales: Sale[] };
              const groups = new Map<string, Group>();
              for (const s of filtered) {
                const key = `${s.category}__${s.year}`;
                if (!groups.has(key)) {
                  groups.set(key, { category: s.category, year: s.year, sales: [] });
                }
                groups.get(key)!.sales.push(s);
              }

              const byCategory = [...groups.values()]
                .sort((a, b) => a.category.localeCompare(b.category) || b.year.localeCompare(a.year))
                .map(g => {
                  // Stats sur les seules ventes significatives ; le compte
                  // total et la liste affichée restent exhaustifs
                  const calcSales = g.sales.filter(s => !s.excludedFromCalc);
                  const prices = calcSales.map(s => s.prix);
                  return {
                    category: g.category,
                    year: g.year,
                    unit: g.sales[0].unit,
                    count: g.sales.length,
                    calcCount: calcSales.length,
                    reliable: calcSales.length >= MIN_SAMPLE_RELIABLE,
                    medianPrice: prices.length > 0 ? Math.round(median(prices) * 100) / 100 : null,
                    minPrice: prices.length > 0 ? Math.min(...prices) : null,
                    maxPrice: prices.length > 0 ? Math.max(...prices) : null,
                    medianSurface: Math.round(median(g.sales.map(s => s.surface_terrain))),
                    transactions: g.sales
                      .sort((a, b) => new Date(b.date_mutation).getTime() - new Date(a.date_mutation).getTime())
                      .slice(0, MAX_TRANSACTIONS_PER_GROUP)
                      .map(({ year, category, unit, ...t }) => t),
                  };
                });

              return { count: filtered.length, availableCategories, byCategory };
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Erreur inconnue';
              throw new Error(`Récupération statistiques terrain échouée: ${message}`);
            }
          }
        })
      }
    });

    // Stream text with error interception: if Anthropic API is overloaded,
    // send a readable error message instead of silently returning an empty stream.
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.textStream) {
            controller.enqueue(encoder.encode(chunk));
          }
          // Après le texte : si le tool terrain a été appelé, on ajoute son
          // résultat JSON derrière un marqueur — le frontend le retire du
          // texte affiché et le passe au composant TerrainStatsCards.
          const steps = await result.steps;
          const terrain = steps
            .flatMap(s => s.toolResults)
            .find(r => r.toolName === 'fetch_terrain_stats_commune');
          if (terrain) {
            controller.enqueue(encoder.encode('\n' + TERRAIN_MARKER + JSON.stringify(terrain.output)));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          const isOverload = msg.includes('RetryError') || msg.includes('overload') || msg.includes('529') || msg.includes('rate');
          controller.enqueue(encoder.encode(
            isOverload
              ? '⚠️ Service temporairement surchargé. Réessayez dans quelques instants.'
              : '⚠️ Une erreur est survenue. Réessayez.'
          ));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    console.error('API route error:', error);
    return new Response('⚠️ Erreur serveur. Réessayez.', { status: 500 });
  }
}
