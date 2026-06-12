/**
 * On-chain portfolio state reads.
 *
 * Reads quote_balance, lp_balance, total_shares, locked_principal, yield_accumulated
 * for a SonarkPortfolio<DUSDC> via DevInspect on the keeper's sender address.
 *
 * These are all pure view functions — no state is changed.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { env, PLP_TYPE, CLOCK_ID } from '../env.js';
import { withRetry } from '../util/retry.js';

const SONARK = () => env.SONARK_PACKAGE;
const DUSDC = env.DUSDC_TYPE;

// ── Low-level helper ────────────────────────────────────────────────────────

async function readU64(
  client: SuiGrpcClient,
  sender: string,
  target: string,
  typeArgs: string[],
  objectId: string,
): Promise<bigint> {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({ target, typeArguments: typeArgs, arguments: [tx.object(objectId)] });
  const sim = await client.core.simulateTransaction({
    transaction: tx,
    include: { commandResults: true },
  });
  if (sim.$kind === 'FailedTransaction') {
    throw new Error(`DevInspect failed (${target}): ${JSON.stringify(sim.FailedTransaction?.status)}`);
  }
  const bcs = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (!bcs) throw new Error(`No returnValues from ${target}`);
  return Buffer.from(bcs).readBigUInt64LE(0) as unknown as bigint;
}

// ── Portfolio state ─────────────────────────────────────────────────────────

export interface PortfolioChainState {
  quote_balance_raw: bigint;
  lp_balance_raw: bigint;
  total_shares: bigint;
  locked_principal_raw: bigint;
  yield_accumulated_raw: bigint;
  available_balance_raw: bigint;
  nav_per_share: bigint;
  nav_updated_at_ms: bigint;
  paused: boolean;
}

export async function readPortfolioChainState(
  client: SuiGrpcClient,
  portfolioId: string,
  sender: string,
): Promise<PortfolioChainState> {
  const pkg = SONARK();
  const [
    quote_balance_raw,
    lp_balance_raw,
    total_shares,
    locked_principal_raw,
    yield_accumulated_raw,
  ] = await withRetry(
    () => Promise.all([
      readU64(client, sender, `${pkg}::portfolio::quote_balance`, [DUSDC], portfolioId),
      readU64(client, sender, `${pkg}::portfolio::lp_balance`,    [DUSDC, PLP_TYPE], portfolioId),
      readU64(client, sender, `${pkg}::portfolio::total_shares`,  [DUSDC], portfolioId),
      readU64(client, sender, `${pkg}::portfolio::locked_principal`, [DUSDC], portfolioId),
      readU64(client, sender, `${pkg}::portfolio::yield_accumulated`, [DUSDC], portfolioId),
    ]),
    `readPortfolioChainState(${portfolioId.slice(0, 8)}...)`,
  );

  const nav_per_share = await withRetry(
    () => readNavPerShare(client, sender, portfolioId),
    `readNavPerShare(${portfolioId.slice(0, 8)}...)`,
  );
  const nav_updated_at_ms = await withRetry(
    () => readNavUpdatedAt(client, sender, portfolioId),
    `readNavUpdatedAt(${portfolioId.slice(0, 8)}...)`,
  );
  const paused = await withRetry(
    () => readPaused(client, sender, portfolioId),
    `readPaused(${portfolioId.slice(0, 8)}...)`,
  );

  const reserved = locked_principal_raw + yield_accumulated_raw;
  const available_balance_raw = quote_balance_raw > reserved
    ? quote_balance_raw - reserved
    : 0n;

  return {
    quote_balance_raw,
    lp_balance_raw,
    total_shares,
    locked_principal_raw,
    yield_accumulated_raw,
    available_balance_raw,
    nav_per_share,
    nav_updated_at_ms,
    paused,
  };
}

async function readNavPerShare(
  client: SuiGrpcClient,
  sender: string,
  portfolioId: string,
): Promise<bigint> {
  return readU64(client, sender, `${SONARK()}::portfolio::nav_per_share`, [DUSDC], portfolioId);
}

async function readNavUpdatedAt(
  client: SuiGrpcClient,
  sender: string,
  portfolioId: string,
): Promise<bigint> {
  return readU64(client, sender, `${SONARK()}::portfolio::nav_updated_at`, [DUSDC], portfolioId);
}

async function readPaused(
  client: SuiGrpcClient,
  sender: string,
  portfolioId: string,
): Promise<boolean> {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${SONARK()}::portfolio::paused`,
    typeArguments: [DUSDC],
    arguments: [tx.object(portfolioId)],
  });
  const sim = await client.core.simulateTransaction({
    transaction: tx,
    include: { commandResults: true },
  });
  if (sim.$kind === 'FailedTransaction') return false;
  const bcs = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
  return bcs ? bcs[0] === 1 : false;
}

/**
 * Read the LP balance for a specific LP token type using the TypeName-Bag pattern.
 * Used by Task 3 (bettor MTM computation) to determine how much PLP the portfolio holds.
 */
export async function readLpBalance(
  client: SuiGrpcClient,
  portfolioId: string,
  sender: string,
): Promise<bigint> {
  const pkg = SONARK();
  return withRetry(
    () => readU64(client, sender, `${pkg}::portfolio::lp_balance`, [DUSDC, PLP_TYPE], portfolioId),
    `readLpBalance(${portfolioId.slice(0, 8)}...)`,
  );
}

/**
 * Read PolicyCap ID stored inside the portfolio.
 * Used to find the PolicyCap object when processing portfolios from DB.
 */
export async function readPolicyId(
  client: SuiGrpcClient,
  portfolioId: string,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client.core as any).getObject({
    objectId: portfolioId,
    include: { json: true },
  });
  const json = result?.object?.json ?? result?.json;
  if (!json || typeof json !== 'object') {
    throw new Error(`getObject(${portfolioId}) returned no JSON`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = (json as Record<string, any>)['policy_id'] as string | undefined;
  if (!id) throw new Error(`portfolio ${portfolioId} missing policy_id`);
  return id;
}

/**
 * Read the Manager ID registered inside the portfolio.
 * Returns null if no manager has been registered yet.
 */
export async function readManagerId(
  client: SuiGrpcClient,
  portfolioId: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client.core as any).getObject({
    objectId: portfolioId,
    include: { json: true },
  });
  const json = result?.object?.json ?? result?.json;
  if (!json || typeof json !== 'object') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mgr = (json as Record<string, any>)['manager_id'] as unknown;
  if (!mgr || typeof mgr !== 'object') return null;
  const inner = (mgr as Record<string, unknown>)['id'] as string | undefined;
  return inner ?? null;
}
