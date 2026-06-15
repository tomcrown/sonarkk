/**
 * POST /chat — Streaming AI copilot chat endpoint.
 *
 * Request body:
 *   {
 *     messages: [{ role: 'user'|'model', content: string }],
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
 */

import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { assembleContext } from '../services/context-assembler.js';
import { buildSystemPrompt } from '../services/system-prompt.js';
import { streamChat } from '../services/gemini.js';
import type { ChatMessage } from '../services/gemini.js';

export const chatRouter = Router();

const MessageSchema = z.object({
  role: z.enum(['user', 'model']),
  content: z.string().min(1).max(10_000),
});

const ChatRequestSchema = z.object({
  messages:        z.array(MessageSchema).min(1).max(50),
  wallet_address:  z.string().optional(),
  portfolio_id:    z.string().optional(),
});

chatRouter.post('/', async (req, res) => {
  if (!env.GEMINI_API_KEY) {
    res.status(503).json({ error: 'AI copilot not configured — set GEMINI_API_KEY in .env' });
    return;
  }

  // Parse + validate
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { messages, wallet_address, portfolio_id } = parsed.data;

  // The last message must be from the user.
  const lastMessage = messages[messages.length - 1]!;
  if (lastMessage.role !== 'user') {
    res.status(400).json({ error: 'Last message must have role=user' });
    return;
  }

  // Split into history (all but last) + current user message.
  const history: ChatMessage[] = messages.slice(0, -1).map(m => ({
    role: m.role,
    content: m.content,
  }));
  const userMessage = lastMessage.content;

  // Set up SSE headers before any async work.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Assemble live context (oracle + portfolio + leaderboard).
    const ctx = await assembleContext(wallet_address, portfolio_id);
    const systemPrompt = buildSystemPrompt(ctx);

    // Stream from Gemini.
    for await (const chunk of streamChat(systemPrompt, history, userMessage)) {
      sendEvent(chunk);
      if (chunk.done) break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Send error as a final SSE event so the client can handle it gracefully.
    sendEvent({ error: msg, done: true });
  }

  res.end();
});
