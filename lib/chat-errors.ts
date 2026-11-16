// Classification des erreurs de /api/chat, par type et code HTTP.
//
// On ne classe JAMAIS sur le texte du message : il vient du fournisseur et
// peut changer. Le visiteur ne reçoit que l'un des textes fixes ci-dessous
// (repris de l'existant : ancien catch de la route et app/page.tsx).
import { APICallError, RetryError } from 'ai';

export const ERROR_TEXTS = {
  timeout: '⚠️ La réponse a pris trop de temps. Réessayez dans quelques instants.',
  overloaded: '⚠️ Service temporairement surchargé. Réessayez dans quelques instants.',
  unavailable: '⚠️ Service temporairement indisponible. Réessayez dans quelques instants.',
  generic: '⚠️ Une erreur est survenue. Réessayez.',
} as const;

export type ErrorKind = keyof typeof ERROR_TEXTS;

function isTimeoutLike(error: unknown): boolean {
  // AbortSignal.timeout() rejette avec un DOMException nommé TimeoutError
  const name = typeof error === 'object' && error !== null && 'name' in error ? (error as { name: unknown }).name : undefined;
  return name === 'TimeoutError' || name === 'AbortError';
}

export function classifyError(error: unknown): ErrorKind {
  if (RetryError.isInstance(error)) {
    return error.reason === 'abort' ? 'timeout' : classifyError(error.lastError);
  }
  if (isTimeoutLike(error)) return 'timeout';
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === undefined) return 'generic';
    if (status === 429 || status === 529 || status >= 500) return 'overloaded';
    return 'unavailable';
  }
  return 'generic';
}

export function errorText(error: unknown): string {
  return ERROR_TEXTS[classifyError(error)];
}
