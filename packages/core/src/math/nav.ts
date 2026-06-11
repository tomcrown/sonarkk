/**
 * Full NAV formula for Sonark portfolios.
 *
 * total_nav = quote_balance + lp_value_in_dusdc + bettor_mtm
 * nav_per_share = total_nav × 1e9 / total_shares
 *
 * quote_balance: raw DUSDC sitting in the portfolio Balance<Quote>.
 *
 * lp_value_in_dusdc: proportional redemption value of held PLP tokens.
 *   CORRECT formula: lp_value = portfolio_plp_balance × vault_value / plp_total_supply
 *   where:
 *     vault_value      = predict::balance<DUSDC>(&Predict) — total DUSDC in the Predict vault
 *     plp_total_supply = total PLP outstanding (from Predict object content via GraphQL)
 *   This gives the portfolio's proportional share of the vault. If the portfolio holds
 *   1% of all PLP, its LP value is 1% of vault_value — NOT 100% of vault_value.
 *
 * bettor_mtm: mark-to-market of open bettor positions (strategies ⑤⑥⑦).
 *   Computed by calling predict::get_trade_amounts for each open position.
 *
 * Principal-Protected adjustment:
 *   available_balance = quote_balance - locked_principal - yield_accumulated
 *
 * All amounts use the on-chain precision: 6 decimals for DUSDC (1e6 per unit).
 * nav_per_share is scaled 1e9 to preserve precision in integer arithmetic on-chain.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { CoreClient } from '@mysten/sui/client';

// ── Types ──────────────────────────────────────────────────────────────────

/** Raw on-chain NAV components (all in DUSDC raw units, 6 dp). */
export interface NavComponents {
  quote_balance_raw: bigint;    // raw DUSDC from portfolio::quote_balance
  lp_balance_raw: bigint;       // raw PLP from portfolio::lp_balance
  lp_value_raw: bigint;         // DUSDC value: lp_balance × vault_value / plp_total_supply
  bettor_mtm_raw: bigint;       // MTM of open bettor positions
  total_nav_raw: bigint;        // quote_balance + lp_value + bettor_mtm
  total_shares: bigint;         // from portfolio::total_shares
  nav_per_share: bigint;        // total_nav × 1e9 / total_shares
  locked_principal_raw: bigint; // for principal-protected strategy
  yield_accumulated_raw: bigint;
  available_balance_raw: bigint; // quote_balance - locked_principal - yield_accumulated
  vault_value_raw: bigint;       // predict::balance<DUSDC> at computation time
  plp_total_supply_raw: bigint;  // PLP total supply at computation time
}

/** A single open bettor position returned by the predict-server. */
export interface OpenBettorPosition {
  market_key: string;
  position_type: 'binary' | 'range';
  notional_raw: bigint;         // DUSDC paid at entry
  current_payout_raw: bigint;   // payout if settled now (from get_trade_amounts)
}

export interface NavInputs {
  /** Portfolio object ID. */
  portfolio_id: string;
  /** Predict shared object ID. */
  predict_id: string;
  /** Sonark package ID. */
  sonark_package: string;
  /** DeepBook Predict package ID. */
  predict_package: string;
  /** DUSDC type (e.g. 0x...::dusdc::DUSDC). */
  dusdc_type: string;
  /** PLP type (e.g. 0x...::plp::PLP). */
  plp_type: string;
  /** Caller address for DevInspect. */
  sender: string;
  /** Open bettor positions (fetched from keeper's position book or predict-server). */
  open_bettor_positions: OpenBettorPosition[];
  /** Locked principal (principal-protected strategy only). 0n if not used. */
  locked_principal_raw: bigint;
  /** Accumulated yield (principal-protected strategy only). 0n if not used. */
  yield_accumulated_raw: bigint;
  /**
   * Total DUSDC value in the Predict vault.
   * Required. Obtain via fetchPredictVaultState() before calling computeNav().
   * Used as the numerator scaling in: lp_value = lp_balance × vault_value / plp_total_supply.
   */
  vault_value_raw: bigint;
  /**
   * Total PLP tokens outstanding (denominator in LP value formula).
   * Required. Obtain via fetchPredictVaultState() before calling computeNav().
   * Must not be approximated — incorrect value inflates or deflates LP value.
   */
  plp_total_supply_raw: bigint;
}

