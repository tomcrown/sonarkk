/**
 * Portfolio cycle execution — builds and submits the keeper PTB.
 *
 * One PTB per portfolio per expiry:
 *   House ①②③: update_nav → take_for_supply → predict::supply → store_lp
 *   Bettor ⑤⑥:  update_nav → take_for_bettor → predict::mint_range → store_quote (change)
 *   Bettor ⑦:   update_nav → take_for_bettor → predict::mint → store_quote (change)
 *   House ④:    update_nav → claim_yield_from_lending → [keeper tops up yield] →
 *               store_quote → take_yield_for_bet → predict::mint → store_quote (change)
 *
 * IMPORTANT — Predict mint/mint_range signatures:
 *   These were inferred from the contract's redeem/supply patterns and the
 *   BinaryPositionJson field layout. Verify before first bettor cycle run:
 *     mint<Q>(predict, manager, oracle, is_call: bool, k: u64, payment: Coin<Q>, clock) → Coin<Q>
 *     mint_range<Q>(predict, manager, oracle, lower_k: u64, upper_k: u64, notional: Coin<Q>, clock) → Coin<Q>
 *   k is log-moneyness × 1e9 (unsigned magnitude; sign via is_call for binary).
 *   lower_k / upper_k are signed log-moneyness × 1e9 (stored as two's complement u64 or offset).
 *   If the on-chain signature differs, update the PTB arguments here only.
 *
 * The hedge order (for ②) is submitted in a SEPARATE PTB via spot/hedge.ts
 * because DeepBook PTBs reference their own coin objects and cannot be combined
 * with Predict calls in a single PTB without object ID conflicts.
 *
 * All functions that write to the portfolio require the PolicyCap to be passed.
 * Budget is consumed on-chain; the keeper cannot exceed the cap.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SizingResult } from '@sonarkk/core';
import { env, PLP_TYPE, CLOCK_ID, EXPLORER_URL } from '../env.js';
import { log } from '../logger.js';
import { withRetry } from '../util/retry.js';

const PREDICT_PKG = () => env.PREDICT_PACKAGE;
const PREDICT_OBJ = () => env.PREDICT_OBJECT;
const SONARK_PKG  = () => env.SONARK_PACKAGE;
const DUSDC       = env.DUSDC_TYPE;

export interface ExecuteResult {
  tx_digest: string;
  nav_pushed: bigint;
  supply_amount_raw: bigint;
}

export interface BettorExecuteResult {
  tx_digest: string;
  nav_pushed: bigint;
  notional_raw: bigint;
  market_key: string;    // derived key; keeper stores in DB for later settlement
  oracle_id: string;
}

/**
 * Strike selection — controls how far from ATM the keeper places bets.
 *
 * For binary strategies (CROSS_VENUE_ARB):
 *   ATM    → strike = forwardRaw floored to nearest $1
 *   OTM_1  → strike ±1% from ATM (call=above, put=below)
 *   OTM_2  → strike ±2% from ATM
 *
 * For range strategies (RANGE_ROLL, VOL_TARGETED_RANGE):
 *   ATM    → ±5% range width (rangeWidthBps = 500)
 *   OTM_1  → ±10% range width (rangeWidthBps = 1000) — wider, lower win probability
 *   OTM_2  → ±15% range width (rangeWidthBps = 1500) — widest, highest payout if won
 *
 * Lower win probability = higher payout per contract if the position wins.
 * Users who are very confident in low vol pick OTM for higher reward.
 */
export type StrikeSelection = 'ATM' | 'OTM_1' | 'OTM_2';

const OTM_BINARY_OFFSET_BPS: Record<StrikeSelection, bigint> = {
  ATM:   0n,
  OTM_1: 100n,  // 1% from ATM
  OTM_2: 200n,  // 2% from ATM
};

const OTM_RANGE_WIDTH_BPS: Record<StrikeSelection, bigint> = {
  ATM:   500n,   // ±5%  from ATM
  OTM_1: 1000n,  // ±10% from ATM
  OTM_2: 1500n,  // ±15% from ATM
};

