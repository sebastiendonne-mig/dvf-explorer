import { fetchSpy } from './helpers/hermetic';
import { inspect } from 'node:util';
import { APICallError, simulateReadableStream } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatRequest, mockModel, toolStep, type StreamPart } from './helpers/chat';
import { FAKE_SALES, TERRAIN_INPUT } from './helpers/terrain-fixture';
import { handleChat } from '@/lib/chat-handler';
import { ERROR_TEXTS } from '@/lib/chat-errors';
import { log } from '@/lib/log';
import { TERRAIN_MARKER } from '@/lib/terrain';

// Erreur EN MILIEU de flux : le modèle a déjà émis du texte, puis le flux du
// fournisseur contient une partie { type: 'error' }. Contrairement aux autres
// tests, doStream ne lève rien : l'erreur arrive DANS le flux.

vi.mock('@/lib/terrain-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/terrain-data')>()),
  fetchTerrainSales: vi.fn(async () => FAKE_SALES),
}));

afterEach(() => vi.restoreAllMocks());

const SENTINELLE = 'chaine-temoin-milieu';
const TEXTE = '📍 Sète\n*Résultats';

function sentinelApiError() {
  return new APICallError({
    message: `${SENTINELLE} (message)`,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: { messages: [{ role: 'user', content: `${SENTINELLE} (requestBodyValues)` }] },
    statusCode: 529,
    responseBody: `{"type":"error","error":{"message":"${SENTINELLE} (responseBody)"}}`,
    isRetryable: false,
  });
}

/** Un pas qui émet du texte puis une partie error, sans partie finish (le flux s'arrête là). */
function midStreamErrorStep(error: unknown) {
  return {
    stream: simulateReadableStream<StreamPart>({
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: TEXTE },
        { type: 'error', error },
      ],
    }),
  };
}

function spyAllConsole() {
  return (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const)
    .map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
}

async function run(steps: Parameters<typeof mockModel>[0]) {
  const spies = spyAllConsole();
  const body = { messages: [{ id: 'user-1', role: 'user', content: `${SENTINELLE} prix des terrains à Sète` }] };
  const res = await handleChat(chatRequest(body), { model: mockModel(steps), now: () => new Date(), log });
  const text = await res.text();
  const dump = spies.flatMap((s) => s.mock.calls.flat()).map((a) => inspect(a, { depth: 20 })).join('\n');
  return { res, text, dump };
}

