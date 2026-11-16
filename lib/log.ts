// Journal JSON structuré, une ligne par événement.
//
// Les champs n'acceptent que des valeurs scalaires : passer un objet erreur,
// un tableau de messages ou un corps de réponse est une erreur de COMPILATION.
// Règle : jamais de contenu visiteur (adresse, messages), jamais d'IP, jamais
// de message ni de corps renvoyé par un fournisseur.

import { APICallError, RetryError } from 'ai';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;
export type Logger = (level: LogLevel, event: string, fields?: LogFields) => void;

export const log: Logger = (level, event, fields = {}) => {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

/** Nom de classe de l'erreur, seule information journalisée pour une erreur quelconque. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Champs journalisables d'une erreur du SDK : nom, statut HTTP, caractère
 * réessayable. Un RetryError est déballé (lastError). Jamais `message`
 * (texte du fournisseur), `responseBody`, `requestBodyValues` (contient les
 * messages des visiteurs) ni l'objet erreur lui-même.
 */
export function errorLogFields(error: unknown): LogFields {
  const inner = RetryError.isInstance(error) ? error.lastError : error;
  const api = APICallError.isInstance(inner) ? inner : undefined;
  return {
    name: errorName(error),
    retryReason: RetryError.isInstance(error) ? error.reason : undefined,
    innerName: inner !== error ? errorName(inner) : undefined,
    statusCode: api?.statusCode,
    isRetryable: api?.isRetryable,
  };
}
