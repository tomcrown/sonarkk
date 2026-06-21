/**
 * /walrus — Walrus snapshot history and on-demand trigger.
 *
 * GET /walrus/snapshots — list all snapshots (latest first)
 * POST /walrus/snapshot — trigger an on-demand snapshot (HTTP upload, no on-chain registration)
 *
 * The keeper's daily job uses the full @mysten/walrus SDK (encode→register→upload→certify)
 * which produces an on-chain Sui blob object. This on-demand endpoint uses the simpler
 * HTTP PUT to the Walrus publisher — the blobId is still content-addressed and verifiable
 * on Walruscan, but without an on-chain registration TX (suiEventDigest will be null).
 */

import { Router } from 'express';
import { getPrismaClient } from '@sonarkk/core';
import { env } from '../env.js';

export const walrusRouter = Router();

const WALRUS_EPOCHS = 30;
const CAVEAT =
  'Performance data modeled on synthetic/assumed trader flow. Testnet has minimal real volume. ' +
  'These numbers are not indicative of mainnet returns.';

interface WalrusPublisherResponse {
  newlyCreated?: { blobObject: { blobId: string } };
  alreadyCertified?: { blobId: string };
}

// GET /walrus/snapshots
walrusRouter.get('/snapshots', async (_req, res) => {
  try {
    const prisma = getPrismaClient();
    const snapshots = await prisma.walrusSnapshot.findMany({
      orderBy: { snapshotDate: 'desc' },
      take: 30,
      select: {
        id: true,
        snapshotDate: true,
        blobId: true,
        suiEventDigest: true,
        writtenAt: true,
        writeError: true,
      },
    });

    res.json({
      snapshots: snapshots.map(s => ({
        id: s.id,
        date: s.snapshotDate,
        blobId: s.blobId ?? null,
        suiEventDigest: s.suiEventDigest ?? null,
        writtenAt: s.writtenAt.toISOString(),
        writeError: s.writeError ?? null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /walrus/snapshot — on-demand trigger
walrusRouter.post('/snapshot', async (_req, res) => {
  const prisma = getPrismaClient();
  const snapshotDate = new Date().toISOString().slice(0, 10);

  try {
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

    const payload = JSON.stringify({
      date: snapshotDate,
      generated_at: new Date().toISOString(),
      portfolios: portfolioData,
      vaults: vaultData,
      caveat: CAVEAT,
    });

    const blobBytes = Buffer.from(payload, 'utf-8');

    const uploadRes = await fetch(`${env.WALRUS_PUBLISHER_URL}/v1/blobs?epochs=${WALRUS_EPOCHS}`, {
      method: 'PUT',
      body: blobBytes,
      headers: { 'Content-Type': 'application/octet-stream' },
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => 'unknown');
      throw new Error(`Walrus publisher error ${uploadRes.status}: ${text}`);
    }

    const json = await uploadRes.json() as WalrusPublisherResponse;
    const blobId = json.newlyCreated?.blobObject.blobId ?? json.alreadyCertified?.blobId;
    if (!blobId) throw new Error(`Unexpected Walrus response: ${JSON.stringify(json)}`);

    const record = await prisma.walrusSnapshot.upsert({
      where: { snapshotDate },
      create: {
        snapshotDate,
        blobId,
        suiEventDigest: null,
        portfolioData: JSON.stringify(portfolioData),
        vaultData: JSON.stringify(vaultData),
        writeError: null,
      },
      update: {
        blobId,
        suiEventDigest: null,
        portfolioData: JSON.stringify(portfolioData),
        vaultData: JSON.stringify(vaultData),
        writeError: null,
        writtenAt: new Date(),
      },
    });

    res.json({
      date: record.snapshotDate,
      blobId,
      suiEventDigest: null,
      writtenAt: record.writtenAt.toISOString(),
      walruscanUrl: `https://walruscan.com/testnet/blob/${blobId}`,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    try {
      await prisma.walrusSnapshot.upsert({
        where: { snapshotDate },
        create: { snapshotDate, writeError: errMsg, portfolioData: '[]', vaultData: '[]' },
        update: { writeError: errMsg, writtenAt: new Date() },
      });
    } catch { /* ignore secondary DB failure */ }
    res.status(500).json({ error: errMsg });
  }
});
