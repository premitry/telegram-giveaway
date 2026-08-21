import type { Env, GiveawayRow } from '../types';
import type { TelegramMessage } from '../telegram/types';
import { sendMessage } from '../telegram/api';
import { getGiveaway, getLatestGiveaway, setGiveawayStatus } from '../db/giveaways';
import { countParticipants } from '../db/participants';
import {
  drawGiveaway,
  rerollWinner,
  renderWinnersCardBlock,
  notifyWinners,
  listWinners,
} from '../services/draw';
import { updatePublishedCard, parsePrizes } from '../services/giveaway';
import { getUserById } from '../db/users';

/** Resolve the target giveaway from an optional numeric id argument. */
export async function resolveTarget(env: Env, args: string[]): Promise<GiveawayRow | null> {
  if (args[0] && /^\d+$/.test(args[0])) return getGiveaway(env.DB, Number(args[0]));
  return getLatestGiveaway(env.DB);
}

/**
 * Core draw: secure weighted pick with a fresh membership re-check, persist
 * winners, embed them in the published card, end the giveaway, and DM winners.
 * Shared by the /draw command and the button-driven draw flow.
 */
export async function executeDraw(
  env: Env,
  giveaway: GiveawayRow,
): Promise<{ winners: Awaited<ReturnType<typeof drawGiveaway>>; delivered: number }> {
  const winners = await drawGiveaway(env, giveaway);
  await setGiveawayStatus(env.DB, giveaway.id, 'ended');

  const count = await countParticipants(env.DB, giveaway.id);
  const winnersHtml = await renderWinnersCardBlock(env, winners, parsePrizes(giveaway));
  await updatePublishedCard(env, { ...giveaway, status: 'ended' }, count, false, winnersHtml);

  const delivered = winners.length > 0 ? await notifyWinners(env, giveaway, winners) : 0;
  return { winners, delivered };
}

/**
 * Reroll a single winner position: pick a replacement (excluding current
 * winners, re-checking membership), refresh the card, and DM the new winner.
 * Shared by /reroll and the button-driven reroll. Returns the replacement (or
 * null if no eligible candidate) plus the up-to-date winners list.
 */
export async function executeReroll(
  env: Env,
  giveaway: GiveawayRow,
  position: number,
): Promise<{ replacement: Awaited<ReturnType<typeof rerollWinner>>; winners: Awaited<ReturnType<typeof listWinners>> }> {
  const replacement = await rerollWinner(env, giveaway, position);
  const winners = await listWinners(env, giveaway.id);
  if (replacement) {
    const winnersHtml = await renderWinnersCardBlock(
      env,
      winners.map((w) => ({ position: w.position, userId: w.user_id })),
      parsePrizes(giveaway),
    );
    const count = await countParticipants(env.DB, giveaway.id);
    await updatePublishedCard(env, { ...giveaway, status: 'ended' }, count, false, winnersHtml);
    await notifyWinners(env, giveaway, [replacement]);
  }
  return { replacement, winners };
}

/** /draw [id] — re-check membership, draw winners securely, show them in the card, end giveaway. */
export async function cmdDraw(env: Env, message: TelegramMessage, args: string[]): Promise<void> {
  const chatId = message.chat.id;
  const giveaway = await resolveTarget(env, args);
  if (!giveaway) { await sendMessage(env, chatId, '❌ Giveaway tidak ditemukan.'); return; }
  if (giveaway.status !== 'active' && giveaway.status !== 'awaiting_draw') {
    await sendMessage(env, chatId, `❌ Giveaway #${giveaway.id} berstatus <b>${giveaway.status}</b>, tidak bisa di-draw.`);
    return;
  }

  await sendMessage(env, chatId, '🎲 Mengundi pemenang (mengecek ulang membership)…');
  const { winners, delivered } = await executeDraw(env, giveaway);

  if (winners.length === 0) {
    await sendMessage(env, chatId, '⚠️ Tidak ada pemenang eligible (semua kandidat gagal cek membership).');
  } else {
    await sendMessage(
      env,
      chatId,
      `✅ Draw selesai. ${winners.length} pemenang terpilih & ditampilkan di kartu giveaway.\n📩 Notif DM terkirim ke ${delivered}/${winners.length} pemenang.`,
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

  const { replacement, winners } = await executeReroll(env, giveaway, position);
  if (!replacement) {
    await sendMessage(env, chatId, '⚠️ Tidak ada kandidat pengganti yang eligible.');
    return;
  }
  const user = await getUserById(env.DB, replacement.userId);
  const handle = user?.username ? `@${user.username}` : (user?.first_name ?? 'Winner');
  await sendMessage(
    env,
    chatId,
    `🔁 Posisi #${position} diganti menjadi <b>${handle}</b>.\nKartu giveaway diperbarui & pemenang baru dinotif. Total pemenang: ${winners.length}.`,
  );
}
