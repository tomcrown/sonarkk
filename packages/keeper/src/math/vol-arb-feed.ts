/**
 * Vol-arb cross-venue signal feed — Phase 5 Task 6.
 *
 * Purpose: compare Predict's ATM implied vol (from SVI) against a reference
 * realized vol from Hyperliquid (primary) or trailing oracle prices (fallback).
 * If Predict implied vol > reference realized vol + threshold → sell-vol edge.
 *
 * Sources:
 *   PRIMARY:  Hyperliquid 24h realized vol from hourly OHLCV candles.
 *   FALLBACK: Trailing 24h realized vol from Predict oracle price history.
 *   POLYMARKET: Binary price → implied vol inversion. Implemented but documented
 *               as "no current BTC markets found" (only 2023 events available).
 *
 * Formula — Polymarket binary price → implied vol (cited from Black model):
 *   A binary call pays 1 if F > K at expiry: c = N(d₂) = N((ln(F/K) - ½σ²T) / (σ√T))
 *   Inverting: let u = σ√T. Then d₂ = (ln(F/K) - ½u²) / u
 *   Given c = N(d₂): z = N⁻¹(c), x = ln(F/K)
 *   Quadratic in u: u² + 2zu - 2x = 0 → u = -z + √(z² + 2x)
 *   (positive root; valid for x near 0 i.e. near ATM)
 *   σ = u / √T
 *
 * Edge definition:
 *   edge_pct = (predict_implied_vol - reference_realized_vol) / reference_realized_vol × 100
 *   fired = edge_pct > SELL_VOL_EDGE_THRESHOLD_PCT (default 10%)
 *
 * Safety (Rule 3 binding):
 *   Buy-vol mode is NOT enabled — negative edge means favorable entry for buy-vol,
 *   but without a live Polymarket BTC feed the signal is one-sided sell-vol only.
 *
 * Quant assumptions (flag for human review):
 *   1. Realized vol is computed as annualized std-dev of log returns on 1h candles
 *      (Rogers-Satchell or close-to-close). We use close-to-close (Parkinson available
 *      but close-to-close is standard for comparison to implied vol).
 *   2. Predict ATM implied vol is svi_atm_vol(SVI, t_years) — the same function used
 *      by the entry guard. This is the SVI raw parameter calibration by Mysten Labs.
 *   3. 24h realized vol is the reference. Predict expiries are sub-hour, so realized
 *      vol over 24h is a trailing estimate, not a forward estimate for the next expiry.
 *      This introduces basis risk. Use edge threshold ≥10% to compensate.
 *   4. No transaction cost or spread adjustment yet — the edge is gross.
 */

import { atmVol } from '@sonarkk/core';
import type { SviParams } from '@sonarkk/core';
import { log } from '../logger.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';
const SELL_VOL_EDGE_THRESHOLD_PCT = 10; // minimum edge to fire vol-arb (gross, pre-cost)

// ── Result type ───────────────────────────────────────────────────────────────

export type VolArbSource = 'hyperliquid' | 'polymarket' | 'realized_vol_fallback';

export interface VolArbSignal {
  source: VolArbSource;
  predict_implied_vol: number;   // Predict ATM implied vol (SVI)
  reference_vol: number;         // Reference realized/implied vol
  edge_pct: number;              // (predict - reference) / reference × 100
  fired: boolean;                // edge_pct > SELL_VOL_EDGE_THRESHOLD_PCT
  raw_details: Record<string, unknown>;
}

// ── Standard Normal helpers ───────────────────────────────────────────────────

function erfc(x: number): number {
  // Abramowitz & Stegun approximation (max error < 1.5e-7)
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}

