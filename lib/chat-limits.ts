// Bornes de /api/chat (lot 9A). Toute modification change le coût maximal d'une requête.

/** Taille maximale du corps HTTP, en octets, vérifiée avant JSON.parse. */
export const MAX_BODY_BYTES = 2048;

/** Le client n'envoie qu'un message par recherche (app/page.tsx, body { messages: [userMsg] }). */
export const MAX_MESSAGES = 1;

/**
 * Longueur maximale du `content`, après trim, en unités UTF-16 (String.length).
 * geocode_address borne déjà l'adresse à 200 ; le content peut être une phrase
 * qui contient l'adresse, d'où la marge.
 */
export const MAX_CONTENT_CHARS = 500;

/**
 * Plafond de sortie du modèle, PAR PAS : le SDK le repasse tel quel à chaque
 * appel du modèle. Pire cas par requête = stepCountIs(5) × 3000. Valeur provisoire.
 */
export const MAX_OUTPUT_TOKENS = 3000;
