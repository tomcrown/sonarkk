/**
 * GET /svi-surface — Live SVI vol surface for all active oracles (Module C).
 *
 * Fetches all active oracle objects from predict-server, computes implied vol
 * at 21 log-moneyness strikes from k=-1.0 to k=+1.0 per oracle, and returns
 * a structured JSON for vol surface visualization.
 *
 * The frontend can use this data to render a 2D smile (vol vs strike) or
 * a 3D surface (vol vs strike vs time-to-expiry).
 *
 * Response schema:
 *   {
 *     oracles: [{
 *       oracle_id: string,
 *       expiry_iso: string,
 *       t_years: number,
 *       atm_vol_pct: number,       // ATM implied vol %
 *       skew_bps: number,          // 25-delta put-call skew in bps
 *       smile: [{ k: number, vol_pct: number, prob_call: number, spread_pct: number }],
 *     }],
 *     generated_at: string,
 *   }
 */

import { Router } from 'express';
import { atmVol, binaryCallProb, computeSpread, sviW } from '@sonarkk/core';
import { env } from '../env.js';

export const sviSurfaceRouter = Router();

// ── Strike grid ────────────────────────────────────────────────────────────────

// 21 points from k=-1.0 to k=+1.0 (log-moneyness, e.g. -0.1 = 10% OTM put)
const STRIKE_GRID_K: number[] = Array.from({ length: 21 }, (_, i) => -1.0 + i * 0.1);

// ── Oracle type ────────────────────────────────────────────────────────────────

interface ActiveOracle {
  oracle_id: string;
  expiry: number;      // ms
  t_years: number;
  svi: {
    a: number; b: number; rho: number; m: number; sigma: number;
  };
}

// ── Fetch active oracles ───────────────────────────────────────────────────────

async function fetchActiveOracles(): Promise<ActiveOracle[]> {
  const resp = await fetch(`${env.PREDICT_SERVER_URL}/oracles/active`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`predict-server /oracles/active returned ${resp.status}`);
  const data = (await resp.json()) as { oracles?: ActiveOracle[] };
  return data.oracles ?? [];
}

// ── Route ──────────────────────────────────────────────────────────────────────

sviSurfaceRouter.get('/', async (_req, res) => {
  try {
    const oracles = await fetchActiveOracles();

    if (oracles.length === 0) {
      res.json({ oracles: [], generated_at: new Date().toISOString(), note: 'No active oracles' });
      return;
    }

    const surface = oracles.map(oracle => {
      const atm = atmVol(oracle.svi, oracle.t_years);

      // Compute smile across the strike grid.
      const smile = STRIKE_GRID_K.map(k => {
        const w = sviW(oracle.svi, k);
        const vol = w > 0 && oracle.t_years > 0 ? Math.sqrt(w / oracle.t_years) : atm;
        const prob_call = binaryCallProb(oracle.svi, k);
        const spread = computeSpread(prob_call, 0.3); // 30% utilization assumption

        return {
          k:            +k.toFixed(2),
          vol_pct:      +(vol * 100).toFixed(2),
          prob_call:    +prob_call.toFixed(4),
          spread_pct:   +(spread * 100).toFixed(3),
        };
      });

      // 25-delta skew: vol at k=-0.3 (rough OTM put proxy) minus vol at k=+0.3 (OTM call proxy).
      const putVol  = smile.find(s => s.k === -0.3)?.vol_pct ?? atm * 100;
      const callVol = smile.find(s => s.k === 0.3)?.vol_pct  ?? atm * 100;
      const skew_bps = Math.round((putVol - callVol) * 100); // convert pct difference to bps

      return {
        oracle_id:   oracle.oracle_id,
        expiry_iso:  new Date(oracle.expiry).toISOString(),
        t_years:     +oracle.t_years.toFixed(6),
        t_minutes:   +((oracle.expiry - Date.now()) / 60_000).toFixed(1),
        atm_vol_pct: +(atm * 100).toFixed(2),
        skew_bps,
        smile,
      };
    });

    // Sort by t_years ascending (nearest expiry first).
    surface.sort((a, b) => a.t_years - b.t_years);

    res.json({
      oracles: surface,
      oracle_count: surface.length,
      generated_at: new Date().toISOString(),
      note: 'Vol computed from live SVI parameters. Spread uses assumed 30% pool utilization. Skew = OTM put vol minus OTM call vol at k=±0.3.',
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
