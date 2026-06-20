/**
 * demo-cycle.ts — Force one keeper cycle for a demo portfolio.
 *
 * Spawned by POST /portfolios/:id/run-cycle in the API.
 * Reads DEMO_PORTFOLIO_ID from env.
 * Outputs newline-delimited JSON events to stdout.
 *
 * Event types:
 *   { type: 'progress', message: string }
 *   { type: 'tx', protocol: string, label: string, digest: string, url: string }
 *   { type: 'done', cycleId: string, supplyTxDigest: string|null, hedgeTxDigest: string|null }
 *   { type: 'error', message: string }
 */

import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { getPrismaClient, disconnectPrisma, computeHouseNetDelta, computeHedgeOrder } from '@sonarkk/core';
import { env, CLOCK_ID, PLP_TYPE, EXPLORER_URL } from './env.js';
import { fetchOracleState } from './chain/oracle.js';
import { readPortfolioChainState } from './chain/portfolio.js';
import {
  executeSupplyCycle,
  executePrincipalProtectedCycle,
  executeMarginLoopCycle,
} from './chain/execute.js';
import { executeSpotHedge } from './spot/hedge.js';
import { computeHedgeBudget } from './math/hedge-budget.js';

const DUSDC   = env.DUSDC_TYPE;
const SONARK  = env.SONARK_PACKAGE;
const PREDICT = env.PREDICT_PACKAGE;

