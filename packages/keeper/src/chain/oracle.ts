/**
 * Oracle chain reads.
 *
 * Phase 3 verified: SVI params live on oracle objects, NOT in the predict-server REST API.
 * Fetch path: REST /oracles → get oracle_id → getObject(oracle_id, {json: true}) → svi + prices.
 * All SVI params scaled by SVI_SCALE = 1e9. Signs in m and rho stored as {is_negative, magnitude}.
 */

import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SviParams } from '@sonarkk/core';
import { env } from '../env.js';
import { log } from '../logger.js';
import { withRetry } from '../util/retry.js';

const SVI_SCALE = 1_000_000_000;
const PREDICT_SERVER = env.PREDICT_SERVER_URL;

// ── REST types ──────────────────────────────────────────────────────────────

interface OracleMeta {
  oracle_id: string;
  predict_id: string;
  underlying_asset: string;
  expiry: number;
  status: 'active' | 'settled' | 'cancelled';
  settlement_price: number | null;
  settled_at: number | null;
}

// ── REST helpers ────────────────────────────────────────────────────────────

async function fetchOracles(status: 'active' | 'settled', limit = 20): Promise<OracleMeta[]> {
  const url = `${PREDICT_SERVER}/oracles?status=${status}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`predict-server /oracles: HTTP ${res.status}`);
  return res.json() as Promise<OracleMeta[]>;
}

// ── On-chain oracle object read ─────────────────────────────────────────────

export interface OracleState {
  oracle_id: string;
  expiry_ms: number;
  svi: SviParams;
  forward: number;
  spot: number;
  t_years: number;
  settlement_price: number | null;
}

/** Read SVI + prices from the oracle's on-chain object. */
async function readOracleObject(
  client: SuiGrpcClient,
  oracleId: string,
  expiryMs: number,
  settlementPrice: number | null,
): Promise<OracleState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client.core as any).getObject({
    objectId: oracleId,
    include: { json: true },
  });

  const json = result?.object?.json ?? result?.json;
  if (!json || typeof json !== 'object') {
    throw new Error(`getObject(${oracleId}) returned no JSON`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = json as Record<string, any>;
  const s = obj['svi'] as Record<string, unknown> | undefined;
  const p = obj['prices'] as Record<string, unknown> | undefined;

  if (!s) throw new Error(`oracle ${oracleId} has no svi field`);
  if (!p) throw new Error(`oracle ${oracleId} has no prices field`);

  const signedField = (field: unknown): number => {
    const f = field as Record<string, unknown>;
    const neg = f['is_negative'] as boolean;
    const mag = Number(f['magnitude']);
    return (neg ? -1 : 1) * (mag / SVI_SCALE);
  };

  const svi: SviParams = {
    a:     Number(s['a']) / SVI_SCALE,
    b:     Number(s['b']) / SVI_SCALE,
    rho:   signedField(s['rho']),
    m:     signedField(s['m']),
    sigma: Number(s['sigma']) / SVI_SCALE,
  };

  const forward = Number(p['forward']) / SVI_SCALE;
  const spot    = Number(p['spot'])    / SVI_SCALE;

  const nowMs   = Date.now();
  const t_years = Math.max(0, (expiryMs - nowMs) / (365.25 * 24 * 60 * 60 * 1000));

  return { oracle_id: oracleId, expiry_ms: expiryMs, svi, forward, spot, t_years, settlement_price: settlementPrice };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch the single best active oracle for entry guard / hedge calculations.
 *
 * "Best" = soonest future expiry within a reasonable window (< 4 hours).
 * Reads only ONE on-chain oracle object (vs 20-30 in fetchActiveOracleStates),
 * keeping the keeper cycle fast. Returns null when no suitable oracle exists.
 */
export async function fetchBestActiveOracleState(
  client: SuiGrpcClient,
): Promise<OracleState | null> {
  const metas = await withRetry(() => fetchOracles('active', 30), 'fetchActiveOracles');
  const nowMs = Date.now();
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

  // Only consider oracles that are truly in the future and within 4 hours.
  const candidates = metas
    .filter(m => m.expiry > nowMs && m.expiry - nowMs < FOUR_HOURS_MS)
    .sort((a, b) => a.expiry - b.expiry); // soonest first

  if (candidates.length === 0) {
    log.warn({ total_active: metas.length }, 'no suitable active oracle found within 4h window');
    return null;
  }

  // Try oracles in order until one reads successfully.
  for (const meta of candidates) {
    try {
      const state = await withRetry(
        () => readOracleObject(client, meta.oracle_id, meta.expiry, null),
        `readOracleObject(${meta.oracle_id.slice(0, 8)}...)`,
      );
      if (state.t_years > 0) return state;
    } catch (err) {
      log.warn({ oracleId: meta.oracle_id, err }, 'active oracle read failed, trying next');
    }
  }

  return null;
}

/** Fetch recently settled oracles (for triggering the settle-and-reenter cycle). */
export async function fetchRecentlySettledOracles(limit = 5): Promise<OracleMeta[]> {
  return withRetry(() => fetchOracles('settled', limit), 'fetchSettledOracles');
}

/**
 * Fetch a single oracle's state. Used during cycle execution when the oracle
 * is known (from the settled event).
 */
export async function fetchOracleState(
  client: SuiGrpcClient,
  oracleId: string,
  expiryMs: number,
  settlementPrice: number | null,
): Promise<OracleState> {
  return withRetry(
    () => readOracleObject(client, oracleId, expiryMs, settlementPrice),
    `fetchOracleState(${oracleId.slice(0, 8)}...)`,
  );
}
