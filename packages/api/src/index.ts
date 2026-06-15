/**
 * Sonark API Server — Phase 7 Module B
 *
 * Endpoints:
 *   POST /chat            — Streaming AI copilot (Gemini, SSE)
 *   GET  /context         — Live market + portfolio context (JSON)
 *   GET  /leaderboard     — Vault leaderboard (JSON)
 *   GET  /portfolios      — List portfolios for a wallet (JSON)
 *   GET  /portfolios/:id  — Single portfolio + cycle history (JSON)
 *   PATCH /portfolios/:id — Update bot config live (JSON)
 *   POST /backtest        — Run parameterized backtest (JSON) [Module C]
 *   GET  /svi-surface     — Live SVI vol surface for all active oracles [Module C]
 *
 * All endpoints are stateless (per-request DB reads).
 * /chat uses Server-Sent Events for streaming — no WebSocket needed.
 */

import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import { chatRouter }        from './routes/chat.js';
import { contextRouter }     from './routes/context.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { portfolioRouter }   from './routes/portfolio.js';

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({ origin: env.API_CORS_ORIGIN }));
app.use(express.json({ limit: '512kb' }));

// Request logger (lightweight, no pino-http dep)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/chat',        chatRouter);
app.use('/context',     contextRouter);
app.use('/leaderboard', leaderboardRouter);
app.use('/portfolios',  portfolioRouter);

// Backtest + SVI surface routes are registered by Module C (imported at runtime).
// They live in ./routes/backtest.ts and ./routes/svi-surface.ts
try {
  const { backtestRouter }   = await import('./routes/backtest.js');
  const { sviSurfaceRouter } = await import('./routes/svi-surface.js');
  app.use('/backtest',    backtestRouter);
  app.use('/svi-surface', sviSurfaceRouter);
  console.log('[api] Module C routes registered: /backtest, /svi-surface');
} catch {
  console.warn('[api] Module C routes not available yet (./routes/backtest.ts not found)');
}

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'sonark-api', ts: new Date().toISOString() });
});

// ── 404 fallback ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(env.API_PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  Sonark API  →  http://localhost:${env.API_PORT}  ║`);
  console.log(`╠══════════════════════════════════════╣`);
  console.log(`║  POST /chat             (SSE stream)  ║`);
  console.log(`║  GET  /context                        ║`);
  console.log(`║  GET  /leaderboard                    ║`);
  console.log(`║  GET  /portfolios?wallet=0x...        ║`);
  console.log(`║  PATCH /portfolios/:id  (live config) ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});

export default app;
