import type { OracleRecord, RoundResult } from '../data/types.js';

// Config shared by all strategy simulators.
export interface SimConfig {
  // DUSDC vault size (total deposited capital).
  vault_size_dusdc: number;
  // Utilization fraction [0, 1]: fraction of vault in active positions.
  utilization: number;
  // Fraction of volume that is binary calls vs puts (0.55 = 55% calls).
  call_fraction: number;
  // Number of synthetic strikes to simulate (should be odd, centred at ATM).
  num_strikes: number;
  // DeepBook round-trip friction for hedge (bps). Only used by Hedged-PLP.
  deepbook_friction_bps: number;
  // Mock lending APY for Principal-Protected (iron_bank mock).
  mock_lending_apy: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  vault_size_dusdc: 100_000,
  utilization: 0.25,       // overridden by sensitivity runner
  call_fraction: 0.55,
  num_strikes: 7,
  deepbook_friction_bps: 8,
  mock_lending_apy: 0.05,  // 5% APY — conservative money market assumption
};

// Strategy simulator interface: given one oracle period, return a RoundResult.
export type StrategySimulator = (
  record: OracleRecord,
  config: SimConfig,
) => RoundResult;

// Strike distribution weights for synthetic volume (normal-shaped).
// len must match config.num_strikes (always 7 here).
export const STRIKE_WEIGHTS = [0.05, 0.10, 0.20, 0.30, 0.20, 0.10, 0.05];

// Strike offsets in sigma-multiples (centred at ATM = k=0).
export const STRIKE_SIGMA_OFFSETS = [-2, -1.5, -1, 0, 1, 1.5, 2];