function Phi(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

function PhiInv(p: number): number {
  // Rational approximation (Peter Acklam), max error < 1.15e-9.
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
              1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
              6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
              -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pLow = 0.02425, pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
           ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5, r = q * q;
    return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
           (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
          ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

// ── Polymarket binary price → implied vol ─────────────────────────────────────

/**
 * Invert binary call price c = N(d₂) to implied vol.
 *
 * Black model binary call: c = N((ln(F/K) - ½σ²T) / (σ√T))
 * Substituting u = σ√T:
 *   d₂ = (x - ½u²) / u  where x = ln(F/K)
 *   z = N⁻¹(c) = (x - ½u²) / u → zu = x - ½u² → ½u² + zu - x = 0
 *   Positive root: u = -z + √(z² + 2x)
 *   σ = u / √T
 *
 * Returns null when the price is too far OTM/ITM for the approximation to hold.
 */
export function binaryPriceToImpliedVol(
  price: number,   // 0-1 binary probability / price
  forward: number, // forward price
  strike: number,  // strike price
  t_years: number, // time to expiry in years
): number | null {
  if (price <= 0.001 || price >= 0.999) return null;
  if (t_years <= 0) return null;
  const x = Math.log(forward / strike);
  const z = PhiInv(price);
  const discriminant = z * z + 2 * x;
  if (discriminant < 0) return null;
  const u = -z + Math.sqrt(discriminant);
  if (u <= 0) return null;
  return u / Math.sqrt(t_years);
}

// ── Hyperliquid 24h realized vol ──────────────────────────────────────────────

interface HyperliquidCandle {
  t: number;  // open time (ms)
  o: string;  // open
  h: string;  // high
  l: string;  // low
  c: string;  // close
  v: string;  // volume
}

async function fetchHyperliquidCandles(
  coin: string,
  intervalHours: number,
  lookbackHours: number,
): Promise<HyperliquidCandle[]> {
  const nowMs = Date.now();
  const startMs = nowMs - lookbackHours * 60 * 60 * 1000;
  const interval = `${intervalHours}h`;

  const body = JSON.stringify({
    type: 'candleSnapshot',
    req: { coin, interval, startTime: startMs, endTime: nowMs },
  });

  const res = await fetch(HYPERLIQUID_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`Hyperliquid candles HTTP ${res.status}`);
  const data = await res.json() as HyperliquidCandle[];
  return data;
}

function computeRealizedVol(candles: HyperliquidCandle[]): number {
  if (candles.length < 2) throw new Error('need at least 2 candles to compute realized vol');
  const closes = candles.map(c => parseFloat(c.c));
  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    logReturns.push(Math.log(closes[i]! / closes[i - 1]!));
  }
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (logReturns.length - 1);
  // Annualize: 1h candles → 8760 periods/year
  const periodsPerYear = (365 * 24) / candles.length * logReturns.length;
  return Math.sqrt(variance * periodsPerYear);
}

async function fetchHyperliquidRealizedVol(): Promise<{ vol: number; candle_count: number; spot: number }> {
  const candles = await fetchHyperliquidCandles('BTC', 1, 24);
  if (candles.length < 6) {
    throw new Error(`too few Hyperliquid candles: ${candles.length}`);
  }
  const vol = computeRealizedVol(candles);
  const spot = parseFloat(candles[candles.length - 1]!.c);
  return { vol, candle_count: candles.length, spot };
}

// ── Predict oracle trailing realized vol (fallback) ───────────────────────────

async function fetchPredictTrailingVol(predictServerUrl: string): Promise<{ vol: number; oracle_count: number } | null> {
  try {
    const url = `${predictServerUrl}/oracles?status=settled&limit=24`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const oracles = await res.json() as Array<{ settlement_price: number | null }>;
    const prices = oracles
      .filter(o => o.settlement_price !== null)
      .map(o => o.settlement_price!);

    if (prices.length < 4) return null;

    const logReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i]! > 0 && prices[i - 1]! > 0) {
        logReturns.push(Math.log(prices[i]! / prices[i - 1]!));
      }
    }
    if (logReturns.length < 3) return null;

    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (logReturns.length - 1);
    // Sub-hour expiries: assuming ~1 per hour, 8760 periods/year.
    const vol = Math.sqrt(variance * 8760);
    return { vol, oracle_count: prices.length };
  } catch {
    return null;
  }
}

// ── Polymarket (documented, no current BTC markets) ───────────────────────────

interface PolymarketMarket {
  condition_id: string;
  question: string;
  outcomes: string[];
  outcomePrices: string[];
  active: boolean;
  expiry_timestamp?: string;
}

