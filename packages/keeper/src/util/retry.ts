import { log } from '../logger.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

/**
 * Exponential backoff retry wrapper for all chain/RPC calls.
 * On final failure, throws — the caller decides whether to skip or abort.
 * Never swallows errors silently.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const delay = BASE_DELAY_MS * 2 ** attempt;
        log.warn({ label, attempt, delay }, `${label} failed, retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
