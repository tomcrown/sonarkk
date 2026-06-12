/**
 * Main keeper loop — one idempotent worker per expiry cycle.
 *
 * Per-cycle flow (Task 1 from Phase 4 spec):
 *   1. Fetch recently-settled oracles from predict-server
 *   2. For each settled oracle not yet fully processed:
 *      a. Load all active portfolios from DB
 *      b. For each portfolio:
 *         i.   IDEMPOTENCY CHECK — already done this (portfolio + expiry)?
 *         ii.  POLICY CHECK — cap valid / not revoked / budget remaining?
 *         iii. SETTLE prior positions
 *         iv.  ENTRY GUARD — shouldSkipExpiry?
 *         v.   COMPUTE NAV + sizing + hedge inputs (Phase 3 math)
 *         vi.  EXECUTE supply PTB + hedge PTB
 *         vii. RECORD cycle result to DB
 *   3. Sleep KEEPER_POLL_INTERVAL_MS → repeat
 *
 * Idempotency guarantee:
 *   The DB unique constraint on (portfolioId, expiryMs) is the idempotency key.
 *   If the keeper crashes after execute but before RECORD, on restart it will
 *   attempt the cycle again (no record → not done). The duplicate supply PTB
 *   will fail on-chain (budget exhausted) and be caught by the policy check.
 *   This is intentional: a failed re-attempt is always safer than skipping.
 */

import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  fetchPredictVaultState,
  computeNav,
  shouldSkipExpiry,
  computeHouseNetDelta,
  computeHedgeOrder,
  sizePlpSupplier,
  sizeHedgedPlp,
  sizeSmartVault,
  sizePrincipalProtected,
} from '@sonarkk/core';
import type { StrategyId } from '@sonarkk/core';

import { fetchRecentlySettledOracles, fetchOracleState, fetchBestActiveOracleState } from './chain/oracle.js';
import type { OracleState } from './chain/oracle.js';
import { readPortfolioChainState, readManagerId } from './chain/portfolio.js';
import { readPredictManagerPositions } from './chain/predict-manager.js';
import { checkPolicyCap } from './chain/policy.js';
import { settleBinaryPositions } from './chain/settle.js';
import { executeSupplyCycle, pushNavOnly } from './chain/execute.js';
import { executeSpotHedge } from './spot/hedge.js';
import { computeHedgeBudget } from './math/hedge-budget.js';
import { computeBettorMtm } from './math/bettor-mtm.js';
import { computeVolArbSignal } from './math/vol-arb-feed.js';
import { notifyOnAction } from './notify.js';
import { log } from './logger.js';
import { env, EXPLORER_URL } from './env.js';
import { getPrismaClient } from '@sonarkk/core';

// ── Constants ───────────────────────────────────────────────────────────────

const DUSDC = env.DUSDC_TYPE;
const PREDICT_OBJ = env.PREDICT_OBJECT;

// Map strategy string value → StrategyId for entry-guard
const STRATEGY_TYPE_MAP: Record<string, StrategyId | null> = {
  PLP_SUPPLIER:        'plp_supplier',
  HEDGED_PLP:          'hedged_plp',
  SMART_VAULT:         'smart_vault',
  PRINCIPAL_PROTECTED: 'principal_protected',
  RANGE_ROLL:          'range_roll',
  VOL_TARGETED_RANGE:  'vol_targeted_range',
  CROSS_VENUE_ARB:     'vol_arb_sell',
};

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
  // The settled oracle has t_years=0 (expired) which causes atmVol=0; we need
  // a live active oracle with a positive t_years for correct vol/guard/hedge math.
  // fetchBestActiveOracleState reads only ONE oracle object (not all 20-30) for speed.
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

  // Read Predict vault state once per cycle (shared: vault_value + plp_supply).
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
      // Per-portfolio errors are logged but do not abort the cycle for others.
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
  };
  oracle_id: string;
  expiry_ms: number;
  /** Settled oracle (trigger) — used for settling old positions and DB recording. */
  oracleState: Awaited<ReturnType<typeof fetchOracleState>>;
  /**
   * Current active oracle — used for the entry guard and hedge calculations.
   * Distinct from oracleState because settled oracles have t_years=0 (expired)
   * which causes atmVol to return 0 and the entry guard to always skip.
   * null when no active oracle is available (supply step is skipped).
   */
  activeOracleState: OracleState | null;
  vaultState: { vault_value_raw: bigint; plp_total_supply_raw: bigint };
  client: SuiGrpcClient;
  keypair: Ed25519Keypair;
  keeperAddress: string;
}

