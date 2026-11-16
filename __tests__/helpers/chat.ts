// Aides de test : requêtes, lecture du flux, faux modèle.
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { vi } from 'vitest';
import { handleChat, type ChatDeps } from '@/lib/chat-handler';
import type { Logger } from '@/lib/log';

type StreamResult = Awaited<ReturnType<MockLanguageModelV3['doStream']>>;
export type StreamPart = StreamResult['stream'] extends ReadableStream<infer P> ? P : never;

export const VALID_BODY = { messages: [{ id: 'user-1', role: 'user', content: '10 Rue de la Paix, Paris' }] };

export function chatRequest(body: unknown, init: { raw?: boolean; headers?: Record<string, string> } = {}): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    body: init.raw ? (body as string) : JSON.stringify(body),
  });
}

export async function readAll(res: Response): Promise<string> {
  return res.text();
}

function usage(output = 5) {
  return {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

export function finishPart(reason: 'stop' | 'length' | 'tool-calls' = 'stop'): StreamPart {
  return { type: 'finish', finishReason: { unified: reason, raw: undefined }, usage: usage() };
}

/** Un pas qui écrit `text` puis s'arrête. */
export function textStep(text: string, reason: 'stop' | 'length' = 'stop'): StreamResult {
  return {
    stream: simulateReadableStream<StreamPart>({
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: text },
        { type: 'text-end', id: 't1' },
        finishPart(reason),
      ],
    }),
  };
}

/** Un pas qui appelle un outil (le SDK l'exécute puis passe au pas suivant). */
export function toolStep(toolName: string, input: unknown, text = ''): StreamResult {
  const chunks: StreamPart[] = [{ type: 'stream-start', warnings: [] }];
  if (text) {
    chunks.push({ type: 'text-start', id: 't0' }, { type: 'text-delta', id: 't0', delta: text }, { type: 'text-end', id: 't0' });
  }
  chunks.push(
    { type: 'tool-call', toolCallId: 'call-1', toolName, input: JSON.stringify(input) },
    finishPart('tool-calls'),
  );
  return { stream: simulateReadableStream<StreamPart>({ chunks }) };
}

/** Faux modèle : chaque appel consomme l'élément suivant de `steps` (résultat ou erreur levée). */
export function mockModel(steps: Array<StreamResult | Error>): MockLanguageModelV3 {
  // MockLanguageModelV3 enregistre lui-même chaque appel dans doStreamCalls.
  let i = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      const step = steps[i++];
      if (step === undefined) throw new Error('faux modèle : pas imprévu');
      if (step instanceof Error) throw step;
      return step;
    },
  });
}

export function makeDeps(model: MockLanguageModelV3): ChatDeps & { log: Logger & ReturnType<typeof vi.fn> } {
  return { model, now: () => new Date('2026-11-16T12:00:00Z'), log: vi.fn() as Logger & ReturnType<typeof vi.fn> };
}

export async function runChat(body: unknown, steps: Array<StreamResult | Error>, init?: Parameters<typeof chatRequest>[1]) {
  const model = mockModel(steps);
  const deps = makeDeps(model);
  const res = await handleChat(chatRequest(body, init), deps);
  const text = await readAll(res);
  return { res, text, model, deps };
}
