import type { Env, GiveawayRow, ParticipantRow } from '../types';
import type { CallbackQuery, InlineKeyboardMarkup } from '../telegram/types';
import { answerCallback, sendMessage, editMessageText, getBotUsername, deleteMessage } from '../telegram/api';
import { getGiveaway, getLatestGiveaway, listGiveaways, deleteGiveaway } from '../db/giveaways';
import { getUserByTelegramId } from '../db/users';
import { getParticipant, countParticipants, totalEntries } from '../db/participants';
import {
  joinGiveaway,
  entriesSummary,
} from '../services/participant';
import { updatePublishedCard, renderCaption } from '../services/giveaway';
import { channelUrl } from '../services/membership';
import { buildReferralLink } from '../services/referral';
import {
  notEligibleKeyboard,
  participatingKeyboard,
  inviteKeyboard,
  startMenuKeyboard,
  backKeyboard,
  activeMenuKeyboard,
  entriesMenuKeyboard,
  deleteListKeyboard,
  deletePickConfirmKeyboard,
  drawListKeyboard,
  drawPickConfirmKeyboard,
} from '../telegram/keyboards';
import { handleWizardCallback, startWizard } from './admin';
import { executeDraw } from './adminDraw';
import { isAdmin } from './auth';
import { WELCOME } from './start';

const HOWTO = [
  '❓ <b>Cara Ikut Giveaway</b>',
  '',
  '1️⃣ Tekan <b>🎉 Giveaway Aktif</b> lalu <b>JOIN GIVEAWAY</b>.',
  '2️⃣ Kalau diminta, <b>join channel</b> dulu lalu tekan <b>CHECK AGAIN</b>.',
  '3️⃣ Setelah masuk, tekan <b>👥 INVITE FRIENDS</b> untuk dapat link referral.',
  '',
  '🎟 Tiap teman valid = <b>+1 entry</b> (menambah peluang menang).',
].join('\n');

function participatingText(entries: number, validReferrals: number): string {
  return [
    "✅ <b>You're participating!</b>",
    '',
    `🎟 Your Entries: <b>${entries}</b>`,
    `👥 Valid Referrals: <b>${validReferrals}</b>`,
  ].join('\n');
}

/**
 * Show the "you're participating" view. When the button was pressed inside a
 * private chat menu, edit that message in place (clean navigation, with back);
 * otherwise (e.g. from the public channel post) send a fresh DM.
 */
async function showParticipating(
  env: Env,
  cq: CallbackQuery,
  giveaway: GiveawayRow,
  participant: ParticipantRow,
): Promise<void> {
  const summary = await entriesSummary(env.DB, giveaway.id, participant);
  const text = participatingText(summary.totalEntries, summary.validReferrals);
  const msg = cq.message;
  if (msg && msg.chat.type === 'private') {
    await editMessageText(env, msg.chat.id, msg.message_id, text, {
      reply_markup: entriesMenuKeyboard(giveaway.id),
    });
  } else {
    await sendMessage(env, cq.from.id, text, { reply_markup: participatingKeyboard(giveaway.id) });
  }
}

async function handleJoinOrCheck(env: Env, cq: CallbackQuery, giveawayId: number): Promise<void> {
  const giveaway = await getGiveaway(env.DB, giveawayId);
  if (!giveaway) {
    await answerCallback(env, cq.id, 'Giveaway tidak ditemukan.', true);
    return;
  }
  const result = await joinGiveaway(env, giveaway, cq.from);
  const chatId = cq.from.id;

  switch (result.status) {
    case 'inactive':
      await answerCallback(env, cq.id, '⚠️ Giveaway ini sudah berakhir atau belum aktif.', true);
      return;
    case 'not_member':
      await answerCallback(env, cq.id, '❌ Kamu belum memenuhi syarat.', true);
      await sendMessage(env, chatId, '❌ Kamu belum memenuhi syarat giveaway.', {
        reply_markup: notEligibleKeyboard(giveaway.id, channelUrl(giveaway)),
      });
      return;
    case 'already':
      await answerCallback(env, cq.id, '✅ Kamu sudah terdaftar di giveaway ini.');
      await showParticipating(env, cq, giveaway, result.participant);
      return;
    case 'joined': {
      await answerCallback(env, cq.id, '🎉 Berhasil ikut giveaway!');
      await showParticipating(env, cq, giveaway, result.participant);
      const count = await countParticipants(env.DB, giveaway.id);
      await updatePublishedCard(env, giveaway, count);
      return;
    }
  }
}

