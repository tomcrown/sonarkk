/**
 * POST /chat — Streaming AI copilot chat endpoint.
 *
 * Request body:
 *   {
 *     messages: [{ role: 'user'|'assistant', content: string }],
 *     wallet_address?: string,   // user's Sui address for portfolio context
 *     portfolio_id?: string,     // specific portfolio object ID for targeted advice
 *   }
 *
 * Response: Server-Sent Events (text/event-stream)
 *   data: {"text":"...", "done":false}
 *   data: {"text":"", "done":true}
 *
 * The last message in `messages` must be role=user (the current question).
 * Pass the full conversation history so the AI has context for follow-ups.
 *
 * The static system prompt (persona, strategies, config guide, risk disclosures)
 * is cached at Anthropic for 5 minutes via cache_control: { type: "ephemeral" },
 * so turn 2+ of any conversation incurs ~90% fewer input tokens.
 */

import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { assembleContext } from '../services/context-assembler.js';
import { buildStaticSystemPrompt, buildDynamicContext } from '../services/system-prompt.js';
import { streamChat } from '../services/anthropic.js';
import type { ChatMessage } from '../services/anthropic.js';

export const chatRouter = Router();

const MessageSchema = z.object({
  // Accept both 'assistant' (Anthropic native) and 'model' (legacy Gemini) for compat.
  role: z.enum(['user', 'assistant', 'model']),
  content: z.string().min(1).max(10_000),
});

const ChatRequestSchema = z.object({
  messages:        z.array(MessageSchema).min(1).max(50),
  wallet_address:  z.string().optional(),
  portfolio_id:    z.string().optional(),
});

// Static prompt is built once at module load — it never changes.
const STATIC_PROMPT = buildStaticSystemPrompt();

chatRouter.post('/', async (req, res) => {
  if (!env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'AI copilot not configured — set ANTHROPIC_API_KEY in .env' });
    return;
  }

  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { messages, wallet_address, portfolio_id } = parsed.data;

  const lastMessage = messages[messages.length - 1]!;
  if (lastMessage.role !== 'user') {
    res.status(400).json({ error: 'Last message must have role=user' });
    return;
  }

  // Build history — map 'model' (legacy Gemini role) → 'assistant' (Anthropic).
  const history: ChatMessage[] = messages.slice(0, -1).map(m => ({
    role: m.role === 'model' ? 'assistant' : (m.role as 'user' | 'assistant'),
    content: m.content,
  }));
  const userMessage = lastMessage.content;

  // SSE headers before any async work.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Assemble live context (oracle + portfolio + leaderboard) — 30-second server cache.
    const ctx = await assembleContext(wallet_address, portfolio_id);
    const dynamicContext = buildDynamicContext(ctx);

    // Stream from Claude. Static prompt is cached at Anthropic; only dynamic
    // context + new user message are sent uncached on turn 2+.
    for await (const chunk of streamChat(STATIC_PROMPT, dynamicContext, history, userMessage)) {
      sendEvent(chunk);
      if (chunk.done) break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendEvent({ error: msg, done: true });
  }

  res.end();
});
