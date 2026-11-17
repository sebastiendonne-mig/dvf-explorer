// Lecture et validation du corps de /api/chat.
//
// 1. Lecture bornée : Content-Length trop grand => 413 sans lire ; sinon lecture
//    du flux en comptant les octets (l'en-tête peut manquer ou mentir) => 413
//    dès que MAX_BODY_BYTES est dépassé. JSON.parse n'arrive qu'après.
// 2. Schéma strict : un seul message, role 'user' uniquement (pas de message
//    system/assistant/tool injecté par le client), content texte borné,
//    clés inconnues refusées (seul `id`, envoyé par le client, est toléré).
// Le texte renvoyé est fixe : jamais d'écho de l'entrée.
import { z } from 'zod';
import { MAX_BODY_BYTES, MAX_CONTENT_CHARS, MAX_MESSAGES } from '@/lib/chat-limits';

export const INVALID_REQUEST_TEXT = '⚠️ Requête invalide.';

export type ChatUserMessage = { role: 'user'; content: string };

export type ChatRequestResult =
  | { ok: true; messages: ChatUserMessage[] }
  | { ok: false; status: 400 | 413; rule: string; field?: string; code?: string };

const messageSchema = z.strictObject({
  id: z.string().max(64).optional(),
  role: z.literal('user'),
  content: z.string().trim().min(1).max(MAX_CONTENT_CHARS),
});

const bodySchema = z.strictObject({
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
});

async function readBoundedText(req: Request): Promise<{ ok: true; text: string } | { ok: false; rule: string }> {
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    return { ok: false, rule: 'body_too_large' };
  }
  if (!req.body) return { ok: true, text: '' };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, rule: 'body_too_large' };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, rule: 'body_encoding' };
  }
}

export async function parseChatRequest(req: Request): Promise<ChatRequestResult> {
  const body = await readBoundedText(req);
  if (!body.ok) {
    return { ok: false, status: body.rule === 'body_too_large' ? 413 : 400, rule: body.rule };
  }

  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    return { ok: false, status: 400, rule: 'json_invalid' };
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    // Le chemin ne contient que des noms de clés du schéma et des indices :
    // jamais de valeur ni de nom de clé fourni par le client.
    const issue = parsed.error.issues[0];
    return { ok: false, status: 400, rule: 'schema', field: issue?.path.join('.') || '(racine)', code: issue?.code };
  }

  return {
    ok: true,
    messages: parsed.data.messages.map(({ role, content }) => ({ role, content })),
  };
}
