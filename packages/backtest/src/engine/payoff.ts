/**
 * Payoff computation for binary and range bets.
 *
 * Binary call: pays 1 DUSDC if settlement_price > strike_usd, else 0
 * Binary put:  pays 1 DUSDC if settlement_price < strike_usd, else 0
 * Range:       pays 1 DUSDC if low_usd ≤ settlement_price < high_usd, else 0
 */

export function binaryCallWon(settlementUsd: number, strikeUsd: number): boolean {
  return settlementUsd > strikeUsd;
}

export function binaryPutWon(settlementUsd: number, strikeUsd: number): boolean {
  return settlementUsd < strikeUsd;
}

export function rangeWon(
  settlementUsd: number,
  lowUsd: number,
  highUsd: number,
): boolean {
  return settlementUsd >= lowUsd && settlementUsd < highUsd;
}
