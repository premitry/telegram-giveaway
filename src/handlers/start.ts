import type { Env } from '../types';
import type { TelegramMessage } from '../telegram/types';
import { sendMessage } from '../telegram/api';
import { upsertUser } from '../db/users';
import { getGiveaway, getLatestGiveaway } from '../db/giveaways';
import { countParticipants } from '../db/participants';
import { parseStartPayload, recordPendingReferral } from '../services/referral';
import { sendGiveawayCard } from '../services/giveaway';
import { startMenuKeyboard } from '../telegram/keyboards';
import { isAdmin } from './auth';

const WELCOME = [
  '👋 <b>Selamat datang di Giveaway Bot!</b>',
  '',
  'Pilih menu di bawah 👇',
  '',
  '• <b>🎉 Giveaway Aktif</b> — lihat giveaway yang sedang berjalan',
  '• <b>🎟 Entry Saya</b> — cek jumlah entry kamu',
  '• <b>❓ Cara Ikut</b> — panduan singkat',
].join('\n');

/** Handle /start, including referral deep links (?start=g_<id>_r_<uid>). */
export async function handleStart(env: Env, message: TelegramMessage): Promise<void> {
  if (!message.from) return;
  const chatId = message.chat.id;
  const user = await upsertUser(env.DB, message.from);

  const payload = (message.text ?? '').split(' ')[1];
  const referral = parseStartPayload(payload);

  if (referral) {
    const giveaway = await getGiveaway(env.DB, referral.giveawayId);
    if (giveaway && giveaway.status === 'active') {
      await recordPendingReferral(env.DB, giveaway, referral.referrerTelegramId, user);
      const count = await countParticipants(env.DB, giveaway.id);
      await sendMessage(
        env,
        chatId,
        '🎁 Kamu diundang teman untuk ikut giveaway ini! Tekan <b>JOIN GIVEAWAY</b> di bawah 👇',
      );
      await sendGiveawayCard(env, chatId, giveaway, count);
      return;
    }
    await sendMessage(env, chatId, '⚠️ Giveaway dari link ini tidak ditemukan atau sudah berakhir.');
    return;
  }

  // Plain /start — show welcome menu + the latest active giveaway if any.
  const admin = isAdmin(env, message.from.id);
  await sendMessage(env, chatId, WELCOME, { reply_markup: startMenuKeyboard(admin) });
  const latest = await getLatestGiveaway(env.DB);
  if (latest && latest.status === 'active') {
    const count = await countParticipants(env.DB, latest.id);
    await sendGiveawayCard(env, chatId, latest, count);
  }
}
