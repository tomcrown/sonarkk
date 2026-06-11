/**
 * Net-delta calculator for Predict binary and range positions.
 *
 * Quant basis (per CLAUDE.md §4):
 *
 * SVI parameterization:
 *   w(k) = a + b*(rho*(k-m) + sqrt((k-m)^2 + sigma^2))
 *   k = ln(K/F)   (log-moneyness, K = strike, F = forward)
 *   w(k) = total variance = σ_implied² × T
 *
 * Binary call risk-neutral probability:
 *   p_call(k) = Φ(d₂)  where  d₂ = -k/√w - √w/2
 *
 * Binary call delta (∂p/∂S):
 *   d₂ = ln(S/K)/√w - √w/2   (expanding k = ln(K/S) for constant K)
 *   ∂d₂/∂S = 1/(S√w)
 *   ∴ Δ_call = φ(d₂)/(S√w)
 *
 * Normalised delta (per unit of S, multiply by notional/S to get DBTC):
 *   Δ_norm = φ(d₂)/√w
 *
 * Range delta = vertical spread: long call at k_low, short call at k_high:
 *   Δ_range = Δ_norm(k_low) - Δ_norm(k_high)
 *
 * HOUSE sign convention:
 *   The PLP vault is counterparty to all bets (writes options).
 *   Writing a call → delta = -Δ_norm × notional/S  (house loses when BTC rises)
 *   Writing a put  → delta = +Δ_norm × notional/S  (house gains when BTC rises)
 *   (Binary put delta = -Δ_call from bettor's view → house put delta = +Δ_call)
 *
 *   Net house delta for 55/45 call/put book:
 *     = Δ_norm × (put_notional - call_notional) / S
 *     = Δ_norm × (0.45 - 0.55) × notional / S  < 0  (net short)
 *
 *   To hedge negative house delta: go LONG |net_delta| DBTC.
 *
 * Near-expiry: φ(d₂)/√w spikes as w→0. The keeper should scale down hedge
 * orders within MIN_T_YEARS_FOR_HEDGE to avoid chasing large Spot orders.
 *
 * References:
 *   Taleb (1997) "Dynamic Hedging", Ch. 3 — digital option delta
 *   Hull (2012) "Options, Futures and Other Derivatives", Ch. 17 — binary options
 *   Gatheral (2006) "The Volatility Surface" — SVI parameterization
 */

// ── SVI primitives (self-contained — no cross-package import) ──────────────

export interface SviParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

/** Standard normal CDF (Abramowitz & Stegun, error < 7.5e-8). */
export function Phi(x: number): number {
  if (x <= -8) return 0;
  if (x >= 8) return 1;
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const p = k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * p;
  return x < 0 ? 1 - cdf : cdf;
}

