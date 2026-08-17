// Cryptographically secure random helpers (Web Crypto API only — never Math.random).

/**
 * Uniform integer in [0, max) using rejection sampling to avoid modulo bias.
 */
export function secureRandomBelow(max: number): number {
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error(`secureRandomBelow: max must be a positive integer, got ${max}`);
  }
  if (max === 1) return 0;

  const range = 0x1_0000_0000; // 2^32
  const limit = range - (range % max);
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

export interface WeightedEntry {
  userId: number;
  telegramId: string;
  entries: number;
}

/**
 * Secure weighted random selection without replacement.
 * A candidate with `entries = 4` is 4x as likely to be picked as one with `entries = 1`.
 * Already-selected winners are removed from the pool before the next pick.
 */
export function drawWinners(pool: WeightedEntry[], count: number): WeightedEntry[] {
  const remaining = pool.filter((p) => p.entries > 0);
  const winners: WeightedEntry[] = [];

  while (winners.length < count && remaining.length > 0) {
    const total = remaining.reduce((sum, p) => sum + p.entries, 0);
    if (total <= 0) break;

    let target = secureRandomBelow(total);
    let idx = 0;
    for (; idx < remaining.length; idx++) {
      target -= remaining[idx].entries;
      if (target < 0) break;
    }
    if (idx >= remaining.length) idx = remaining.length - 1; // safety guard
    winners.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return winners;
}
