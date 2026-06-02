import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import {
  sanitizeAddress,
  extractDepartmentFromInsee,
  isDepartmentExcluded
} from '@/lib/sanitize';

export const maxDuration = 60;

const systemPrompt = `Tu es un agent DVF. RÈGLE ABSOLUE : n'écris AUCUN texte avant d'avoir exécuté les deux outils — appelle-les directement.

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
INTERDIT : introduction, conclusion, commentaire, tout texte hors format.`;

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
