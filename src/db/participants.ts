import type { ParticipantRow } from '../types';
import type { WeightedEntry } from '../utils/random';
import { nowIso } from '../utils/datetime';

export function getParticipant(
  db: D1Database,
  giveawayId: number,
  userId: number,
): Promise<ParticipantRow | null> {
  return db
    .prepare(`SELECT * FROM participants WHERE giveaway_id = ? AND user_id = ?`)
    .bind(giveawayId, userId)
    .first<ParticipantRow>();
}

/** Insert a participant. Returns false if the user already joined (UNIQUE conflict). */
export async function insertParticipant(
  db: D1Database,
  giveawayId: number,
  userId: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO participants (giveaway_id, user_id, base_entries, referral_entries, joined_at, is_valid)
       VALUES (?, ?, 1, 0, ?, 1)`,
    )
    .bind(giveawayId, userId, nowIso())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function countParticipants(db: D1Database, giveawayId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM participants WHERE giveaway_id = ? AND is_valid = 1`)
    .bind(giveawayId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/** Valid participant counts for every giveaway, keyed by giveaway_id (one query). */
export async function countParticipantsAll(db: D1Database): Promise<Record<number, number>> {
  const res = await db
    .prepare(
      `SELECT giveaway_id AS gid, COUNT(*) AS c
         FROM participants WHERE is_valid = 1 GROUP BY giveaway_id`,
    )
    .all<{ gid: number; c: number }>();
  const map: Record<number, number> = {};
  for (const r of res.results ?? []) map[r.gid] = r.c;
  return map;
}

export async function totalEntries(db: D1Database, giveawayId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(base_entries + referral_entries), 0) AS t
         FROM participants WHERE giveaway_id = ? AND is_valid = 1`,
    )
    .bind(giveawayId)
    .first<{ t: number }>();
  return row?.t ?? 0;
}

/**
 * Increment a participant's referral_entries, capped at maxBonus.
 * Returns the new referral_entries value (or null if participant not found).
 */
export async function incrementReferralEntry(
  db: D1Database,
  giveawayId: number,
  referrerUserId: number,
  maxBonus: number,
): Promise<number | null> {
  const res = await db
    .prepare(
      `UPDATE participants
         SET referral_entries = MIN(referral_entries + 1, ?)
       WHERE giveaway_id = ? AND user_id = ?`,
    )
    .bind(maxBonus, giveawayId, referrerUserId)
    .run();
  if ((res.meta.changes ?? 0) === 0) return null;

  const row = await db
    .prepare(`SELECT referral_entries FROM participants WHERE giveaway_id = ? AND user_id = ?`)
    .bind(giveawayId, referrerUserId)
    .first<{ referral_entries: number }>();
  return row?.referral_entries ?? null;
}

/** Valid participants joined with their telegram_id and total weighted entries. */
export async function listWeightedParticipants(
  db: D1Database,
  giveawayId: number,
): Promise<WeightedEntry[]> {
  const res = await db
    .prepare(
      `SELECT p.user_id AS userId, u.telegram_id AS telegramId,
              (p.base_entries + p.referral_entries) AS entries
         FROM participants p
         JOIN users u ON u.id = p.user_id
        WHERE p.giveaway_id = ? AND p.is_valid = 1`,
    )
    .bind(giveawayId)
    .all<WeightedEntry>();
  return res.results ?? [];
}
