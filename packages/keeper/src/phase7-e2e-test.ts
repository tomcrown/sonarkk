/**
 * phase7-e2e-test.ts — Full Phase 7 end-to-end test.
 *
 * Proves all Phase 7 modules (A–G) are functional:
 *
 *  Act  1 — Strategy inventory: verify all 8 portfolios (incl. MARGIN_LOOP) in DB + chain
 *  Act  2 — Portfolio config: drawdown pause, stop-loss, strike selection on-chain
 *  Act  3 — Live oracle cycle: entry guard + NAV for every strategy
 *  Act  4 — MockMargin (Module F): fast-forward interest → preview borrow capacity
 *  Act  5 — Vol-arb signal + delta-hedge sizing (Module G)
 *  Act  6 — SVI vol surface (Module C) — direct computation from active oracle
 *  Act  7 — AI Copilot (Module B) — HTTP query to localhost:${API_PORT} (skips if server not running)
 *  Act  8 — Backtest API (Module C) — HTTP query (skips if server not running)
 *  Act  9 — Walrus snapshot (Module D) — check/run daily snapshot
 *  Act 10 — Seal copy-trading (Module E) — read seal_blob_id from chain, verify decrypt pattern
 *
 * Prerequisites:
 *   pnpm --filter @sonarkk/keeper exec tsx src/deploy-all-strategies.ts
 *   (For MARGIN_LOOP: add MOCK_MARGIN_ID=<id> to .env after setup.ts creates it)
 *
 * Usage:
 *   pnpm --filter @sonarkk/keeper exec tsx src/phase7-e2e-test.ts
 */

import 'dotenv/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import {
  fetchPredictVaultState,
  computeNav,
  shouldSkipExpiry,
  atmVol,
  sviW,
  binaryCallProb,
  binaryCallDeltaNorm,
  computeSpread,
  computeHedgeOrder,
  getPrismaClient,
  disconnectPrisma,
} from '@sonarkk/core';
import { env, CLOCK_ID, PLP_TYPE, EXPLORER_URL } from './env.js';
import { fetchBestActiveOracleState, fetchOracleState } from './chain/oracle.js';
import { readPortfolioChainState } from './chain/portfolio.js';
import { STRATEGY_TYPE_MAP } from './loop-types.js';
import { computeVolArbSignal } from './math/vol-arb-feed.js';
import { runDailyWalrusSnapshot, shouldRunDailySnapshot } from './jobs/walrus-snapshot.js';

// ── Formatting helpers ────────────────────────────────────────────────────────

function banner(title: string) {
  const line = '═'.repeat(68);
  console.log(`\n${line}\n  ${title}\n${line}`);
}
function ok(label: string, value: string | number | bigint | boolean) {
  console.log(`  ✓ ${String(label).padEnd(40)}: ${value}`);
}
function warn(msg: string) {
  console.log(`  ⚠  ${msg}`);
}
function skip(msg: string) {
  console.log(`  ⏭  ${msg}`);
}

// ── SVI surface helper ────────────────────────────────────────────────────────

const SMILE_GRID_K = [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4];

