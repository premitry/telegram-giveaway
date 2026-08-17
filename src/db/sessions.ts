import type { WizardData, WizardStep } from '../types';
import { nowIso } from '../utils/datetime';

export interface AdminSession {
  telegramId: string;
  step: WizardStep;
  data: WizardData;
}

export async function getSession(
  db: D1Database,
  telegramId: string,
): Promise<AdminSession | null> {
  const row = await db
    .prepare(`SELECT step, data FROM admin_sessions WHERE telegram_id = ?`)
    .bind(telegramId)
    .first<{ step: string; data: string | null }>();
  if (!row) return null;
  let data: WizardData = {};
  if (row.data) {
    try {
      data = JSON.parse(row.data) as WizardData;
    } catch {
      data = {};
    }
  }
  return { telegramId, step: row.step as WizardStep, data };
}

export async function setSession(
  db: D1Database,
  telegramId: string,
  step: WizardStep,
  data: WizardData,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_sessions (telegram_id, step, data, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         step = excluded.step,
         data = excluded.data,
         updated_at = excluded.updated_at`,
    )
    .bind(telegramId, step, JSON.stringify(data), nowIso())
    .run();
}

export async function clearSession(db: D1Database, telegramId: string): Promise<void> {
  await db.prepare(`DELETE FROM admin_sessions WHERE telegram_id = ?`).bind(telegramId).run();
}
