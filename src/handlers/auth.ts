import type { Env } from '../types';
import { isDbAdmin } from '../db/admins';

/**
 * Owners are the fixed IDs in ADMIN_IDS (env var). They can never be removed via
 * the bot and are the only ones allowed to manage the admin list (/add, /deladmin).
 */
export function isOwner(env: Env, telegramId: string | number): boolean {
  const id = String(telegramId);
  return env.ADMIN_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(id);
}

/**
 * Admins can run all giveaway commands. This is an owner (ADMIN_IDS) OR a user
 * added at runtime via /add (stored in the `admins` table).
 */
export async function isAdmin(env: Env, telegramId: string | number): Promise<boolean> {
  if (isOwner(env, telegramId)) return true;
  return isDbAdmin(env.DB, String(telegramId));
}
