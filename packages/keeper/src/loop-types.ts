/**
 * Shared types and constants used by loop.ts and other keeper modules.
 * Extracted to avoid circular imports.
 */

import type { StrategyId } from '@sonarkk/core';

export const STRATEGY_TYPE_MAP: Record<string, StrategyId | null> = {
  PLP_SUPPLIER:        'plp_supplier',
  HEDGED_PLP:          'hedged_plp',
  SMART_VAULT:         'smart_vault',
  PRINCIPAL_PROTECTED: 'principal_protected',
  RANGE_ROLL:          'range_roll',
  VOL_TARGETED_RANGE:  'vol_targeted_range',
  CROSS_VENUE_ARB:     'vol_arb_sell',
};
