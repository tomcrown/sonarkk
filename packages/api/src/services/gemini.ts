/**
 * gemini.ts — Gemini AI client for streaming chat.
 *
 * Uses the @google/generative-ai SDK with streaming GenerateContentStream.
 * Supports multi-turn conversation history.
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import type { Content } from '@google/generative-ai';
import { env } from '../env.js';

// ── Client singleton ───────────────────────────────────────────────────────────

let _genai: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  if (!_genai) _genai = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return _genai;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface StreamChunk {
  text: string;
  done: boolean;
}

// ── Safety settings ────────────────────────────────────────────────────────────

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,      threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

// ── Generation config ──────────────────────────────────────────────────────────

const GENERATION_CONFIG = {
  temperature: 0.7,     // balanced: creative enough to be helpful, grounded enough to be accurate
  topP: 0.9,
  topK: 40,
  maxOutputTokens: 2048,
};

// ── Streaming chat ─────────────────────────────────────────────────────────────

/**
 * Stream a chat response from Gemini.
 * Yields text chunks as they arrive.
 *
 * @param systemPrompt  Full system prompt including live context.
 * @param history       Prior conversation turns (user + model alternating).
 * @param userMessage   The latest user message.
 */
export async function* streamChat(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
): AsyncGenerator<StreamChunk> {
  const genai = getGenAI();
  const model = genai.getGenerativeModel({
    model: env.GEMINI_MODEL,
    systemInstruction: systemPrompt,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: GENERATION_CONFIG,
  });

  // Convert our ChatMessage format to Gemini's Content format.
  const contents: Content[] = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.content }],
  }));

  // Add the current user message.
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  const result = await model.generateContentStream({ contents });

  let buffer = '';
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      buffer += text;
      yield { text, done: false };
    }
  }

  yield { text: '', done: true };
}

/**
 * Non-streaming chat — returns the full response at once.
 * Used for programmatic calls (e.g., E2E test).
 */
export async function chat(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of streamChat(systemPrompt, history, userMessage)) {
    if (!chunk.done) chunks.push(chunk.text);
  }
  return chunks.join('');
}
