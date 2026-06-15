/**
 * Main keeper loop — one idempotent worker per expiry cycle.
 *
 * Per-cycle flow:
 *   1. Fetch recently-settled oracles from predict-server
 *   2. For each settled oracle not yet fully processed:
 *      a. Load all active portfolios from DB
 *      b. For each portfolio:
 *         i.   IDEMPOTENCY CHECK — already done this (portfolio + expiry)?
 *         ii.  POLICY CHECK — cap valid / not revoked / budget remaining?
 *         iii. SETTLE prior positions (binary or range, from OpenPosition table)
 *         iv.  ENTRY GUARD — shouldSkipExpiry?
 *         v.   COMPUTE NAV + sizing + hedge inputs (Phase 3 math)
 *         vi.  EXECUTE per strategy:
 *              ①②③ → executeSupplyCycle  (+ hedge for ②③)
 *              ④   → executePrincipalProtectedCycle
 *              ⑤⑥  → executeRangeCycle
 *              ⑦   → executeBinaryCycle
 *         vii. STORE new open positions (for bettor strategies)
 *         viii.RECORD cycle result to DB
 *   3. Sleep KEEPER_POLL_INTERVAL_MS → repeat
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  fetchPredictVaultState,
  computeNav,
  shouldSkipExpiry,
  computeHouseNetDelta,
  computeHouseNetDeltaSynthetic,
  computeHedgeOrder,
  sizePlpSupplier,
  sizeHedgedPlp,
  sizeSmartVault,
  sizePrincipalProtected,
  sizeRangeRoll,
  sizeVolTargetedRange,
  sizeVolArb,
  sviW,
} from '@sonarkk/core';

import { fetchRecentlySettledOracles, fetchOracleState, fetchBestActiveOracleState } from './chain/oracle.js';
import type { OracleState } from './chain/oracle.js';
import { readPortfolioChainState, readManagerId } from './chain/portfolio.js';
import { readPredictManagerPositions } from './chain/predict-manager.js';
import { checkPolicyCap } from './chain/policy.js';
import { settleBinaryPositions, settleRangePositions } from './chain/settle.js';
import {
  executeSupplyCycle,
  executeRangeCycle,
  executeBinaryCycle,
  executePrincipalProtectedCycle,
  pushNavOnly,
} from './chain/execute.js';
import { executeSpotHedge } from './spot/hedge.js';
import { computeHedgeBudget } from './math/hedge-budget.js';
import { computeBettorMtm } from './math/bettor-mtm.js';
import { computeVolArbSignal } from './math/vol-arb-feed.js';
import { notifyOnAction } from './notify.js';
import { log } from './logger.js';
import { env, CLOCK_ID, EXPLORER_URL } from './env.js';
import { getPrismaClient } from '@sonarkk/core';
import { STRATEGY_TYPE_MAP } from './loop-types.js';

// ── Constants ───────────────────────────────────────────────────────────────

const DUSDC = env.DUSDC_TYPE;
const PREDICT_OBJ = env.PREDICT_OBJECT;
const SONARK_PKG = env.SONARK_PACKAGE;

// Minimum yield to deploy for strategy ④ (saves gas on tiny yields).
const MIN_YIELD_TO_BET_RAW = 10_000n; // 0.01 DUSDC

// ── Per-oracle cycle ────────────────────────────────────────────────────────

interface OracleCycleInput {
  oracle_id: string;
  expiry_ms: number;
  settlement_price: number | null;
  client: SuiGrpcClient;
  keypair: Ed25519Keypair;
}

export async function runOracleCycle(input: OracleCycleInput): Promise<void> {
  const { oracle_id, expiry_ms, client, keypair } = input;
  const prisma = getPrismaClient();
  const keeperAddress = keypair.getPublicKey().toSuiAddress();

  log.info({ oracle_id, expiry_ms }, 'starting oracle cycle');

  // Read oracle SVI + prices once per cycle (shared across all portfolios).
  let oracleState;
  try {
    oracleState = await fetchOracleState(client, oracle_id, expiry_ms, input.settlement_price);
  } catch (err) {
    log.error({ oracle_id, err }, 'oracle state read failed, aborting cycle');
    return;
  }

  // Fetch the current active oracle for entry guard + hedge calculations.
  let activeOracleState: OracleState | null = null;
  try {
    activeOracleState = await fetchBestActiveOracleState(client);
    log.info(
      { active_oracle: activeOracleState?.oracle_id?.slice(0, 10), t_years: activeOracleState?.t_years },
      'active oracle for entry guard',
    );
  } catch (err) {
    log.warn({ err }, 'fetchBestActiveOracleState failed — will skip entry for this cycle');
  }

  // Read Predict vault state once per cycle.
  let vaultState;
  try {
    vaultState = await fetchPredictVaultState(client.core, PREDICT_OBJ);
  } catch (err) {
    log.error({ err }, 'predict vault state read failed, aborting cycle');
    return;
  }

  // Fetch all active portfolios from DB.
  const portfolios = await prisma.portfolio.findMany({ where: { isActive: true } });
  log.info({ count: portfolios.length, oracle_id }, 'processing portfolios');

  for (const portfolio of portfolios) {
    await processPortfolio({
      portfolio,
      oracle_id,
      expiry_ms,
      oracleState,
      activeOracleState,
      vaultState,
      client,
      keypair,
      keeperAddress,
    }).catch((err) => {
      log.error({ portfolioId: portfolio.id, oracle_id, err }, 'portfolio cycle failed');
      notifyOnAction({
        kind: 'error',
        portfolioId: portfolio.id,
        oracleId: oracle_id,
        expiryMs: BigInt(expiry_ms),
        detail: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

// ── Per-portfolio processing ────────────────────────────────────────────────

interface PortfolioInput {
  portfolio: {
    id: string;
    objectId: string;
    policyCapId: string;
    strategy: string;
    hedgeMultiplier: number;
    managerId: string | null;
  };
  oracle_id: string;
  expiry_ms: number;
  oracleState: Awaited<ReturnType<typeof fetchOracleState>>;
  activeOracleState: OracleState | null;
  vaultState: { vault_value_raw: bigint; plp_total_supply_raw: bigint; total_max_payout_raw: bigint; total_mtm_raw: bigint };
  client: SuiGrpcClient;
  keypair: Ed25519Keypair;
  keeperAddress: string;
}

async function processPortfolio(input: PortfolioInput): Promise<void> {
  const { portfolio, oracle_id, expiry_ms, activeOracleState, vaultState, client, keypair, keeperAddress } = input;
  const { objectId: portfolioId, policyCapId } = portfolio;
  const prisma = getPrismaClient();
  const expiryBigInt = BigInt(expiry_ms);

  // ── (a) IDEMPOTENCY CHECK ─────────────────────────────────────────────────
  const existing = await prisma.keeperCycle.findUnique({
    where: { portfolioId_expiryMs: { portfolioId: portfolio.id, expiryMs: expiryBigInt } },
  });
  if (existing) {
    log.info({ portfolioId: portfolio.id, oracle_id, status: existing.status },
      'idempotency: cycle already recorded, skipping');
    return;
  }

  // ── (b) POLICY CHECK ──────────────────────────────────────────────────────
  const policyCheck = await checkPolicyCap(client, policyCapId, portfolioId);
  if (!policyCheck.valid) {
    log.warn({ portfolioId, policyCapId, reason: policyCheck.reason }, 'policy invalid, skipping');
    notifyOnAction({ kind: 'skip', portfolioId: portfolio.id, oracleId: oracle_id,
      expiryMs: expiryBigInt, detail: `policy_check_failed: ${policyCheck.reason}` });
    await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped',
      `policy_check_failed: ${policyCheck.reason}`);
    if (policyCheck.reason === 'revoked') {
      await prisma.portfolio.update({ where: { id: portfolio.id }, data: { isActive: false } });
    }
    return;
  }

  // ── (c) READ PORTFOLIO STATE ──────────────────────────────────────────────
  let chainState;
  try {
    chainState = await readPortfolioChainState(client, portfolioId, keeperAddress);
  } catch (err) {
    log.error({ portfolioId, err }, 'portfolio chain state read failed');
    await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'error',
      `chain_state_read_failed: ${String(err)}`);
    return;
  }
  if (chainState.paused) {
    log.info({ portfolioId }, 'portfolio is paused, skipping');
    await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped', 'portfolio_paused');
    return;
  }

  // ── (d) SETTLE PRIOR POSITIONS ────────────────────────────────────────────
  // Read managerId from DB (set when portfolio was deployed for bettor strategies).
  // Falls back to on-chain read if DB doesn't have it yet.
  const managerId = portfolio.managerId ?? await readManagerId(client, portfolioId);
  let settleTxDigest: string | null = null;

  if (managerId) {
    try {
      // Read open positions from DB for this portfolio.
      type OpenPos = { id: string; positionType: string; marketKey: string; quantityRaw: bigint };
      const openPositions: OpenPos[] = await prisma.openPosition.findMany({
        where: { portfolioId: portfolio.id, settledAt: null, expiryMs: { lte: expiryBigInt } },
      });
      const binaryPositions = openPositions.filter((p: OpenPos) => p.positionType === 'binary');
      const rangePositions  = openPositions.filter((p: OpenPos) => p.positionType === 'range');

      if (binaryPositions.length > 0) {
        const settleResult = await settleBinaryPositions(
          client, keypair, portfolioId, managerId, oracle_id,
          binaryPositions.map((p: OpenPos) => p.marketKey),
          binaryPositions.map((p: OpenPos) => p.quantityRaw),
        );
        settleTxDigest = settleResult.tx_digest;
        // Mark as settled.
        await prisma.openPosition.updateMany({
          where: { id: { in: binaryPositions.map((p: OpenPos) => p.id) } },
          data: { settledAt: new Date() },
        });
      }

      if (rangePositions.length > 0) {
        const settleResult = await settleRangePositions(
          client, keypair, portfolioId, managerId, oracle_id,
          rangePositions.map((p: OpenPos) => p.marketKey),
          rangePositions.map((p: OpenPos) => p.quantityRaw),
        );
        settleTxDigest = settleResult.tx_digest ?? settleTxDigest;
        await prisma.openPosition.updateMany({
          where: { id: { in: rangePositions.map((p: OpenPos) => p.id) } },
          data: { settledAt: new Date() },
        });
      }
    } catch (err) {
      log.warn({ portfolioId, err }, 'settle step failed, continuing to entry guard');
    }
  }

  // Re-read chain state after settlement.
  chainState = await readPortfolioChainState(client, portfolioId, keeperAddress);

  // ── (e) ENTRY GUARD ───────────────────────────────────────────────────────
  const strategyId = STRATEGY_TYPE_MAP[portfolio.strategy];
  if (!strategyId) {
    log.warn({ portfolioId, strategy: portfolio.strategy }, 'unknown strategy type, skipping');
    await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped', 'unknown_strategy');
    return;
  }

  if (!activeOracleState) {
    log.info({ portfolioId }, 'no active oracle available — settle only, skip entry');
    await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped', 'no_active_oracle',
      { settleTxDigest });
    return;
  }

  const utilization = vaultState.vault_value_raw > 0n
    ? Number(vaultState.total_max_payout_raw) / Number(vaultState.vault_value_raw)
    : 0;
  const clampedUtil = Math.max(0, Math.min(1, utilization));

  const guardResult = shouldSkipExpiry(
    activeOracleState.svi,
    activeOracleState.t_years,
    clampedUtil,
    strategyId,
  );

  // ── (f) COMPUTE NAV ───────────────────────────────────────────────────────
  const { vault_value_raw, plp_total_supply_raw } = vaultState;

  // Fetch open bettor positions from DB for MTM computation.
  const openPositionsForMtm = await prisma.openPosition.findMany({
    where: { portfolioId: portfolio.id, settledAt: null },
  });
  const bettorMtm = await computeBettorMtm(
    client, keeperAddress, managerId ?? '', oracle_id,
    openPositionsForMtm.map((p: { marketKey: string; quantityRaw: bigint; positionType: string }) => ({
      key: p.marketKey,
      quantity_raw: p.quantityRaw,
      position_type: p.positionType as 'binary' | 'range',
    })),
  );

  const navComponents = await computeNav(client.core, {
    portfolio_id: portfolioId,
    predict_id: PREDICT_OBJ,
    sonark_package: SONARK_PKG,
    predict_package: env.PREDICT_PACKAGE,
    dusdc_type: DUSDC,
    plp_type: `${env.PREDICT_PACKAGE}::plp::PLP`,
    sender: keeperAddress,
    open_bettor_positions: [],
    locked_principal_raw: chainState.locked_principal_raw,
    yield_accumulated_raw: chainState.yield_accumulated_raw,
    vault_value_raw,
    plp_total_supply_raw,
  });

  log.info({
    portfolioId,
    nav_per_share: navComponents.nav_per_share.toString(),
    quote_balance: navComponents.quote_balance_raw.toString(),
    lp_value: navComponents.lp_value_raw.toString(),
    bettor_mtm: bettorMtm.toString(),
    total_nav: navComponents.total_nav_raw.toString(),
  }, 'NAV computed');

  if (guardResult.skip) {
    log.info({ portfolioId, reason: guardResult.reason, atmVol: guardResult.atm_vol },
      'entry guard: skip this expiry');
    notifyOnAction({ kind: 'skip', portfolioId: portfolio.id, oracleId: oracle_id,
      expiryMs: expiryBigInt, ...(guardResult.reason !== undefined ? { detail: guardResult.reason } : {}) });
    try {
      const navTx = await pushNavOnly(client, keypair, portfolioId, policyCapId, navComponents.nav_per_share);
      notifyOnAction({ kind: 'nav_update', portfolioId: portfolio.id, oracleId: oracle_id,
        expiryMs: expiryBigInt, txDigest: navTx });
      await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped', guardResult.reason ?? null, {
        settleTxDigest, navPerShareBefore: chainState.nav_per_share,
        navPerShareAfter: navComponents.nav_per_share, atmVol: guardResult.atm_vol,
        atmSpread: guardResult.atm_spread, entryGuardSkipped: true,
        vaultValueRaw: vault_value_raw, plpTotalSupplyRaw: plp_total_supply_raw,
        quoteBalanceRaw: navComponents.quote_balance_raw, lpBalanceRaw: navComponents.lp_balance_raw,
        bettorMtmRaw: bettorMtm, totalNavRaw: navComponents.total_nav_raw,
      });
    } catch (err) {
      log.warn({ portfolioId, err }, 'nav push on skip failed');
      await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped', guardResult.reason ?? null);
    }
    return;
  }

  const policyBudgetRaw = policyCheck.state.budget_remaining;

  // ── (g) EXECUTE per strategy ──────────────────────────────────────────────
  let supplyTxDigest: string | null = null;
  let hedgeTxDigest: string | null = null;
  let hedgeDirection: string | null = null;
  let hedgeSizeDbtc: number | null = null;
  let hedgeNotionalDusdc: number | null = null;
  let idealHedgeNotional: number | null = null;
  let coverageRatioPct: number | null = null;
  let isPartialHedge = false;
  let hedgeBudgetDusdc: number | null = null;
  let deltaSource: string | null = null;
  let newPositionKey: string | null = null;
  let newPositionType: 'binary' | 'range' | null = null;
  let newNotionalRaw: bigint | null = null;

  try {
    if (portfolio.strategy === 'PLP_SUPPLIER') {
      // ① PLP Supplier
      const sizing = sizePlpSupplier(navComponents.available_balance_raw, policyBudgetRaw);
      if (sizing.skip_reason) {
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, sizing.skip_reason,
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }
      const execResult = await executeSupplyCycle(
        client, keypair, portfolioId, policyCapId, navComponents.nav_per_share, sizing);
      supplyTxDigest = execResult.tx_digest;
      notifyOnAction({ kind: 'supply', portfolioId: portfolio.id, oracleId: oracle_id,
        expiryMs: expiryBigInt, txDigest: supplyTxDigest, detail: `supply ${sizing.size_raw}` });

    } else if (portfolio.strategy === 'HEDGED_PLP' || portfolio.strategy === 'SMART_VAULT') {
      // ② Hedged-PLP  ③ Smart Vault (supply leg + hedge)
      const sizing = portfolio.strategy === 'HEDGED_PLP'
        ? sizeHedgedPlp(navComponents.available_balance_raw, policyBudgetRaw)
        : sizeSmartVault(navComponents.available_balance_raw, policyBudgetRaw).hedged_plp;
      if (sizing.skip_reason) {
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, sizing.skip_reason,
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }

      const execResult = await executeSupplyCycle(
        client, keypair, portfolioId, policyCapId, navComponents.nav_per_share, sizing);
      supplyTxDigest = execResult.tx_digest;
      notifyOnAction({ kind: 'supply', portfolioId: portfolio.id, oracleId: oracle_id,
        expiryMs: expiryBigInt, txDigest: supplyTxDigest });

      // Hedge
      const { hedge_budget_raw, is_cap_constrained } = computeHedgeBudget(
        navComponents.lp_value_raw, portfolio.hedgeMultiplier, navComponents.available_balance_raw);
      hedgeBudgetDusdc = Number(hedge_budget_raw) / 1e6;

      const managerPositions = await readPredictManagerPositions(client, managerId, oracle_id);
      deltaSource = 'positions';

      let houseNetDelta: number;
      if (managerPositions.length > 0) {
        houseNetDelta = computeHouseNetDelta(activeOracleState.svi, activeOracleState.spot, managerPositions);
      } else {
        const total_lp_dusdc = Number(navComponents.lp_value_raw) / 1e6;
        if (vaultState.total_max_payout_raw > 0n && total_lp_dusdc > 0) {
          const atm_vol_sqrt_t = Math.sqrt(Math.max(sviW(activeOracleState.svi, 0), 1e-10));
          houseNetDelta = computeHouseNetDeltaSynthetic(
            activeOracleState.svi, activeOracleState.spot, atm_vol_sqrt_t,
            [-2, -1, 0, 1, 2], [0.10, 0.25, 0.30, 0.25, 0.10], 0.55, total_lp_dusdc,
          );
        } else {
          houseNetDelta = 0;
        }
      }

      const hedgeOrder = computeHedgeOrder({
        house_net_delta: houseNetDelta,
        spot_price_usd: activeOracleState.spot,
        t_years: activeOracleState.t_years,
        budget_remaining_dusdc: Number(hedge_budget_raw) / 1e6,
      });
      idealHedgeNotional = Math.abs(houseNetDelta) * activeOracleState.spot;

      log.info({ portfolioId, house_net_delta: houseNetDelta, hedge_direction: hedgeOrder.direction,
        size_dbtc: hedgeOrder.size_dbtc, is_cap_constrained, deltaSource }, 'hedge inputs computed');

      if (!hedgeOrder.skipped && hedgeOrder.direction !== 'none' && env.DEEPBOOK_BALANCE_MANAGER) {
        try {
          const hedgeResult = await executeSpotHedge(client, keypair, hedgeOrder, idealHedgeNotional);
          hedgeTxDigest = hedgeResult.tx_digest;
          hedgeDirection = hedgeResult.order_direction;
          hedgeSizeDbtc = hedgeResult.order_size_dbtc;
          hedgeNotionalDusdc = hedgeResult.notional_dbusdc;
          coverageRatioPct = hedgeResult.coverage_ratio_pct;
          isPartialHedge = hedgeResult.is_partial;
          notifyOnAction({ kind: 'hedge', portfolioId: portfolio.id, oracleId: oracle_id,
            expiryMs: expiryBigInt, txDigest: hedgeTxDigest,
            detail: `${hedgeDirection} ${hedgeSizeDbtc?.toFixed(8)} DBTC, coverage ${coverageRatioPct?.toFixed(1)}%`,
            coverageRatioPct: coverageRatioPct ?? undefined });
        } catch (err) {
          log.warn({ portfolioId, err }, 'hedge execution failed — supply already done');
          hedgeDirection = hedgeOrder.direction;
          coverageRatioPct = 0;
        }
      } else if (hedgeOrder.skipped) {
        log.info({ portfolioId, reason: hedgeOrder.skip_reason }, 'hedge skipped');
        coverageRatioPct = 0;
      } else if (!env.DEEPBOOK_BALANCE_MANAGER) {
        log.warn({ portfolioId }, 'DEEPBOOK_BALANCE_MANAGER not set — hedge skipped');
        coverageRatioPct = 0;
      }

    } else if (portfolio.strategy === 'PRINCIPAL_PROTECTED') {
      // ④ Principal-Protected
      if (!env.MOCK_LENDING_ID) {
        log.warn({ portfolioId }, 'MOCK_LENDING_ID not set — skipping principal-protected cycle');
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, 'no_mock_lending_id',
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }
      if (!managerId) {
        log.warn({ portfolioId }, 'no managerId for PRINCIPAL_PROTECTED — skipping');
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, 'no_manager_id',
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }

      // Preview yield via DevInspect to know how much to inject.
      const yieldRaw = await previewPortfolioYield(
        client, keeperAddress, portfolioId, env.MOCK_LENDING_ID);
      if (yieldRaw < MIN_YIELD_TO_BET_RAW) {
        log.info({ portfolioId, yieldRaw }, 'yield too small to bet — skipping');
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, 'yield_too_small',
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }

      const sizing = sizePrincipalProtected(yieldRaw, policyBudgetRaw);
      if (sizing.skip_reason) {
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, sizing.skip_reason,
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }

      // Find keeper's DUSDC coin for yield injection.
      const keeperCoins = await client.core.listCoins({ owner: keeperAddress, coinType: DUSDC });
      const dusdcCoin = keeperCoins.objects.find(c => BigInt(c.balance) >= sizing.size_raw);
      if (!dusdcCoin) {
        log.warn({ portfolioId, need: sizing.size_raw }, 'keeper has insufficient DUSDC for yield injection');
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, 'keeper_insufficient_dusdc',
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }

      const ppResult = await executePrincipalProtectedCycle(
        client, keypair, portfolioId, policyCapId, managerId, oracle_id,
        BigInt(activeOracleState.expiry_ms), activeOracleState.forward_raw,
        env.MOCK_LENDING_ID, navComponents.nav_per_share,
        dusdcCoin.objectId, sizing.size_raw,
      );
      supplyTxDigest = ppResult.tx_digest;
      newPositionKey = ppResult.market_key;
      newPositionType = 'range';
      newNotionalRaw = ppResult.bet_notional_raw;
      notifyOnAction({ kind: 'supply', portfolioId: portfolio.id, oracleId: oracle_id,
        expiryMs: expiryBigInt, txDigest: supplyTxDigest,
        detail: `PP yield bet ${sizing.size_raw} raw DUSDC` });

    } else if (portfolio.strategy === 'RANGE_ROLL' || portfolio.strategy === 'VOL_TARGETED_RANGE') {
      // ⑤ Range Roll  ⑥ Vol-Targeted Range
      if (!managerId) {
        log.warn({ portfolioId }, 'no managerId for bettor strategy — skipping');
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, 'no_manager_id',
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }

      const sizing = portfolio.strategy === 'RANGE_ROLL'
        ? sizeRangeRoll(navComponents.available_balance_raw, policyBudgetRaw)
        : sizeVolTargetedRange(navComponents.available_balance_raw, policyBudgetRaw,
            guardResult.atm_vol);
      if (sizing.skip_reason) {
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, sizing.skip_reason,
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }

      const rangeResult = await executeRangeCycle(
        client, keypair, portfolioId, policyCapId, managerId, oracle_id,
        BigInt(activeOracleState.expiry_ms), activeOracleState.forward_raw,
        navComponents.nav_per_share, sizing,
      );
      supplyTxDigest = rangeResult.tx_digest;
      newPositionKey = rangeResult.market_key;
      newPositionType = 'range';
      newNotionalRaw = rangeResult.notional_raw;
      notifyOnAction({ kind: 'supply', portfolioId: portfolio.id, oracleId: oracle_id,
        expiryMs: expiryBigInt, txDigest: supplyTxDigest,
        detail: `mint_range ${sizing.size_raw} DUSDC` });

    } else if (portfolio.strategy === 'CROSS_VENUE_ARB') {
      // ⑦ Cross-Venue Vol-Arb (sell-vol binary)
      if (!managerId) {
        log.warn({ portfolioId }, 'no managerId for CROSS_VENUE_ARB — skipping');
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, 'no_manager_id',
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }

      // Compute vol-arb signal to get sizing confidence.
      const signal = await computeVolArbSignal(
        activeOracleState.svi, activeOracleState.t_years, env.PREDICT_SERVER_URL,
      ).catch(() => null);

      if (!signal?.fired) {
        log.info({ portfolioId, signal }, 'vol-arb signal not fired — skipping binary mint');
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, 'vol_arb_not_fired',
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }

      const sizing = sizeVolArb(navComponents.available_balance_raw, policyBudgetRaw,
        Math.min(1, signal.edge_pct / 20));  // full size at 20%+ edge
      if (sizing.skip_reason) {
        await skipWithRecord(portfolio.id, oracle_id, expiryBigInt, sizing.skip_reason,
          { settleTxDigest, navComponents, vaultState, chainState, bettorMtm });
        return;
      }

      // Sell ATM call (sell-vol mode only — per CLAUDE.md Rule 3).
      const binaryResult = await executeBinaryCycle(
        client, keypair, portfolioId, policyCapId, managerId, oracle_id,
        BigInt(activeOracleState.expiry_ms), activeOracleState.forward_raw,
        navComponents.nav_per_share, sizing, true,
      );
      supplyTxDigest = binaryResult.tx_digest;
      newPositionKey = binaryResult.market_key;
      newPositionType = 'binary';
      newNotionalRaw = binaryResult.notional_raw;
      notifyOnAction({ kind: 'supply', portfolioId: portfolio.id, oracleId: oracle_id,
        expiryMs: expiryBigInt, txDigest: supplyTxDigest,
        detail: `mint ATM call, edge ${signal.edge_pct.toFixed(1)}%` });
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ portfolioId, err: msg }, 'execute step failed');
    await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'error', msg, {
      settleTxDigest, navPerShareBefore: chainState.nav_per_share,
      navPerShareAfter: navComponents.nav_per_share, atmVol: guardResult.atm_vol,
      atmSpread: guardResult.atm_spread, vaultValueRaw: vault_value_raw,
      plpTotalSupplyRaw: plp_total_supply_raw, quoteBalanceRaw: navComponents.quote_balance_raw,
      lpBalanceRaw: navComponents.lp_balance_raw, bettorMtmRaw: bettorMtm,
      totalNavRaw: navComponents.total_nav_raw, deltaSource,
    });
    return;
  }

  // ── (h) STORE NEW BETTOR POSITIONS ────────────────────────────────────────
  if (newPositionKey && newPositionType && newNotionalRaw !== null) {
    await prisma.openPosition.create({
      data: {
        portfolioId: portfolio.id,
        positionType: newPositionType,
        oracleId: activeOracleState!.oracle_id,
        marketKey: newPositionKey,
        quantityRaw: newNotionalRaw,
        notionalRaw: newNotionalRaw,
        expiryMs: BigInt(Math.round(activeOracleState!.t_years * 365.25 * 24 * 3600 * 1000) + Date.now()),
        mintTxDigest: supplyTxDigest,
      },
    });
    log.info({ portfolioId, newPositionKey, newPositionType, newNotionalRaw: newNotionalRaw.toString() },
      'open position stored');
  }

  // ── (i) VOL-ARB SIGNAL EVALUATION (passive for non-arb strategies) ────────
  let volArbSource: string | null = null;
  let volArbPredictImpliedVol: number | null = null;
  let volArbReferenceImpliedVol: number | null = null;
  let volArbEdgePct: number | null = null;
  let volArbFired = false;

  try {
    const signal = await computeVolArbSignal(
      activeOracleState.svi, activeOracleState.t_years, env.PREDICT_SERVER_URL);
    volArbSource = signal.source;
    volArbPredictImpliedVol = signal.predict_implied_vol;
    volArbReferenceImpliedVol = signal.reference_vol;
    volArbEdgePct = signal.edge_pct;
    volArbFired = signal.fired && portfolio.strategy === 'CROSS_VENUE_ARB';
    log.info({ portfolioId, volArbSource, edge_pct: volArbEdgePct.toFixed(2), fired: signal.fired }, 'vol-arb signal evaluated');
  } catch (err) {
    log.warn({ portfolioId, err }, 'vol-arb signal evaluation failed — skipping');
  }

  // ── (j) RECORD CYCLE RESULT ───────────────────────────────────────────────
  await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'done', null, {
    settleTxDigest, supplyTxDigest,
    navPerShareBefore: chainState.nav_per_share, navPerShareAfter: navComponents.nav_per_share,
    quoteBalanceRaw: navComponents.quote_balance_raw, lpBalanceRaw: navComponents.lp_balance_raw,
    lpValueRaw: navComponents.lp_value_raw, bettorMtmRaw: bettorMtm,
    totalNavRaw: navComponents.total_nav_raw, vaultValueRaw: vault_value_raw,
    plpTotalSupplyRaw: plp_total_supply_raw, atmVol: guardResult.atm_vol,
    atmSpread: guardResult.atm_spread, entryGuardSkipped: false,
    hedgeDirection, hedgeSizeDbtc, hedgeNotionalDusdc, idealHedgeNotional,
    coverageRatioPct, hedgeTxDigest, isPartialHedge, hedgeBudgetDusdc, deltaSource,
    volArbSource, volArbPredictImpliedVol, volArbReferenceImpliedVol, volArbEdgePct, volArbFired,
  });

  log.info({
    portfolioId, oracle_id, supplyTxDigest, hedgeTxDigest, coverageRatioPct, deltaSource, volArbFired,
    explorer_supply: supplyTxDigest ? `${EXPLORER_URL}/${supplyTxDigest}` : null,
    explorer_hedge:  hedgeTxDigest  ? `${EXPLORER_URL}/${hedgeTxDigest}`  : null,
  }, 'portfolio cycle complete');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * DevInspect call to preview yield for a PRINCIPAL_PROTECTED portfolio.
 * Uses portfolio::preview_portfolio_yield which wraps mock_lending::preview_yield.
 */
