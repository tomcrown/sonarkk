/**
 * GET /svi-surface — Live SVI vol surface for active (future) oracles.
 *
 * Fetches active oracle objects from predict-server via the correct
 * /oracles?status=active endpoint, filters to oracles expiring in the
 * future, fetches SVI params for each, and returns a vol surface in the
 * shape expected by the frontend SviSurfaceResponse type.
 *
 * Response schema:
 *   {
 *     surface: [{
 *       expiryMs:  string,          // oracle expiry as ms string
 *       atmVol:    number,          // ATM implied vol (fraction, e.g. 0.40)
 *       strikes:   [{
 *         k:      number,           // log-moneyness
 *         prob:   number,           // binary call probability at k
 *         spread: number,           // estimated spread (fraction)
 *         w:      number,           // total variance w(k)
 *       }],
 *     }],
 *     timestamp: string,
 *   }
 */

import { Router } from 'express';
import {
  atmVol as computeAtmVol,
  binaryCallProb,
  computeSpread,
  sviW,
  predictClient,
} from '@sonarkk/core';

export const sviSurfaceRouter = Router();

// 9 strike points from k=-0.4 to k=+0.4 (log-moneyness).
// At k=±1.0 probabilities are trivially 100%/0%; the ±0.4 range covers
// strikes from ~0.67× to ~1.49× spot where the smile shows real variation.
const STRIKE_GRID_K: number[] = Array.from({ length: 9 }, (_, i) =>
  parseFloat((-0.4 + i * 0.1).toFixed(1))
);

const SVI_SCALE = 1e9;
const MAX_SURFACE_ORACLES = 10; // fetch SVI for at most the 10 nearest expiries
const UTIL_ASSUMPTION = 0.3;    // 30% pool utilization for spread estimate

sviSurfaceRouter.get('/', async (_req, res) => {
  try {
    const allActive = await predictClient.oracles({ status: 'active' });

    const now = Date.now();
    const futureOracles = allActive
      .filter(o => o.expiry > now)
      .sort((a, b) => a.expiry - b.expiry)
      .slice(0, MAX_SURFACE_ORACLES);

    if (futureOracles.length === 0) {
      res.json({ surface: [], timestamp: new Date().toISOString(), note: 'No active future oracles' });
      return;
    }

    // Fetch SVI params for all selected oracles in parallel.
    const sviResults = await Promise.allSettled(
      futureOracles.map(o => predictClient.oracleSvi(o.oracle_id, { limit: 1 }))
    );

    const surface: Array<{
      expiryMs: string;
      tYears: number;
      atmVol: number;
      strikes: Array<{ k: number; vol: number; prob: number; spread: number; w: number }>;
    }> = [];

    for (let i = 0; i < futureOracles.length; i++) {
      const oracle = futureOracles[i]!;
      const sviResult = sviResults[i];
      if (!sviResult || sviResult.status !== 'fulfilled') continue;
      const rawSvi = sviResult.value[0];
      if (!rawSvi) continue;

      const svi = {
        a:     rawSvi.a     / SVI_SCALE,
        b:     rawSvi.b     / SVI_SCALE,
        rho:   (rawSvi.rho_negative ? -1 : 1) * (rawSvi.rho   / SVI_SCALE),
        m:     (rawSvi.m_negative   ? -1 : 1) * (rawSvi.m     / SVI_SCALE),
        sigma: rawSvi.sigma / SVI_SCALE,
      };

      const tYears = (oracle.expiry - now) / (365.25 * 24 * 3_600_000);
      const atm = computeAtmVol(svi, tYears);

      // Skip degenerate calibrations (atm vol = 0, NaN, Infinity, or > 300%)
      if (!isFinite(atm) || atm <= 0 || atm > 3.0) continue;

      const strikes = STRIKE_GRID_K.map(k => {
        const w = sviW(svi, k);
        const vol = w > 0 && tYears > 0 ? Math.sqrt(w / tYears) : 0;
        const prob = binaryCallProb(svi, k);
        const spread = computeSpread(prob, UTIL_ASSUMPTION);
        return { k, vol, prob, spread, w };
      });

      surface.push({
        expiryMs: String(oracle.expiry),
        tYears,
        atmVol:   atm,
        strikes,
      });
    }

    res.json({ surface, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
