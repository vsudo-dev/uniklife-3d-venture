/** Retry schedule for outbound deliveries: 30s, 60s, 2m, 4m … capped at 1 hour. */
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_CAP_MS = 60 * 60_000;

/** Pure exponential backoff for the n-th failed attempt (1-based). No jitter. */
export function computeBackoff(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  // 2^(n-1) overflows quickly; clamp the exponent before multiplying.
  const exp = Math.min(n - 1, 30);
  return Math.min(BACKOFF_BASE_MS * 2 ** exp, BACKOFF_CAP_MS);
}

/**
 * Backoff with ±20% jitter (spreads retries so a recovering receiver is not hit
 * by a thundering herd). `random` is injectable for deterministic tests.
 */
export function computeRetryDelay(attempt: number, random: () => number = Math.random): number {
  const base = computeBackoff(attempt);
  const r = Math.min(Math.max(random(), 0), 1);
  const jittered = Math.round(base * (0.8 + 0.4 * r));
  return Math.min(jittered, BACKOFF_CAP_MS);
}
