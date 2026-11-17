import { fetchSpy } from './helpers/hermetic';
import { inspect } from 'node:util';
import { APICallError } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VALID_BODY, chatRequest, mockModel, runChat, textStep, toolStep } from './helpers/chat';
import { FAKE_SALES, TERRAIN_INPUT } from './helpers/terrain-fixture';
import { handleChat } from '@/lib/chat-handler';
import { ERROR_TEXTS } from '@/lib/chat-errors';
import { log } from '@/lib/log';
import { TERRAIN_MARKER } from '@/lib/terrain';

vi.mock('@/lib/terrain-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/terrain-data')>()),
  fetchTerrainSales: vi.fn(async () => FAKE_SALES),
}));

afterEach(() => vi.restoreAllMocks());

/**
 * Lit la FIN du flux comme app/page.tsx:218-227 : le marqueur, puis un JSON qui
 * doit aller jusqu'au dernier octet. Si quoi que ce soit suivait le JSON,
 * JSON.parse échouerait : c'est la preuve que le marqueur est le dernier élément.
 */
function splitAtMarker(text: string) {
  const idx = text.indexOf(TERRAIN_MARKER);
  expect(idx).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(TERRAIN_MARKER, idx + 1)).toBe(-1); // un seul marqueur
  const tail = text.slice(idx + TERRAIN_MARKER.length);
  const payload = JSON.parse(tail) as { count: number; insee: string; byCategory: unknown[] };
  expect(tail.endsWith('}')).toBe(true);
  return { before: text.slice(0, idx), payload };
}

describe('marqueur terrain — fin du flux', () => {
  it('cas nominal : texte puis marqueur en dernier, JSON intact', async () => {
    const { text } = await runChat(VALID_BODY, [
      toolStep('fetch_terrain_stats_commune', TERRAIN_INPUT),
      textStep('📍 Sète'),
    ]);
    const { before, payload } = splitAtMarker(text);
    expect(before).toBe('📍 Sète\n');
    expect(payload.insee).toBe('34301');
    expect(payload.count).toBe(FAKE_SALES.length);
    expect(payload.byCategory.length).toBeGreaterThan(0);
  });

  it('erreur au 2e pas : texte, puis message fixe, puis marqueur en dernier', async () => {
    const { text, model } = await runChat(VALID_BODY, [
      toolStep('fetch_terrain_stats_commune', TERRAIN_INPUT, 'Recherche…'),
      new APICallError({
        message: 'surcharge', url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {},
        statusCode: 529, isRetryable: false,
      }),
    ]);
    expect(model.doStreamCalls).toHaveLength(2);
    const { before, payload } = splitAtMarker(text);
    expect(before).toBe(`Recherche…\n\n${ERROR_TEXTS.overloaded}\n`);
    expect(payload.insee).toBe('34301');
    expect(text.endsWith('}')).toBe(true);
    expect(text.lastIndexOf(ERROR_TEXTS.overloaded)).toBeLessThan(text.indexOf(TERRAIN_MARKER));
  });

  it('erreur au 2e pas sans texte au 1er pas : message fixe sans saut de ligne initial, marqueur en dernier', async () => {
    const { text } = await runChat(VALID_BODY, [
      toolStep('fetch_terrain_stats_commune', TERRAIN_INPUT),
      new APICallError({ message: 'x', url: 'u', requestBodyValues: {}, statusCode: 400, isRetryable: false }),
    ]);
    const { before } = splitAtMarker(text);
    expect(before).toBe(`${ERROR_TEXTS.unavailable}\n`);
  });

  it('sans outil terrain : aucun marqueur', async () => {
    const { text } = await runChat(VALID_BODY, [textStep('📍 Paris')]);
    expect(text).toBe('📍 Paris');
    expect(text).not.toContain(TERRAIN_MARKER);
  });
});

describe('chaîne sentinelle — rien ne fuit vers la console ni vers le visiteur', () => {
  const SENTINELLE = 'chaine-temoin-fuite';

  function sentinelError() {
    return new APICallError({
      message: `${SENTINELLE} (message)`,
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: { messages: [{ role: 'user', content: `${SENTINELLE} (requestBodyValues)` }] },
      statusCode: 529,
      responseHeaders: { 'x-temoin': SENTINELLE },
      responseBody: `{"type":"error","error":{"message":"${SENTINELLE} (responseBody)"}}`,
      isRetryable: false,
    });
  }

  function spyAllConsole() {
    return (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const)
      .map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  }

  function consoleDump(spies: ReturnType<typeof spyAllConsole>) {
    // inspect, pas JSON.stringify : JSON.stringify(new Error()) vaut "{}" et masquerait une fuite
    return spies.flatMap((s) => s.mock.calls.flat()).map((a) => inspect(a, { depth: 20 })).join('\n');
  }

  async function run(steps: Parameters<typeof mockModel>[0], content: string) {
    const spies = spyAllConsole();
    const body = { messages: [{ id: 'user-1', role: 'user', content }] };
    // Vrai journal de production (lib/log), pas un vi.fn : on teste ce qui sortirait sur Vercel
    const res = await handleChat(chatRequest(body), { model: mockModel(steps), now: () => new Date(), log });
    const text = await res.text();
    return { text, dump: consoleDump(spies), spies };
  }

  it('contrôle négatif : le détecteur voit la fuite que causait le onError par défaut du SDK', () => {
    const spies = spyAllConsole();
    console.error(sentinelError()); // ce que faisait onError par défaut (ai/dist/index.js:6592-6594)
    const dump = consoleDump(spies);
    expect(dump).toContain(`${SENTINELLE} (requestBodyValues)`);
    expect(dump).toContain(`${SENTINELLE} (responseBody)`);
  });

  it('erreur au 1er pas : sentinelle absente de console.* et de la réponse', async () => {
    const { text, dump, spies } = await run([sentinelError()], `${SENTINELLE} adresse visiteur`);
    expect(spies.some((s) => s.mock.calls.length > 0)).toBe(true); // le journal a bien écrit quelque chose
    expect(dump).toContain('"event":"model_error"');
    expect(dump).not.toContain(SENTINELLE);
    expect(text).toBe(ERROR_TEXTS.overloaded);
    expect(text).not.toContain(SENTINELLE);
  });

  it('erreur au 2e pas : sentinelle absente de console.* et de la réponse', async () => {
    const { text, dump } = await run(
      [toolStep('fetch_terrain_stats_commune', TERRAIN_INPUT), sentinelError()],
      `${SENTINELLE} prix des terrains à Sète`,
    );
    expect(dump).toContain('"event":"model_error"');
    expect(dump).not.toContain(SENTINELLE);
    expect(text).not.toContain(SENTINELLE);
    splitAtMarker(text);
  });

  it('succès : le contenu visiteur et la réponse du modèle ne sont pas journalisés', async () => {
    const { text, dump } = await run([textStep(`réponse ${SENTINELLE}-modele`)], `${SENTINELLE}-visiteur`);
    expect(text).toBe(`réponse ${SENTINELLE}-modele`);
    expect(dump).toContain('"event":"chat_finish"');
    expect(dump).not.toContain(SENTINELLE);
  });
});

describe('étanchéité réseau', () => {
  it("aucun test de ce fichier n'a appelé fetch", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
