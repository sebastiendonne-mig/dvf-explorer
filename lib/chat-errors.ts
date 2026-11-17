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

/**
 * Erreur en milieu de flux : le fournisseur Anthropic émet un objet brut
 * { type, message } et non une APICallError
 * (node_modules/@ai-sdk/anthropic/dist/index.js:5043-5044, schéma :771-776).
 * Table FERMÉE type → code HTTP équivalent, pour réutiliser le classement
 * par statusCode. Tout type absent de la table reste « générique ».
 */
export const PROVIDER_ERROR_STATUS = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
} as const;

export type ProviderErrorType = keyof typeof PROVIDER_ERROR_STATUS;

/**
 * `type` d'un objet d'erreur brut, s'il figure dans la table fermée ; sinon
 * undefined. Object.hasOwn et non `in` : un type « toString » ou « __proto__ »
 * ne doit pas passer par le prototype.
 */
export function providerErrorType(error: unknown): ProviderErrorType | undefined {
  if (typeof error !== 'object' || error === null || error instanceof Error) return undefined;
  const type = (error as { type?: unknown }).type;
  return typeof type === 'string' && Object.hasOwn(PROVIDER_ERROR_STATUS, type)
    ? (type as ProviderErrorType)
    : undefined;
}

function isTimeoutLike(error: unknown): boolean {
  // AbortSignal.timeout() rejette avec un DOMException nommé TimeoutError
  const name = typeof error === 'object' && error !== null && 'name' in error ? (error as { name: unknown }).name : undefined;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** Seule politique de messages : par code HTTP (réel ou équivalent). */
function classifyStatus(status: number | undefined): ErrorKind {
  if (status === undefined) return 'generic';
  if (status === 429 || status === 529 || status >= 500) return 'overloaded';
  return 'unavailable';
}

export function classifyError(error: unknown): ErrorKind {
  if (RetryError.isInstance(error)) {
    return error.reason === 'abort' ? 'timeout' : classifyError(error.lastError);
  }
  if (isTimeoutLike(error)) return 'timeout';
  if (APICallError.isInstance(error)) return classifyStatus(error.statusCode);
  const type = providerErrorType(error);
  if (type !== undefined) return classifyStatus(PROVIDER_ERROR_STATUS[type]);
  return 'generic';
}

export function errorText(error: unknown): string {
  return ERROR_TEXTS[classifyError(error)];
}
