import type { Env } from '../types';
import type { TelegramMessage } from '../telegram/types';
import { sendMessage } from '../telegram/api';
import { isAdmin } from './auth';
import { handleStart } from './start';
import { startWizard } from './admin';
import { cmdStats, cmdParticipants, cmdEnd, cmdBroadcast } from './adminCommands';
import { cmdDraw, cmdReroll } from './adminDraw';
import { clearSession } from '../db/sessions';

const HELP_USER = [
  '🤖 <b>Giveaway Bot</b>',
  '',
  '/start — mulai & lihat giveaway aktif',
  '/help — bantuan',
].join('\n');

const HELP_ADMIN = [
  '',
  '<b>Admin:</b>',
  '/newgiveaway — buat giveaway (wizard)',
  '/stats [id] — statistik',
  '/participants [id] — data participant',
  '/draw [id] — undi pemenang',
  '/reroll &lt;pos&gt; [id] — ganti 1 pemenang',
  '/end [id] — akhiri giveaway',
  '/broadcast [id] pesan — kirim ke participant',
  '/cancel — batalkan wizard',
].join('\n');

/** Route a slash-command message. */
export async function handleCommand(env: Env, message: TelegramMessage): Promise<void> {
  if (!message.from) return;
  const chatId = message.chat.id;
  const raw = (message.text ?? '').trim();
  const parts = raw.split(/\s+/);
  const command = parts[0].split('@')[0].toLowerCase();
  const args = parts.slice(1);
  const admin = isAdmin(env, message.from.id);

  const needAdmin = async (fn: () => Promise<void>): Promise<void> => {
    if (!admin) {
      await sendMessage(env, chatId, '🚫 Perintah ini khusus admin.');
      return;
    }
    await fn();
  };

  switch (command) {
    case '/start':
      await handleStart(env, message);
      return;
    case '/help':
      await sendMessage(env, chatId, HELP_USER + (admin ? '\n' + HELP_ADMIN : ''));
      return;
    case '/newgiveaway':
      await needAdmin(() => startWizard(env, message));
      return;
    case '/stats':
      await needAdmin(() => cmdStats(env, message, args));
      return;
    case '/participants':
      await needAdmin(() => cmdParticipants(env, message, args));
      return;
    case '/draw':
      await needAdmin(() => cmdDraw(env, message, args));
      return;
    case '/reroll':
      await needAdmin(() => cmdReroll(env, message, args));
      return;
    case '/end':
      await needAdmin(() => cmdEnd(env, message, args));
      return;
    case '/broadcast':
      await needAdmin(() => cmdBroadcast(env, message, args));
      return;
    case '/cancel':
      await clearSession(env.DB, String(message.from.id));
      await sendMessage(env, chatId, '✅ Dibatalkan.');
      return;
    default:
      await sendMessage(env, chatId, 'Perintah tidak dikenali. Ketik /help.');
  }
}
