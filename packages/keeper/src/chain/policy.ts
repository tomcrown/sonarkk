/**
 * PolicyCap on-chain state reads.
 *
 * The keeper reads the PolicyCap before every cycle to confirm:
 *   1. The cap has NOT been revoked (object still exists).
 *   2. The cap has NOT expired (expiry_ms > now).
 *   3. The cap has remaining budget (budget_remaining > 0).
 *
 * If any check fails, the keeper marks the portfolio inactive in the DB
 * (or simply skips it) and emits a warning. This is the non-custodial
 * guarantee — enforced on-chain, verified here before spending gas.
 */

import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { log } from '../logger.js';

export interface PolicyCapState {
  exists: boolean;
  portfolio_id: string;
  budget_remaining: bigint;
  budget_cap: bigint;
  expiry_ms: bigint;
}

export type PolicyCheckResult =
  | { valid: true; state: PolicyCapState }
  | { valid: false; reason: 'revoked' | 'expired' | 'budget_exhausted'; state?: PolicyCapState };

export async function checkPolicyCap(
  client: SuiGrpcClient,
  policyCapId: string,
  portfolioId: string,
): Promise<PolicyCheckResult> {
  // The gRPC SDK throws for deleted/non-existent objects rather than returning a null result.
  // Catch and treat as revoked.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = await (client.core as any).getObject({
      objectId: policyCapId,
      include: { json: true },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('does not exist')) {
      log.warn({ policyCapId, portfolioId }, 'PolicyCap object not found (getObject threw) — keeper access revoked');
      return { valid: false, reason: 'revoked' };
    }
    throw err; // unexpected error — re-throw
  }

  // Object not found (deleted) = revoked.
  const obj = result?.object;
  if (!obj || obj.status === 'NotExists' || obj.status === 'Deleted') {
    log.warn({ policyCapId, portfolioId }, 'PolicyCap object not found — keeper access revoked');
    return { valid: false, reason: 'revoked' };
  }

  const json = obj?.json ?? result?.json;
  if (!json || typeof json !== 'object') {
    log.warn({ policyCapId }, 'PolicyCap object has no JSON content');
    return { valid: false, reason: 'revoked' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = json as Record<string, any>;
  const state: PolicyCapState = {
    exists: true,
    portfolio_id: j['portfolio_id'] as string ?? '',
    budget_remaining: BigInt(j['budget_remaining'] ?? 0),
    budget_cap: BigInt(j['budget_cap'] ?? 0),
    expiry_ms: BigInt(j['expiry_ms'] ?? 0),
  };

  const nowMs = BigInt(Date.now());
  if (state.expiry_ms <= nowMs) {
    log.warn({ policyCapId, expiryMs: state.expiry_ms.toString(), nowMs: nowMs.toString() },
      'PolicyCap expired — keeper will not act until owner refreshes');
    return { valid: false, reason: 'expired', state };
  }

  if (state.budget_remaining === 0n) {
    log.warn({ policyCapId, portfolioId }, 'PolicyCap budget exhausted for this cycle');
    return { valid: false, reason: 'budget_exhausted', state };
  }

  return { valid: true, state };
}
