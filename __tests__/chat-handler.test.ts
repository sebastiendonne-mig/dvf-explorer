import { fetchSpy } from './helpers/hermetic';
import { describe, expect, it } from 'vitest';
import { VALID_BODY, runChat, textStep } from './helpers/chat';

describe('handleChat — socle', () => {
  it('répond 200 avec le texte du faux modèle', async () => {
    const { res, text, model } = await runChat(VALID_BODY, [textStep('📍 10 Rue de la Paix 75002 Paris')]);
    expect(res.status).toBe(200);
    expect(text).toBe('📍 10 Rue de la Paix 75002 Paris');
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("n'appelle jamais fetch et n'a pas de clé Anthropic", async () => {
    await runChat(VALID_BODY, [textStep('ok')]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