// ── Read helpers ───────────────────────────────────────────────────────────

const SCALING = 1_000_000_000n; // 1e9

async function readU64(
  client: CoreClient,
  sender: string,
  target: string,
  typeArguments: string[],
  objectId: string,
): Promise<bigint> {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({ target, typeArguments, arguments: [tx.object(objectId)] });
  const sim = await client.simulateTransaction({ transaction: tx, include: { commandResults: true } });
  if (sim.$kind === 'FailedTransaction') {
    throw new Error(`DevInspect failed for ${target}: ${JSON.stringify(sim)}`);
  }
  const bcs = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!bcs) throw new Error(`No returnValues for ${target}`);
  return Buffer.from(bcs).readBigUInt64LE(0) as unknown as bigint;
}

// ── Chain reads for LP value inputs ──────────────────────────────────────

/**
 * Verified Predict object JSON structure (predict-testnet-4-16):
 *
 *   vault.balance               → total DUSDC in vault (vault_value_raw)
 *   treasury_cap.total_supply.value → total PLP outstanding (plp_total_supply_raw)
 *
 * vault.balance and plp supply are read via a single gRPC getObject call on the
 * Predict shared object with include: { json: true }. No DevInspect function
 * named "predict::balance" exists in the contract — the data lives in the object.
 */

type PredictJson = {
  vault?: { balance?: string };
  treasury_cap?: { total_supply?: { value?: string } };
};

function parsePredictJson(json: PredictJson): {
  vault_value_raw: bigint;
  plp_total_supply_raw: bigint;
} {
  const vault_balance = json?.vault?.balance;
  if (!vault_balance) {
    throw new Error(
      `predict object missing vault.balance field. ` +
      `top-level keys: ${Object.keys(json ?? {}).join(', ')}`,
    );
  }

  const plp_supply = json?.treasury_cap?.total_supply?.value;
  if (!plp_supply) {
    throw new Error(
      `predict object missing treasury_cap.total_supply.value field. ` +
      `treasury_cap=${JSON.stringify(json?.treasury_cap)}`,
    );
  }

  return {
    vault_value_raw: BigInt(vault_balance),
    plp_total_supply_raw: BigInt(plp_supply),
  };
}

/**
 * Read both vault_value_raw and plp_total_supply_raw from the Predict shared object.
 *
 * Uses a single gRPC getObject call with { include: { json: true } } to read the
 * object's JSON content, then extracts:
 *   vault_value_raw      = json.vault.balance
 *   plp_total_supply_raw = json.treasury_cap.total_supply.value
 *
 * These are the two inputs for the correct LP value formula:
 *   lp_value = portfolio_plp_balance × vault_value_raw / plp_total_supply_raw
 *
 * Throws on any failure — never silently returns wrong data.
 *
 * @param coreClient    The gRPC CoreClient (from SuiGrpcClient.core).
 * @param predictId     Predict shared object ID.
 */
export async function fetchPredictVaultState(
  coreClient: CoreClient,
  predictId: string,
): Promise<{ vault_value_raw: bigint; plp_total_supply_raw: bigint }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (coreClient as any).getObject({
    objectId: predictId,
    include: { json: true },
  });

  const json = result?.object?.json ?? result?.json;
  if (!json || typeof json !== 'object') {
    throw new Error(
      `getObject(${predictId}) returned no JSON content. ` +
      `Ensure the node supports the json include option.`,
    );
  }

  return parsePredictJson(json as PredictJson);
}

// ── Main NAV computation ───────────────────────────────────────────────────

/**
 * Compute full NAV for a Sonark portfolio.
 *
 * All reads are DevInspect (no state changes). The result is used by the
 * keeper to call update_nav on-chain before processing withdrawals.
 *
 * Callers must first obtain vault_value_raw and plp_total_supply_raw via
 * fetchPredictVaultState() and pass them in NavInputs.
 */