async function processPortfolio(input: PortfolioInput): Promise<void> {
  const { portfolio, oracle_id, expiry_ms, oracleState, activeOracleState, vaultState, client, keypair, keeperAddress } = input;
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
    notifyOnAction({
      kind: 'skip',
      portfolioId: portfolio.id,
      oracleId: oracle_id,
      expiryMs: expiryBigInt,
      detail: `policy_check_failed: ${policyCheck.reason}`,
    });
    // Record a skipped cycle so we don't retry this expiry.
    await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped',
      `policy_check_failed: ${policyCheck.reason}`);
    if (policyCheck.reason === 'revoked') {
      // Mark portfolio inactive — the user has revoked the keeper.
      await prisma.portfolio.update({
        where: { id: portfolio.id },
        data: { isActive: false },
      });
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

  // ── (c) SETTLE PRIOR POSITIONS ────────────────────────────────────────────
  const managerId = await readManagerId(client, portfolioId);
  let settleTxDigest: string | null = null;
  if (managerId) {
    try {
      // For Phase 4, no DB-tracked open positions yet (first cycle).
      // In production, the keeper reads open positions from DB and settles them.
      const settleResult = await settleBinaryPositions(
        client, keypair, portfolioId, managerId, oracle_id, [], [],
      );
      settleTxDigest = settleResult.tx_digest;
    } catch (err) {
      log.warn({ portfolioId, err }, 'settle step failed, continuing to entry guard');
    }
  }

  // Re-read chain state after settlement (quote_balance may have changed).
  chainState = await readPortfolioChainState(client, portfolioId, keeperAddress);

  // ── (d) ENTRY GUARD ───────────────────────────────────────────────────────
  const strategyId = STRATEGY_TYPE_MAP[portfolio.strategy];
  if (!strategyId) {
    log.warn({ portfolioId, strategy: portfolio.strategy }, 'unknown strategy type, skipping');
    await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped', 'unknown_strategy');
    return;
  }

  // If no active oracle is available, we can settle but cannot enter a new position.
  if (!activeOracleState) {
    log.info({ portfolioId }, 'no active oracle available — settle only, skip entry');
    await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped', 'no_active_oracle', {
      settleTxDigest,
    });
    return;
  }

  // Compute pool utilization from vault state (total_mtm / vault_value).
  const utilization = vaultState.vault_value_raw > 0n
    ? Number(vaultState.vault_value_raw - vaultState.plp_total_supply_raw) / Number(vaultState.vault_value_raw)
    : 0;
  const clampedUtil = Math.max(0, Math.min(1, utilization));

  // Use the ACTIVE oracle SVI (not the settled one) — settled oracle has t_years=0 which makes atmVol=0.
  const guardResult = shouldSkipExpiry(
    activeOracleState.svi,
    activeOracleState.t_years,
    clampedUtil,
    strategyId,
  );

  if (guardResult.skip) {
    log.info({ portfolioId, reason: guardResult.reason, atmVol: guardResult.atm_vol },
      'entry guard: skip this expiry');
    notifyOnAction({
      kind: 'skip',
      portfolioId: portfolio.id,
      oracleId: oracle_id,
      expiryMs: expiryBigInt,
      ...(guardResult.reason !== undefined ? { detail: guardResult.reason } : {}),
    });
    // Still push NAV so deposits can proceed.
    try {
      const { vault_value_raw, plp_total_supply_raw } = vaultState;
      const bettorMtm = await computeBettorMtm(client, keeperAddress, managerId ?? '', oracle_id, []);
      const navComponents = await computeNav(client.core, {
        portfolio_id: portfolioId,
        predict_id: PREDICT_OBJ,
        sonark_package: env.SONARK_PACKAGE,
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
      const navTx = await pushNavOnly(client, keypair, portfolioId, policyCapId, navComponents.nav_per_share);
      notifyOnAction({ kind: 'nav_update', portfolioId: portfolio.id, oracleId: oracle_id,
        expiryMs: expiryBigInt, txDigest: navTx });
      await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped', guardResult.reason ?? null, {
        settleTxDigest,
        navPerShareBefore: chainState.nav_per_share,
        navPerShareAfter: navComponents.nav_per_share,
        atmVol: guardResult.atm_vol,
        atmSpread: guardResult.atm_spread,
        entryGuardSkipped: true,
        vaultValueRaw: vault_value_raw,
        plpTotalSupplyRaw: plp_total_supply_raw,
        quoteBalanceRaw: chainState.quote_balance_raw,
        lpBalanceRaw: chainState.lp_balance_raw,
        bettorMtmRaw: bettorMtm,
        totalNavRaw: navComponents.total_nav_raw,
      });
    } catch (err) {
      log.warn({ portfolioId, err }, 'nav push on skip failed');
      await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped', guardResult.reason ?? null);
    }
    return;
  }

  // ── (e) COMPUTE NAV + SIZING ──────────────────────────────────────────────
  const { vault_value_raw, plp_total_supply_raw } = vaultState;

  const bettorMtm = await computeBettorMtm(
    client, keeperAddress, managerId ?? '', oracle_id, [],
  );

  const navComponents = await computeNav(client.core, {
    portfolio_id: portfolioId,
    predict_id: PREDICT_OBJ,
    sonark_package: env.SONARK_PACKAGE,
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
    bettor_mtm: navComponents.bettor_mtm_raw.toString(),
    total_nav: navComponents.total_nav_raw.toString(),
  }, 'NAV computed');

  // Policy budget remaining (read from the on-chain PolicyCap state).
  const policyBudgetRaw = policyCheck.state.budget_remaining;

  // ── (f) EXECUTE SUPPLY + HEDGE ────────────────────────────────────────────
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

  try {
    let sizingResult;
    if (portfolio.strategy === 'PLP_SUPPLIER') {
      sizingResult = sizePlpSupplier(navComponents.available_balance_raw, policyBudgetRaw);
    } else if (portfolio.strategy === 'HEDGED_PLP') {
      sizingResult = sizeHedgedPlp(navComponents.available_balance_raw, policyBudgetRaw);
    } else if (portfolio.strategy === 'SMART_VAULT') {
      const smartVaultSizing = sizeSmartVault(navComponents.available_balance_raw, policyBudgetRaw);
      sizingResult = smartVaultSizing.hedged_plp; // Use the hedged leg as primary
    } else if (portfolio.strategy === 'PRINCIPAL_PROTECTED') {
      sizingResult = sizePrincipalProtected(
        navComponents.yield_accumulated_raw, policyBudgetRaw,
      );
    } else {
      // Bettor strategies — use PLP sizing as base for now (Phase 4 focus is house strategies)
      sizingResult = sizePlpSupplier(navComponents.available_balance_raw, policyBudgetRaw);
    }

    if (sizingResult.skip_reason) {
      log.info({ portfolioId, reason: sizingResult.skip_reason }, 'sizing: skip cycle');
      await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'skipped', sizingResult.skip_reason, {
        settleTxDigest,
        navPerShareBefore: chainState.nav_per_share,
        navPerShareAfter: navComponents.nav_per_share,
        atmVol: guardResult.atm_vol,
        atmSpread: guardResult.atm_spread,
        vaultValueRaw: vault_value_raw,
        plpTotalSupplyRaw: plp_total_supply_raw,
        quoteBalanceRaw: navComponents.quote_balance_raw,
        lpBalanceRaw: navComponents.lp_balance_raw,
        bettorMtmRaw: bettorMtm,
        totalNavRaw: navComponents.total_nav_raw,
      });
      return;
    }

    // Execute supply PTB (includes NAV update).
    const execResult = await executeSupplyCycle(
      client, keypair, portfolioId, policyCapId,
      navComponents.nav_per_share, sizingResult,
    );
    supplyTxDigest = execResult.tx_digest;

    notifyOnAction({
      kind: 'supply',
      portfolioId: portfolio.id,
      oracleId: oracle_id,
      expiryMs: expiryBigInt,
      txDigest: supplyTxDigest,
      detail: `supply ${sizingResult.size_raw} DUSDC raw`,
    });

    // Hedge (Hedged-PLP and Smart-Vault strategies).
    if (portfolio.strategy === 'HEDGED_PLP' || portfolio.strategy === 'SMART_VAULT') {
      const { hedge_budget_raw, is_cap_constrained } = computeHedgeBudget(
        navComponents.lp_value_raw,
        portfolio.hedgeMultiplier,
        navComponents.available_balance_raw,
      );
      hedgeBudgetDusdc = Number(hedge_budget_raw) / 1e6;

      // Read real binary positions from PredictManager (Task 1 — Phase 5 reviewer condition).
      // For house strategies (supply-only), managerId is null → positions = [] → delta = 0.
      // For bettor strategies with open positions, reads actual k/call/put notionals.
      // deltaSource = 'positions' in both cases (real read path, not proxy).
      const managerPositions = await readPredictManagerPositions(client, managerId, oracle_id);
      deltaSource = 'positions';

      log.info({
        portfolioId,
        managerId,
        positionCount: managerPositions.length,
        deltaSource,
      }, 'PredictManager positions read');

      const houseNetDelta = computeHouseNetDelta(
        activeOracleState.svi,
        activeOracleState.spot,
        managerPositions,
      );

      const hedgeOrder = computeHedgeOrder({
        house_net_delta: houseNetDelta,
        spot_price_usd: activeOracleState.spot,
        t_years: activeOracleState.t_years,
        budget_remaining_dusdc: Number(hedge_budget_raw) / 1e6,
      });

      idealHedgeNotional = Math.abs(houseNetDelta) * activeOracleState.spot;

      log.info({
        portfolioId,
        house_net_delta: houseNetDelta,
        hedge_direction: hedgeOrder.direction,
        size_dbtc: hedgeOrder.size_dbtc,
        notional_dusdc: hedgeOrder.notional_dusdc,
        ideal_notional_dusdc: idealHedgeNotional,
        is_cap_constrained,
        hedge_budget_dusdc: hedgeBudgetDusdc,
      }, 'hedge inputs computed');

      if (!hedgeOrder.skipped && hedgeOrder.direction !== 'none' && env.DEEPBOOK_BALANCE_MANAGER) {
        try {
          const hedgeResult = await executeSpotHedge(
            client, keypair, hedgeOrder, idealHedgeNotional,
          );
          hedgeTxDigest = hedgeResult.tx_digest;
          hedgeDirection = hedgeResult.order_direction;
          hedgeSizeDbtc = hedgeResult.order_size_dbtc;
          hedgeNotionalDusdc = hedgeResult.notional_dbusdc;
          coverageRatioPct = hedgeResult.coverage_ratio_pct;
          isPartialHedge = hedgeResult.is_partial;

          notifyOnAction({
            kind: 'hedge',
            portfolioId: portfolio.id,
            oracleId: oracle_id,
            expiryMs: expiryBigInt,
            txDigest: hedgeTxDigest,
            detail: `${hedgeDirection} ${hedgeSizeDbtc?.toFixed(8)} DBTC, coverage ${coverageRatioPct?.toFixed(1)}%`,
            coverageRatioPct: coverageRatioPct ?? undefined,
          });
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
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ portfolioId, err: msg }, 'execute step failed');
    await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'error', msg, {
      settleTxDigest,
      navPerShareBefore: chainState.nav_per_share,
      navPerShareAfter: navComponents.nav_per_share,
      atmVol: guardResult.atm_vol,
      atmSpread: guardResult.atm_spread,
      vaultValueRaw: vault_value_raw,
      plpTotalSupplyRaw: plp_total_supply_raw,
      quoteBalanceRaw: navComponents.quote_balance_raw,
      lpBalanceRaw: navComponents.lp_balance_raw,
      bettorMtmRaw: bettorMtm,
      totalNavRaw: navComponents.total_nav_raw,
      deltaSource,
    });
    return;
  }

  // ── (h) VOL-ARB SIGNAL EVALUATION ────────────────────────────────────────
  // Evaluated for all strategies so the DB has vol-arb edge data.
  // Only CROSS_VENUE_ARB uses it for sizing; others record it as a passive observation.
  let volArbSource: string | null = null;
  let volArbPredictImpliedVol: number | null = null;
  let volArbReferenceImpliedVol: number | null = null;
  let volArbEdgePct: number | null = null;
  let volArbFired = false;

  try {
    const signal = await computeVolArbSignal(
      activeOracleState.svi,
      activeOracleState.t_years,
      env.PREDICT_SERVER_URL,
    );
    volArbSource = signal.source;
    volArbPredictImpliedVol = signal.predict_implied_vol;
    volArbReferenceImpliedVol = signal.reference_vol;
    volArbEdgePct = signal.edge_pct;
    volArbFired = signal.fired && portfolio.strategy === 'CROSS_VENUE_ARB';

    log.info({
      portfolioId,
      volArbSource,
      predict_implied_vol: volArbPredictImpliedVol.toFixed(4),
      reference_vol: volArbReferenceImpliedVol.toFixed(4),
      edge_pct: volArbEdgePct.toFixed(2),
      fired: signal.fired,
      strategy_fires: volArbFired,
    }, 'vol-arb signal evaluated');
  } catch (err) {
    log.warn({ portfolioId, err }, 'vol-arb signal evaluation failed — skipping');
  }

  // ── (g) RECORD CYCLE RESULT ───────────────────────────────────────────────
  await recordCycle(portfolio.id, oracle_id, expiryBigInt, 'done', null, {
    settleTxDigest,
    supplyTxDigest,
    navPerShareBefore: chainState.nav_per_share,
    navPerShareAfter: navComponents.nav_per_share,
    quoteBalanceRaw: navComponents.quote_balance_raw,
    lpBalanceRaw: navComponents.lp_balance_raw,
    lpValueRaw: navComponents.lp_value_raw,
    bettorMtmRaw: bettorMtm,
    totalNavRaw: navComponents.total_nav_raw,
    vaultValueRaw: vault_value_raw,
    plpTotalSupplyRaw: plp_total_supply_raw,
    atmVol: guardResult.atm_vol,
    atmSpread: guardResult.atm_spread,
    entryGuardSkipped: false,
    hedgeDirection,
    hedgeSizeDbtc,
    hedgeNotionalDusdc,
    idealHedgeNotional,
    coverageRatioPct,
    hedgeTxDigest,
    isPartialHedge,
    hedgeBudgetDusdc,
    deltaSource,
    volArbSource,
    volArbPredictImpliedVol,
    volArbReferenceImpliedVol,
    volArbEdgePct,
    volArbFired,
  });

  log.info({
    portfolioId,
    oracle_id,
    supplyTxDigest,
    hedgeTxDigest,
    coverageRatioPct,
    deltaSource,
    volArbFired,
    explorer_supply: supplyTxDigest ? `${EXPLORER_URL}/${supplyTxDigest}` : null,
    explorer_hedge:  hedgeTxDigest  ? `${EXPLORER_URL}/${hedgeTxDigest}`  : null,
  }, 'portfolio cycle complete');
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
      settleTxDigest:   extras.settleTxDigest ?? null,
      supplyTxDigest:   extras.supplyTxDigest ?? null,
      navPerShareBefore: extras.navPerShareBefore ?? null,
      navPerShareAfter:  extras.navPerShareAfter  ?? null,
      quoteBalanceRaw:   extras.quoteBalanceRaw   ?? null,
      lpBalanceRaw:      extras.lpBalanceRaw      ?? null,
      lpValueRaw:        extras.lpValueRaw        ?? null,
      bettorMtmRaw:      extras.bettorMtmRaw      ?? null,
      totalNavRaw:       extras.totalNavRaw       ?? null,
      vaultValueRaw:     extras.vaultValueRaw     ?? null,
      plpTotalSupplyRaw: extras.plpTotalSupplyRaw ?? null,
      atmVol:           extras.atmVol    ?? null,
      atmSpread:        extras.atmSpread ?? null,
      entryGuardSkipped: extras.entryGuardSkipped ?? false,
      hedgeDirection:    extras.hedgeDirection    ?? null,
      hedgeSizeDbtc:     extras.hedgeSizeDbtc     ?? null,
      hedgeNotionalDusdc: extras.hedgeNotionalDusdc ?? null,
      idealHedgeNotional: extras.idealHedgeNotional ?? null,
      coverageRatioPct:   extras.coverageRatioPct   ?? null,
      hedgeTxDigest:     extras.hedgeTxDigest   ?? null,
      isPartialHedge:    extras.isPartialHedge  ?? false,
      hedgeBudgetDusdc:  extras.hedgeBudgetDusdc ?? null,
      deltaSource:       extras.deltaSource      ?? null,
      volArbSource:              extras.volArbSource              ?? null,
      volArbPredictImpliedVol:   extras.volArbPredictImpliedVol   ?? null,
      volArbReferenceImpliedVol: extras.volArbReferenceImpliedVol ?? null,
      volArbEdgePct:             extras.volArbEdgePct             ?? null,
      volArbFired:               extras.volArbFired               ?? false,
    },
  });
}

