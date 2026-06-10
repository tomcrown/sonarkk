/**
 * Fetches all settled BTC oracles from predict-server, enriches each with its
 * most-recent SVI snapshot, reconstructs forward prices from adjacent settlement
 * prices, and returns a sorted array of OracleRecord.
 *
 * All results are cached to .cache/ — subsequent runs are instant.
 *
 * Quant assumption: forward ≈ previous oracle's settlement price (valid for
 * ~15-min intervals at 60-80% annual BTC vol; error < 0.3%).
 */
import { readCache, writeCache } from './cache.js';
import { RawSviSchema, type OracleRecord, type SviParams, type RawSvi } from './types.js';
import { z } from 'zod';

const PREDICT_SERVER = 'https://predict-server.testnet.mystenlabs.com';
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

// All SVI raw values are stored as integers divided by 1e9.
const SVI_SCALE = 1e9;

// Filter: skip oracles where the SVI-implied ATM vol is below this level.
// Most predict-testnet oracles have ~2-5% implied vol while realized is ~111%.
// This is a known testnet calibration issue; oracles below 10% are treated as
// degenerate (p ≈ 0.5, payoffs explode with near-zero probability pricing).
const MIN_ATM_VOL_FOR_BACKTEST = 0.10; // 10% annual — minimum reasonable for BTC

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

// Fetches oracle list (all ~3600+ records — server ignores limit param).
async function fetchAllOracles(): Promise<z.infer<typeof OracleRawSchema>[]> {
  const cached = await readCache<z.infer<typeof OracleRawSchema>[]>('oracles_all');
  if (cached) {
    console.log(`  [cache] oracles: ${cached.length} records`);
    return cached;
  }
  console.log('  [fetch] fetching oracle list...');
  const data = await fetchJson<unknown[]>(`${PREDICT_SERVER}/oracles`);
  const parsed = z.array(OracleRawSchema).parse(data);
  await writeCache('oracles_all', parsed);
  console.log(`  [fetch] oracle list: ${parsed.length} records`);
  return parsed;
}

// Fetches SVI for a single oracle (most recent snapshot, limit=1).
// Returns null if the oracle has no SVI data.
async function fetchSvi(oracleId: string): Promise<RawSvi | null> {
  const url = `${PREDICT_SERVER}/oracles/${oracleId}/svi?limit=1`;
  const data = await fetchJson<unknown[]>(url);
  if (!Array.isArray(data) || data.length === 0) return null;
  return RawSviSchema.parse(data[0]);
}

// Batches async tasks with bounded concurrency.
async function batchedMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      if (item !== undefined) {
        results[i] = await fn(item, i);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// Scales raw SVI params and applies sign flags.
function scaleSvi(raw: RawSvi): SviParams {
  return {
    a: raw.a / SVI_SCALE,
    b: raw.b / SVI_SCALE,
    rho: (raw.rho_negative ? -1 : 1) * (raw.rho / SVI_SCALE),
    m: (raw.m_negative ? -1 : 1) * (raw.m / SVI_SCALE),
    sigma: raw.sigma / SVI_SCALE,
  };
}

const OracleRawSchema = z.object({
  oracle_id: z.string(),
  underlying_asset: z.string(),
  expiry: z.number(),
  activated_at: z.number(),
  status: z.enum(['active', 'settled', 'cancelled']),
  settlement_price: z.number().nullable(),
  tick_size: z.number(),
  min_strike: z.number(),
});

export type RawOracle = z.infer<typeof OracleRawSchema>;

export async function fetchOracleRecords(): Promise<OracleRecord[]> {
  const cached = await readCache<OracleRecord[]>('oracle_records');
  if (cached) {
    console.log(`  [cache] oracle records: ${cached.length}`);
    return cached;
  }

  // Step 1: fetch oracle list and filter to settled BTC with valid settlement.
  const allOracles = await fetchAllOracles();
  const settled = allOracles.filter(
    (o) =>
      o.status === 'settled' &&
      o.settlement_price !== null &&
      o.underlying_asset.toUpperCase().includes('BTC'),
  );
  // Sort chronologically by expiry.
  settled.sort((a, b) => a.expiry - b.expiry);
  console.log(`  settled BTC oracles: ${settled.length}`);

  // Step 2: fetch SVI for each oracle (with disk-level caching per oracle).
  console.log(`  fetching SVI for ${settled.length} oracles (50 concurrent)...`);
  let fetched = 0;
  const sviMap = new Map<string, RawSvi | null>();

  // Check which SVIs are already cached as a batch.
  const batchCached = await readCache<Record<string, RawSvi | null>>('svi_batch');
  if (batchCached) {
    for (const [id, svi] of Object.entries(batchCached)) sviMap.set(id, svi);
    console.log(`  [cache] SVI batch: ${sviMap.size} entries`);
  } else {
    await batchedMap(settled, 50, async (oracle) => {
      try {
        const svi = await fetchSvi(oracle.oracle_id);
        sviMap.set(oracle.oracle_id, svi);
      } catch {
        sviMap.set(oracle.oracle_id, null);
      }
      fetched++;
      if (fetched % 500 === 0) process.stdout.write(`  ${fetched}/${settled.length} SVIs...\r`);
    });
    process.stdout.write('\n');
    // Save full SVI batch cache.
    const batchObj: Record<string, RawSvi | null> = {};
    for (const [id, svi] of sviMap) batchObj[id] = svi;
    await writeCache('svi_batch', batchObj);
  }

  // Step 3: build OracleRecord array.
  // Use settlement[i-1] as the forward for settlement[i] (see module docstring).
  const records: OracleRecord[] = [];
  for (let i = 0; i < settled.length; i++) {
    const o = settled[i];
    if (!o) continue;
    const rawSvi = sviMap.get(o.oracle_id);
    if (!rawSvi) continue; // skip oracles with no SVI (can't price)

    const settlementPriceNano = o.settlement_price;
    if (settlementPriceNano === null) continue;
    const settlementUsd = settlementPriceNano / 1e9;
    // forward for this oracle = settlement price of preceding oracle (or itself for index 0)
    const prevSettlement = i === 0 ? null : (settled[i - 1]?.settlement_price ?? null);
    const forwardUsd = prevSettlement !== null ? prevSettlement / 1e9 : settlementUsd;
    const t_years = (o.expiry - o.activated_at) / MS_PER_YEAR;

    const svi = scaleSvi(rawSvi);
    // ATM total variance w(k=0)
    const wAtm =
      svi.a +
      svi.b * (svi.rho * (0 - svi.m) + Math.sqrt((0 - svi.m) ** 2 + svi.sigma ** 2));
    const atm_vol = t_years > 0 && wAtm > 0 ? Math.sqrt(Math.max(wAtm, 0) / t_years) : 0;

    // Skip oracles with degenerate SVI calibration (implied vol too low for meaningful pricing).
    if (atm_vol < MIN_ATM_VOL_FOR_BACKTEST) continue;

    records.push({
      oracle_id: o.oracle_id,
      expiry_ms: o.expiry,
      activated_at_ms: o.activated_at,
      t_years,
      settlement_price_usd: settlementUsd,
      forward_usd: forwardUsd,
      svi,
      atm_vol,
    });
  }

  await writeCache('oracle_records', records);
  console.log(`  built ${records.length} oracle records`);
  return records;
}