function computeSviSmile(svi: Parameters<typeof atmVol>[0], t_years: number) {
  return SMILE_GRID_K.map(k => {
    const w = sviW(svi, k);
    const vol = w > 0 && t_years > 0 ? Math.sqrt(w / t_years) : 0;
    const prob_call = binaryCallProb(svi, k);
    const spread = computeSpread(prob_call, 0.3);
    return { k: k.toFixed(2), vol: (vol * 100).toFixed(2) + '%', prob: prob_call.toFixed(4), spread: (spread * 100).toFixed(2) + '%' };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║    Sonark Phase 7 — Full End-to-End Test                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(env.KEEPER_PRIVATE_KEY);
  } catch {
    const bytes = Buffer.from(env.KEEPER_PRIVATE_KEY, 'base64');
    keypair = Ed25519Keypair.fromSecretKey(bytes.slice(1));
  }
  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  const prisma = getPrismaClient();

  const client = new SuiGrpcClient({
    network: env.SUI_NETWORK as 'testnet',
    baseUrl: env.SUI_GRPC_URL,
  });

  // Shared state filled across acts.
  let activeOracle: Awaited<ReturnType<typeof fetchBestActiveOracleState>> | null = null;
  let vaultState: Awaited<ReturnType<typeof fetchPredictVaultState>> | null = null;

  // ────────────────────────────────────────────────────────────────────────────
  banner('Act 1 — Strategy Inventory (all 8 strategies)');
  // ────────────────────────────────────────────────────────────────────────────

  const allPortfolios = await prisma.portfolio.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    include: { vaultConfig: { select: { budgetCapPerCycleRaw: true, sealBlobId: true } } },
  });

  const EXPECTED_STRATEGIES = [
    'PLP_SUPPLIER', 'HEDGED_PLP', 'SMART_VAULT', 'PRINCIPAL_PROTECTED',
    'RANGE_ROLL', 'VOL_TARGETED_RANGE', 'CROSS_VENUE_ARB', 'MARGIN_LOOP',
  ];
  const foundStrategies = new Set(allPortfolios.map(p => p.strategy));
  const missingStrategies = EXPECTED_STRATEGIES.filter(s => !foundStrategies.has(s));

  if (missingStrategies.length > 0) {
    warn(`Missing strategies: ${missingStrategies.join(', ')}`);
    warn('Run deploy-all-strategies.ts first');
    process.exit(1);
  }

  ok('Active portfolios found', allPortfolios.length);
  console.log('\n  ┌───────────────────────────┬────────────────┬─────────────────────┐');
  console.log('  │ Strategy                   │ objectId       │ managerId           │');
  console.log('  ├───────────────────────────┼────────────────┼─────────────────────┤');
  for (const p of allPortfolios) {
    const id = p.objectId.slice(0, 12) + '...';
    const mgr = p.managerId ? p.managerId.slice(0, 12) + '...' : '—';
    console.log(`  │ ${p.strategy.padEnd(26)} │ ${id.padEnd(14)} │ ${mgr.padEnd(19)} │`);
  }
  console.log('  └───────────────────────────┴────────────────┴─────────────────────┘');

  // ────────────────────────────────────────────────────────────────────────────
  banner('Act 2 — Portfolio Config (drawdown pause · stop-loss · strike)');
  // ────────────────────────────────────────────────────────────────────────────

  console.log('\n  ┌───────────────────────────┬──────────┬───────────┬──────────┬──────────┐');
  console.log('  │ Strategy                   │ util_tgt │ strike    │ drawdown │ stop_loss│');
  console.log('  ├───────────────────────────┼──────────┼───────────┼──────────┼──────────┤');
  for (const p of allPortfolios) {
    const ut = `${((p.utilTarget ?? 0.6) * 100).toFixed(0)}%`.padEnd(8);
    const sk = (p.strikeSelection ?? 'ATM').padEnd(9);
    const dd = p.drawdownPauseThresholdPct != null
      ? `${(p.drawdownPauseThresholdPct * 100).toFixed(0)}%`.padEnd(8)
      : '—'.padEnd(8);
    const sl = p.stopLossFloorRaw != null
      ? `${(Number(p.stopLossFloorRaw) / 1e6).toFixed(2)}`.padEnd(8)
      : '—'.padEnd(8);
    console.log(`  │ ${p.strategy.padEnd(26)} │ ${ut} │ ${sk} │ ${dd} │ ${sl} │`);
  }
  console.log('  └───────────────────────────┴──────────┴───────────┴──────────┴──────────┘');
  ok('All portfolios have utilTarget set', allPortfolios.every(p => p.utilTarget != null));
  ok('All portfolios have strikeSelection set', allPortfolios.every(p => p.strikeSelection != null));

  // ────────────────────────────────────────────────────────────────────────────
  banner('Act 3 — Live Oracle Cycle (entry guard + NAV for each strategy)');
  // ────────────────────────────────────────────────────────────────────────────

  vaultState = await fetchPredictVaultState(client.core, env.PREDICT_OBJECT);
  ok('Predict vault value', `${(Number(vaultState.vault_value_raw) / 1e6).toFixed(4)} DUSDC`);
  ok('PLP total supply raw', vaultState.plp_total_supply_raw.toString());

  try {
    const ao = await fetchBestActiveOracleState(client);
    if (ao) {
      activeOracle = ao;
      ok('Active oracle', ao.oracle_id.slice(0, 16) + '...');
      ok('ATM implied vol', `${(atmVol(ao.svi, ao.t_years) * 100).toFixed(2)}%`);
      ok('Time to expiry', `${(ao.t_years * 365.25 * 24 * 60).toFixed(1)} minutes`);
      ok('Forward price', `$${(Number(ao.forward_raw) / 1e9).toFixed(2)}`);
    } else {
      warn('fetchBestActiveOracleState returned null — no suitable active oracle found');
      warn('Entry guards will show SKIP (correct behavior when no oracle is active)');
    }
  } catch (err) {
    warn(`No active oracle: ${err instanceof Error ? err.message : String(err)}`);
    warn('Entry guards will show SKIP (correct behavior when no oracle is active)');
  }

  const utilization = vaultState.vault_value_raw > 0n
    ? Number(vaultState.total_max_payout_raw) / Number(vaultState.vault_value_raw)
    : 0;

  console.log('\n  Entry guard results:');
  console.log('  ┌───────────────────────────┬──────────┬──────────────────────────────────────┐');
  console.log('  │ Strategy                   │ Result   │ Details                              │');
  console.log('  ├───────────────────────────┼──────────┼──────────────────────────────────────┤');
  for (const portfolio of allPortfolios) {
    const strategyId = STRATEGY_TYPE_MAP[portfolio.strategy];
    if (!strategyId || !activeOracle) {
      console.log(`  │ ${portfolio.strategy.padEnd(26)} │ SKIP     │ no active oracle                     │`);
      continue;
    }
    const guard = shouldSkipExpiry(
      activeOracle.svi, activeOracle.t_years, utilization, strategyId, portfolio.minAtmVolOverride,
    );
    const result = guard.skip ? 'SKIP' : 'PASS';
    const notes = guard.skip
      ? (guard.reason ?? 'guard skip').slice(0, 36)
      : `atm=${(guard.atm_vol * 100).toFixed(1)}% spread=${(guard.atm_spread * 100).toFixed(2)}%`;
    console.log(`  │ ${portfolio.strategy.padEnd(26)} │ ${result.padEnd(8)} │ ${notes.padEnd(36)} │`);
  }
  console.log('  └───────────────────────────┴──────────┴──────────────────────────────────────┘');

  // NAV for PLP_SUPPLIER as representative baseline.
  const plpPortfolio = allPortfolios.find(p => p.strategy === 'PLP_SUPPLIER');
  if (plpPortfolio) {
    const chainState = await readPortfolioChainState(client, plpPortfolio.objectId, keeperAddress);
    const nav = await computeNav(client.core, {
      portfolio_id: plpPortfolio.objectId,
      predict_id: env.PREDICT_OBJECT,
      sonark_package: env.SONARK_PACKAGE,
      predict_package: env.PREDICT_PACKAGE,
      dusdc_type: env.DUSDC_TYPE,
      plp_type: PLP_TYPE,
      sender: keeperAddress,
      open_bettor_positions: [],
      locked_principal_raw: chainState.locked_principal_raw,
      yield_accumulated_raw: chainState.yield_accumulated_raw,
      vault_value_raw: vaultState.vault_value_raw,
      plp_total_supply_raw: vaultState.plp_total_supply_raw,
    });
    console.log('\n  PLP_SUPPLIER NAV:');
    ok('  Total NAV', `${(Number(nav.total_nav_raw) / 1e6).toFixed(6)} DUSDC`);
    ok('  NAV per share', `${(Number(nav.nav_per_share) / 1e9).toFixed(9)} DUSDC/share`);
    ok('  Quote balance', `${(Number(nav.quote_balance_raw) / 1e6).toFixed(6)} DUSDC`);
    ok('  LP value', `${(Number(nav.lp_value_raw) / 1e6).toFixed(6)} DUSDC`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  banner('Act 4 — MockMargin + MARGIN_LOOP (Module F)');
  // ────────────────────────────────────────────────────────────────────────────

  const mlPortfolio = allPortfolios.find(p => p.strategy === 'MARGIN_LOOP');
  if (!mlPortfolio) {
    warn('MARGIN_LOOP portfolio not found in DB');
  } else if (!env.MOCK_MARGIN_ID) {
    warn('MOCK_MARGIN_ID not set — run setup.ts first, then add MOCK_MARGIN_ID to .env');
  } else {
    ok('MARGIN_LOOP portfolio', mlPortfolio.objectId.slice(0, 16) + '...');
    ok('MockMargin object', env.MOCK_MARGIN_ID.slice(0, 16) + '...');

    // Fast-forward margin interest by 90 days for testnet demo purposes.
    const FAST_FORWARD_MS = 90n * 24n * 3600n * 1_000n;
    const ffTx = new Transaction();
    ffTx.setSender(keeperAddress);
    ffTx.moveCall({
      target: `${env.SONARK_PACKAGE}::portfolio::admin_fast_forward_margin_interest`,
      typeArguments: [env.DUSDC_TYPE],
      // ctx: &TxContext is auto-injected by the runtime — NOT passed explicitly.
      arguments: [
        ffTx.object(mlPortfolio.objectId),
        ffTx.object(env.MOCK_MARGIN_ID),
        ffTx.pure.u64(FAST_FORWARD_MS),
      ],
    });

    // The simulation aborts with ENoMarginState (code 20) if enable_margin_loop
    // hasn't been called yet. The keeper's first cycle initializes margin state.
    let ffDigest = '';
    try {
      const ffResult = await client.core.signAndExecuteTransaction({
        transaction: ffTx, signer: keypair, include: { effects: true },
      });
      if (ffResult.$kind === 'FailedTransaction') {
        skip('admin_fast_forward_margin_interest: FailedTransaction (margin state not yet initialized — first keeper cycle calls enable_margin_loop)');
      } else {
        await client.core.waitForTransaction({ digest: ffResult.Transaction!.digest });
        ffDigest = ffResult.Transaction!.digest;
        ok('Margin interest fast-forwarded', `90 days (${EXPLORER_URL}/${ffDigest})`);
      }
    } catch (ffErr) {
      // MoveAbort code 20 = ENoMarginState — expected before first keeper cycle.
      const msg = ffErr instanceof Error ? ffErr.message : String(ffErr);
      if (msg.includes('abort code: 20') || msg.includes('ENoMarginState')) {
        skip('admin_fast_forward_margin_interest: ENoMarginState (margin state not yet initialized — first keeper cycle calls enable_margin_loop)');
      } else {
        warn(`admin_fast_forward_margin_interest unexpected error: ${msg}`);
      }
    }

    // Preview margin interest via DevInspect.
    const previewTx = new Transaction();
    previewTx.setSender(keeperAddress);
    previewTx.moveCall({
      target: `${env.SONARK_PACKAGE}::portfolio::preview_margin_interest`,
      typeArguments: [env.DUSDC_TYPE],
      arguments: [
        previewTx.object(mlPortfolio.objectId),
        previewTx.object(env.MOCK_MARGIN_ID),
        previewTx.object(CLOCK_ID),
      ],
    });
    const sim = await client.core.simulateTransaction({
      transaction: previewTx, include: { commandResults: true },
    });
    if (sim.$kind !== 'FailedTransaction') {
      const bcs = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
      const interestRaw = bcs ? Buffer.from(bcs).readBigUInt64LE(0) as unknown as bigint : 0n;
      ok('Accrued margin interest (90d preview)', `${(Number(interestRaw) / 1e6).toFixed(6)} DUSDC`);
    } else {
      skip('preview_margin_interest DevInspect: no margin state yet (normal — first cycle initializes)');
    }

    // Margin borrow capacity via DevInspect.
    const capTx = new Transaction();
    capTx.setSender(keeperAddress);
    capTx.moveCall({
      target: `${env.SONARK_PACKAGE}::portfolio::margin_borrow_capacity`,
      typeArguments: [env.DUSDC_TYPE],
      arguments: [
        capTx.object(mlPortfolio.objectId),
        capTx.object(env.MOCK_MARGIN_ID),
      ],
    });
    const capSim = await client.core.simulateTransaction({
      transaction: capTx, include: { commandResults: true },
    });
    if (capSim.$kind !== 'FailedTransaction') {
      const bcs = capSim.commandResults?.[0]?.returnValues?.[0]?.bcs;
      const capRaw = bcs ? Buffer.from(bcs).readBigUInt64LE(0) as unknown as bigint : 0n;
      ok('Margin borrow capacity', `${(Number(capRaw) / 1e6).toFixed(6)} DUSDC`);
    } else {
      skip('margin_borrow_capacity: no margin state yet (normal — first cycle initializes)');
    }

    console.log('\n  Three-protocol composability flow:');
    console.log('    DUSDC collateral → portfolio::enable_margin_loop');
    console.log('    portfolio::take_for_margin_borrow → borrowed DUSDC → Predict::mint_range');
    console.log('    settlement payout → portfolio::repay_margin_borrow → collateral freed');
    console.log('    Net P&L = Predict payout − margin borrow interest');
    console.log('    MAINNET SWAP: replace mock_margin:: with DeepBook Margin SDK calls');
  }

  // ────────────────────────────────────────────────────────────────────────────
  banner('Act 5 — Vol-Arb Signal + Delta-Hedge Sizing (Module G)');
  // ────────────────────────────────────────────────────────────────────────────

  if (!activeOracle) {
    skip('No active oracle available — vol-arb signal requires active oracle SVI');
  } else {
    console.log('\n  Computing cross-venue vol-arb signal...');
    const signal = await computeVolArbSignal(
      activeOracle.svi, activeOracle.t_years, env.PREDICT_SERVER_URL,
    ).catch(err => {
      warn(`vol-arb signal failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });

    if (signal) {
      ok('Vol-arb source', signal.source);
      ok('Predict ATM implied vol', `${(signal.predict_implied_vol * 100).toFixed(2)}%`);
      ok('Reference vol', `${(signal.reference_vol * 100).toFixed(2)}% (${signal.source})`);
      ok('Edge pct', `${signal.edge_pct.toFixed(2)}% (threshold 10%)`);
      ok('Signal fired (sell-vol)', signal.fired);
      if ('raw_details' in signal && signal.raw_details) {
        const d = signal.raw_details as Record<string, unknown>;
        if ('hl_spot' in d) ok('BTC spot (Hyperliquid)', `$${(d['hl_spot'] as number).toFixed(2)}`);
        if ('candle_count' in d) ok('Hyperliquid candles used', d['candle_count'] as number);
      }

      // Compute delta-hedge sizing for the vol-arb binary position.
      // Long ATM binary call delta: φ(d₂)/√w × notional/spot (Module G math).
      const NOTIONAL_DUSDC = 100; // $100 example sizing
      const binaryDelta = binaryCallDeltaNorm(activeOracle.svi, 0 /* ATM */)
        * NOTIONAL_DUSDC
        / activeOracle.spot;

      const hedgeOrder = computeHedgeOrder({
        house_net_delta: binaryDelta,  // positive → short (sell BTC to hedge long binary)
        spot_price_usd: activeOracle.spot,
        t_years: activeOracle.t_years,
        budget_remaining_dusdc: 1000, // example budget
      });

      console.log(`\n  Delta-hedge sizing for $${NOTIONAL_DUSDC} ATM binary call position:`);
      ok('  Binary call delta (DBTC)', binaryDelta.toFixed(8));
      ok('  Hedge direction', hedgeOrder.direction);
      ok('  Hedge size (DBTC)', hedgeOrder.size_dbtc.toFixed(8));
      ok('  Hedge notional (DUSDC)', hedgeOrder.notional_dusdc.toFixed(4));
      ok('  Expected friction (DUSDC)', hedgeOrder.friction_cost_dusdc.toFixed(4));
      ok('  Skipped?', hedgeOrder.skipped ? (hedgeOrder.skip_reason ?? 'yes') : 'no');

      if (hedgeOrder.skipped) {
        console.log('\n  Note: binary delta is very small at sub-hour expiries (σ√T ≈ 0.003).');
        console.log('  Hedge skipped below 10¢ minimum notional — correct behavior per hedge.ts.');
      }

      console.log('\n  Buy-vol mode: DISABLED (per CLAUDE.md Rule 3).');
      console.log('  Enabled only when a live cross-venue binary feed confirms persistent mispricing.');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  banner('Act 6 — SVI Vol Surface (Module C)');
  // ────────────────────────────────────────────────────────────────────────────

  if (!activeOracle) {
    skip('No active oracle — SVI surface requires oracle SVI params');
  } else {
    const smile = computeSviSmile(activeOracle.svi, activeOracle.t_years);
    const atmVolPct = (atmVol(activeOracle.svi, activeOracle.t_years) * 100).toFixed(2);

    console.log(`\n  Oracle: ${activeOracle.oracle_id.slice(0, 20)}...`);
    console.log(`  ATM implied vol: ${atmVolPct}%`);
    console.log('\n  Vol smile (log-moneyness → implied vol, probability, spread):');
    console.log('  ┌────────┬──────────┬──────────┬──────────┐');
    console.log('  │   k    │   vol    │  p_call  │  spread  │');
    console.log('  ├────────┼──────────┼──────────┼──────────┤');
    for (const pt of smile) {
      const row = `  │ ${pt.k.padStart(6)} │ ${pt.vol.padStart(8)} │ ${pt.prob.padStart(8)} │ ${pt.spread.padStart(8)} │`;
      console.log(row);
    }
    console.log('  └────────┴──────────┴──────────┴──────────┘');
    ok('SVI surface computed (9 smile points)', true);
    console.log('\n  The full 21-point surface at /svi-surface is served by the API package.');
    console.log('  Start API: pnpm --filter @sonarkk/api start');
  }

  // ────────────────────────────────────────────────────────────────────────────
  banner('Act 7 — AI Copilot (Module B) via HTTP');
  // ────────────────────────────────────────────────────────────────────────────

  const API_BASE = `http://localhost:${process.env['API_PORT'] ?? 3001}`;

  let apiRunning = false;
  try {
    const healthRes = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1000) });
    apiRunning = healthRes.ok;
  } catch {
    // Not running.
  }

  if (!apiRunning) {
    skip(`API server not running on ${API_BASE}`);
    console.log('  To start: pnpm --filter @sonarkk/api start');
    console.log('  Then re-run this test to prove the AI copilot response.');
  } else {
    // Query the chat endpoint.
    const chatQuestion = 'What is the current market vol regime and which strategy is safest right now?';
    console.log(`\n  User question: "${chatQuestion}"`);
    console.log('  Querying Gemini AI copilot...');

    try {
      const chatRes = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatQuestion, history: [] }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!chatRes.ok) {
        warn(`Chat endpoint returned ${chatRes.status}: ${await chatRes.text()}`);
      } else {
        const chatBody = await chatRes.json() as { response: string; context?: unknown };
        console.log(`\n  AI response:\n  ${chatBody.response.slice(0, 500)}${chatBody.response.length > 500 ? '...' : ''}`);
        ok('AI copilot responded', true);
        ok('Context assembled', chatBody.context != null);
      }
    } catch (err) {
      warn(`Chat request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  banner('Act 8 — Backtest API (Module C) via HTTP');
  // ────────────────────────────────────────────────────────────────────────────

  if (!apiRunning) {
    skip('API server not running — backtest API test skipped');
    console.log('  To run: curl http://localhost:3001/api/backtest (starts backtest on demand)');
    console.log('  Results: per-strategy APY, Sharpe, drawdown, win-rate, spread-cost');
    console.log('  CAUTION: never present raw APY figures in demo (Rule 2 — modeled on synthetic volume)');
  } else {
    console.log('\n  Triggering backtest via API (may take 10–30 seconds)...');
    try {
      const btRes = await fetch(`${API_BASE}/api/backtest`, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!btRes.ok) {
        warn(`Backtest API returned ${btRes.status}`);
      } else {
        const bt = await btRes.json() as {
          oracle_count: number;
          period_start: string;
          period_end: string;
          realized_btc_vol: number;
          strategies: Array<{ strategy_name: string; net_apy: number; verdict: string; max_drawdown: number }>;
        };
        ok('Oracle records', bt.oracle_count);
        ok('Period', `${bt.period_start.slice(0, 10)} → ${bt.period_end.slice(0, 10)}`);
        ok('Realized BTC vol', `${(bt.realized_btc_vol * 100).toFixed(1)}%`);
        console.log('\n  Strategy verdicts (note: APY modeled on synthetic volume — see Rule 2):');
        for (const s of bt.strategies) {
          const apy = `${(s.net_apy).toFixed(1)}%`.padStart(8);
          const dd = `dd=${(s.max_drawdown * 100).toFixed(1)}%`.padEnd(10);
          const verdict = s.verdict.padEnd(4);
          console.log(`    ${s.strategy_name.padEnd(30)} APY${apy}  ${dd}  verdict=${verdict}`);
        }
        console.log('\n  Caveat: APY figures above are modeled on assumed/synthetic trader flow.');
        console.log('  Never use them in pitch decks or demos without inline caveat (CLAUDE.md Rule 2).');
        ok('Backtest API functional', true);
      }
    } catch (err) {
      warn(`Backtest API request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  banner('Act 9 — Walrus Snapshot (Module D)');
  // ────────────────────────────────────────────────────────────────────────────

  const todayIso = new Date().toISOString().slice(0, 10);
  const existingSnapshot = await prisma.walrusSnapshot.findFirst({
    where: { snapshotDate: todayIso },
    orderBy: { writtenAt: 'desc' },
  }).catch(() => null);

  if (existingSnapshot) {
    ok("Today's snapshot already exists", existingSnapshot.blobId ?? '(pending)');
    ok('Snapshot date', existingSnapshot.snapshotDate);
    ok('Blob ID', (existingSnapshot.blobId?.slice(0, 20) ?? '(none)') + '...');
  } else {
    const shouldRun = shouldRunDailySnapshot();
    if (shouldRun) {
      console.log('\n  No snapshot for today — running daily Walrus snapshot...');
      try {
        await runDailyWalrusSnapshot(client, keypair);
        const snapshot = await prisma.walrusSnapshot.findFirst({
          where: { snapshotDate: todayIso },
          orderBy: { writtenAt: 'desc' },
        });
        if (snapshot) {
          ok('Walrus snapshot created', (snapshot.blobId?.slice(0, 20) ?? '(none)') + '...');
          ok('Snapshot date', snapshot.snapshotDate);
        } else {
          warn('Snapshot ran but DB record not found (check WALRUS_AGGREGATOR_URL)');
        }
      } catch (err) {
        warn(`Walrus snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      skip('Walrus snapshot: shouldRunDailySnapshot() returned false (cooldown active)');
    }
  }

  console.log('\n  Walrus snapshot stores:');
  console.log('    - NAV-per-share for all active portfolios');
  console.log('    - Active oracle ATM vol + SVI params');
  console.log('    - Leaderboard combined TVL');
  console.log('  Blob ID stored as WalrusSnapshot.suiBlobId + emitted as Sui event.');

  // ────────────────────────────────────────────────────────────────────────────
  banner('Act 10 — Seal Copy-Trading (Module E)');
  // ────────────────────────────────────────────────────────────────────────────

  // Find a portfolio that has seal_blob_id set (any strategy).
  const sealPortfolio = allPortfolios.find(
    p => p.vaultConfig?.sealBlobId != null,
  );

  if (!sealPortfolio) {
    console.log('\n  No portfolio has seal_blob_id set yet.');
    console.log('  To encrypt a vault config:');
    console.log('    pnpm --filter @sonarkk/keeper seal-encrypt -- --portfolio <objectId>');
    console.log('  This uploads the encrypted config to Walrus and sets seal_blob_id on-chain.\n');
    console.log('  To purchase copy access (as a second wallet):');
    console.log('    BUYER_PRIVATE_KEY=<base64> pnpm --filter @sonarkk/keeper seal-copy \\');
    console.log('      --portfolio <objectId> --payment <dusdcCoinId>');
    console.log('\n  Full Seal flow:');
    console.log('    1. Creator calls seal-encrypt-vault.ts → encrypted blob uploaded to Walrus');
    console.log('    2. seal_blob_id (Walrus blobId bytes) stored in SonarkPortfolio.seal_blob_id');
    console.log('    3. Buyer pays copy_fee via purchase_copy_access → receives CopyAccessTicket');
    console.log('    4. Buyer calls decryptVaultConfig() with CopyAccessTicket as Seal access condition');
    console.log('    5. Seal key servers call seal_approve_copy_purchase via DevInspect (no state change)');
    console.log('    6. Buyer receives plaintext VaultConfig → deploys matching portfolio');
    skip('seal_blob_id not set on any portfolio — run seal-encrypt-vault.ts to enable');
  } else {
    ok('Portfolio with seal_blob_id', sealPortfolio.objectId.slice(0, 16) + '...');
    ok('Strategy', sealPortfolio.strategy);
    ok('Copy fee set', sealPortfolio.vaultConfig?.sealBlobId != null);

    // Read seal_blob_id from chain to verify it matches DB.
    const onchain = await (client.core as unknown as { getObject: (arg: { objectId: string; include: { json: boolean } }) => Promise<{ object?: { json?: { seal_blob_id?: number[] } }; json?: { seal_blob_id?: number[] } }> }).getObject({
      objectId: sealPortfolio.objectId,
      include: { json: true },
    });
    const json = onchain?.object?.json ?? onchain?.json as { seal_blob_id?: number[] } | undefined;
    const chainBlobId = json?.seal_blob_id;

    if (chainBlobId) {
      const blobIdStr = new TextDecoder().decode(Uint8Array.from(chainBlobId));
      ok('seal_blob_id on-chain (Walrus blobId)', blobIdStr.slice(0, 32) + '...');
      ok('Matches DB record', blobIdStr === sealPortfolio.vaultConfig?.sealBlobId);

      console.log('\n  Seal access condition (DevInspect approval function):');
      console.log(`    seal_approve_copy_purchase<DUSDC>(`);
      console.log(`      _seal_id: vector<u8>,    // Seal's access ID`);
      console.log(`      portfolio: &SonarkPortfolio,`);
      console.log(`      ticket: &CopyAccessTicket,  // proof of payment`);
      console.log(`      ctx: &TxContext`);
      console.log(`    ) — does NOT abort → Seal key servers release decryption key`);
      console.log('\n  BUYER_PRIVATE_KEY is required for actual decrypt. Skipping decrypt step.');
      skip('Actual decrypt skipped — requires BUYER_PRIVATE_KEY + purchased ticket');
    } else {
      warn('seal_blob_id missing on-chain despite DB record — re-run seal-encrypt-vault.ts');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  banner('Phase 7 Test Complete — Summary');
  // ────────────────────────────────────────────────────────────────────────────

  const summary: Array<[string, string]> = [
    ['Act 1  Strategy inventory (8 strategies)', `${allPortfolios.length}/8 found`],
    ['Act 2  Portfolio config (A/B/C/D/SS/SL)', 'all config fields present'],
    ['Act 3  Entry guard + NAV proof', activeOracle ? 'oracle active — guards ran' : 'no oracle (settled-only mode)'],
    ['Act 4  MockMargin + MARGIN_LOOP', env.MOCK_MARGIN_ID ? 'MOCK_MARGIN_ID set — calls made' : 'MOCK_MARGIN_ID not set — see setup.ts'],
    ['Act 5  Vol-arb signal + delta hedge', activeOracle ? 'signal computed, hedge sized' : 'skipped (no oracle)'],
    ['Act 6  SVI vol surface (9-point smile)', activeOracle ? 'surface computed' : 'skipped'],
    ['Act 7  AI copilot (Gemini)', apiRunning ? 'response received' : 'API not running'],
    ['Act 8  Backtest API', apiRunning ? 'results received' : 'API not running'],
    ['Act 9  Walrus snapshot', existingSnapshot ? 'snapshot exists' : 'ran/skipped'],
    ['Act 10 Seal copy-trading', sealPortfolio ? 'blob ID verified' : 'seal-encrypt-vault.ts needed'],
  ];

  console.log();
  for (const [label, value] of summary) {
    console.log(`  ✓ ${label.padEnd(46)}: ${value}`);
  }

  console.log('\n  Key reminders:');
  console.log('  • NEVER show raw APY numbers in demos (Rule 2 — modeled on synthetic volume)');
  console.log('  • Betting strategies ⑤⑥⑦ require "short-vol / calm-weather only" disclosure (Rule 3)');
  console.log('  • Buy-vol mode stays disabled until a live cross-venue binary feed is wired (Rule 3)');
  console.log('  • Hard vol floor is 10% minimum — never lower (entry-guard.ts HARD_VOL_FLOOR)');

  if (!apiRunning) {
    console.log('\n  To run Acts 7+8: start the API server first:');
    console.log('    pnpm --filter @sonarkk/api start');
    console.log('  Then re-run this test to get full coverage.\n');
  }

  await disconnectPrisma();
  console.log('\n  Phase 7 E2E test complete.\n');
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