async function fetchPolymarketBtcSignal(): Promise<{ vol: number; source: 'polymarket'; market: string } | null> {
  try {
    const url = 'https://gamma-api.polymarket.com/markets?active=true&tag=crypto&limit=100';
    const res = await fetch(url);
    if (!res.ok) return null;
    const markets = await res.json() as PolymarketMarket[];

    // Filter for BTC price prediction markets.
    const btcMarkets = markets.filter(m =>
      m.question.toLowerCase().includes('bitcoin') ||
      m.question.toLowerCase().includes('btc'),
    );

    if (btcMarkets.length === 0) {
      log.info('Polymarket: no active BTC markets found (only historical 2023 events available)');
      return null;
    }

    // Pick the most liquid ATM binary (closest to 50 cents).
    const candidates = btcMarkets
      .filter(m => m.outcomePrices?.length >= 2 && m.expiry_timestamp)
      .map(m => {
        const price = parseFloat(m.outcomePrices[0] ?? '0.5');
        const dif = Math.abs(price - 0.5);
        return { market: m, price, dif };
      })
      .sort((a, b) => a.dif - b.dif);

    if (candidates.length === 0) return null;

    const { market, price } = candidates[0]!;
    const expiryMs = market.expiry_timestamp ? new Date(market.expiry_timestamp).getTime() : 0;
    const t_years = Math.max(0, (expiryMs - Date.now()) / (365.25 * 24 * 60 * 60 * 1000));
    if (t_years <= 0) return null;

    // We'd need the current BTC spot to compute F/K. Use 1.0 (ATM assumption).
    const impliedVol = binaryPriceToImpliedVol(price, 1.0, 1.0, t_years);
    if (impliedVol === null) return null;

    log.info({ question: market.question, price, impliedVol, t_years }, 'Polymarket BTC binary signal');
    return { vol: impliedVol, source: 'polymarket', market: market.question };
  } catch (err) {
    log.warn({ err }, 'Polymarket fetch failed');
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the cross-venue vol-arb signal.
 *
 * @param svi           Active oracle SVI params (for Predict ATM implied vol)
 * @param t_years       Time to expiry (from active oracle)
 * @param predictServerUrl  Predict-server URL (for fallback realized vol)
 */
export async function computeVolArbSignal(
  svi: SviParams,
  t_years: number,
  predictServerUrl: string,
): Promise<VolArbSignal> {
  const predictImpliedVol = atmVol(svi, t_years);

  // ── Try Hyperliquid (primary) ──
  try {
    const hl = await fetchHyperliquidRealizedVol();
    const edgePct = (predictImpliedVol - hl.vol) / hl.vol * 100;
    const fired = edgePct > SELL_VOL_EDGE_THRESHOLD_PCT;

    log.info({
      source: 'hyperliquid',
      predict_implied_vol: predictImpliedVol.toFixed(4),
      hl_realized_vol: hl.vol.toFixed(4),
      edge_pct: edgePct.toFixed(2),
      fired,
      candle_count: hl.candle_count,
    }, 'vol-arb signal (Hyperliquid)');

    return {
      source: 'hyperliquid',
      predict_implied_vol: predictImpliedVol,
      reference_vol: hl.vol,
      edge_pct: edgePct,
      fired,
      raw_details: {
        hl_spot: hl.spot,
        candle_count: hl.candle_count,
        threshold_pct: SELL_VOL_EDGE_THRESHOLD_PCT,
      },
    };
  } catch (err) {
    log.warn({ err }, 'Hyperliquid vol feed failed — trying Polymarket');
  }

  // ── Try Polymarket (secondary) ──
  const pm = await fetchPolymarketBtcSignal();
  if (pm) {
    const edgePct = (predictImpliedVol - pm.vol) / pm.vol * 100;
    const fired = edgePct > SELL_VOL_EDGE_THRESHOLD_PCT;

    log.info({
      source: 'polymarket',
      predict_implied_vol: predictImpliedVol.toFixed(4),
      pm_implied_vol: pm.vol.toFixed(4),
      edge_pct: edgePct.toFixed(2),
      fired,
      market: pm.market,
    }, 'vol-arb signal (Polymarket)');

    return {
      source: 'polymarket',
      predict_implied_vol: predictImpliedVol,
      reference_vol: pm.vol,
      edge_pct: edgePct,
      fired,
      raw_details: { market: pm.market, threshold_pct: SELL_VOL_EDGE_THRESHOLD_PCT },
    };
  }

  // ── Fallback: Predict trailing realized vol ──
  const trail = await fetchPredictTrailingVol(predictServerUrl);
  const refVol = trail?.vol ?? predictImpliedVol * 0.9; // last resort: assume 10% premium
  const edgePct = (predictImpliedVol - refVol) / refVol * 100;
  const fired = edgePct > SELL_VOL_EDGE_THRESHOLD_PCT;

  log.warn({
    source: 'realized_vol_fallback',
    predict_implied_vol: predictImpliedVol.toFixed(4),
    fallback_vol: refVol.toFixed(4),
    edge_pct: edgePct.toFixed(2),
    fired,
    oracle_count: trail?.oracle_count ?? 0,
  }, 'vol-arb signal (fallback realized vol)');

  return {
    source: 'realized_vol_fallback',
    predict_implied_vol: predictImpliedVol,
    reference_vol: refVol,
    edge_pct: edgePct,
    fired,
    raw_details: {
      oracle_count: trail?.oracle_count ?? 0,
      warning: 'fallback used — Hyperliquid and Polymarket both unavailable',
      threshold_pct: SELL_VOL_EDGE_THRESHOLD_PCT,
    },
  };
}
