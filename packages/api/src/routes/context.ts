/**
 * GET /context — Returns the current assembled context as JSON.
 *
 * Useful for debugging what the AI sees, and for the frontend to display
 * live market state (regime, ATM vol, active portfolios).
 *
 * Query params:
 *   wallet_address  — filter to this wallet's portfolios
 *   portfolio_id    — filter to this specific portfolio
 */

import { Router } from 'express';
import { z } from 'zod';
import { assembleContext } from '../services/context-assembler.js';

export const contextRouter = Router();

const QuerySchema = z.object({
  wallet_address: z.string().optional(),
  portfolio_id:   z.string().optional(),
});

contextRouter.get('/', async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() });
    return;
  }

  const { wallet_address, portfolio_id } = parsed.data;

  try {
    const ctx = await assembleContext(wallet_address, portfolio_id);
    res.json({
      market: ctx.market,
      portfolios: ctx.portfolios.map(p => ({
        ...p,
        // Serialize BigInts for JSON transport.
        nav_per_share_now:    p.nav_per_share_now    != null ? p.nav_per_share_now.toString() : null,
        nav_per_share_before: p.nav_per_share_before != null ? p.nav_per_share_before.toString() : null,
        stop_loss_raw:        p.stop_loss_raw        != null ? p.stop_loss_raw.toString() : null,
      })),
      leaderboard: ctx.leaderboard.map(e => ({
        ...e,
        combined_tvl_raw: e.combined_tvl_raw != null ? e.combined_tvl_raw.toString() : null,
      })),
      assembled_at: new Date(ctx.assembled_at).toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