/** Compute binary strike from forward price and selection. */
function computeBinaryStrike(forwardRaw: bigint, selection: StrikeSelection, isCall: boolean): bigint {
  const TICK = 1_000_000_000n;
  const atm = (forwardRaw / TICK) * TICK;
  const offset = atm * OTM_BINARY_OFFSET_BPS[selection] / 10000n;
  // Calls go above ATM, puts go below ATM for OTM positions.
  return isCall ? atm + offset : atm - offset;
}

/** Compute range width in bps from selection. */
function computeRangeWidthBps(selection: StrikeSelection): bigint {
  return OTM_RANGE_WIDTH_BPS[selection];
}

// ── House strategies ①②③ ─────────────────────────────────────────────────────

/**
 * Execute the house-strategy supply cycle for a single portfolio.
 *
 * Steps:
 *   a. update_nav — commits the computed nav_per_share on-chain
 *   b. take_for_supply → predict::supply → store_lp — supply DUSDC, receive PLP
 *
 * The hedge order is NOT included here; it's submitted after this TX confirms.
 */
export async function executeSupplyCycle(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  policyCapId: string,
  navPerShare: bigint,
  sizing: SizingResult,
): Promise<ExecuteResult> {
  const supplyAmount = sizing.size_raw;
  if (supplyAmount <= 0n) {
    throw new Error('executeSupplyCycle called with zero supply amount');
  }

  const tx = new Transaction();

  // 1. Push NAV per share so the deposit contract can price new shares correctly.
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::update_nav`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(navPerShare),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // 2. Take DUSDC from portfolio → supply to Predict → get PLP → store back.
  const dusdc_coin = tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::take_for_supply`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(supplyAmount),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  const plp_coin = tx.moveCall({
    target: `${PREDICT_PKG()}::predict::supply`,
    typeArguments: [DUSDC],
    arguments: [tx.object(PREDICT_OBJ()), dusdc_coin, tx.object(CLOCK_ID)],
  });

  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::store_lp`,
    typeArguments: [DUSDC, PLP_TYPE],
    arguments: [
      tx.object(portfolioId),
      plp_coin,
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `executeSupplyCycle(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`supply TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction?.digest ?? '';
  log.info(
    { digest, portfolioId, navPerShare: navPerShare.toString(), supplyAmount: supplyAmount.toString(),
      explorer: `${EXPLORER_URL}/${digest}` },
    'supply cycle executed',
  );

  return { tx_digest: digest, nav_pushed: navPerShare, supply_amount_raw: supplyAmount };
}

// ── Bettor strategies ⑤⑥ (mint_range) ────────────────────────────────────────

/**
 * Execute a range-option cycle for strategies ⑤ RANGE_ROLL and ⑥ VOL_TARGETED_RANGE.
 *
 * The range covers [lower_k, upper_k] in log-moneyness. For a neutral ATM range:
 *   lower_k = -RANGE_HALF_WIDTH_K  (below spot)
 *   upper_strike = forwardRaw * (1 + rangeWidthBps/10000)  (above ATM)
 * The payout is the full notional if BTC settles within the range.
 *
 * Default range: ±10% around ATM (rangeWidthBps = 1000).
 *
 * Flow:
 *   1. take_for_bettor → coin
 *   2. predict_manager::deposit(manager, coin)  — fund manager
 *   3. range_key::new(oracle_id, expiry, lower, upper) → RangeKey
 *   4. predict::mint_range(predict, manager, oracle, key, amount, clock, ctx) → void
 *   Settlement: read from DB, call settleRangePositions.
 */
export async function executeRangeCycle(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  policyCapId: string,
  managerId: string,
  oracleId: string,
  expiryMs: bigint,
  forwardRaw: bigint,
  navPerShare: bigint,
  sizing: SizingResult,
  strikeSelection: StrikeSelection = 'ATM',
): Promise<BettorExecuteResult> {
  const notional = sizing.size_raw;
  if (notional <= 0n) {
    throw new Error('executeRangeCycle called with zero notional');
  }

  const TICK = 1_000_000_000n;
  const rangeWidthBps = computeRangeWidthBps(strikeSelection);
  const lowerStrikeRaw = (forwardRaw * (10000n - rangeWidthBps) / 10000n / TICK) * TICK;
  const upperStrikeRaw = (forwardRaw * (10000n + rangeWidthBps) / 10000n / TICK) * TICK;

  const tx = new Transaction();

  // 1. Push NAV.
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::update_nav`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(navPerShare),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // 2. Take DUSDC from portfolio for the bet.
  const payment = tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::take_for_bettor`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(notional),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // 3. Deposit DUSDC into PredictManager (manager holds balance; mint debits it).
  tx.moveCall({
    target: `${PREDICT_PKG()}::predict_manager::deposit`,
    typeArguments: [DUSDC],
    arguments: [tx.object(managerId), payment],
  });

  // 4. Build RangeKey: range_key::new(oracle_id: ID, expiry: u64, lower: u64, upper: u64)
  const rangeKey = tx.moveCall({
    target: `${PREDICT_PKG()}::range_key::new`,
    typeArguments: [],
    arguments: [
      tx.pure.id(oracleId),
      tx.pure.u64(expiryMs),
      tx.pure.u64(lowerStrikeRaw),
      tx.pure.u64(upperStrikeRaw),
    ],
  });

  // 5. Mint range position — deducts cost from manager's internal balance; returns void.
  tx.moveCall({
    target: `${PREDICT_PKG()}::predict::mint_range`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(PREDICT_OBJ()),
      tx.object(managerId),
      tx.object(oracleId),
      rangeKey,
      tx.pure.u64(notional),  // amount = position size (same units as payout)
      tx.object(CLOCK_ID),
    ],
  });

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `executeRangeCycle(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`mint_range TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction?.digest ?? '';
  const marketKey = deriveRangeKey(oracleId, expiryMs, lowerStrikeRaw, upperStrikeRaw);

  log.info(
    { digest, portfolioId, oracleId, notional: notional.toString(),
      lowerStrikeRaw: lowerStrikeRaw.toString(), upperStrikeRaw: upperStrikeRaw.toString(),
      marketKey, explorer: `${EXPLORER_URL}/${digest}` },
    'range cycle executed',
  );

  return { tx_digest: digest, nav_pushed: navPerShare, notional_raw: notional, market_key: marketKey, oracle_id: oracleId };
}

// ── Bettor strategy ⑦ (binary mint) ─────────────────────────────────────────

/**
 * Execute a binary option cycle for strategy ⑦ CROSS_VENUE_ARB.
 *
 * Mints an ATM call or put binary on Predict. The vol-arb signal determines
 * whether to sell a call or put (sell-vol view: sell whichever is implied richest).
 *
 * Default: ATM call (isCall=true, strike = forward rounded to $1 tick).
 *
 * Flow:
 *   1. take_for_bettor → coin
 *   2. predict_manager::deposit(manager, coin)  — fund manager
 *   3. market_key::up/down(oracle_id, expiry, strike) → MarketKey
 *   4. predict::mint(predict, manager, oracle, key, amount, clock, ctx) → void
 */
export async function executeBinaryCycle(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  policyCapId: string,
  managerId: string,
  oracleId: string,
  expiryMs: bigint,
  forwardRaw: bigint,
  navPerShare: bigint,
  sizing: SizingResult,
  isCall: boolean = true,
  strikeSelection: StrikeSelection = 'ATM',
): Promise<BettorExecuteResult> {
  const notional = sizing.size_raw;
  if (notional <= 0n) {
    throw new Error('executeBinaryCycle called with zero notional');
  }

  const strikeRaw = computeBinaryStrike(forwardRaw, strikeSelection, isCall);

  const tx = new Transaction();

  // 1. Push NAV.
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::update_nav`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(navPerShare),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // 2. Take DUSDC from portfolio for the bet.
  const payment = tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::take_for_bettor`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(notional),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // 3. Deposit DUSDC into PredictManager.
  tx.moveCall({
    target: `${PREDICT_PKG()}::predict_manager::deposit`,
    typeArguments: [DUSDC],
    arguments: [tx.object(managerId), payment],
  });

  // 4. Build MarketKey: market_key::up/down(oracle_id: ID, expiry: u64, strike: u64)
  const marketKeyObj = tx.moveCall({
    target: `${PREDICT_PKG()}::market_key::${isCall ? 'up' : 'down'}`,
    typeArguments: [],
    arguments: [
      tx.pure.id(oracleId),
      tx.pure.u64(expiryMs),
      tx.pure.u64(strikeRaw),
    ],
  });

  // 5. Mint binary position — debits cost from manager's internal balance; returns void.
  tx.moveCall({
    target: `${PREDICT_PKG()}::predict::mint`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(PREDICT_OBJ()),
      tx.object(managerId),
      tx.object(oracleId),
      marketKeyObj,
      tx.pure.u64(notional),  // amount = position size
      tx.object(CLOCK_ID),
    ],
  });

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `executeBinaryCycle(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`mint TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction?.digest ?? '';
  const marketKey = deriveBinaryKey(oracleId, expiryMs, strikeRaw, isCall);

  log.info(
    { digest, portfolioId, oracleId, isCall, strikeRaw: strikeRaw.toString(),
      notional: notional.toString(), marketKey, explorer: `${EXPLORER_URL}/${digest}` },
    'binary cycle executed',
  );

  return { tx_digest: digest, nav_pushed: navPerShare, notional_raw: notional, market_key: marketKey, oracle_id: oracleId };
}

// ── House strategy ④ (principal-protected) ────────────────────────────────────

export interface PrincipalProtectedExecuteResult {
  tx_digest: string;
  nav_pushed: bigint;
  yield_claimed_raw: bigint;
  bet_notional_raw: bigint;
  market_key: string;
  oracle_id: string;
}

/**
 * Execute a principal-protected yield bet cycle for strategy ④.
 *
 * Steps:
 *   a. update_nav
 *   b. claim_yield_from_lending — accrues yield from MockLending
 *   c. keeper transfers `yield_amount` DUSDC to portfolio via store_quote
 *      (testnet: keeper owns DUSDC; mainnet: IronBank pays directly)
 *   d. take_yield_for_bet — pull the yield DUSDC back out for betting
 *   e. predict::mint_range — bet the yield on a range option
 *   f. record_bet_settlement — happens next cycle on settlement
 *
 * Principal NEVER touches Predict. Enforced at the Move level by available_balance().
 *
 * The keeper's DUSDC balance is used to fund the yield injection (step c).
 * This simulates IronBank paying out yield on testnet.
 * The keeper must hold enough DUSDC for this — funded by the testing budget.
 */
export async function executePrincipalProtectedCycle(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  policyCapId: string,
  managerId: string,
  oracleId: string,
  expiryMs: bigint,
  forwardRaw: bigint,
  mockLendingId: string,
  navPerShare: bigint,
  keeperDusdcCoinId: string,  // keeper's DUSDC coin object to inject yield (testnet simulation)
  yieldAmountRaw: bigint,     // pre-computed yield to inject (from preview_yield)
): Promise<PrincipalProtectedExecuteResult> {
  if (yieldAmountRaw <= 0n) {
    throw new Error('executePrincipalProtectedCycle called with zero yield');
  }

  const TICK = 1_000_000_000n;
  const lowerStrikeRaw = (forwardRaw * 90n / 100n / TICK) * TICK;  // -10%
  const upperStrikeRaw = (forwardRaw * 110n / 100n / TICK) * TICK; // +10%

  const tx = new Transaction();

  // 1. Push NAV.
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::update_nav`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(navPerShare),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // 2. Claim yield from MockLending (updates last_claimed_ms in receipt).
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::claim_yield_from_lending`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.object(mockLendingId),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // 3. Keeper injects yield DUSDC into portfolio (simulates IronBank payout on testnet).
  const [yield_coin] = tx.splitCoins(
    tx.object(keeperDusdcCoinId),
    [tx.pure.u64(yieldAmountRaw)],
  );
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::store_quote`,
    typeArguments: [DUSDC],
    arguments: [tx.object(portfolioId), yield_coin],
  });

  // 4. Take yield DUSDC back out for betting (principal enforcement: only yield, never principal).
  const bet_coin = tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::take_yield_for_bet`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(yieldAmountRaw),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // 5. Fund manager with the yield coin.
  tx.moveCall({
    target: `${PREDICT_PKG()}::predict_manager::deposit`,
    typeArguments: [DUSDC],
    arguments: [tx.object(managerId), bet_coin],
  });

  // 6. Build RangeKey ±10% ATM for the yield bet.
  const rangeKey = tx.moveCall({
    target: `${PREDICT_PKG()}::range_key::new`,
    typeArguments: [],
    arguments: [
      tx.pure.id(oracleId),
      tx.pure.u64(expiryMs),
      tx.pure.u64(lowerStrikeRaw),
      tx.pure.u64(upperStrikeRaw),
    ],
  });

  // 7. Mint range — deducts cost from manager balance; returns void.
  tx.moveCall({
    target: `${PREDICT_PKG()}::predict::mint_range`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(PREDICT_OBJ()),
      tx.object(managerId),
      tx.object(oracleId),
      rangeKey,
      tx.pure.u64(yieldAmountRaw),
      tx.object(CLOCK_ID),
    ],
  });

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `executePrincipalProtectedCycle(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`principal-protected TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction?.digest ?? '';
  const marketKey = deriveRangeKey(oracleId, expiryMs, lowerStrikeRaw, upperStrikeRaw);

  log.info(
    { digest, portfolioId, oracleId, yieldAmountRaw: yieldAmountRaw.toString(),
      lowerStrikeRaw: lowerStrikeRaw.toString(), upperStrikeRaw: upperStrikeRaw.toString(),
      marketKey, explorer: `${EXPLORER_URL}/${digest}` },
    'principal-protected cycle executed',
  );

  return {
    tx_digest: digest,
    nav_pushed: navPerShare,
    yield_claimed_raw: yieldAmountRaw,
    bet_notional_raw: yieldAmountRaw,
    market_key: marketKey,
    oracle_id: oracleId,
  };
}

// ── Margin Loop (⑧ three-protocol composability) ─────────────────────────────

export interface MarginLoopSetupResult {
  tx_digest: string;
}

export interface MarginLoopCycleResult {
  tx_digest: string;
  nav_pushed: bigint;
  borrow_raw: bigint;
  market_key: string;
  oracle_id: string;
}

/**
 * First-time setup: enable_margin_loop on the portfolio.
 *
 * Call this once before the first MARGIN_LOOP cycle. It locks `collateral_amount`
 * DUSDC in the portfolio as margin collateral and initializes the MarginReceipt.
 * The margin borrow capacity = LTV × collateral (e.g. 75% × collateral).
 *
 * On testnet, also call admin_fast_forward_margin_interest to generate meaningful
 * interest for testing without waiting real time.
 */
export async function enableMarginLoopOnchain(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  policyCapId: string,
  mockMarginId: string,
  collateralAmountRaw: bigint,
): Promise<MarginLoopSetupResult> {
  const tx = new Transaction();

  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::enable_margin_loop`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.object(mockMarginId),
      tx.pure.u64(collateralAmountRaw),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `enableMarginLoop(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`enable_margin_loop TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }
  const tx_digest = result.Transaction!.digest;
  await client.core.waitForTransaction({ digest: tx_digest });

  log.info({ portfolioId, tx_digest, collateralAmountRaw }, 'margin loop enabled on-chain');
  return { tx_digest };
}

/**
 * Execute a MARGIN_LOOP cycle (strategy ⑧).
 *
 * Three-protocol composability: MockMargin + Predict.
 * Settlement of the prior range position is handled separately by settleRangePositions()
 * in the keeper loop's settle step — this PTB only handles borrow + deploy.
 *
 * PTB steps:
 *   a. update_nav
 *   b. (if repayAmountRaw > 0) repay_margin_borrow — repays prior borrow from settled payout
 *      already credited to quote_balance by the settle step
 *   c. take_for_margin_borrow → borrowed Coin<Q>
 *   d. predict::mint_range with borrowed coin → change Coin<Q>
 *   e. store_quote(change) — credit unused premium back to portfolio
 *
 * @param repayAmountRaw - amount to repay from prior cycle's payout (0 for first cycle)
 */
export async function executeMarginLoopCycle(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  policyCapId: string,
  managerId: string,
  mockMarginId: string,
  oracleId: string,
  expiryMs: bigint,
  forwardRaw: bigint,
  navPerShare: bigint,
  borrowAmountRaw: bigint,
  _priorMarketKey: string | null,      // unused: settlement runs separately
  _priorExpiryMs: bigint | null,       // unused
  _priorLowerStrikeRaw: bigint | null, // unused
  _priorUpperStrikeRaw: bigint | null, // unused
  repayAmountRaw: bigint,
  strikeSelection: StrikeSelection = 'ATM',
): Promise<MarginLoopCycleResult> {
  if (borrowAmountRaw <= 0n) {
    throw new Error('executeMarginLoopCycle: borrowAmountRaw must be > 0');
  }

  const TICK = 1_000_000_000n;

  // New range position: ATM ±10% / OTM_1 ±15% / OTM_2 ±20%
  const rangeHalfBps = strikeSelection === 'ATM' ? 10n : strikeSelection === 'OTM_1' ? 15n : 20n;
  const lowerStrikeRaw = (forwardRaw * (100n - rangeHalfBps) / 100n / TICK) * TICK;
  const upperStrikeRaw = (forwardRaw * (100n + rangeHalfBps) / 100n / TICK) * TICK;

  const tx = new Transaction();

  // (a) Update NAV
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::update_nav`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(navPerShare),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // (b) Repay prior borrow from settled payout already in quote_balance (skip if first cycle)
  if (repayAmountRaw > 0n) {
    tx.moveCall({
      target: `${SONARK_PKG()}::portfolio::repay_margin_borrow`,
      typeArguments: [DUSDC],
      arguments: [
        tx.object(portfolioId),
        tx.object(mockMarginId),
        tx.pure.u64(repayAmountRaw),
        tx.object(policyCapId),
        tx.object(CLOCK_ID),
      ],
    });
  }

  // (c) Borrow from margin for this cycle's Predict bet
  const borrowed = tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::take_for_margin_borrow`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.object(mockMarginId),
      tx.pure.u64(borrowAmountRaw),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  // (f) Mint range position using borrowed DUSDC
  const change = tx.moveCall({
    target: `${PREDICT_PKG()}::predict::mint_range`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(env.PREDICT_OBJECT),
      tx.object(managerId),
      tx.object(oracleId),
      tx.pure.u64(lowerStrikeRaw),
      tx.pure.u64(upperStrikeRaw),
      borrowed,
      tx.object(CLOCK_ID),
    ],
  });

  // (g) Store unused premium change back in portfolio
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::store_quote`,
    typeArguments: [DUSDC],
    arguments: [tx.object(portfolioId), change],
  });

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `executeMarginLoop(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`margin_loop cycle TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }
  const tx_digest = result.Transaction!.digest;
  await client.core.waitForTransaction({ digest: tx_digest });

  const marketKey = deriveRangeKey(oracleId, expiryMs, lowerStrikeRaw, upperStrikeRaw);

  log.info(
    { portfolioId, tx_digest, borrowAmountRaw, marketKey, EXPLORER_URL: `${EXPLORER_URL}/${tx_digest}` },
    'MARGIN_LOOP cycle complete',
  );

  return {
    tx_digest,
    nav_pushed: navPerShare,
    borrow_raw: borrowAmountRaw,
    market_key: marketKey,
    oracle_id: oracleId,
  };
}

// ── Nav-only push ────────────────────────────────────────────────────────────

/**
 * Push updated NAV without supplying (e.g. when entry guard fires skip).
 * Keeps the on-chain NAV fresh so deposits can proceed.
 */
export async function pushNavOnly(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  portfolioId: string,
  policyCapId: string,
  navPerShare: bigint,
): Promise<string> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${SONARK_PKG()}::portfolio::update_nav`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.pure.u64(navPerShare),
      tx.object(policyCapId),
      tx.object(CLOCK_ID),
    ],
  });

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `pushNavOnly(${portfolioId.slice(0, 8)}...)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`update_nav TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }
  return result.Transaction?.digest ?? '';
}

