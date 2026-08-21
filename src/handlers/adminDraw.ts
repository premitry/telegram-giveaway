import type { Env, GiveawayRow } from '../types';
import type { TelegramMessage } from '../telegram/types';
import { sendMessage } from '../telegram/api';
import { getGiveaway, getLatestGiveaway, setGiveawayStatus } from '../db/giveaways';
import { countParticipants } from '../db/participants';
import {
  drawGiveaway,
  rerollWinner,
  renderWinnersAnnouncement,
  notifyWinners,
  listWinners,
  type DrawnWinner,
} from '../services/draw';
import { updatePublishedCard } from '../services/giveaway';
import { getUserById } from '../db/users';

/** Resolve the target giveaway from an optional numeric id argument. */
export async function resolveTarget(env: Env, args: string[]): Promise<GiveawayRow | null> {
  if (args[0] && /^\d+$/.test(args[0])) return getGiveaway(env.DB, Number(args[0]));
  return getLatestGiveaway(env.DB);
}

async function announce(env: Env, giveaway: GiveawayRow, winners: DrawnWinner[]): Promise<void> {
  const text = await renderWinnersAnnouncement(env, giveaway, winners);
  if (giveaway.publish_chat_id) {
    await sendMessage(env, giveaway.publish_chat_id, text);
  }
}

/** /draw [id] — re-check membership, draw winners securely, announce, end giveaway. */
export async function cmdDraw(env: Env, message: TelegramMessage, args: string[]): Promise<void> {
  const chatId = message.chat.id;
  const giveaway = await resolveTarget(env, args);
  if (!giveaway) { await sendMessage(env, chatId, '❌ Giveaway tidak ditemukan.'); return; }
  if (giveaway.status !== 'active' && giveaway.status !== 'awaiting_draw') {
    await sendMessage(env, chatId, `❌ Giveaway #${giveaway.id} berstatus <b>${giveaway.status}</b>, tidak bisa di-draw.`);
    return;
  }

  await sendMessage(env, chatId, '🎲 Mengundi pemenang (mengecek ulang membership)…');
  const winners = await drawGiveaway(env, giveaway);
  await setGiveawayStatus(env.DB, giveaway.id, 'ended');

  const count = await countParticipants(env.DB, giveaway.id);
  await updatePublishedCard(env, { ...giveaway, status: 'ended' }, count, false);
  await announce(env, giveaway, winners);

  if (winners.length === 0) {
    await sendMessage(env, chatId, '⚠️ Tidak ada pemenang eligible (semua kandidat gagal cek membership).');
  } else {
    const dm = await notifyWinners(env, giveaway, winners);
    await sendMessage(
      env,
      chatId,
      `✅ Draw selesai. ${winners.length} pemenang terpilih & diumumkan.\n📩 Notif DM terkirim ke ${dm}/${winners.length} pemenang.`,
    );
  }
}

/** /reroll <position> [id] — replace a single winner position. */
export async function cmdReroll(env: Env, message: TelegramMessage, args: string[]): Promise<void> {
  const chatId = message.chat.id;
  const position = Number.parseInt(args[0] ?? '', 10);
  if (!Number.isInteger(position) || position < 1) {
    await sendMessage(env, chatId, 'Gunakan: <code>/reroll &lt;position&gt; [giveaway_id]</code>');
    return;
  }
  const giveaway = await resolveTarget(env, args.slice(1));
  if (!giveaway) { await sendMessage(env, chatId, '❌ Giveaway tidak ditemukan.'); return; }

  const replacement = await rerollWinner(env, giveaway, position);
  if (!replacement) {
    await sendMessage(env, chatId, '⚠️ Tidak ada kandidat pengganti yang eligible.');
    return;
  }
  const user = await getUserById(env.DB, replacement.userId);
  const handle = user?.username ? `@${user.username}` : (user?.first_name ?? 'Winner');
  const winners = await listWinners(env, giveaway.id);
  await sendMessage(
    env,
    chatId,
    `🔁 Posisi #${position} diganti menjadi <b>${handle}</b> (${replacement.entries} 🎟).\nTotal pemenang sekarang: ${winners.length}.`,
  );
  if (giveaway.publish_chat_id) {
    await sendMessage(env, giveaway.publish_chat_id, `🔁 <b>Reroll</b> — pemenang posisi #${position} diperbarui: ${handle}`);
  }
}
