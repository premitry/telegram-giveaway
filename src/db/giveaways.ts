import type { GiveawayRow, GiveawayStatus } from '../types';
import { nowIso } from '../utils/datetime';

/** Fields needed to persist a new giveaway (already normalized from the wizard). */
export interface NewGiveaway {
  title: string;
  description: string | null;
  prize: string;
  prizes_json: string | null;
  winners_count: number;
  required_channel: string;
  deadline: string;
  max_referral_bonus: number;
  image_file_id: string | null;
  publish_chat_id: string | null;
}

/** Create a giveaway in `draft` status. Returns the new id. */
export async function createGiveaway(db: D1Database, data: NewGiveaway): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO giveaways
         (title, description, prize, prizes_json, winners_count, required_channel, deadline,
          max_referral_bonus, image_file_id, publish_chat_id, status, auto_draw, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?)`,
    )
    .bind(
      data.title,
      data.description ?? null,
      data.prize,
      data.prizes_json ?? null,
      data.winners_count,
      data.required_channel,
      data.deadline,
      data.max_referral_bonus,
      data.image_file_id ?? null,
      data.publish_chat_id ?? null,
      nowIso(),
    )
    .run();

  const id = res.meta.last_row_id;
  if (!id) throw new Error('createGiveaway: no last_row_id');
  return id;
}

export function getGiveaway(db: D1Database, id: number): Promise<GiveawayRow | null> {
  return db.prepare(`SELECT * FROM giveaways WHERE id = ?`).bind(id).first<GiveawayRow>();
}

/** Latest non-draft giveaway (used as the default target for admin commands). */
export function getLatestGiveaway(db: D1Database): Promise<GiveawayRow | null> {
  return db
    .prepare(`SELECT * FROM giveaways WHERE status != 'draft' ORDER BY id DESC LIMIT 1`)
    .first<GiveawayRow>();
}

/** Giveaways an admin can pick from (newest first) — used by the delete picker. */
export async function listGiveaways(db: D1Database, limit = 25): Promise<GiveawayRow[]> {
  const res = await db
    .prepare(`SELECT * FROM giveaways ORDER BY id DESC LIMIT ?`)
    .bind(limit)
    .all<GiveawayRow>();
  return res.results ?? [];
}

export async function setGiveawayStatus(
  db: D1Database,
  id: number,
  status: GiveawayStatus,
): Promise<void> {
  await db.prepare(`UPDATE giveaways SET status = ? WHERE id = ?`).bind(status, id).run();
}

export async function setPublishInfo(
  db: D1Database,
  id: number,
  chatId: string,
  messageId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE giveaways SET publish_chat_id = ?, publish_message_id = ?, status = 'active' WHERE id = ?`)
    .bind(chatId, messageId, id)
    .run();
}

/** Active giveaways whose deadline has already passed. */
export async function getExpiredActive(db: D1Database, nowUtcIso: string): Promise<GiveawayRow[]> {
  const res = await db
    .prepare(`SELECT * FROM giveaways WHERE status = 'active' AND deadline <= ?`)
    .bind(nowUtcIso)
    .all<GiveawayRow>();
  return res.results ?? [];
}

/**
 * Permanently delete a giveaway and everything tied to it (participants,
 * referrals, winners). Used to remove a giveaway created by mistake.
 * The published channel post is handled separately by the caller.
 */
export async function deleteGiveaway(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM participants WHERE giveaway_id = ?`).bind(id),
    db.prepare(`DELETE FROM referrals WHERE giveaway_id = ?`).bind(id),
    db.prepare(`DELETE FROM winners WHERE giveaway_id = ?`).bind(id),
    db.prepare(`DELETE FROM giveaways WHERE id = ?`).bind(id),
  ]);
}