/**
 * JOIN tapped from the CHANNEL post. A user only ends up in the `users` table
 * after they've /start-ed the bot (start.ts + the in-DM join both upsert only
 * from a private chat), so its presence is a reliable "bot can DM them" signal.
 *  - New user  → answerCallback with a url deep-link: their client opens the bot
 *    (/start g_<id>) so it can DM them. This is the ONLY time they get bounced.
 *  - Known user → process the join right here and just show a popup + DM; they
 *    stay in the channel, no redirect.
 */
async function handleChannelJoin(env: Env, cq: CallbackQuery, giveawayId: number): Promise<void> {
  const known = await getUserByTelegramId(env.DB, String(cq.from.id));
  if (!known) {
    const botUsername = await getBotUsername(env);
    await answerCallback(env, cq.id, undefined, false, `https://t.me/${botUsername}?start=g_${giveawayId}`);
    return;
  }

  const giveaway = await getGiveaway(env.DB, giveawayId);
  if (!giveaway) {
    await answerCallback(env, cq.id, 'Giveaway tidak ditemukan.', true);
    return;
  }
  const result = await joinGiveaway(env, giveaway, cq.from);
  switch (result.status) {
    case 'inactive':
      await answerCallback(env, cq.id, '⚠️ Giveaway ini sudah berakhir atau belum aktif.', true);
      return;
    case 'not_member':
      await answerCallback(env, cq.id, '❌ Kamu belum join channel syaratnya. Join dulu ya.', true);
      await sendMessage(env, cq.from.id, '❌ Kamu belum memenuhi syarat giveaway.', {
        reply_markup: notEligibleKeyboard(giveaway.id, channelUrl(giveaway)),
      });
      return;
    case 'already': {
      await answerCallback(env, cq.id, '✅ Kamu sudah terdaftar di giveaway ini.', true);
      const summary = await entriesSummary(env.DB, giveaway.id, result.participant);
      await sendMessage(env, cq.from.id, participatingText(summary.totalEntries, summary.validReferrals), {
        reply_markup: participatingKeyboard(giveaway.id),
      });
      return;
    }
    case 'joined': {
      await answerCallback(env, cq.id, '🎉 Berhasil ikut giveaway! Cek chat bot ya.', true);
      const summary = await entriesSummary(env.DB, giveaway.id, result.participant);
      await sendMessage(env, cq.from.id, participatingText(summary.totalEntries, summary.validReferrals), {
        reply_markup: participatingKeyboard(giveaway.id),
      });
      const count = await countParticipants(env.DB, giveaway.id);
      await updatePublishedCard(env, giveaway, count);
      return;
    }
  }
}

async function handleInvite(env: Env, cq: CallbackQuery, giveawayId: number): Promise<void> {
  const giveaway = await getGiveaway(env.DB, giveawayId);
  if (!giveaway) {
    await answerCallback(env, cq.id, 'Giveaway tidak ditemukan.', true);
    return;
  }
  const botUsername = await getBotUsername(env);
  const link = buildReferralLink(botUsername, giveaway.id, String(cq.from.id));
  await answerCallback(env, cq.id);
  await sendMessage(
    env,
    cq.from.id,
    [
      '👥 <b>Undang teman & dapatkan entry tambahan!</b>',
      '',
      `Setiap teman yang valid = <b>+1 entry</b> (maksimal ${giveaway.max_referral_bonus}).`,
      '',
      'Link referral kamu:',
      `<code>${link}</code>`,
    ].join('\n'),
    { reply_markup: inviteKeyboard(link) },
  );
}

async function handleEntries(env: Env, cq: CallbackQuery, giveawayId: number): Promise<void> {
  const giveaway = await getGiveaway(env.DB, giveawayId);
  if (!giveaway) {
    await answerCallback(env, cq.id, 'Giveaway tidak ditemukan.', true);
    return;
  }
  const user = await getUserByTelegramId(env.DB, String(cq.from.id));
  const participant = user ? await getParticipant(env.DB, giveaway.id, user.id) : null;
  if (!participant) {
    await answerCallback(env, cq.id, 'Kamu belum ikut giveaway ini.', true);
    return;
  }
  await answerCallback(env, cq.id);
  const summary = await entriesSummary(env.DB, giveaway.id, participant);
  await sendMessage(env, cq.from.id, participatingText(summary.totalEntries, summary.validReferrals), {
    reply_markup: participatingKeyboard(giveaway.id),
  });
}

