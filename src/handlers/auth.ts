import type { Env } from '../types';

/** True when the given Telegram user id is listed in ADMIN_IDS. */
export function isAdmin(env: Env, telegramId: string | number): boolean {
  const id = String(telegramId);
  return env.ADMIN_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(id);
}
