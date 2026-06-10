import { z } from 'zod';
import { env } from './env.js';

const BASE = env.PREDICT_SERVER_URL;

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`predict-server ${url.pathname}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const StatusSchema = z.object({
  status: z.string(),
  latest_onchain_checkpoint: z.number(),
  current_time_ms: z.number(),
});

export const OracleSchema = z.object({
  predict_id: z.string(),
  oracle_id: z.string(),
  underlying_asset: z.string(),
  expiry: z.number(),
  min_strike: z.number(),
  tick_size: z.number(),
  status: z.enum(['active', 'settled', 'cancelled']),
  activated_at: z.number(),
  settlement_price: z.number().nullable(),
  settled_at: z.number().nullable(),
  created_checkpoint: z.number(),
});

export const OraclePriceSchema = z.object({
  oracle_id: z.string(),
  spot: z.number(),
  forward: z.number(),
  onchain_timestamp: z.number(),
  checkpoint_timestamp_ms: z.number(),
});

export const OracleSviSchema = z.object({
  oracle_id: z.string(),
  a: z.number(),
  b: z.number(),
  rho: z.number(),
  rho_negative: z.boolean(),
  m: z.number(),
  m_negative: z.boolean(),
  sigma: z.number(),
  onchain_timestamp: z.number(),
});

export type Oracle = z.infer<typeof OracleSchema>;
export type OraclePrice = z.infer<typeof OraclePriceSchema>;
export type OracleSvi = z.infer<typeof OracleSviSchema>;

export const predictClient = {
  status: async () => {
    const raw = await get<unknown>('/status');
    return StatusSchema.parse(raw);
  },

  oracles: async (params?: { limit?: number; sort?: 'asc' | 'desc'; status?: string }) => {
    const p: Record<string, string> = {};
    if (params?.limit !== undefined) p['limit'] = String(params.limit);
    if (params?.sort) p['sort'] = params.sort;
    if (params?.status) p['status'] = params.status;
    const raw = await get<unknown[]>('/oracles', p);
    return z.array(OracleSchema).parse(raw);
  },

  oraclePrices: async (oracleId: string, params?: { limit?: number }) => {
    const p: Record<string, string> = {};
    if (params?.limit !== undefined) p['limit'] = String(params.limit);
    const raw = await get<unknown[]>(`/oracles/${oracleId}/prices`, p);
    return z.array(OraclePriceSchema).parse(raw);
  },

  oracleSvi: async (oracleId: string, params?: { limit?: number }) => {
    const p: Record<string, string> = {};
    if (params?.limit !== undefined) p['limit'] = String(params.limit);
    const raw = await get<unknown[]>(`/oracles/${oracleId}/svi`, p);
    return z.array(OracleSviSchema).parse(raw);
  },
};