// ── Market key derivation ────────────────────────────────────────────────────
// These must match how the Predict contract encodes position keys.
// If the contract uses a different encoding, update these functions.

/**
 * Derive a stable DB key for a range position.
 * Format: "range|{oracle_id}|{expiry_ms}|{lower_strike_raw}|{upper_strike_raw}"
 * Used to reconstruct the on-chain RangeKey struct at settlement time.
 */
export function deriveRangeKey(oracleId: string, expiryMs: bigint, lowerStrikeRaw: bigint, upperStrikeRaw: bigint): string {
  return `range|${oracleId}|${expiryMs}|${lowerStrikeRaw}|${upperStrikeRaw}`;
}

/**
 * Derive a stable DB key for a binary position.
 * Format: "binary|{oracle_id}|{expiry_ms}|{strike_raw}|{call/put}"
 * Used to reconstruct the on-chain MarketKey struct at settlement time.
 */
export function deriveBinaryKey(oracleId: string, expiryMs: bigint, strikeRaw: bigint, isCall: boolean): string {
  return `binary|${oracleId}|${expiryMs}|${strikeRaw}|${isCall ? 'call' : 'put'}`;
}

// ── PredictManager creation ──────────────────────────────────────────────────

/**
 * Create a PredictManager for a bettor-strategy portfolio.
 *
 * Bettor strategies (⑤⑥⑦④) need a PredictManager to hold binary/range positions.
 * House strategies (①②③) do not use a PredictManager.
 *
 * VERIFY: predict::create_manager signature. Inferred as:
 *   create_manager(predict, clock, ctx) — creates a shared PredictManager object
 *
 * After this TX, read the new shared object ID from effects.changedObjects
 * and store it in portfolio.managerId.
 */
export async function createPredictManager(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
): Promise<string> {
  const tx = new Transaction();

  // create_manager(ctx: &mut TxContext) → ID  — ctx is implicit in PTBs
  tx.moveCall({
    target: `${PREDICT_PKG()}::predict::create_manager`,
    typeArguments: [],
    arguments: [],
  });

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    'createPredictManager',
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`create_manager TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  // Extract the newly created shared PredictManager object ID.
  const effects = result.Transaction?.effects;
  if (!effects) throw new Error('no effects in create_manager result');

  const digest = result.Transaction?.digest ?? '';
  await client.core.waitForTransaction({ digest });

  for (const obj of (effects as { changedObjects?: Array<{ idOperation?: string; objectId: string; outputOwner?: { $kind?: string } }> }).changedObjects ?? []) {
    if (obj.idOperation === 'Created' && obj.outputOwner?.$kind === 'Shared') {
      log.info({ managerId: obj.objectId }, 'PredictManager created');
      return obj.objectId;
    }
  }

  throw new Error('PredictManager shared object not found in TX effects');
}
