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

/** Weight of a first-time candidate. Halved per previous win, floored at 1. */
export const FRESH_WEIGHT = 1024;
/** Beyond this many past wins the weight stops shrinking (stays at 1/1024). */
const MAX_PENALIZED_WINS = 10;

/**
 * Chance multiplier for a candidate who already won `pastWins` giveaways before:
 * halved per win (1 win → 50%, 2 → 25%, 3 → 12.5%, …), never zero — a repeat
 * winner stays possible, just far less likely than someone who never won.
 */
export function repeatWinnerWeight(pastWins: number): number {
  if (pastWins <= 0) return FRESH_WEIGHT;
  return FRESH_WEIGHT / 2 ** Math.min(pastWins, MAX_PENALIZED_WINS);
}

/**
 * Secure random selection without replacement, weighted by `weightOf` (higher =
 * more likely). Weights are integers ≥ 1, so no candidate is ever excluded.
 * Already-selected winners are removed from the pool before the next pick.
 * Pass a constant weightOf for an equal-chance draw.
 *
 * Note: `entries` (referral bonus) is NOT used here — invites still don't buy odds.
 */
export function drawWinners(
  pool: WeightedEntry[],
  count: number,
  weightOf: (entry: WeightedEntry) => number = () => 1,
): WeightedEntry[] {
  const remaining = pool.map((entry) => ({
    entry,
    weight: Math.max(1, Math.round(weightOf(entry))),
  }));
  const winners: WeightedEntry[] = [];

  while (winners.length < count && remaining.length > 0) {
    const total = remaining.reduce((sum, r) => sum + r.weight, 0);
    let ticket = secureRandomBelow(total);
    let idx = 0;
    while (idx < remaining.length - 1) {
      ticket -= remaining[idx].weight;
      if (ticket < 0) break;
      idx++;
    }
    winners.push(remaining[idx].entry);
    remaining.splice(idx, 1);
  }
  return winners;
}