/** Confirm/cancel handler for the destructive /delete flow. Admin-only. */
async function handleDelete(
  env: Env,
  cq: CallbackQuery,
  giveawayId: number,
  confirm: boolean,
): Promise<void> {
  const msg = cq.message;
  const editSelf = (text: string, keyboard?: InlineKeyboardMarkup): Promise<unknown> => {
    const extra = keyboard ? { reply_markup: keyboard } : {};
    return msg
      ? editMessageText(env, cq.from.id, msg.message_id, text, extra)
      : sendMessage(env, cq.from.id, text, extra);
  };

  if (!(await isAdmin(env, cq.from.id))) {
    await answerCallback(env, cq.id, '🚫 Khusus admin.', true);
    return;
  }
  if (!confirm) {
    await answerCallback(env, cq.id, 'Dibatalkan.');
    await editSelf('↩️ Penghapusan dibatalkan. Giveaway tetap ada.', backKeyboard());
    return;
  }

  const g = await getGiveaway(env.DB, giveawayId);
  if (!g) {
    await answerCallback(env, cq.id, 'Giveaway sudah tidak ada.', true);
    await editSelf('ℹ️ Giveaway sudah tidak ada.', backKeyboard());
    return;
  }

  // Remove the published channel post first (best-effort — deletion is limited to
  // ~48h old messages and needs delete rights; ignore failures).
  if (g.publish_chat_id && g.publish_message_id) {
    await deleteMessage(env, g.publish_chat_id, Number(g.publish_message_id));
  }
  await deleteGiveaway(env.DB, giveawayId);

  await answerCallback(env, cq.id, '🗑 Terhapus.');
  await editSelf(`🗑 Giveaway #${giveawayId} <b>dihapus permanen</b> beserta data pesertanya.`, backKeyboard());
}

/** Show the confirm view for a giveaway picked from the delete list (in place). */
async function handleDeletePick(env: Env, cq: CallbackQuery, giveawayId: number): Promise<void> {
  if (!(await isAdmin(env, cq.from.id))) {
    await answerCallback(env, cq.id, '🚫 Khusus admin.', true);
    return;
  }
  const g = await getGiveaway(env.DB, giveawayId);
  if (!g) {
    await answerCallback(env, cq.id, 'Giveaway sudah tidak ada.', true);
    return;
  }
  await answerCallback(env, cq.id);
  const count = await countParticipants(env.DB, g.id);
  const text = [
    `⚠️ <b>Hapus giveaway #${g.id}?</b>`,
    `<i>${g.title}</i>`,
    '',
    `Status: <b>${g.status}</b> • Peserta: <b>${count}</b>`,
    '',
    '🚨 Permanen — giveaway, data peserta & referral terhapus, dan postingan channel dihapus.',
  ].join('\n');
  const msg = cq.message;
  if (msg) {
    await editMessageText(env, cq.from.id, msg.message_id, text, {
      reply_markup: deletePickConfirmKeyboard(g.id),
    });
  } else {
    await sendMessage(env, cq.from.id, text, { reply_markup: deletePickConfirmKeyboard(g.id) });
  }
}

