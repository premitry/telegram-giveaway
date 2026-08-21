import type { Env } from '../types';
import { sendMessage } from '../telegram/api';
import { nowIso } from '../utils/datetime';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Telegram ids of every valid participant of a giveaway. */
export async function participantChatIds(env: Env, giveawayId: number): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT u.telegram_id AS telegram_id
       FROM participants p
       JOIN users u ON u.id = p.user_id
      WHERE p.giveaway_id = ? AND p.is_valid = 1`,
  )
    .bind(giveawayId)
    .all<{ telegram_id: string }>();
  return (res.results ?? []).map((r) => r.telegram_id);
}

/** Telegram ids of every user who has ever interacted with the bot. */
export async function allUserChatIds(env: Env): Promise<string[]> {
  const res = await env.DB.prepare(`SELECT telegram_id FROM users`).all<{ telegram_id: string }>();
  return (res.results ?? []).map((r) => r.telegram_id);
}

/**
 * Queue a broadcast to a set of recipients (persisted in D1). The rows are then
 * drained in small batches by sendBroadcastBatch() — from the command handler
 * (first batch, immediately) and from the cron trigger (the rest). This keeps a
 * broadcast within the Workers subrequest limit and needs no paid Queues.
 * Returns the number of recipients queued.
 */
export async function queueBroadcast(env: Env, chatIds: string[], text: string): Promise<number> {
  const unique = [...new Set(chatIds)];
  if (unique.length === 0) return 0;
  const created = nowIso();
  // Batch inserts to keep the number of subrequests small.
  const chunkSize = 50;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
    const binds: (string)[] = [];
    for (const id of chunk) binds.push(id, text, 'pending', created);
    await env.DB.prepare(
      `INSERT INTO broadcast_queue (chat_id, text, status, created_at) VALUES ${placeholders}`,
    )
      .bind(...binds)
      .run();
  }
  return unique.length;
}

export interface BroadcastProgress {
  sent: number;
  failed: number;
  remaining: number;
}

/**
 * Send up to `limit` pending broadcast messages. Status updates are batched into
 * two queries (sent / failed) so a batch of 25 stays well under the free-plan
 * subrequest cap. Returns how many were sent/failed this call and how many
 * pending rows remain.
 */
export async function sendBroadcastBatch(env: Env, limit = 25): Promise<BroadcastProgress> {
  const res = await env.DB.prepare(
    `SELECT id, chat_id, text FROM broadcast_queue WHERE status = 'pending' ORDER BY id LIMIT ?`,
  )
    .bind(limit)
    .all<{ id: number; chat_id: string; text: string }>();
  const rows = res.results ?? [];
  if (rows.length === 0) return { sent: 0, failed: 0, remaining: 0 };

  const sentIds: number[] = [];
  const failedIds: number[] = [];
  for (const row of rows) {
    try {
      const r = await sendMessage(env, row.chat_id, row.text);
      if (r.ok) sentIds.push(row.id);
      else {
        failedIds.push(row.id);
        console.warn(`broadcast to ${row.chat_id} skipped: ${r.description}`);
      }
    } catch (err) {
      failedIds.push(row.id);
      console.error(`broadcast to ${row.chat_id} errored`, err);
    }
    await sleep(40); // ~25 msg/s, under Telegram's limits
  }

  const markStatus = async (ids: number[], status: string): Promise<void> => {
    if (ids.length === 0) return;
    const ph = ids.map(() => '?').join(', ');
    await env.DB.prepare(`UPDATE broadcast_queue SET status = ? WHERE id IN (${ph})`)
      .bind(status, ...ids)
      .run();
  };
  await markStatus(sentIds, 'sent');
  await markStatus(failedIds, 'failed');

  const rem = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM broadcast_queue WHERE status = 'pending'`,
  ).first<{ c: number }>();
  return { sent: sentIds.length, failed: failedIds.length, remaining: rem?.c ?? 0 };
}
