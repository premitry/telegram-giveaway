import type { ReferralRow } from '../types';
import { nowIso } from '../utils/datetime';

/**
 * Store a pending referral. UNIQUE(giveaway_id, referred_user_id) prevents duplicates
 * (a referred user can only ever be attributed to one referrer per giveaway).
 * Returns false when the referral already existed.
 */
export async function insertPendingReferral(
  db: D1Database,
  giveawayId: number,
  referrerUserId: number,
  referredUserId: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO referrals (giveaway_id, referrer_user_id, referred_user_id, is_valid, created_at)
       VALUES (?, ?, ?, 0, ?)`,
    )
    .bind(giveawayId, referrerUserId, referredUserId, nowIso())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Pending (not-yet-valid) referral for a referred user in a giveaway. */
export function getPendingReferral(
  db: D1Database,
  giveawayId: number,
  referredUserId: number,
): Promise<ReferralRow | null> {
  return db
    .prepare(
      `SELECT * FROM referrals WHERE giveaway_id = ? AND referred_user_id = ? AND is_valid = 0`,
    )
    .bind(giveawayId, referredUserId)
    .first<ReferralRow>();
}

export async function markReferralValid(db: D1Database, referralId: number): Promise<void> {
  await db.prepare(`UPDATE referrals SET is_valid = 1 WHERE id = ?`).bind(referralId).run();
}

export async function countValidReferrals(
  db: D1Database,
  giveawayId: number,
  referrerUserId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM referrals
        WHERE giveaway_id = ? AND referrer_user_id = ? AND is_valid = 1`,
    )
    .bind(giveawayId, referrerUserId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function countAllValidReferrals(db: D1Database, giveawayId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM referrals WHERE giveaway_id = ? AND is_valid = 1`)
    .bind(giveawayId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}
