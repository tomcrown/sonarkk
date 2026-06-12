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

/** Fetch all active oracles and their on-chain SVI state. */
export async function fetchActiveOracleStates(
  client: SuiGrpcClient,
): Promise<OracleState[]> {
  const metas = await withRetry(() => fetchOracles('active', 30), 'fetchActiveOracles');
  const results: OracleState[] = [];

  for (const meta of metas) {
    try {
      const state = await withRetry(
        () => readOracleObject(client, meta.oracle_id, meta.expiry, null), // expiry is already ms
        `readOracleObject(${meta.oracle_id.slice(0, 8)}...)`,
      );
      results.push(state);
    } catch (err) {
      log.warn({ oracleId: meta.oracle_id, err }, 'oracle object read failed, skipping');
    }
  }
  return results;
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
