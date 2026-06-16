export const STRATEGY_NAMES: Record<number, string> = {
  0: 'PLP Supplier',
  1: 'Hedged PLP',
  2: 'Smart Vault',
  3: 'Principal Protected',
  4: 'Range Roll',
  5: 'Vol-Targeted Range',
  6: 'Cross-Venue Arb',
  7: 'Margin Loop',
}

export const STRATEGY_DESCRIPTIONS: Record<number, string> = {
  0: 'Supply capital to the options liquidity pool. Collect the spread on every bet, direction-agnostic.',
  1: 'House income from PLP plus a dynamic delta-hedge on DeepBook Spot to offset directional BTC exposure.',
  2: 'Auto-allocated across house strategies with rebalancing. The one-tap default.',
  3: 'Principal stays in safe lending — only accumulated yield is ever deployed to Predict. Zero principal risk.',
  4: 'Bet that BTC stays in range. Auto-rolls each expiry. Short-volatility view.',
  5: 'Range-rolling with position sizing tied to SVI-implied vol. Reduces tail losses vs raw Range Roll.',
  6: 'Fires when Predict prices more vol than Hyperliquid reference. Sell-vol mode only.',
  7: 'Three-protocol composability demo: lending + margin + Predict. Admin/demo only.',
}

export const BETTOR_STRATEGIES = new Set([4, 5, 6])
export const HOUSE_STRATEGIES = new Set([0, 1, 2, 3])

export const STRATEGY_RISK_LABELS: Record<number, string> = {
  0: 'Low–Med',
  1: 'Low–Med',
  2: 'Low–Med',
  3: 'No principal risk',
  4: 'Med — short vol',
  5: 'Med — short vol',
  6: 'High — short vol',
  7: 'Demo only',
}

export const STRATEGY_COLORS: Record<number, string> = {
  0: '#A9A8EC',
  1: '#A9A8EC',
  2: '#A9A8EC',
  3: '#3DD68C',
  4: '#E8A627',
  5: '#E8A627',
  6: '#F04438',
  7: '#58586A',
}

export const KEEPER_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  stopped: 'Stopped',
  error: 'Error',
}

export const BETTOR_DISCLOSURE =
  'Short-volatility strategy — profitable in calm markets, loses in volatility spikes.'

export const DUSDC_DECIMALS = 6
export const DUSDC_DIVISOR = 1_000_000
export const NAV_SCALE = 1_000_000_000

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