export async function computeNav(
  client: CoreClient,
  inputs: NavInputs,
): Promise<NavComponents> {
  const {
    portfolio_id,
    sonark_package,
    dusdc_type,
    plp_type,
    sender,
    open_bettor_positions,
    locked_principal_raw,
    yield_accumulated_raw,
    vault_value_raw,
    plp_total_supply_raw,
  } = inputs;

  // Read on-chain portfolio state in parallel.
  const [quote_balance_raw, lp_balance_raw, total_shares] = await Promise.all([
    readU64(client, sender, `${sonark_package}::portfolio::quote_balance`, [dusdc_type], portfolio_id),
    readU64(client, sender, `${sonark_package}::portfolio::lp_balance`, [dusdc_type, plp_type], portfolio_id),
    readU64(client, sender, `${sonark_package}::portfolio::total_shares`, [dusdc_type], portfolio_id),
  ]);

  // LP value: the portfolio's proportional share of the Predict vault.
  //
  //   lp_value = portfolio_plp_balance × vault_value / plp_total_supply
  //
  // A portfolio holding 1% of all PLP owns 1% of vault_value.
  // Using available_withdrawal (the whole vault) as a proxy overestimates by ~100×
  // for a small holder — a critical attack surface for NAV-based withdraw accounting.
  const lp_value_raw = lp_balance_raw === 0n || plp_total_supply_raw === 0n
    ? 0n
    : (lp_balance_raw * vault_value_raw) / plp_total_supply_raw;

  // Sum bettor MTM.
  let bettor_mtm_raw = 0n;
  for (const pos of open_bettor_positions) {
    bettor_mtm_raw += pos.current_payout_raw;
  }

  const total_nav_raw = quote_balance_raw + lp_value_raw + bettor_mtm_raw;

  const nav_per_share = total_shares > 0n
    ? (total_nav_raw * SCALING) / total_shares
    : SCALING; // 1:1 when no shares outstanding (fresh vault)

  const available_balance_raw = quote_balance_raw >= locked_principal_raw + yield_accumulated_raw
    ? quote_balance_raw - locked_principal_raw - yield_accumulated_raw
    : 0n;

  return {
    quote_balance_raw,
    lp_balance_raw,
    lp_value_raw,
    bettor_mtm_raw,
    total_nav_raw,
    total_shares,
    nav_per_share,
    locked_principal_raw,
    yield_accumulated_raw,
    available_balance_raw,
    vault_value_raw,
    plp_total_supply_raw,
  };
}

// ── Formatting ─────────────────────────────────────────────────────────────

const DUSDC_DECIMALS = 1_000_000n;

function formatDusdc(raw: bigint): string {
  const whole = raw / DUSDC_DECIMALS;
  const frac = raw % DUSDC_DECIMALS;
  return `${whole}.${frac.toString().padStart(6, '0')} DUSDC`;
}

export function formatNavComponents(c: NavComponents): string {
  const nav_human = Number(c.nav_per_share) / 1e9;
  const lp_fraction = c.plp_total_supply_raw > 0n
    ? `${(Number(c.lp_balance_raw) / Number(c.plp_total_supply_raw) * 100).toFixed(6)}% of vault`
    : 'n/a (no PLP supply)';
  return [
    `quote_balance    : ${formatDusdc(c.quote_balance_raw)}`,
    `lp_balance       : ${c.lp_balance_raw} PLP`,
    `vault_value      : ${formatDusdc(c.vault_value_raw)}  (predict::balance — total DUSDC in vault)`,
    `plp_total_supply : ${c.plp_total_supply_raw} PLP`,
    `portfolio_share  : ${lp_fraction}`,
    `lp_value         : ${formatDusdc(c.lp_value_raw)}  (= ${c.lp_balance_raw} × ${c.vault_value_raw} / ${c.plp_total_supply_raw})`,
    `bettor_mtm       : ${formatDusdc(c.bettor_mtm_raw)}`,
    `total_nav        : ${formatDusdc(c.total_nav_raw)}`,
    `total_shares     : ${c.total_shares}`,
    `nav_per_share    : ${c.nav_per_share} (${nav_human.toFixed(9)} DUSDC/share)`,
    `locked_principal : ${formatDusdc(c.locked_principal_raw)}`,
    `yield_accum      : ${formatDusdc(c.yield_accumulated_raw)}`,
    `available_balance: ${formatDusdc(c.available_balance_raw)}`,
  ].join('\n');
}
