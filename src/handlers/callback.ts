import type { Env, GiveawayRow, ParticipantRow } from '../types';
import type { CallbackQuery } from '../telegram/types';
import { answerCallback, sendMessage, getBotUsername } from '../telegram/api';
import { getGiveaway } from '../db/giveaways';
import { getUserByTelegramId } from '../db/users';
import { getParticipant, countParticipants } from '../db/participants';
import {
  joinGiveaway,
  entriesSummary,
} from '../services/participant';
import { updatePublishedCard } from '../services/giveaway';
import { channelUrl } from '../services/membership';
import { buildReferralLink } from '../services/referral';
import {
  notEligibleKeyboard,
  participatingKeyboard,
  inviteKeyboard,
} from '../telegram/keyboards';
import { handleWizardCallback } from './admin';

function participatingText(entries: number, validReferrals: number): string {
  return [
    "✅ <b>You're participating!</b>",
    '',
    `🎟 Your Entries: <b>${entries}</b>`,
    `👥 Valid Referrals: <b>${validReferrals}</b>`,
  ].join('\n');
}

async function sendParticipatingCard(
  env: Env,
  chatId: number,
  giveaway: GiveawayRow,
  participant: ParticipantRow,
): Promise<void> {
  const summary = await entriesSummary(env.DB, giveaway.id, participant);
  await sendMessage(env, chatId, participatingText(summary.totalEntries, summary.validReferrals), {
    reply_markup: participatingKeyboard(giveaway.id),
  });
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
      await sendParticipatingCard(env, chatId, giveaway, result.participant);
      return;
    case 'joined': {
      await answerCallback(env, cq.id, '🎉 Berhasil ikut giveaway!');
      await sendParticipatingCard(env, chatId, giveaway, result.participant);
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

/** Entry point for all callback_query updates. */
export async function handleCallback(env: Env, cq: CallbackQuery): Promise<void> {
  const data = cq.data ?? '';

  if (data.startsWith('wiz:')) {
    await handleWizardCallback(env, cq);
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
    case 'invite':
      await handleInvite(env, cq, giveawayId);
      return;
    case 'entries':
      await handleEntries(env, cq, giveawayId);
      return;
    default:
      await answerCallback(env, cq.id);
  }
}
