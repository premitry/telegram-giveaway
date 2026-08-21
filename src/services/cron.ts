import type { Env } from '../types';
import { sendMessage } from '../telegram/api';
import { getExpiredActive, setGiveawayStatus } from '../db/giveaways';
import { countParticipants } from '../db/participants';
import { updatePublishedCard } from './giveaway';
import { drawGiveaway, renderWinnersAnnouncement, notifyWinners } from './draw';
import { sendBroadcastBatch } from './broadcast';
import { nowIso } from '../utils/datetime';

/**
 * Runs every 5 minutes. Flips expired active giveaways to `awaiting_draw`
 * (or auto-draws when auto_draw = 1). Never picks winners automatically
 * unless auto_draw is set. Also drains one batch of any pending broadcast.
 */
export async function runCron(env: Env): Promise<void> {
  // Drain a batch of the broadcast queue (no-op if nothing pending).
  try {
    const prog = await sendBroadcastBatch(env);
    if (prog.sent || prog.failed) {
      console.log(`cron: broadcast batch sent=${prog.sent} failed=${prog.failed} remaining=${prog.remaining}`);
    }
  } catch (err) {
    console.error('cron: broadcast batch error', err);
  }

  const expired = await getExpiredActive(env.DB, nowIso());
  if (expired.length === 0) return;
  console.log(`cron: ${expired.length} giveaway(s) past deadline`);

  for (const g of expired) {
    try {
      if (g.auto_draw === 1) {
        const winners = await drawGiveaway(env, g);
        await setGiveawayStatus(env.DB, g.id, 'ended');
        const count = await countParticipants(env.DB, g.id);
        await updatePublishedCard(env, { ...g, status: 'ended' }, count, false);
        if (g.publish_chat_id) {
          const text = await renderWinnersAnnouncement(env, g, winners);
          await sendMessage(env, g.publish_chat_id, text);
        }
        await notifyWinners(env, g, winners);
        console.log(`cron: auto-drew giveaway #${g.id} (${winners.length} winners)`);
      } else {
        await setGiveawayStatus(env.DB, g.id, 'awaiting_draw');
        const count = await countParticipants(env.DB, g.id);
        await updatePublishedCard(env, { ...g, status: 'awaiting_draw' }, count, false);
        console.log(`cron: giveaway #${g.id} -> awaiting_draw`);
      }
    } catch (err) {
      console.error(`cron: error processing giveaway #${g.id}`, err);
    }
  }
}
