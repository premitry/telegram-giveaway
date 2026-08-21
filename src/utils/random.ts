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
 * Secure UNWEIGHTED random selection without replacement — every candidate has
 * an equal chance regardless of their entry count (referrals/invites do NOT
 * boost odds). The `entries` field is kept for display only.
 * Already-selected winners are removed from the pool before the next pick.
 */
export function drawWinners(pool: WeightedEntry[], count: number): WeightedEntry[] {
  const remaining = [...pool];
  const winners: WeightedEntry[] = [];

  while (winners.length < count && remaining.length > 0) {
    const idx = secureRandomBelow(remaining.length);
    winners.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return winners;
}
