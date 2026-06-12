import { PrismaClient } from '@prisma/client';

let _client: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!_client) {
    _client = new PrismaClient({
      log: process.env['NODE_ENV'] === 'production' ? ['error'] : ['error', 'warn'],
    });
  }
  return _client;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
}