/** Show the confirm view for a giveaway picked from the draw list (in place). */
async function handleDrawPick(env: Env, cq: CallbackQuery, giveawayId: number): Promise<void> {
  if (!(await isAdmin(env, cq.from.id))) {
    await answerCallback(env, cq.id, '🚫 Khusus admin.', true);
    return;
  }
  const g = await getGiveaway(env.DB, giveawayId);
  if (!g) {
    await answerCallback(env, cq.id, 'Giveaway sudah tidak ada.', true);
    return;
  }
  if (g.status !== 'active' && g.status !== 'awaiting_draw') {
    await answerCallback(env, cq.id, `Status ${g.status} — tidak bisa diundi.`, true);
    return;
  }
  await answerCallback(env, cq.id);
  const count = await countParticipants(env.DB, g.id);
  const text = [
    `🎬 <b>Undi pemenang giveaway #${g.id}?</b>`,
    `<i>${g.title}</i>`,
    '',
    `Status: <b>${g.status}</b> • Peserta: <b>${count}</b> • Pemenang: <b>${g.winners_count}</b>`,
    '',
    'Bot cek ulang membership channel tiap kandidat, pilih pemenang acak (berbobot sesuai entry), tampilkan di kartu & DM pemenang. Giveaway jadi <b>ended</b>.',
  ].join('\n');
  const msg = cq.message;
  if (msg) {
    await editMessageText(env, cq.from.id, msg.message_id, text, {
      reply_markup: drawPickConfirmKeyboard(g.id),
    });
  } else {
    await sendMessage(env, cq.from.id, text, { reply_markup: drawPickConfirmKeyboard(g.id) });
  }
}

/** Run the draw for a confirmed giveaway (admin-only), report the result in place. */
async function handleDraw(env: Env, cq: CallbackQuery, giveawayId: number): Promise<void> {
  const msg = cq.message;
  const editSelf = (text: string): Promise<unknown> =>
    msg
      ? editMessageText(env, cq.from.id, msg.message_id, text, { reply_markup: backKeyboard() })
      : sendMessage(env, cq.from.id, text, { reply_markup: backKeyboard() });

  if (!(await isAdmin(env, cq.from.id))) {
    await answerCallback(env, cq.id, '🚫 Khusus admin.', true);
    return;
  }
  const g = await getGiveaway(env.DB, giveawayId);
  if (!g) {
    await answerCallback(env, cq.id, 'Giveaway sudah tidak ada.', true);
    return;
  }
  if (g.status !== 'active' && g.status !== 'awaiting_draw') {
    await answerCallback(env, cq.id, `Status ${g.status} — tidak bisa diundi.`, true);
    await editSelf(`ℹ️ Giveaway #${g.id} berstatus <b>${g.status}</b>, tidak bisa diundi.`);
    return;
  }

  await answerCallback(env, cq.id, '🎲 Mengundi…');
  const { winners, delivered } = await executeDraw(env, g);
  if (winners.length === 0) {
    await editSelf('⚠️ Tidak ada pemenang eligible (semua kandidat gagal cek membership).');
    return;
  }
  await editSelf(
    [
      `✅ <b>Draw #${g.id} selesai!</b>`,
      `${winners.length} pemenang terpilih & tampil di kartu giveaway.`,
      `📩 Notif DM terkirim ke ${delivered}/${winners.length} pemenang.`,
    ].join('\n'),
  );
}

