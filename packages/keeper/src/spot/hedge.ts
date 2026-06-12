/**
 * DeepBook Spot hedge execution for Strategy ② Hedged-PLP.
 *
 * Uses DeepBook v3 BalanceManager to place market orders on the DBTC/DBUSDC pool.
 *
 * Required setup (run once):
 *   pnpm --filter @sonarkk/keeper run setup
 *   → Creates a BalanceManager, stores address in DEEPBOOK_BALANCE_MANAGER env var.
 *
 * Hedge direction (from delta.ts + hedge.ts):
 *   house_net_delta < 0 (more calls written) → house SHORT delta → hedge LONG (buy DBTC)
 *   house_net_delta > 0 (more puts written)  → house LONG delta  → hedge SHORT (sell DBTC)
 *
 * The keeper's wallet must hold sufficient DBUSDC (for long hedge) or DBTC (for short hedge).
 * On testnet, use the DeepBook faucet or mint DBUSDC from the testnet coin contract.
 *
 * Token scalars (from deepbook-v3 testnetCoins):
 *   DBTC  scalar = 1e8  (8 decimals)
 *   DBUSDC scalar = 1e6  (6 decimals, same as DUSDC)
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { DeepBookClient, DeepBookConfig, testnetCoins, testnetPools } from '@mysten/deepbook-v3';
import type { HedgeOrder } from '@sonarkk/core';
import { env, EXPLORER_URL } from '../env.js';
import { log } from '../logger.js';
import { withRetry } from '../util/retry.js';
import { computeCoverageRatio } from '../math/hedge-budget.js';

// DeepBook testnet pool and coin constants.
const POOL_KEY = 'DBTC_DBUSDC';
const DBTC_SCALAR  = testnetCoins['DBTC']!.scalar;   // 1e8
const DBUSDC_SCALAR = testnetCoins['DBUSDC']!.scalar; // 1e6

// Minimum DBTC order size (1 satoshi = 1e-8 BTC) to avoid dust orders.
const MIN_DBTC_ORDER = 1 / DBTC_SCALAR; // 0.00000001 DBTC

export interface HedgeExecutionResult {
  tx_digest: string;
  order_direction: 'long' | 'short';
  order_size_dbtc: number;
  notional_dbusdc: number;
  ideal_notional_dusdc: number;
  coverage_ratio_pct: number;
  is_partial: boolean;
}

/**
 * Execute the spot hedge order on DeepBook DBTC/DBUSDC.
 *
 * The hedge PTB is separate from the supply PTB because DeepBook's
 * coinWithBalance() scans the sender's wallet for the required coin type,
 * and mixing Predict + DeepBook calls in one PTB can conflict on object IDs.
 */
export async function executeSpotHedge(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
  order: HedgeOrder,
  ideal_notional_dusdc: number,
): Promise<HedgeExecutionResult> {
  if (order.skipped || order.direction === 'none') {
    throw new Error('executeSpotHedge called with a skipped/no-hedge order');
  }
  if (order.size_dbtc < MIN_DBTC_ORDER) {
    throw new Error(`order too small: ${order.size_dbtc} DBTC (min ${MIN_DBTC_ORDER})`);
  }

  const managerAddress = env.DEEPBOOK_BALANCE_MANAGER;
  if (!managerAddress) {
    throw new Error(
      'DEEPBOOK_BALANCE_MANAGER is not set. Run: pnpm --filter @sonarkk/keeper run setup',
    );
  }

  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  const dbClient = new DeepBookClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    network: 'testnet',
    address: keeperAddress,
    balanceManagers: {
      KEEPER: { address: managerAddress },
    },
    coins: testnetCoins,
    pools: testnetPools,
  });

  // DBTC quantity in base units (8 decimals).
  const dbtc_quantity_raw = Math.floor(order.size_dbtc * DBTC_SCALAR);
  // DBUSDC to deposit = hedge notional (DUSDC ≈ DBUSDC on testnet, both ~$1 stablecoins).
  const dbusdc_deposit_raw = Math.floor(order.notional_dusdc * DBUSDC_SCALAR);

  const isBid = order.direction === 'long'; // bid = buy DBTC with DBUSDC
  const clientOrderId = String(Date.now()); // unique per order

  log.info(
    {
      direction: order.direction,
      size_dbtc: order.size_dbtc,
      notional_dusdc: order.notional_dusdc,
      ideal_notional_dusdc,
      is_partial: order.is_partial,
      shortfall_dusdc: order.shortfall_dusdc,
    },
    'building hedge PTB',
  );

  const tx = new Transaction();

  // 1. Deposit the required quote (DBUSDC) or base (DBTC) into the BalanceManager.
  //    The coinWithBalance utility finds the right coins in the sender's wallet.
  if (isBid) {
    // Long hedge: buy DBTC → deposit DBUSDC into manager.
    dbClient.balanceManager.depositIntoManager('KEEPER', 'DBUSDC', dbusdc_deposit_raw)(tx);
  } else {
    // Short hedge: sell DBTC → deposit DBTC into manager.
    const dbtc_deposit_raw = Math.floor(order.size_dbtc * DBTC_SCALAR);
    dbClient.balanceManager.depositIntoManager('KEEPER', 'DBTC', dbtc_deposit_raw)(tx);
  }

  // 2. Place market order.
  dbClient.deepBook.placeMarketOrder({
    poolKey: POOL_KEY,
    balanceManagerKey: 'KEEPER',
    clientOrderId,
    quantity: dbtc_quantity_raw,
    isBid,
    payWithDeep: false, // fees come from the traded asset
  })(tx);

  // 3. Withdraw remaining balance back to keeper wallet.
  //    After a market order, unspent balance stays in the manager; withdraw it.
  if (isBid) {
    dbClient.balanceManager.withdrawAllFromManager('KEEPER', 'DBUSDC', keeperAddress)(tx);
    dbClient.balanceManager.withdrawAllFromManager('KEEPER', 'DBTC',   keeperAddress)(tx);
  } else {
    dbClient.balanceManager.withdrawAllFromManager('KEEPER', 'DBTC',   keeperAddress)(tx);
    dbClient.balanceManager.withdrawAllFromManager('KEEPER', 'DBUSDC', keeperAddress)(tx);
  }

  const result = await withRetry(
    () => client.core.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      include: { effects: true },
    }),
    `executeSpotHedge(${order.direction} ${order.size_dbtc.toFixed(8)} DBTC)`,
  );

  if (result.$kind === 'FailedTransaction') {
    throw new Error(`hedge TX failed: ${JSON.stringify(result.FailedTransaction?.status)}`);
  }

  const digest = result.Transaction?.digest ?? '';
  const coverage_ratio_pct = computeCoverageRatio(ideal_notional_dusdc, order.notional_dusdc);

  log.info(
    {
      notify: true,
      digest,
      direction: order.direction,
      size_dbtc: order.size_dbtc,
      notional_dusdc: order.notional_dusdc,
      ideal_notional_dusdc,
      coverage_ratio_pct,
      is_partial: order.is_partial,
      explorer: `${EXPLORER_URL}/${digest}`,
    },
    'hedge coverage this cycle',
  );

  return {
    tx_digest: digest,
    order_direction: order.direction,
    order_size_dbtc: order.size_dbtc,
    notional_dbusdc: order.notional_dusdc,
    ideal_notional_dusdc,
    coverage_ratio_pct,
    is_partial: order.is_partial,
  };
}
