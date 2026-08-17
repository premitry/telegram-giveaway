import type { Env } from '../types';
import { sendMessage } from '../telegram/api';

export interface BroadcastMessage {
  chatId: string;
  text: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enqueue a broadcast to every valid participant of a giveaway.
 * Messages are pushed to Cloudflare Queues in batches; the consumer sends them
 * gradually so the Worker request stays within execution limits.
 * Returns the number of recipients enqueued.
 */
export async function enqueueBroadcast(
  env: Env,
  giveawayId: number,
  text: string,
): Promise<number> {
  const queue = env.BROADCAST_QUEUE;
  if (!queue) {
    // Free plan: Queues binding not available. Signal caller to explain.
    throw new Error('QUEUE_UNAVAILABLE');
  }

  const res = await env.DB.prepare(
    `SELECT u.telegram_id AS telegram_id
       FROM participants p
       JOIN users u ON u.id = p.user_id
      WHERE p.giveaway_id = ? AND p.is_valid = 1`,
  )
    .bind(giveawayId)
    .all<{ telegram_id: string }>();

  const recipients = res.results ?? [];
  if (recipients.length === 0) return 0;

  const chunkSize = 100;
  for (let i = 0; i < recipients.length; i += chunkSize) {
    const chunk = recipients.slice(i, i + chunkSize);
    await queue.sendBatch(
      chunk.map((r) => ({ body: { chatId: r.telegram_id, text } satisfies BroadcastMessage })),
    );
  }
  return recipients.length;
}

/** Queue consumer: send each queued broadcast message, pacing to respect rate limits. */
export async function handleBroadcastBatch(
  batch: MessageBatch<BroadcastMessage>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const res = await sendMessage(env, msg.body.chatId, msg.body.text);
      // ok:false from a blocked/deactivated user should not be retried forever.
      if (!res.ok) {
        console.warn(`broadcast to ${msg.body.chatId} skipped: ${res.description}`);
      }
      msg.ack();
      await sleep(50); // ~20 msg/s, well under Telegram's limits
    } catch (err) {
      console.error(`broadcast to ${msg.body.chatId} errored`, err);
      msg.retry();
    }
  }
}
