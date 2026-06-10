import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '..', '..', '.cache');

async function ensureCacheDir(): Promise<void> {
  if (!existsSync(CACHE_DIR)) {
    await mkdir(CACHE_DIR, { recursive: true });
  }
}

export async function readCache<T>(key: string): Promise<T | null> {
  const path = join(CACHE_DIR, `${key}.json`);
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  await ensureCacheDir();
  const path = join(CACHE_DIR, `${key}.json`);
  await writeFile(path, JSON.stringify(data), 'utf-8');
}

// Returns whether a cache entry exists (for progress reporting).
export function cacheExists(key: string): boolean {
  return existsSync(join(CACHE_DIR, `${key}.json`));
}
