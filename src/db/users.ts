import type { UserRow } from '../types';
import { nowIso } from '../utils/datetime';
import type { TelegramUser } from '../telegram/types';

/** Insert or update a user by telegram_id, returning the stored row. */
export async function upsertUser(db: D1Database, tg: TelegramUser): Promise<UserRow> {
  const telegramId = String(tg.id);
  await db
    .prepare(
      `INSERT INTO users (telegram_id, username, first_name, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         username = excluded.username,
         first_name = excluded.first_name`,
    )
    .bind(telegramId, tg.username ?? null, tg.first_name ?? null, nowIso())
    .run();

  const row = await db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .bind(telegramId)
    .first<UserRow>();

  if (!row) throw new Error(`upsertUser failed for telegram_id=${telegramId}`);
  return row;
}

export function getUserByTelegramId(db: D1Database, telegramId: string): Promise<UserRow | null> {
  return db
    .prepare(`SELECT * FROM users WHERE telegram_id = ?`)
    .bind(telegramId)
    .first<UserRow>();
}

export function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
}

/** Total users who have started the bot (one row per unique telegram_id). */
export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS c FROM users`).first<{ c: number }>();
  return row?.c ?? 0;
}
