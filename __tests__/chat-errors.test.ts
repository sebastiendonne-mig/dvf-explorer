import './helpers/hermetic';
import { APICallError, RetryError } from 'ai';
import { describe, expect, it } from 'vitest';
import { VALID_BODY, runChat } from './helpers/chat';
import { ERROR_TEXTS, classifyError, errorText } from '@/lib/chat-errors';

function apiError(statusCode: number | undefined, isRetryable = false) {
  return new APICallError({
    message: 'texte fournisseur',
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

describe('classifyError — table statusCode → message', () => {
  it.each([
    [400, 'unavailable'],
    [401, 'unavailable'],
    [403, 'unavailable'],
    [429, 'overloaded'],
    [500, 'overloaded'],
    [503, 'overloaded'],
    [529, 'overloaded'],
    [undefined, 'generic'],
  ] as const)('statusCode %s → %s', (status, kind) => {
    expect(classifyError(apiError(status))).toBe(kind);
    expect(errorText(apiError(status))).toBe(ERROR_TEXTS[kind]);
  });

  it('RetryError enveloppant une 429 → surchargé (lastError)', () => {
    const e = new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [apiError(500, true), apiError(429, true)] });
    expect(classifyError(e)).toBe('overloaded');
  });

  it('RetryError enveloppant une 401 → indisponible', () => {
    const e = new RetryError({ message: 'x', reason: 'errorNotRetryable', errors: [apiError(401)] });
    expect(classifyError(e)).toBe('unavailable');
  });

  it("RetryError d'abandon → trop long", () => {
    const e = new RetryError({ message: 'x', reason: 'abort', errors: [apiError(500, true)] });
    expect(classifyError(e)).toBe('timeout');
  });

  it('timeout de AbortSignal.timeout (DOMException TimeoutError) → trop long', () => {
    expect(classifyError(new DOMException('délai', 'TimeoutError'))).toBe('timeout');
    expect(classifyError(new DOMException('abandon', 'AbortError'))).toBe('timeout');
  });

  it('erreur quelconque → générique', () => {
    expect(classifyError(new Error('overload 529 rate'))).toBe('generic'); // le texte n'est plus lu
    expect(classifyError('chaîne')).toBe('generic');
    expect(classifyError(undefined)).toBe('generic');
  });

  it('les textes visiteur sont ceux déjà en place', () => {
    expect(ERROR_TEXTS).toEqual({
      timeout: '⚠️ La réponse a pris trop de temps. Réessayez dans quelques instants.',
      overloaded: '⚠️ Service temporairement surchargé. Réessayez dans quelques instants.',
      unavailable: '⚠️ Service temporairement indisponible. Réessayez dans quelques instants.',
      generic: '⚠️ Une erreur est survenue. Réessayez.',
    });
  });
});

describe('handleChat — message renvoyé au visiteur', () => {
  it('flux terminé sans texte alors qu\'une erreur a été vue → message fixe, rien d\'autre', async () => {
    const { res, text } = await runChat(VALID_BODY, [apiError(400)]);
    expect(res.status).toBe(200);
    expect(text).toBe(ERROR_TEXTS.unavailable);
  });

  it('529 non réessayable → surchargé', async () => {
    const { text } = await runChat(VALID_BODY, [apiError(529)]);
    expect(text).toBe(ERROR_TEXTS.overloaded);
  });

  it('429 réessayable : le SDK réessaie une fois puis lève un RetryError → surchargé', async () => {
    const { text, model, deps } = await runChat(VALID_BODY, [apiError(429, true), apiError(429, true)]);
    expect(model.doStreamCalls).toHaveLength(2); // maxRetries: 1
    expect(text).toBe(ERROR_TEXTS.overloaded);
    expect(deps.log).toHaveBeenCalledWith('error', 'model_error', expect.objectContaining({
      name: 'AI_RetryError', innerName: 'AI_APICallError', statusCode: 429,
    }));
  }, 15_000);
});
