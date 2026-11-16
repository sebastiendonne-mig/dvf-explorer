// Verrou hermétique, importé en tête de chaque __tests__/chat-*.test.ts.
//
// - Supprime ANTHROPIC_API_KEY : aucun test ne doit pouvoir joindre Anthropic,
//   même par erreur (la clé locale est d'origine inconnue).
// - Remplace fetch par un stub qui échoue : tout appel réseau fait échouer le test,
//   et afterEach vérifie qu'il n'y en a eu aucun.
import { afterEach, beforeEach, expect, vi } from 'vitest';

delete process.env.ANTHROPIC_API_KEY;

export const fetchSpy = vi.fn(async (..._args: unknown[]): Promise<Response> => {
  throw new Error('fetch interdit dans les tests hermétiques');
});

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
