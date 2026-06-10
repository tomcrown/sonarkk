/**
 * Strategy ④ — Principal-Protected (Pool-and-Accumulate).
 *
 * Principal sits in mock lending (iron_bank / money market — testnet mock per CLAUDE.md §2).
 * Yield is accumulated and periodically deployed as a binary bet on Predict.
 * Principal NEVER touches Predict.
 *
 * Mock lending interface: LendingAdapter.
 * Assumption: 5% APY (conservative money market), configurable via mock_lending_apy.
 *
 * Bet schedule: accumulate yield for BET_EPOCH_ROUNDS rounds (≈24 hours at 15-min cadence),
 * then deploy the pot as an ATM binary call (bet on BTC direction per recent trend).
 * This matches the "pool yield from all users → shared upside" design.
 *
 * Quant note: This strategy has lower expected return than PLP (it avoids the spread edge),
 * but has zero downside risk on principal — important for risk-averse depositors.
 */
import { binaryCallProb } from '../engine/svi.js';
import { bettorBetPnl } from '../engine/spread.js';
import { binaryCallWon, binaryPutWon } from '../engine/payoff.js';
import type { OracleRecord, RoundResult } from '../data/types.js';
import type { SimConfig } from './types.js';

// Rounds between bet deployments (~24 hours = 96 × 15-min intervals).
const BET_EPOCH_ROUNDS = 96;
// Fraction of accumulated pot to risk per bet (leave a buffer for next epoch).
const BET_FRACTION = 0.80;

export function simulatePrincipalProtected(
  records: OracleRecord[],
  config: SimConfig,
): RoundResult[] {
  const results: RoundResult[] = [];
  let accumulated_yield = 0;
  let rounds_since_bet = 0;

  for (let idx = 0; idx < records.length; idx++) {
    const rec = records[idx];
    if (!rec) continue;
    const S_T = rec.settlement_price_usd;
    const F = rec.forward_usd;

    // Yield earned this round (lending on full vault, guaranteed).
    const round_yield = config.vault_size_dusdc * config.mock_lending_apy * rec.t_years;
    accumulated_yield += round_yield;
    rounds_since_bet++;

    let bet_pnl = 0;
    let spread_fraction = 0;

    if (rounds_since_bet >= BET_EPOCH_ROUNDS && accumulated_yield > 0) {
      const pot = accumulated_yield * BET_FRACTION;
      // Bet direction: ATM call if BTC recently up, else ATM put.
      const prevRecord = records[idx - 1];
      const btc_up = idx > 0 && prevRecord !== undefined && rec.forward_usd > prevRecord.forward_usd;
      const p_atm = binaryCallProb(rec.svi, 0);

      if (btc_up) {
        const won = binaryCallWon(S_T, F);
        bet_pnl = bettorBetPnl(p_atm, config.utilization, won, pot);
      } else {
        const p_put = 1 - p_atm;
        const won = binaryPutWon(S_T, F);
        bet_pnl = bettorBetPnl(p_put, config.utilization, won, pot);
      }

      // Reset pot (keep the unbetted fraction + any winnings).
      accumulated_yield = accumulated_yield - accumulated_yield * BET_FRACTION;
      rounds_since_bet = 0;
      spread_fraction = 0; // bettor pays spread (not collected by this strategy)
    }

    // Base lending yield + any bet result, as fraction of vault.
    const pnl_fraction = (round_yield + bet_pnl) / config.vault_size_dusdc;

    results.push({
      oracle_id: rec.oracle_id,
      expiry_ms: rec.expiry_ms,
      pnl_fraction,
      spread_fraction,
      won: null,
    });
  }

  return results;
}