// ── Polling loop ─────────────────────────────────────────────────────────────

/** Track which (oracle_id, expiry_ms) pairs have been fully dispatched this session. */
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
      const settled = await fetchRecentlySettledOracles(10);
      // Only process oracles that settled within the last 2 hours.
      // Beyond that, any open positions would already be settled by other parties,
      // and iterating the full history on restart wastes cycles without value.
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const recentSettled = settled.filter(o => Date.now() - o.expiry < TWO_HOURS_MS);

      for (const oracle of recentSettled) {
        const key = `${oracle.oracle_id}:${oracle.expiry}`;
        if (_dispatchedOracles.has(key)) continue; // already processed this session

        log.info({ oracle_id: oracle.oracle_id, expiry: oracle.expiry },
          'dispatching oracle cycle');

        await runOracleCycle({
          oracle_id: oracle.oracle_id,
          expiry_ms: oracle.expiry, // predict-server already returns ms; do NOT multiply by 1000
          settlement_price: oracle.settlement_price,
          client,
          keypair,
        });

        _dispatchedOracles.add(key);
        // Prevent unbounded growth — keep only the last 500 entries.
        if (_dispatchedOracles.size > 500) {
          const first = _dispatchedOracles.values().next().value;
          if (first) _dispatchedOracles.delete(first);
        }
      }
    } catch (err) {
      log.error({ err }, 'polling tick failed');
    }

    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