async function previewPortfolioYield(
  client: SuiGrpcClient,
  sender: string,
  portfolioId: string,
  mockLendingId: string,
): Promise<bigint> {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${SONARK_PKG}::portfolio::preview_portfolio_yield`,
    typeArguments: [DUSDC],
    arguments: [
      tx.object(portfolioId),
      tx.object(mockLendingId),
      tx.object(CLOCK_ID),
    ],
  });
  const sim = await client.core.simulateTransaction({ transaction: tx, include: { commandResults: true } });
  if (sim.$kind === 'FailedTransaction') {
    log.warn({ portfolioId }, 'preview_portfolio_yield DevInspect failed — assuming 0');
    return 0n;
  }
  const bcs = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!bcs) return 0n;
  return Buffer.from(bcs).readBigUInt64LE(0) as unknown as bigint;
}

interface SkipExtras {
  settleTxDigest?: string | null;
  navComponents: { nav_per_share: bigint; quote_balance_raw: bigint; lp_balance_raw: bigint; lp_value_raw: bigint; total_nav_raw: bigint };
  vaultState: { vault_value_raw: bigint; plp_total_supply_raw: bigint };
  chainState: { nav_per_share: bigint };
  bettorMtm: bigint;
}

async function skipWithRecord(
  portfolioId: string,
  oracleId: string,
  expiryMs: bigint,
  reason: string,
  extras: SkipExtras,
): Promise<void> {
  await recordCycle(portfolioId, oracleId, expiryMs, 'skipped', reason, {
    settleTxDigest: extras.settleTxDigest ?? null,
    navPerShareBefore: extras.chainState.nav_per_share,
    navPerShareAfter: extras.navComponents.nav_per_share,
    quoteBalanceRaw: extras.navComponents.quote_balance_raw,
    lpBalanceRaw: extras.navComponents.lp_balance_raw,
    lpValueRaw: extras.navComponents.lp_value_raw,
    bettorMtmRaw: extras.bettorMtm,
    totalNavRaw: extras.navComponents.total_nav_raw,
    vaultValueRaw: extras.vaultState.vault_value_raw,
    plpTotalSupplyRaw: extras.vaultState.plp_total_supply_raw,
  });
}

// ── DB helpers ───────────────────────────────────────────────────────────────

interface CycleExtras {
  settleTxDigest?: string | null;
  supplyTxDigest?: string | null;
  navPerShareBefore?: bigint;
  navPerShareAfter?: bigint;
  quoteBalanceRaw?: bigint;
  lpBalanceRaw?: bigint;
  lpValueRaw?: bigint;
  bettorMtmRaw?: bigint;
  totalNavRaw?: bigint;
  vaultValueRaw?: bigint;
  plpTotalSupplyRaw?: bigint;
  atmVol?: number;
  atmSpread?: number;
  entryGuardSkipped?: boolean;
  hedgeDirection?: string | null;
  hedgeSizeDbtc?: number | null;
  hedgeNotionalDusdc?: number | null;
  idealHedgeNotional?: number | null;
  coverageRatioPct?: number | null;
  hedgeTxDigest?: string | null;
  isPartialHedge?: boolean;
  hedgeBudgetDusdc?: number | null;
  deltaSource?: string | null;
  volArbSource?: string | null;
  volArbPredictImpliedVol?: number | null;
  volArbReferenceImpliedVol?: number | null;
  volArbEdgePct?: number | null;
  volArbFired?: boolean;
}

async function recordCycle(
  portfolioId: string,
  oracleId: string,
  expiryMs: bigint,
  status: 'done' | 'skipped' | 'error',
  skipOrErrReason: string | null,
  extras: CycleExtras = {},
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.keeperCycle.create({
    data: {
      portfolioId,
      oracleId,
      expiryMs,
      status,
      skipReason:   status === 'skipped' ? skipOrErrReason : null,
      errorMsg:     status === 'error'   ? skipOrErrReason : null,
      settleTxDigest:    extras.settleTxDigest    ?? null,
      supplyTxDigest:    extras.supplyTxDigest    ?? null,
      navPerShareBefore: extras.navPerShareBefore ?? null,
      navPerShareAfter:  extras.navPerShareAfter  ?? null,
      quoteBalanceRaw:   extras.quoteBalanceRaw   ?? null,
      lpBalanceRaw:      extras.lpBalanceRaw      ?? null,
      lpValueRaw:        extras.lpValueRaw        ?? null,
      bettorMtmRaw:      extras.bettorMtmRaw      ?? null,
      totalNavRaw:       extras.totalNavRaw       ?? null,
      vaultValueRaw:     extras.vaultValueRaw     ?? null,
      plpTotalSupplyRaw: extras.plpTotalSupplyRaw ?? null,
      atmVol:            extras.atmVol            ?? null,
      atmSpread:         extras.atmSpread         ?? null,
      entryGuardSkipped: extras.entryGuardSkipped ?? false,
      hedgeDirection:    extras.hedgeDirection    ?? null,
      hedgeSizeDbtc:     extras.hedgeSizeDbtc     ?? null,
      hedgeNotionalDusdc: extras.hedgeNotionalDusdc ?? null,
      idealHedgeNotional: extras.idealHedgeNotional ?? null,
      coverageRatioPct:  extras.coverageRatioPct  ?? null,
      hedgeTxDigest:     extras.hedgeTxDigest     ?? null,
      isPartialHedge:    extras.isPartialHedge    ?? false,
      hedgeBudgetDusdc:  extras.hedgeBudgetDusdc  ?? null,
      deltaSource:       extras.deltaSource        ?? null,
      volArbSource:              extras.volArbSource              ?? null,
      volArbPredictImpliedVol:   extras.volArbPredictImpliedVol   ?? null,
      volArbReferenceImpliedVol: extras.volArbReferenceImpliedVol ?? null,
      volArbEdgePct:             extras.volArbEdgePct             ?? null,
      volArbFired:               extras.volArbFired               ?? false,
    },
  });
}

// ── Polling loop ─────────────────────────────────────────────────────────────

const _dispatchedOracles = new Set<string>();

export async function runPollingLoop(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
): Promise<never> {
  const pollMs = env.KEEPER_POLL_INTERVAL_MS;
  log.info({ pollMs }, 'keeper polling loop started');

  for (;;) {
    if (env.KEEPER_PAUSED) {
      log.info('KEEPER_PAUSED=true — sleeping');
      await sleep(pollMs);
      continue;
    }

    try {
      const settled = await fetchRecentlySettledOracles();
      for (const oracle of settled) {
        const key = `${oracle.oracle_id}:${oracle.expiry}`;
        if (_dispatchedOracles.has(key)) continue;
        _dispatchedOracles.add(key);
        await runOracleCycle({
          oracle_id: oracle.oracle_id,
          expiry_ms: oracle.expiry,
          settlement_price: oracle.settlement_price,
          client,
          keypair,
        });
      }
    } catch (err) {
      log.error({ err }, 'polling loop error');
    }

    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
