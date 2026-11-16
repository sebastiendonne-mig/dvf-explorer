// Journal JSON structuré, une ligne par événement.
//
// Les champs n'acceptent que des valeurs scalaires : passer un objet erreur,
// un tableau de messages ou un corps de réponse est une erreur de COMPILATION.
// Règle : jamais de contenu visiteur (adresse, messages), jamais d'IP, jamais
// de message ni de corps renvoyé par un fournisseur.

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
