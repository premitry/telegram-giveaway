/** Runtime admins added via /add (in addition to the fixed ADMIN_IDS owners). */
export async function isDbAdmin(db: D1Database, telegramId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM admins WHERE telegram_id = ?`)
    .bind(telegramId)
    .first<{ ok: number }>();
  return !!row;
}

export async function addAdmin(db: D1Database, telegramId: string): Promise<void> {
  await db
    .prepare(`INSERT INTO admins (telegram_id) VALUES (?) ON CONFLICT(telegram_id) DO NOTHING`)
    .bind(telegramId)
    .run();
}

export async function removeAdmin(db: D1Database, telegramId: string): Promise<void> {
  await db.prepare(`DELETE FROM admins WHERE telegram_id = ?`).bind(telegramId).run();
}

export async function listAdmins(db: D1Database): Promise<string[]> {
  const res = await db
    .prepare(`SELECT telegram_id FROM admins ORDER BY telegram_id`)
    .all<{ telegram_id: string }>();
  return (res.results ?? []).map((r) => r.telegram_id);
}
