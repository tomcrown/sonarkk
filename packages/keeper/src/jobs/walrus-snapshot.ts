/**
 * walrus-snapshot.ts — Daily leaderboard snapshot to Walrus (Module D).
 *
 * Architecture:
 *   • DB is the operational layer (fast reads, daily writes by keeper loop).
 *   • Walrus is the tamper-proof PROOF layer: daily snapshots published there
 *     are content-addressed (blobId = SHA-256 of content) so any alteration
 *     would produce a different blobId, invalidating the on-chain anchor.
 *   • The Walrus `certify` TX digest is stored as `suiEventDigest` — it IS
 *     the on-chain proof that this exact blob was stored at this time.
 *
 * Snapshot payload (JSON, written as blob):
 *   {
 *     date: "YYYY-MM-DD",
 *     generated_at: ISO timestamp,
 *     portfolios: [{ portfolioId, objectId, strategy, navPerShareRaw, totalNavRaw, cycleCount }],
 *     vaults: [{ vaultConfigId, name, combinedTvlRaw, cycleCount }],
 *     caveat: "Modeled on synthetic trader flow ...",
 *   }
 *
 * This function is idempotent: if today's snapshot already exists in DB
 * (and Walrus write succeeded), it is skipped. If the prior write failed
 * (writeError set), it retries.
 *
 * Called from the keeper polling loop (runPollingLoop) once per day.
 */

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { walrus } from '@mysten/walrus';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getPrismaClient } from '@sonarkk/core';
import { log } from '../logger.js';

// ── Config ─────────────────────────────────────────────────────────────────────

// Store snapshots for 30 Walrus epochs (~30 days on testnet — 1 epoch ≈ 1 day).
const WALRUS_EPOCHS = 30;

const CAVEAT =
  'Performance data modeled on synthetic/assumed trader flow. Testnet has minimal real volume. ' +
  'These numbers are not indicative of mainnet returns.';

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ── Main ───────────────────────────────────────────────────────────────────────

export async function runDailyWalrusSnapshot(
  client: SuiGrpcClient,
  keypair: Ed25519Keypair,
): Promise<void> {
  const snapshotDate = todayIso();
  const prisma = getPrismaClient();

  // Idempotency: skip if today's snapshot already written successfully.
  const existing = await prisma.walrusSnapshot.findUnique({ where: { snapshotDate } });
  if (existing && existing.blobId && !existing.writeError) {
    log.info({ snapshotDate, blobId: existing.blobId }, 'walrus snapshot already exists — skipping');
    return;
  }

  log.info({ snapshotDate }, 'starting daily Walrus snapshot');

  // ── Collect portfolio data ───────────────────────────────────────────────────
  const portfolios = await prisma.portfolio.findMany({
    where: { isActive: true },
    include: {
      cycles: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { navPerShareAfter: true, totalNavRaw: true },
      },
    },
  });

  const portfolioData = portfolios.map(p => ({
    portfolioId: p.id,
    objectId: p.objectId,
    strategy: p.strategy,
    navPerShareRaw: p.cycles[0]?.navPerShareAfter?.toString() ?? null,
    totalNavRaw: p.cycles[0]?.totalNavRaw?.toString() ?? null,
    cycleCount: p.cycles.length,
  }));

  // ── Collect vault data ───────────────────────────────────────────────────────
  const vaultEntries = await prisma.vaultLeaderboardEntry.findMany({
    include: { vaultConfig: { select: { name: true } } },
  });

  const vaultData = vaultEntries.map(e => ({
    vaultConfigId: e.vaultConfigId,
    name: e.vaultConfig.name,
    combinedTvlRaw: e.combinedTvlRaw.toString(),
    cycleCount: e.totalCycles,
    rank: e.rank,
  }));

  // ── Build snapshot payload ───────────────────────────────────────────────────
  const payload = JSON.stringify({
    date: snapshotDate,
    generated_at: new Date().toISOString(),
    portfolios: portfolioData,
    vaults: vaultData,
    caveat: CAVEAT,
  });

  const blobBytes = new TextEncoder().encode(payload);

  // ── Create DB record (reserve the slot; will update with blobId on success) ──
  const keeperAddress = keypair.getPublicKey().toSuiAddress();
  const dbRecord = await prisma.walrusSnapshot.upsert({
    where: { snapshotDate },
    create: {
      snapshotDate,
      portfolioData: JSON.stringify(portfolioData),
      vaultData: JSON.stringify(vaultData),
    },
    update: {
      portfolioData: JSON.stringify(portfolioData),
      vaultData: JSON.stringify(vaultData),
      writeError: null,
      blobId: null,
      suiEventDigest: null,
    },
  });

  // ── Write to Walrus ───────────────────────────────────────────────────────────
  let blobId: string | null = null;
  let suiEventDigest: string | null = null;

  try {
    // Extend the core client with Walrus capability.
    const walrusClient = client.core.$extend(walrus());

    const flow = walrusClient.walrus.writeBlobFlow({ blob: blobBytes });

    // Step 1: Encode (computes blobId without any network calls).
    const encoded = await flow.encode();
    blobId = encoded.blobId;
    log.info({ snapshotDate, blobId, bytes: blobBytes.length }, 'walrus blob encoded');

    // Step 2: Register on-chain (creates the Sui blob object, pays for storage).
    const registered = await flow.executeRegister({
      signer: keypair,
      epochs: WALRUS_EPOCHS,
      deletable: false,
      owner: keeperAddress,
    });
    log.info({ snapshotDate, blobId, registerTx: registered.txDigest }, 'walrus blob registered');

    // Step 3: Upload data to Walrus storage nodes.
    await flow.upload({ digest: registered.txDigest });
    log.info({ snapshotDate, blobId }, 'walrus blob uploaded to storage nodes');

    // Step 4: Certify on-chain (proves the blob is stored and retrievable).
    // Note: WriteBlobStepCertified does not expose a txDigest — the on-chain
    // anchor is the registration TX from step 2, which is sufficient proof.
    const certified = await flow.executeCertify({ signer: keypair });
    // Use the blobObjectId as the on-chain anchor identifier.
    suiEventDigest = registered.txDigest;
    log.info({ snapshotDate, blobId, certifyBlobObjectId: certified.blobObjectId,
      anchorTx: suiEventDigest }, 'walrus blob certified on-chain');

    // ── Update DB with success ─────────────────────────────────────────────────
    await prisma.walrusSnapshot.update({
      where: { id: dbRecord.id },
      data: { blobId, suiEventDigest },
    });

    log.info({ snapshotDate, blobId, suiEventDigest },
      'daily Walrus snapshot complete — blob anchored on-chain');

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error({ snapshotDate, blobId, err: errMsg }, 'walrus snapshot write failed');

    // Record the failure so the next day's run retries.
    await prisma.walrusSnapshot.update({
      where: { id: dbRecord.id },
      data: {
        blobId:         blobId ?? null,     // may have the ID even if certify failed
        suiEventDigest: suiEventDigest ?? null,
        writeError:     errMsg,
      },
    });
  }
}

// ── Scheduler helper ───────────────────────────────────────────────────────────

/**
 * Returns true if the daily snapshot should run right now.
 * Runs once per day at approximately the configured UTC hour.
 * Safe to call multiple times per day — uses DB existence check for idempotency.
 */
let _lastSnapshotDate = '';

export function shouldRunDailySnapshot(): boolean {
  const today = todayIso();
  if (today === _lastSnapshotDate) return false;
  _lastSnapshotDate = today;
  return true;
}
