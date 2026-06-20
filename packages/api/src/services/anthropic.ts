/**
 * anthropic.ts — Claude AI client for streaming chat with prompt caching.
 *
 * Caching strategy:
 *   - Static system prompt (persona + strategies + config guide + risk disclosures)
 *     is sent with cache_control: { type: "ephemeral" }. Anthropic caches it for
 *     5 minutes. Turn 2+ of any conversation costs ~90% fewer input tokens.
 *   - Dynamic context (live market state + portfolio + leaderboard) is a second
 *     system block WITHOUT cache_control — it changes every request.
 *
 * Minimum cacheable block: 1 024 tokens (Sonnet). The static prompt is ~2 500 tokens.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.js';

// ── Client singleton ───────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamChunk {
  text: string;
  done: boolean;
}

// ── Streaming chat ─────────────────────────────────────────────────────────────

/**
 * Stream a chat response from Claude.
 *
 * @param staticPrompt   The large static system prompt — passed with cache_control.
 * @param dynamicContext The small live-context block — not cached, changes each call.
 * @param history        Prior conversation turns (user + assistant alternating).
 * @param userMessage    The latest user message.
 */
export async function* streamChat(
  staticPrompt: string,
  dynamicContext: string,
  history: ChatMessage[],
  userMessage: string,
): AsyncGenerator<StreamChunk> {
  const client = getClient();

  // Two-block system array: static (cached) + dynamic (uncached).
  // Anthropic caches everything up to and including the block with cache_control.
  const system: Anthropic.Messages.TextBlockParam[] = [
    {
      type: 'text',
      text: staticPrompt,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: dynamicContext,
    },
  ];

  // Build message array: history + current user turn.
  const messages: Anthropic.Messages.MessageParam[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const stream = client.messages.stream({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2048,
    temperature: 0.7,
    system,
    messages,
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield { text: event.delta.text, done: false };
    }
  }

  yield { text: '', done: true };
}

/**
 * Non-streaming variant — returns the full response at once.
 */
export async function chat(
  staticPrompt: string,
  dynamicContext: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of streamChat(staticPrompt, dynamicContext, history, userMessage)) {
    if (!chunk.done) chunks.push(chunk.text);
  }
  return chunks.join('');
}
