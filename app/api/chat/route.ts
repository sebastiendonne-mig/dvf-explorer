import { anthropic } from '@ai-sdk/anthropic';
import { handleChat } from '@/lib/chat-handler';
import { log } from '@/lib/log';

export const maxDuration = 60;

// Injection de production uniquement : toute la logique est dans
// lib/chat-handler.ts, testée avec un faux modèle.
export async function POST(req: Request) {
  return handleChat(req, {
    model: anthropic('claude-sonnet-4-6'),
    now: () => new Date(),
    log,
  });
}