/** Standard normal PDF. */
export function phi(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Total variance w(k) from Gatheral SVI params. */
export function sviW(p: SviParams, k: number): number {
  return p.a + p.b * (p.rho * (k - p.m) + Math.sqrt((k - p.m) ** 2 + p.sigma ** 2));
}

/** Binary call probability Φ(d₂). */
export function binaryCallProb(p: SviParams, k: number): number {
  const w = Math.max(sviW(p, k), 1e-10);
  return Phi(-k / Math.sqrt(w) - Math.sqrt(w) / 2);
}

/** ATM implied annual volatility. */
export function atmVol(p: SviParams, t_years: number): number {
  const w = sviW(p, 0);
  return w > 0 && t_years > 0 ? Math.sqrt(w / t_years) : 0;
}

// ── Delta computation ──────────────────────────────────────────────────────

const W_DELTA_FLOOR = 1e-6; // prevents spike at near-zero variance

/**
 * 5 minutes — below this the delta amplitude is unreliable near expiry.
 * Keepers should scale down hedge orders proportionally when t_years < this.
 */
export const MIN_T_YEARS_FOR_HEDGE = 5 / (365.25 * 24 * 60);

/**
 * Normalised binary call delta: φ(d₂)/√w.
 * Multiply by notional/spot_price to get DBTC.
 */
export function binaryCallDeltaNorm(p: SviParams, k: number): number {
  const w = Math.max(sviW(p, k), W_DELTA_FLOOR);
  const sqrtW = Math.sqrt(w);
  const d2 = -k / sqrtW - sqrtW / 2;
  return phi(d2) / sqrtW;
}

// ── Position types ─────────────────────────────────────────────────────────

export interface BinaryPosition {
  direction: 'call' | 'put';
  notional: number; // DUSDC
  k: number;        // ln(K/F)
}

export interface RangePosition {
  notional: number;
  k_low: number;
  k_high: number;
}

// ── Net delta from keeper position book ───────────────────────────────────

/**
 * Compute net delta of a book of binary and range positions (BETTOR view).
 *
 * Returns DUSDC change per $1 BTC move.
 *   Positive = position gains when BTC rises.
 *   Negative = position loses when BTC rises.
 *
 * Multiply net_delta by -1 to get the HOUSE's exposure (house takes the other side).
 */
export function computeNetDelta(
  svi: SviParams,
  spot: number,
  binaries: BinaryPosition[],
  ranges: RangePosition[],
): number {
  let net = 0;
  for (const p of binaries) {
    const d = binaryCallDeltaNorm(svi, p.k) * p.notional / spot;
    net += p.direction === 'call' ? d : -d;
  }
  for (const r of ranges) {
    const d = (binaryCallDeltaNorm(svi, r.k_low) - binaryCallDeltaNorm(svi, r.k_high))
      * r.notional / spot;
    net += d;
  }
  return net;
}

/**
 * Net delta of the PLP vault (HOUSE view) given its full book of exposures.
 *
 * House is counterparty: for every bettor call, house delta is -Δ_call.
 * For every bettor put, house delta is +Δ_call (same magnitude, opposite sign).
 *
 * @param strikes  Each element: one strike band with the total DUSDC in calls
 *                 and puts written by the house at that strike.
 *
 * Returns: DUSDC per $1 BTC move from the house's perspective.
 *   Negative = house loses when BTC rises (net short delta, more calls than puts).
 *   Positive = house loses when BTC falls (net long delta, more puts than calls).
 */
export interface HouseStrikeExposure {
  k: number;
  call_notional: number; // DUSDC in calls at this strike (house wrote these)
  put_notional: number;  // DUSDC in puts at this strike (house wrote these)
}

export function computeHouseNetDelta(
  svi: SviParams,
  spot: number,
  strikes: HouseStrikeExposure[],
): number {
  let net = 0;
  for (const s of strikes) {
    const delta_norm = binaryCallDeltaNorm(svi, s.k);
    // House short call → delta = -Δ_norm × notional/S (house loses when BTC rises)
    net -= delta_norm * s.call_notional / spot;
    // House short put  → delta = +Δ_norm × notional/S (house gains when BTC rises)
    net += delta_norm * s.put_notional / spot;
  }
  return net;
}

/**
 * Convenience: compute house net delta for a synthetic vault book with uniform
 * strike distribution (used by the backtest and stress test).
 *
 * @param atm_vol_sqrt_t  σ√T (pre-computed for efficiency)
 * @param strike_offsets  sigma multiples for each strike band (e.g. [-2,-1,0,1,2])
 * @param weights         fraction of notional at each strike (must sum to 1)
 * @param call_fraction   fraction of each strike band that is calls (vs puts)
 * @param total_notional  total DUSDC deployed
 */
export function computeHouseNetDeltaSynthetic(
  svi: SviParams,
  spot: number,
  atm_vol_sqrt_t: number,
  strike_offsets: number[],
  weights: number[],
  call_fraction: number,
  total_notional: number,
): number {
  const strikes: HouseStrikeExposure[] = strike_offsets.map((offset, i) => {
    const k = offset * atm_vol_sqrt_t;
    const notional_at_strike = total_notional * (weights[i] ?? 0);
    return {
      k,
      call_notional: notional_at_strike * call_fraction,
      put_notional: notional_at_strike * (1 - call_fraction),
    };
  });
  return computeHouseNetDelta(svi, spot, strikes);
}