/** Handle the /start main-menu buttons — navigates in place (edits the same message). */
async function handleMenu(env: Env, cq: CallbackQuery, action: string): Promise<void> {
  const chatId = cq.from.id;
  const msg = cq.message;

  // Render a view in place: edit the menu message when possible, else send a new one.
  const show = async (text: string, keyboard: InlineKeyboardMarkup): Promise<void> => {
    if (msg) {
      await editMessageText(env, chatId, msg.message_id, text, { reply_markup: keyboard });
    } else {
      await sendMessage(env, chatId, text, { reply_markup: keyboard });
    }
  };

  switch (action) {
    case 'home':
      await answerCallback(env, cq.id);
      await show(WELCOME, startMenuKeyboard(await isAdmin(env, cq.from.id)));
      return;
    case 'active': {
      const g = await getLatestGiveaway(env.DB);
      if (!g || g.status !== 'active') {
        await answerCallback(env, cq.id, 'Belum ada giveaway aktif saat ini.', true);
        return;
      }
      await answerCallback(env, cq.id);
      const count = await countParticipants(env.DB, g.id);
      await show(renderCaption(g, count), activeMenuKeyboard(g.id, await isAdmin(env, cq.from.id)));
      return;
    }
    case 'dellist': {
      if (!(await isAdmin(env, cq.from.id))) { await answerCallback(env, cq.id, '🚫 Khusus admin.', true); return; }
      const list = await listGiveaways(env.DB);
      if (list.length === 0) { await answerCallback(env, cq.id, 'Belum ada giveaway.', true); return; }
      await answerCallback(env, cq.id);
      await show(
        '🗑 <b>Hapus Giveaway</b>\n\nPilih giveaway yang mau dihapus (permanen):',
        deleteListKeyboard(list),
      );
      return;
    }
    case 'drawlist': {
      if (!(await isAdmin(env, cq.from.id))) { await answerCallback(env, cq.id, '🚫 Khusus admin.', true); return; }
      const list = (await listGiveaways(env.DB)).filter(
        (g) => g.status === 'active' || g.status === 'awaiting_draw',
      );
      if (list.length === 0) { await answerCallback(env, cq.id, 'Belum ada giveaway yang bisa diundi.', true); return; }
      await answerCallback(env, cq.id);
      await show(
        '🎬 <b>Undi Pemenang</b>\n\nPilih giveaway yang mau diundi:',
        drawListKeyboard(list),
      );
      return;
    }
    case 'entries': {
      const g = await getLatestGiveaway(env.DB);
      if (!g) { await answerCallback(env, cq.id, 'Belum ada giveaway.', true); return; }
      const user = await getUserByTelegramId(env.DB, String(cq.from.id));
      const participant = user ? await getParticipant(env.DB, g.id, user.id) : null;
      if (!participant) {
        await answerCallback(env, cq.id, 'Kamu belum ikut giveaway. Tekan Giveaway Aktif → JOIN dulu.', true);
        return;
      }
      await answerCallback(env, cq.id);
      const summary = await entriesSummary(env.DB, g.id, participant);
      await show(participatingText(summary.totalEntries, summary.validReferrals), entriesMenuKeyboard(g.id));
      return;
    }
    case 'howto':
      await answerCallback(env, cq.id);
      await show(HOWTO, backKeyboard());
      return;
    case 'new':
      if (!(await isAdmin(env, cq.from.id))) { await answerCallback(env, cq.id, '🚫 Khusus admin.', true); return; }
      await answerCallback(env, cq.id);
      await startWizard(env, chatId, String(cq.from.id));
      return;
    case 'stats': {
      if (!(await isAdmin(env, cq.from.id))) { await answerCallback(env, cq.id, '🚫 Khusus admin.', true); return; }
      const g = await getLatestGiveaway(env.DB);
      if (!g) { await answerCallback(env, cq.id, 'Belum ada giveaway.', true); return; }
      await answerCallback(env, cq.id);
      const [participants, entries] = await Promise.all([
        countParticipants(env.DB, g.id),
        totalEntries(env.DB, g.id),
      ]);
      await show(
        [
          `📊 <b>Statistik</b> — #${g.id}`,
          `<i>${g.title}</i>`,
          '',
          `👥 Participants: <b>${participants}</b>`,
          `🎟 Total Entries: <b>${entries}</b>`,
          `⏳ Status: <b>${g.status}</b>`,
        ].join('\n'),
        backKeyboard(),
      );
      return;
    }
    default:
      await answerCallback(env, cq.id);
  }
}

/** Entry point for all callback_query updates. */
export async function handleCallback(env: Env, cq: CallbackQuery): Promise<void> {
  const data = cq.data ?? '';

  if (data.startsWith('wiz:')) {
    await handleWizardCallback(env, cq);
    return;
  }

  if (data.startsWith('menu:')) {
    await handleMenu(env, cq, data.slice('menu:'.length));
    return;
  }

  const [action, gidStr] = data.split(':');
  const giveawayId = Number(gidStr);
  if (!Number.isInteger(giveawayId)) {
    await answerCallback(env, cq.id);
    return;
  }

  switch (action) {
    case 'join':
    case 'check':
      await handleJoinOrCheck(env, cq, giveawayId);
      return;
    case 'cjoin':
      await handleChannelJoin(env, cq, giveawayId);
      return;
    case 'invite':
      await handleInvite(env, cq, giveawayId);
      return;
    case 'entries':
      await handleEntries(env, cq, giveawayId);
      return;
    case 'delpick':
      await handleDeletePick(env, cq, giveawayId);
      return;
    case 'drawpick':
      await handleDrawPick(env, cq, giveawayId);
      return;
    case 'drawcfm':
      await handleDraw(env, cq, giveawayId);
      return;
    case 'delcfm':
      await handleDelete(env, cq, giveawayId, true);
      return;
    case 'delx':
      await handleDelete(env, cq, giveawayId, false);
      return;
    default:
      await answerCallback(env, cq.id);
  }
}
