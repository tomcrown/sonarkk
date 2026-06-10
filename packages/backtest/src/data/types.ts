import { z } from 'zod';

// Scaled SVI parameters (already divided by 1e9 and sign-applied).
// Formula: w(k) = a + b*(rho*(k-m) + sqrt((k-m)^2 + sigma^2))
// where k = ln(K/F), w = total variance (sigma_implied^2 * T)
export interface SviParams {
  a: number;     // variance intercept (ATM total variance ≈ a when m≈0)
  b: number;     // slope / curvature
  rho: number;   // skew correlation [-1, 1]
  m: number;     // location (log-moneyness at minimum variance)
  sigma: number; // wing smoothness (> 0)
}

// One fully-normalized oracle record (one 15-min settlement period).
export interface OracleRecord {
  oracle_id: string;
  // Times in ms
  expiry_ms: number;
  activated_at_ms: number;
  // Duration in years (expiry - activated_at converted to years)
  t_years: number;
  // BTC price at settlement in USD (settlement_price / 1e9)
  settlement_price_usd: number;
  // Forward price at activation in USD — approximated from preceding oracle's settlement
  forward_usd: number;
  // SVI parameters (most recent before settlement, already scaled)
  svi: SviParams;
  // ATM implied annual vol = sqrt(w_atm / t_years), used for quick reference
  atm_vol: number;
}

// Result of simulating one strategy for one oracle period.
export interface RoundResult {
  oracle_id: string;
  expiry_ms: number;
  // NAV change as fraction of capital deployed in this round (e.g. 0.002 = +0.2%)
  pnl_fraction: number;
  // Total spread collected as fraction of capital (always >= 0 for house strategies)
  spread_fraction: number;
  // Whether the bet/payoff was in-the-money (for betting strategies)
  won: boolean | null; // null for house strategies (not binary win/lose)
}

// Cumulative strategy result over all rounds.
export interface StrategyResult {
  strategy_id: string;
  strategy_name: string;
  utilization: number;  // 0.05, 0.25, or 0.60
  rounds: RoundResult[];
  // Computed metrics (filled in by calculator)
  net_apy: number;
  max_drawdown: number;
  sharpe: number;
  win_rate: number | null;        // null for house strategies
  spread_cost_pct: number | null; // fraction of gross returns eaten by spread (betting strategies)
  verdict: 'keep' | 'fix' | 'cut';
}

// The full backtest output.
export interface BacktestOutput {
  generated_at: string;
  oracle_count: number;
  period_start: string;
  period_end: string;
  realized_btc_vol: number;  // annualised realized vol from settlement price series
  strategies: StrategyResult[];
}

// Zod schema for validating raw SVI from the API (with sign flags).
export const RawSviSchema = z.object({
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

export type RawSvi = z.infer<typeof RawSviSchema>;
