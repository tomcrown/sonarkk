/**
 * reset-db.ts — Mark all portfolios, open positions, and vault configs as inactive.
 * Run this before re-deploying all strategies after a contract republish.
 *
 * Usage: pnpm --filter @sonarkk/keeper exec tsx src/reset-db.ts
 */
import { getPrismaClient, disconnectPrisma } from '@sonarkk/core';

const p = getPrismaClient();

const portfolios = await p.portfolio.findMany({ select: { id: true, strategy: true } });
console.log(`Found ${portfolios.length} portfolios. Marking inactive...`);
for (const port of portfolios) {
  await p.portfolio.update({ where: { id: port.id }, data: { isActive: false } });
  console.log(`  deactivated: ${port.strategy}`);
}

const positions = await p.openPosition.deleteMany({ where: {} });
console.log(`Deleted ${positions.count} open positions.`);

const vaults = await p.vaultConfig.updateMany({ where: {}, data: { isPublic: false } });
console.log(`Deactivated ${vaults.count} vault configs.`);

console.log('DB reset complete — safe to run deploy-all-strategies.');
await disconnectPrisma();
