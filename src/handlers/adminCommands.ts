import type { Env } from '../types';
import type { TelegramMessage } from '../telegram/types';
import { sendMessage } from '../telegram/api';
import { setGiveawayStatus } from '../db/giveaways';
import { countParticipants, totalEntries } from '../db/participants';
import { countAllValidReferrals } from '../db/referrals';
import { updatePublishedCard } from '../services/giveaway';
import { enqueueBroadcast } from '../services/broadcast';
import { resolveTarget } from './adminDraw';
import { formatWib } from '../utils/datetime';

/** /stats [id] */
export async function cmdStats(env: Env, message: TelegramMessage, args: string[]): Promise<void> {
  const chatId = message.chat.id;
  const g = await resolveTarget(env, args);
  if (!g) { await sendMessage(env, chatId, '❌ Belum ada giveaway.'); return; }

  const [participants, entries, refs] = await Promise.all([
    countParticipants(env.DB, g.id),
    totalEntries(env.DB, g.id),
    countAllValidReferrals(env.DB, g.id),
  ]);

  await sendMessage(
    env,
    chatId,
    [
      `📊 <b>Giveaway Statistics</b> — #${g.id}`,
      `<i>${g.title}</i>`,
      '',
      `👥 Participants: <b>${participants}</b>`,
      `🔗 Valid Referrals: <b>${refs}</b>`,
      `🎟 Total Entries: <b>${entries}</b>`,
      `⏳ Status: <b>${g.status}</b>`,
      `📅 Deadline: ${formatWib(g.deadline)}`,
    ].join('\n'),
  );
}

/** /participants [id] */
export async function cmdParticipants(env: Env, message: TelegramMessage, args: string[]): Promise<void> {
  const chatId = message.chat.id;
  const g = await resolveTarget(env, args);
  if (!g) { await sendMessage(env, chatId, '❌ Belum ada giveaway.'); return; }

  const [participants, entries, refs] = await Promise.all([
    countParticipants(env.DB, g.id),
    totalEntries(env.DB, g.id),
    countAllValidReferrals(env.DB, g.id),
  ]);
  const avg = participants > 0 ? (entries / participants).toFixed(2) : '0';

  await sendMessage(
    env,
    chatId,
    [
      `👥 <b>Participants</b> — giveaway #${g.id}`,
      '',
      `• Total participants: <b>${participants}</b>`,
      `• Total entries: <b>${entries}</b>`,
      `• Valid referrals: <b>${refs}</b>`,
      `• Rata-rata entry/participant: <b>${avg}</b>`,
    ].join('\n'),
  );
}

/** /end [id] — stop accepting new participants and mark the message ENDED. */
export async function cmdEnd(env: Env, message: TelegramMessage, args: string[]): Promise<void> {
  const chatId = message.chat.id;
  const g = await resolveTarget(env, args);
  if (!g) { await sendMessage(env, chatId, '❌ Belum ada giveaway.'); return; }
  if (g.status === 'ended') { await sendMessage(env, chatId, 'ℹ️ Giveaway sudah ended.'); return; }

  await setGiveawayStatus(env.DB, g.id, 'ended');
  const count = await countParticipants(env.DB, g.id);
  await updatePublishedCard(env, { ...g, status: 'ended' }, count, false);
  await sendMessage(env, chatId, `🔒 Giveaway #${g.id} sekarang <b>ENDED</b>. Tombol JOIN dinonaktifkan.`);
}

/** /broadcast [id] <text> — queue a message to all participants. */
export async function cmdBroadcast(env: Env, message: TelegramMessage, args: string[]): Promise<void> {
  const chatId = message.chat.id;
  let target = args;
  let text: string;
  if (args[0] && /^\d+$/.test(args[0]) && args.length > 1) {
    text = args.slice(1).join(' ');
  } else {
    text = args.join(' ');
    target = [];
  }
  if (!text.trim()) {
    await sendMessage(env, chatId, 'Gunakan: <code>/broadcast [giveaway_id] pesan…</code>');
    return;
  }
  const g = await resolveTarget(env, target);
  if (!g) { await sendMessage(env, chatId, '❌ Belum ada giveaway.'); return; }

  const n = await enqueueBroadcast(env, g.id, text);
  await sendMessage(env, chatId, `📣 Broadcast di-queue ke <b>${n}</b> participant giveaway #${g.id}.`);
}
