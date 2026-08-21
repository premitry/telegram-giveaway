import type { Env } from '../types';
import type { TelegramMessage } from '../telegram/types';
import { sendMessage } from '../telegram/api';
import { upsertUser } from '../db/users';
import { getGiveaway } from '../db/giveaways';
import { countParticipants } from '../db/participants';
import { parseStartPayload } from '../services/referral';
import { sendGiveawayCard } from '../services/giveaway';
import { startMenuKeyboard } from '../telegram/keyboards';
import { isAdmin } from './auth';

export const WELCOME = [
  '👋 <b>Selamat datang di Giveaway Bot!</b>',
  '',
  'Pilih menu di bawah 👇',
  '',
  '• <b>🎉 Giveaway Aktif</b> — lihat giveaway yang sedang berjalan',
  '• <b>❓ Cara Ikut</b> — panduan singkat',
].join('\n');

/** Handle /start, including the giveaway deep link (?start=g_<id>). */
export async function handleStart(env: Env, message: TelegramMessage): Promise<void> {
  if (!message.from) return;
  const chatId = message.chat.id;
  await upsertUser(env.DB, message.from);

  const payload = (message.text ?? '').split(' ')[1];
  const referral = parseStartPayload(payload);

  if (referral) {
    const giveaway = await getGiveaway(env.DB, referral.giveawayId);
    if (giveaway && giveaway.status === 'active') {
      const count = await countParticipants(env.DB, giveaway.id);
      await sendMessage(
        env,
        chatId,
        '🎁 Yuk ikut giveaway ini! Tekan <b>JOIN GIVEAWAY</b> di bawah 👇',
      );
      await sendGiveawayCard(env, chatId, giveaway, count);
      return;
    }
    await sendMessage(env, chatId, '⚠️ Giveaway dari link ini tidak ditemukan atau sudah berakhir.');
    return;
  }

  // Plain /start — show only the welcome menu. The active giveaway is viewed via
  // the "🎉 Giveaway Aktif" button (in place), so we don't auto-send the card here
  // (that would show it twice).
  const admin = await isAdmin(env, message.from.id);
  await sendMessage(env, chatId, WELCOME, { reply_markup: startMenuKeyboard(admin) });
}