describe('erreur en milieu de flux (partie error après du texte)', () => {
  it('APICallError dans la partie error : message fixe après le texte, sentinelle absente', async () => {
    const { res, text, dump } = await run([midStreamErrorStep(sentinelApiError())]);
    expect(res.status).toBe(200);
    // (1) pas de fin silencieuse : le texte déjà parti, puis le message fixe
    expect(text).toBe(`${TEXTE}\n\n${ERROR_TEXTS.overloaded}`);
    // (3) aucune fuite
    expect(dump).toContain('"event":"model_error"');
    expect(dump).not.toContain(SENTINELLE);
    expect(text).not.toContain(SENTINELLE);
  });

  it('après un pas terrain : texte, message fixe, puis marqueur en dernier', async () => {
    const { text, dump } = await run([
      toolStep('fetch_terrain_stats_commune', TERRAIN_INPUT),
      midStreamErrorStep(sentinelApiError()),
    ]);
    const idx = text.indexOf(TERRAIN_MARKER);
    expect(idx).toBeGreaterThan(0);
    // (1) le message d'erreur est bien envoyé, AVANT le marqueur
    expect(text.slice(0, idx)).toBe(`${TEXTE}\n\n${ERROR_TEXTS.overloaded}\n`);
    // (2) le marqueur est le dernier élément : le JSON va jusqu'au dernier octet
    const payload = JSON.parse(text.slice(idx + TERRAIN_MARKER.length)) as { insee: string };
    expect(payload.insee).toBe('34301');
    expect(text.indexOf(TERRAIN_MARKER, idx + 1)).toBe(-1);
    // (3) aucune fuite
    expect(dump).not.toContain(SENTINELLE);
    expect(text).not.toContain(SENTINELLE);
  });

  // Forme RÉELLE d'une erreur en milieu de flux chez Anthropic : le fournisseur
  // émet { type: 'error', error: value.error }, soit un objet brut
  // { type: 'overloaded_error', message } et non une APICallError
  // (node_modules/@ai-sdk/anthropic/dist/index.js:5043-5044, schéma :771-776).
  it('objet d\'erreur brut façon Anthropic : pas de fin silencieuse, sentinelle absente', async () => {
    const { text, dump } = await run([
      midStreamErrorStep({ type: 'overloaded_error', message: `${SENTINELLE} (message brut)` }),
    ]);
    expect(text.startsWith(`${TEXTE}\n\n⚠️ `)).toBe(true);
    expect(dump).not.toContain(SENTINELLE);
    expect(text).not.toContain(SENTINELLE);
  });

  /** Ligne model_error du vrai journal, relue depuis la console espionnée. */
  function modelErrorLine(dump: string): Record<string, unknown> {
    const line = dump.split('\n').find((l) => l.includes('"event":"model_error"'));
    expect(line).toBeDefined();
    // inspect entoure la chaîne de quotes simples : on les retire avant JSON.parse
    return JSON.parse(line!.replace(/^'|'$/g, '')) as Record<string, unknown>;
  }

  it('overloaded_error brut : message « surchargé », type journalisé, sentinelle absente', async () => {
    const { text, dump } = await run([
      midStreamErrorStep({ type: 'overloaded_error', message: `${SENTINELLE} Overloaded` }),
    ]);
    expect(text).toBe(`${TEXTE}\n\n${ERROR_TEXTS.overloaded}`);
    expect(modelErrorLine(dump)).toMatchObject({ name: 'object', providerType: 'overloaded_error' });
    expect(dump).not.toContain(SENTINELLE);
    expect(text).not.toContain(SENTINELLE);
  });

  it('rate_limit_error brut : message « surchargé », type journalisé, sentinelle absente', async () => {
    const { text, dump } = await run([
      midStreamErrorStep({ type: 'rate_limit_error', message: `${SENTINELLE} Rate limited` }),
    ]);
    expect(text).toBe(`${TEXTE}\n\n${ERROR_TEXTS.overloaded}`);
    expect(modelErrorLine(dump)).toMatchObject({ providerType: 'rate_limit_error' });
    expect(dump).not.toContain(SENTINELLE);
    expect(text).not.toContain(SENTINELLE);
  });

  it('type inconnu : générique, journal "unknown", la chaîne inconnue absente des journaux', async () => {
    const TYPE_INCONNU = 'type-inconnu-temoin';
    const { text, dump } = await run([
      midStreamErrorStep({ type: TYPE_INCONNU, message: `${SENTINELLE} ?` }),
    ]);
    expect(text).toBe(`${TEXTE}\n\n${ERROR_TEXTS.generic}`);
    expect(modelErrorLine(dump)).toMatchObject({ providerType: 'unknown' });
    expect(dump).not.toContain(TYPE_INCONNU);
    expect(dump).not.toContain(SENTINELLE);
    expect(text).not.toContain(TYPE_INCONNU);
    expect(text).not.toContain(SENTINELLE);
  });

  it('chaîne simple comme erreur : aucune exception, générique, chaîne absente des journaux', async () => {
    const { res, text, dump } = await run([midStreamErrorStep(`${SENTINELLE} erreur en chaîne`)]);
    expect(res.status).toBe(200);
    expect(text).toBe(`${TEXTE}\n\n${ERROR_TEXTS.generic}`);
    expect(modelErrorLine(dump)).toMatchObject({ name: 'string', providerType: 'unknown' });
    expect(dump).not.toContain(SENTINELLE);
    expect(text).not.toContain(SENTINELLE);
  });

  it('null comme erreur : aucune exception, générique', async () => {
    const { res, text, dump } = await run([midStreamErrorStep(null)]);
    expect(res.status).toBe(200);
    expect(text).toBe(`${TEXTE}\n\n${ERROR_TEXTS.generic}`);
    expect(modelErrorLine(dump)).toMatchObject({ providerType: 'unknown' });
    expect(dump).not.toContain(SENTINELLE);
  });

  it("aucun appel réseau", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