function emit(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

async function fetchBestUnusedOracle(portfolioDbId: string): Promise<{ oracle_id: string; expiry: number }> {
  const res = await fetch(`${env.PREDICT_SERVER_URL}/oracles?status=active&limit=30`);
  if (!res.ok) throw new Error(`predict-server /oracles HTTP ${res.status}`);
  const all = (await res.json()) as Array<{ oracle_id: string; expiry: number; status: string }>;
  const active = all.filter(o => o.status === 'active');
  if (active.length === 0) throw new Error('No active oracles on predict-server');

  const prisma = getPrismaClient();
  const usedExpiries = await prisma.keeperCycle.findMany({
    where: { portfolioId: portfolioDbId },
    select: { expiryMs: true },
  });
  const usedSet = new Set(usedExpiries.map(c => Number(c.expiryMs)));

  // Prefer an oracle not yet used for this portfolio
  const unused = active.filter(o => !usedSet.has(o.expiry));
  const candidates = unused.length > 0 ? unused : active;

  // Pick the one with the most time remaining
  return candidates.reduce((best, o) => (o.expiry > best.expiry ? o : best));
}

async function previewYield(client: SuiGrpcClient, sender: string, portfolioId: string, mockLendingId: string): Promise<bigint> {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${SONARK}::portfolio::preview_portfolio_yield`,
    typeArguments: [DUSDC],
    arguments: [tx.object(portfolioId), tx.object(mockLendingId), tx.object(CLOCK_ID)],
  });
  const sim = await client.core.simulateTransaction({ transaction: tx, include: { commandResults: true } });
  if (sim.$kind === 'FailedTransaction') return 0n;
  const bcs = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!bcs) return 0n;
  return Buffer.from(bcs).readBigUInt64LE(0) as unknown as bigint;
}

async function main() {
  const rawId = process.env['DEMO_PORTFOLIO_ID'];
  if (!rawId) {
    emit({ type: 'error', message: 'DEMO_PORTFOLIO_ID env var not set' });
    process.exit(1);
  }

  const prisma = getPrismaClient();

  emit({ type: 'progress', message: 'Loading portfolio from database…' });
  const portfolio = await prisma.portfolio.findFirst({
    where: { OR: [{ id: rawId }, { objectId: rawId }] },
  });
  if (!portfolio) {
    emit({ type: 'error', message: `Portfolio ${rawId} not found in DB` });
    await disconnectPrisma();
    process.exit(1);
  }

  const portfolioId  = portfolio.objectId;
  const policyCapId  = portfolio.policyCapId;
  if (!policyCapId) {
    emit({ type: 'error', message: 'Portfolio has no policyCapId — not fully deployed' });
    await disconnectPrisma();
    process.exit(1);
  }

  // Load keeper keypair
  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  } catch {
    const bytes = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64');
    keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
  }
  const keeperAddress = keypair.getPublicKey().toSuiAddress();

  const client = new SuiGrpcClient({
    network: env.SUI_NETWORK as 'testnet',
    baseUrl: env.SUI_GRPC_URL,
  });

  emit({ type: 'progress', message: 'Fetching active oracle from predict-server…' });
  const oracleMeta = await fetchBestUnusedOracle(portfolio.id);
  const expiryBigInt = BigInt(oracleMeta.expiry);

  emit({ type: 'progress', message: `Oracle ${oracleMeta.oracle_id.slice(0, 10)}… — reading SVI params…` });
  const oracleState = await fetchOracleState(client, oracleMeta.oracle_id, oracleMeta.expiry, null);

  emit({ type: 'progress', message: 'Reading portfolio chain state…' });
  const chainState = await readPortfolioChainState(client, portfolioId, keeperAddress);

  const navPerShare = chainState.nav_per_share > 0n ? chainState.nav_per_share : 1_000_000_000n;

  // Compute utilization-based supply amount
  const utilTarget = portfolio.utilTarget ?? 0.25;
  const rawSize = BigInt(Math.floor(Number(chainState.available_balance_raw) * utilTarget));
  const MIN_SUPPLY = 1_000_000n; // 1 DUSDC
  const MAX_DEMO   = 5_000_000n; // 5 DUSDC cap to be safe
  const supplyAmount = rawSize < MIN_SUPPLY
    ? MIN_SUPPLY
    : rawSize > MAX_DEMO ? MAX_DEMO : rawSize;

  let supplyTxDigest: string | null = null;
  let hedgeTxDigest: string | null  = null;
  let hedgeDirection: string | null = null;
  let coverageRatioPct: number | null = null;

  const strategy = portfolio.strategy;

  // ── House strategies ①②③ ─────────────────────────────────────────────────────
  if (strategy === 'PLP_SUPPLIER' || strategy === 'HEDGED_PLP' || strategy === 'SMART_VAULT') {
    if (chainState.available_balance_raw < MIN_SUPPLY) {
      emit({ type: 'error', message: `Insufficient available balance (${chainState.available_balance_raw} raw, need ${MIN_SUPPLY})` });
      await disconnectPrisma();
      process.exit(1);
    }

    emit({ type: 'progress', message: `Executing supply (${Number(supplyAmount) / 1e6} DUSDC → DeepBook Predict PLP pool)…` });
    const supplyResult = await executeSupplyCycle(
      client, keypair, portfolioId, policyCapId, navPerShare,
      { size_raw: supplyAmount, ideal_size_raw: supplyAmount, is_budget_capped: false, utilization_fraction: utilTarget },
    );
    supplyTxDigest = supplyResult.tx_digest;
    emit({ type: 'tx', protocol: 'DeepBook Predict', label: 'Supply ↗', digest: supplyTxDigest, url: `${EXPLORER_URL}/${supplyTxDigest}` });

    // Hedge for HEDGED_PLP
    if (strategy === 'HEDGED_PLP' && env.DEEPBOOK_BALANCE_MANAGER) {
      emit({ type: 'progress', message: 'Computing delta-hedge order…' });
      const afterSupply = await readPortfolioChainState(client, portfolioId, keeperAddress);
      const lpValueRaw = afterSupply.lp_balance_raw;
      const { hedge_budget_raw } = computeHedgeBudget(lpValueRaw, portfolio.hedgeMultiplier ?? 1.0, afterSupply.available_balance_raw);
      const lpValueUsd = Number(lpValueRaw) / 1e6;
      const houseNetDelta = computeHouseNetDelta(oracleState.svi, oracleState.spot, [{
        k: 0, call_notional: lpValueUsd * 0.55, put_notional: lpValueUsd * 0.45,
      }]);
      const hedgeOrder = computeHedgeOrder({
        house_net_delta: houseNetDelta,
        spot_price_usd: oracleState.spot,
        t_years: oracleState.t_years,
        budget_remaining_dusdc: Number(hedge_budget_raw) / 1e6,
      });

      if (!hedgeOrder.skipped && hedgeOrder.size_dbtc && hedgeOrder.size_dbtc > 0) {
        emit({ type: 'progress', message: `Executing DeepBook Spot ${hedgeOrder.direction} hedge (${hedgeOrder.size_dbtc?.toFixed(6)} DBTC)…` });
        try {
          const hedgeResult = await executeSpotHedge(client, keypair, hedgeOrder, Number(hedge_budget_raw) / 1e6);
          if (hedgeResult.tx_digest) {
            hedgeTxDigest = hedgeResult.tx_digest;
            hedgeDirection = hedgeOrder.direction ?? null;
            coverageRatioPct = hedgeResult.coverage_ratio_pct ?? null;
            emit({
              type: 'tx',
              protocol: 'DeepBook Spot',
              label: `Spot hedge ${hedgeOrder.direction === 'long' ? '↑' : '↓'} ${coverageRatioPct != null ? coverageRatioPct.toFixed(0) + '%' : ''} ↗`,
              digest: hedgeTxDigest,
              url: `${EXPLORER_URL}/${hedgeTxDigest}`,
            });
          }
        } catch (err) {
          emit({ type: 'progress', message: `Hedge TX failed (non-fatal): ${err instanceof Error ? err.message : String(err)}` });
        }
      } else {
        emit({ type: 'progress', message: `Hedge skipped: ${hedgeOrder.skip_reason ?? 'math skipped'}` });
      }
    }

  // ── Strategy ④ Principal Protected ──────────────────────────────────────────
  } else if (strategy === 'PRINCIPAL_PROTECTED') {
    const managerId = portfolio.managerId;
    if (!managerId) {
      emit({ type: 'error', message: 'No managerId in DB — run keeper-setup for this portfolio first' });
      await disconnectPrisma();
      process.exit(1);
    }
    const mockLendingId = env.MOCK_LENDING_ID;
    if (!mockLendingId) {
      emit({ type: 'error', message: 'MOCK_LENDING_ID not set in keeper env' });
      await disconnectPrisma();
      process.exit(1);
    }

    // Fast-forward yield by 30 days so demo shows non-trivial yield
    emit({ type: 'progress', message: 'Fast-forwarding yield accrual (30 days)…' });
    const ffTx = new Transaction();
    ffTx.moveCall({
      target: `${SONARK}::portfolio::admin_fast_forward_portfolio_yield`,
      typeArguments: [DUSDC],
      arguments: [
        ffTx.object(portfolioId),
        ffTx.object(mockLendingId),
        ffTx.pure.u64(30n * 24n * 60n * 60n * 1000n), // 30 days ms
      ],
    });
    const ffResult = await client.core.signAndExecuteTransaction({ transaction: ffTx, signer: keypair, include: { effects: true } });
    if (ffResult.$kind === 'FailedTransaction') {
      emit({ type: 'progress', message: 'Fast-forward failed (not admin?) — proceeding with accrued yield' });
    } else {
      // Wait for fast-forward to be finalized before previewYield reads chain state.
      // Without this, simulateTransaction sees stale state and returns 0.
      const ffDigest = (ffResult as { Transaction?: { digest?: string } }).Transaction?.digest;
      if (ffDigest) await client.core.waitForTransaction({ digest: ffDigest });
    }

    // Preview yield
    emit({ type: 'progress', message: 'Previewing yield amount…' });
    const yieldAmount = await previewYield(client, keeperAddress, portfolioId, mockLendingId);
    if (yieldAmount < 100n) { // less than 0.0001 DUSDC
      emit({ type: 'error', message: `Yield too small to bet (${yieldAmount} raw) — MockLending may not be configured` });
      await disconnectPrisma();
      process.exit(1);
    }
    emit({ type: 'progress', message: `Yield to deploy: ${Number(yieldAmount) / 1e6} DUSDC → Predict range bet` });

    emit({ type: 'progress', message: 'Executing principal-protected yield bet on Predict…' });
    const ppResult = await executePrincipalProtectedCycle(
      client, keypair, portfolioId, policyCapId, managerId,
      oracleMeta.oracle_id, expiryBigInt, oracleState.forward_raw,
      mockLendingId, navPerShare, yieldAmount,
    );
    supplyTxDigest = ppResult.tx_digest;
    emit({ type: 'tx', protocol: 'DeepBook Predict', label: 'Yield bet ↗', digest: supplyTxDigest, url: `${EXPLORER_URL}/${supplyTxDigest}` });

  // ── Strategy ⑦ Margin Loop ───────────────────────────────────────────────────
  } else if (strategy === 'MARGIN_LOOP') {
    const managerId = portfolio.managerId;
    if (!managerId) {
      emit({ type: 'error', message: 'No managerId in DB — run keeper-setup for this portfolio first' });
      await disconnectPrisma();
      process.exit(1);
    }
    const mockMarginId = env.MOCK_MARGIN_ID;
    if (!mockMarginId) {
      emit({ type: 'error', message: 'MOCK_MARGIN_ID not set in keeper env' });
      await disconnectPrisma();
      process.exit(1);
    }

    // Borrow up to 30% of available balance for the demo (small, safe amount)
    const borrowAmount = chainState.available_balance_raw > 0n
      ? BigInt(Math.min(Number(chainState.available_balance_raw) * 0.3, Number(MAX_DEMO)))
      : MIN_SUPPLY;
    if (borrowAmount < 1000n) {
      emit({ type: 'error', message: 'Available balance too low for margin borrow demo' });
      await disconnectPrisma();
      process.exit(1);
    }
    emit({ type: 'progress', message: `Borrowing ${Number(borrowAmount) / 1e6} DUSDC from MockMargin → Predict range bet…` });
    const mlResult = await executeMarginLoopCycle(
      client, keypair, portfolioId, policyCapId, managerId, mockMarginId,
      oracleMeta.oracle_id, expiryBigInt, oracleState.forward_raw,
      navPerShare, borrowAmount,
      null, null, null, null, // no prior positions on first demo cycle
      0n, // repay 0 (no prior borrow)
      (portfolio.strikeSelection ?? 'ATM') as 'ATM' | 'OTM_1' | 'OTM_2',
    );
    supplyTxDigest = mlResult.tx_digest;
    emit({ type: 'tx', protocol: 'DeepBook Predict', label: 'Margin bet ↗', digest: supplyTxDigest, url: `${EXPLORER_URL}/${supplyTxDigest}` });

  } else {
    emit({ type: 'error', message: `Strategy ${strategy} not supported for demo cycles` });
    await disconnectPrisma();
    process.exit(1);
  }

  // Record in DB
  emit({ type: 'progress', message: 'Recording cycle in database…' });
  const cycle = await prisma.keeperCycle.create({
    data: {
      portfolioId:       portfolio.id,
      oracleId:          oracleMeta.oracle_id,
      expiryMs:          expiryBigInt,
      status:            'done',
      skipReason:        null,
      supplyTxDigest,
      hedgeTxDigest,
      hedgeDirection,
      coverageRatioPct:  coverageRatioPct ?? 0,
      navPerShareBefore: chainState.nav_per_share,
      navPerShareAfter:  navPerShare,
      quoteBalanceRaw:   chainState.quote_balance_raw,
      lpBalanceRaw:      chainState.lp_balance_raw,
      atmVol:            oracleState.svi ? Math.sqrt(Math.max(0, (oracleState.svi.a ?? 0)) / Math.max(0.001, oracleState.t_years)) : null,
      entryGuardSkipped: true, // forced demo cycle bypasses vol check
    },
  });

  emit({
    type: 'done',
    cycleId: cycle.id,
    supplyTxDigest,
    hedgeTxDigest,
    hedgeDirection,
    coverageRatioPct,
  });

  await disconnectPrisma();
}

main().catch(async (err) => {
  emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  await disconnectPrisma().catch(() => undefined);
  process.exit(1);
});
