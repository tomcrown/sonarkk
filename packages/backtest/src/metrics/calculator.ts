/**
 * Metrics calculator for backtest results.
 *
 * All metrics are computed from the per-round RoundResult series.
 * Conventions:
 *   - APY: annualised, computed from total return over backtest period.
 *   - Sharpe: annualised, using risk-free rate of 0 (no risk-free on testnet).
 *   - Max drawdown: peak-to-trough on cumulative NAV curve.
 *   - Win rate: fraction of rounds where pnl_fraction > 0 (or won===true for betting strats).
 *   - Spread cost %: total spread collected / |gross_return| (house strats only).
 */
import type { RoundResult, OracleRecord } from '../data/types.js';

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

export interface MetricSet {
  net_apy: number;
  total_return_pct: number;
  max_drawdown: number;
  sharpe: number;
  win_rate: number | null;
  spread_cost_pct: number | null;
  rounds_traded: number;
}

export function computeMetrics(
  rounds: RoundResult[],
  records: OracleRecord[],
): MetricSet {
  if (rounds.length === 0) {
    return {
      net_apy: 0, total_return_pct: 0, max_drawdown: 0,
      sharpe: 0, win_rate: null, spread_cost_pct: null, rounds_traded: 0,
    };
  }

  // Build cumulative NAV curve (starting at 1.0).
  const nav: number[] = [1.0];
  for (const r of rounds) {
    nav.push((nav[nav.length - 1] ?? 1) + r.pnl_fraction);
  }

  const total_return = (nav[nav.length - 1] ?? 1) - 1.0;

  // Annualise over the actual backtest period.
  const firstMs = records[0]?.expiry_ms ?? 0;
  const lastMs = records[records.length - 1]?.expiry_ms ?? 0;
  const period_ms = lastMs - firstMs;
  const t_years = period_ms > 0 ? period_ms / MS_PER_YEAR : 1;
  const net_apy = t_years > 0 ? total_return / t_years : total_return;

  // Max drawdown: peak-to-trough on NAV.
  let peak = nav[0] ?? 1;
  let max_dd = 0;
  for (const v of nav) {
    if (v !== undefined && v > peak) peak = v;
    const dd = peak > 0 ? (peak - (v ?? 0)) / peak : 0;
    if (dd > max_dd) max_dd = dd;
  }

  // Sharpe: annualised excess return / annualised vol of per-round returns.
  const pnl_fracs = rounds.map((r) => r.pnl_fraction);
  const mean = pnl_fracs.reduce((s, v) => s + v, 0) / pnl_fracs.length;
  const variance =
    pnl_fracs.reduce((s, v) => s + (v - mean) ** 2, 0) / pnl_fracs.length;
  const per_round_std = Math.sqrt(variance);
  // Rounds per year: total rounds / t_years
  const rounds_per_year = rounds.length / t_years;
  const sharpe =
    per_round_std > 0
      ? (mean * rounds_per_year) / (per_round_std * Math.sqrt(rounds_per_year))
      : 0;

  // Win rate.
  const has_won_field = rounds.some((r) => r.won !== null);
  let win_rate: number | null = null;
  if (has_won_field) {
    const wins = rounds.filter((r) => r.won === true).length;
    win_rate = wins / rounds.length;
  } else {
    // For house strategies: "win" = positive P&L round
    const wins = rounds.filter((r) => r.pnl_fraction > 0).length;
    win_rate = wins / rounds.length;
  }

  // Spread cost %.
  const total_spread = rounds.reduce((s, r) => s + r.spread_fraction, 0);
  const gross_return = rounds.reduce(
    (s, r) => s + Math.max(0, r.pnl_fraction + r.spread_fraction),
    0,
  );
  const spread_cost_pct =
    gross_return > 0 ? total_spread / gross_return : null;

  return {
    net_apy,
    total_return_pct: total_return * 100,
    max_drawdown: max_dd,
    sharpe,
    win_rate,
    spread_cost_pct,
    rounds_traded: rounds.length,
  };
}

// Verdict: simple rules based on metrics.
export function verdict(m: MetricSet, strategyType: 'house' | 'bettor'): 'keep' | 'fix' | 'cut' {
  if (m.rounds_traded < 10) return 'cut';

  if (strategyType === 'house') {
    // House strategies: keep if APY > 5% and drawdown < 20%
    if (m.net_apy >= 0.05 && m.max_drawdown < 0.20) return 'keep';
    if (m.net_apy >= 0.02 || m.max_drawdown < 0.30) return 'fix';
    return 'cut';
  } else {
    // Betting strategies: need positive APY to keep; spread must not eat all returns
    if (m.net_apy >= 0.03 && m.sharpe >= 0.5) return 'keep';
    if (m.net_apy >= 0 && (m.spread_cost_pct ?? 1) < 0.5) return 'fix';
    return 'cut';
  }
}

// Annualised realized volatility from a price series.
export function realizedVol(prices: number[], t_years_per_interval: number): number {
  if (prices.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const cur = prices[i];
    if (prev !== undefined && cur !== undefined && prev > 0 && cur > 0) {
      const r = Math.log(cur / prev);
      sum += r * r;
      count++;
    }
  }
  if (count === 0 || t_years_per_interval <= 0) return 0;
  return Math.sqrt(sum / count / t_years_per_interval);
}
