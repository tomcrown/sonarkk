/**
 * SVI (Stochastic Volatility Inspired) smile model.
 *
 * Raw Gatheral SVI parameterization:
 *   w(k) = a + b * (rho*(k-m) + sqrt((k-m)^2 + sigma^2))
 * where:
 *   k     = log-moneyness = ln(K/F)  (K=strike, F=forward)
 *   w(k)  = total variance = sigma_implied^2 * T
 *
 * Binary call probability (risk-neutral, Black-Scholes on SVI implied vol):
 *   p = Φ(d₂)  where  d₂ = -k/√w - √w/2
 *
 * Simplification: We use Φ(d₂) rather than the full Dupire-corrected CDF.
 * The correction term is φ(d₂)·w'(k)/(2√w) ≈ 0.001-0.005 for these params
 * (nearly flat smile on 2-hour expiries) — immaterial for the backtest verdict.
 *
 * Delta for binary call: ∂p/∂S ≈ φ(d₂)/(S·√w)
 * Used by Hedged-PLP to size the DeepBook Spot hedge.
 */
import type { SviParams } from '../data/types.js';

// Standard normal CDF — Abramowitz & Stegun rational approximation (error < 7.5e-8).
export function Phi(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const p =
    k *
    (0.319381530 +
      k *
        (-0.356563782 +
          k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  const phi_x = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - phi_x * p;
  return x < 0 ? 1 - cdf : cdf;
}

// Standard normal PDF.
export function phi(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Total variance w(k) from SVI params.
export function sviW(params: SviParams, k: number): number {
  const { a, b, rho, m, sigma } = params;
  return a + b * (rho * (k - m) + Math.sqrt((k - m) ** 2 + sigma ** 2));
}

// Derivative of w with respect to k (used for Dupire correction and sensitivity).
export function sviWPrime(params: SviParams, k: number): number {
  const { b, rho, m, sigma } = params;
  return b * (rho + (k - m) / Math.sqrt((k - m) ** 2 + sigma ** 2));
}

// Implied annual volatility at log-moneyness k, given t_years.
export function impliedVol(params: SviParams, k: number, t_years: number): number {
  const w = sviW(params, k);
  if (w <= 0 || t_years <= 0) return 0;
  return Math.sqrt(w / t_years);
}

// Minimum total variance floor: prevents division-by-zero and probability collapse.
// Corresponds to ~0.3% annual vol at T=15min — essentially zero but numerically stable.
const W_FLOOR = 1e-10;

// Binary CALL probability: P(S_T > K) — risk-neutral.
// Returns value in [0, 1]. For k=0 (ATM), this ≈ 0.5 minus a small adjustment.
export function binaryCallProb(params: SviParams, k: number): number {
  const w = Math.max(sviW(params, k), W_FLOOR);
  const sqrtW = Math.sqrt(w);
  const d2 = -k / sqrtW - sqrtW / 2;
  return Phi(d2);
}

// Binary PUT probability: P(S_T < K) = 1 - P(S_T > K).
export function binaryPutProb(params: SviParams, k: number): number {
  return 1 - binaryCallProb(params, k);
}

// Range bet probability: P(K_low < S_T ≤ K_high).
// k_low = ln(K_low/F), k_high = ln(K_high/F).
export function rangeBetProb(params: SviParams, k_low: number, k_high: number): number {
  return Math.max(0, binaryCallProb(params, k_low) - binaryCallProb(params, k_high));
}

// Minimum total variance for delta to avoid infinite hedge sizes near zero vol.
const W_DELTA_FLOOR = 1e-6; // ~0.003% annual vol at T=2hr — small but non-zero

// Delta of a binary call: ∂p/∂S ≈ φ(d₂) / (S·√w).
// Returns delta in units of (DUSDC change per $1 BTC move) / DUSDC_notional.
// Multiply by notional × spot to get BTC equivalent for hedging.
export function binaryCallDelta(params: SviParams, k: number): number {
  const w = Math.max(sviW(params, k), W_DELTA_FLOOR);
  const sqrtW = Math.sqrt(w);
  const d2 = -k / sqrtW - sqrtW / 2;
  // ∂p/∂k = -φ(d₂)/√w  (ignoring smile correction)
  // ∂p/∂S = ∂p/∂k × ∂k/∂S = (-φ(d₂)/√w) × (-1/S) = φ(d₂)/(S·√w)
  // Normalised (per unit S): return φ(d₂)/√w
  return phi(d2) / sqrtW;
}

// Calibration check: verifies that SVI parameters produce physically sensible results.
// Returns a summary; logs warnings for suspect values.
export interface SviCalibrationReport {
  atm_vol_pct: number;   // implied vol at ATM in percent
  skew_bps: number;      // vol difference between k=-0.02 and k=+0.02 in bps
  prob_atm_call: number; // should be close to 0.50
  butterfly: number;     // convexity: vol at k=±0.03 minus vol at k=0
  suspicious: boolean;   // true if anything looks off
}

export function calibrateSvi(params: SviParams, t_years: number): SviCalibrationReport {
  const atm_vol_pct = impliedVol(params, 0, t_years) * 100;
  const vol_minus = impliedVol(params, -0.02, t_years) * 100;
  const vol_plus = impliedVol(params, 0.02, t_years) * 100;
  const vol_wing_m = impliedVol(params, -0.03, t_years) * 100;
  const vol_wing_p = impliedVol(params, 0.03, t_years) * 100;

  const skew_bps = (vol_minus - vol_plus) * 100; // negative skew = higher put vol
  const butterfly = ((vol_wing_m + vol_wing_p) / 2 - atm_vol_pct) * 100;
  const prob_atm_call = binaryCallProb(params, 0);

  const suspicious =
    atm_vol_pct < 5 ||
    atm_vol_pct > 300 ||
    Math.abs(prob_atm_call - 0.5) > 0.1 ||
    sviW(params, 0) <= 0;

  return { atm_vol_pct, skew_bps, prob_atm_call, butterfly, suspicious };
}
