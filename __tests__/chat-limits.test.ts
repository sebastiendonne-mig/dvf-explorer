import './helpers/hermetic';
import { describe, expect, it, vi } from 'vitest';
import { VALID_BODY, runChat, textStep, toolStep } from './helpers/chat';
import { FAKE_SALES, TERRAIN_INPUT } from './helpers/terrain-fixture';
import { MAX_OUTPUT_TOKENS } from '@/lib/chat-limits';

// L'outil terrain ne doit pas toucher le réseau : on remplace fetchTerrainSales
// et on garde le reste du module (clampYears, median…) tel quel.
vi.mock('@/lib/terrain-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/terrain-data')>()),
  fetchTerrainSales: vi.fn(async () => FAKE_SALES),
}));

describe('maxOutputTokens', () => {
  it('vaut 3000', () => {
    expect(MAX_OUTPUT_TOKENS).toBe(3000);
  });

  it('est transmis au modèle à CHAQUE pas', async () => {
    const { res, model } = await runChat(VALID_BODY, [
      toolStep('fetch_terrain_stats_commune', TERRAIN_INPUT),
      textStep('📍 Sète'),
    ]);
    expect(res.status).toBe(200);
    expect(model.doStreamCalls).toHaveLength(2);
    for (const call of model.doStreamCalls) {
      expect(call.maxOutputTokens).toBe(3000);
    }
  });
});

describe('journal chat_finish', () => {
  it('journalise finishReason, nombre de pas et volumes, sans contenu', async () => {
    const CONTENU = 'texte-temoin-reponse';
    const { deps } = await runChat(VALID_BODY, [textStep(CONTENU)]);
    expect(deps.log).toHaveBeenCalledWith('info', 'chat_finish', {
      finishReason: 'stop', steps: 1, inputTokens: 10, outputTokens: 5,
    });
    const logged = JSON.stringify(deps.log.mock.calls);
    expect(logged).not.toContain(CONTENU);
    expect(logged).not.toContain('Rue de la Paix');
  });

  it("niveau warn quand la réponse est coupée (finishReason 'length')", async () => {
    const { deps } = await runChat(VALID_BODY, [textStep('réponse coupée', 'length')]);
    expect(deps.log).toHaveBeenCalledWith('warn', 'chat_finish', expect.objectContaining({ finishReason: 'length' }));
  });
});
