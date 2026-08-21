import type { Env } from '../types';
import type { TelegramMessage } from '../telegram/types';
import { sendMessage } from '../telegram/api';
import { setGiveawayStatus } from '../db/giveaways';
import { countParticipants, totalEntries } from '../db/participants';
import { countAllValidReferrals } from '../db/referrals';
import { updatePublishedCard } from '../services/giveaway';
import {
  queueBroadcast,
  sendBroadcastBatch,
  participantChatIds,
  allUserChatIds,
} from '../services/broadcast';
import { addAdmin, removeAdmin, listAdmins } from '../db/admins';
import { isOwner } from './auth';
import { entitiesToHtml, escapeHtml } from '../utils/formatting';
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

/**
 * /broadcast (alias /bc) — send a message to a set of recipients, no Paid plan
 * needed. The text can be typed inline OR taken from the message you reply to
 * (keeping its bold/italic/links). Targeting:
 *   /bc pesan…            → semua user bot (default)
 *   /bc all pesan…        → semua user bot
 *   /bc <giveaway_id> …   → hanya participant giveaway itu
 * Reply ke sebuah pesan lalu ketik /bc (atau /bc all / /bc <id>) memakai isi
 * pesan yang di-reply sebagai teks broadcast.
 */
export async function cmdBroadcast(env: Env, message: TelegramMessage, args: string[]): Promise<void> {
  const chatId = message.chat.id;

  // Resolve the broadcast text: a replied-to message wins (preserves formatting),
  // otherwise the words typed after the targeting token.
  const reply = message.reply_to_message;
  let text = '';
  let rest = args;
  let targetToken: string | null = null;

  if (args[0] === 'all' || (args[0] && /^\d+$/.test(args[0]))) {
    targetToken = args[0];
    rest = args.slice(1);
  }

  if (reply) {
    const src = reply.text ?? reply.caption ?? '';
    const ents = reply.entities ?? reply.caption_entities;
    text = ents && ents.length ? entitiesToHtml(src, ents) : escapeHtml(src);
  } else {
    text = rest.join(' ');
  }

  if (!text.trim()) {
    await sendMessage(
      env,
      chatId,
      [
        'Cara pakai <b>/bc</b>:',
        '• <code>/bc pesan…</code> — ke semua user',
        '• <code>/bc all pesan…</code> — ke semua user',
        '• <code>/bc &lt;giveaway_id&gt; pesan…</code> — ke participant giveaway itu',
        '',
        'Atau <b>reply</b> sebuah pesan lalu ketik <code>/bc</code> (format bold/italic ikut).',
      ].join('\n'),
    );
    return;
  }

  // Resolve recipients.
  let recipients: string[];
  let scope: string;
  if (targetToken && /^\d+$/.test(targetToken)) {
    const g = await resolveTarget(env, [targetToken]);
    if (!g) { await sendMessage(env, chatId, '❌ Giveaway tidak ditemukan.'); return; }
    recipients = await participantChatIds(env, g.id);
    scope = `participant giveaway #${g.id}`;
  } else {
    recipients = await allUserChatIds(env);
    scope = 'semua user';
  }

  const queued = await queueBroadcast(env, recipients, text);
  if (queued === 0) {
    await sendMessage(env, chatId, `ℹ️ Tidak ada penerima (${scope}).`);
    return;
  }

  // Fire the first batch immediately; the rest is drained by the */5 cron.
  const first = await sendBroadcastBatch(env);
  await sendMessage(
    env,
    chatId,
    [
      `📣 Broadcast ke <b>${queued}</b> penerima (${scope}).`,
      `✅ Terkirim batch pertama: <b>${first.sent}</b>` + (first.failed ? ` (gagal ${first.failed})` : ''),
      first.remaining > 0
        ? `⏳ Sisa <b>${first.remaining}</b> dikirim otomatis tiap 5 menit.`
        : '🎉 Semua terkirim.',
    ].join('\n'),
  );
}

/** /add <telegram_id> — owner-only: promote a user to runtime admin. */
export async function cmdAddAdmin(env: Env, message: TelegramMessage, args: string[]): Promise<void> {
  const chatId = message.chat.id;
  if (!message.from || !isOwner(env, message.from.id)) {
    await sendMessage(env, chatId, '🚫 Hanya owner yang bisa menambah admin.');
    return;
  }
  const target = pickUserId(message, args);
  if (!target) {
    await sendMessage(env, chatId, 'Gunakan: <code>/add &lt;telegram_id&gt;</code> (atau reply pesan user).');
    return;
  }
  await addAdmin(env.DB, target);
  await sendMessage(env, chatId, `✅ <code>${escapeHtml(target)}</code> sekarang admin.`);
}

/** /deladmin <telegram_id> — owner-only: remove a runtime admin. */
export async function cmdDelAdmin(env: Env, message: TelegramMessage, args: string[]): Promise<void> {
  const chatId = message.chat.id;
  if (!message.from || !isOwner(env, message.from.id)) {
    await sendMessage(env, chatId, '🚫 Hanya owner yang bisa menghapus admin.');
    return;
  }
  const target = pickUserId(message, args);
  if (!target) {
    await sendMessage(env, chatId, 'Gunakan: <code>/deladmin &lt;telegram_id&gt;</code>.');
    return;
  }
  if (isOwner(env, target)) {
    await sendMessage(env, chatId, '⚠️ Owner (ADMIN_IDS) tidak bisa dihapus lewat bot.');
    return;
  }
  await removeAdmin(env.DB, target);
  await sendMessage(env, chatId, `🗑 <code>${escapeHtml(target)}</code> bukan admin lagi.`);
}

/** /admins — owner-only: list owners + runtime admins. */
export async function cmdAdmins(env: Env, message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  if (!message.from || !isOwner(env, message.from.id)) {
    await sendMessage(env, chatId, '🚫 Khusus owner.');
    return;
  }
  const owners = env.ADMIN_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  const runtime = await listAdmins(env.DB);
  const lines = ['👑 <b>Owner (ADMIN_IDS):</b>', ...owners.map((id) => `• <code>${escapeHtml(id)}</code>`)];
  lines.push('', '🛠 <b>Admin runtime (/add):</b>');
  if (runtime.length === 0) lines.push('• (belum ada)');
  else for (const id of runtime) lines.push(`• <code>${escapeHtml(id)}</code>`);
  await sendMessage(env, chatId, lines.join('\n'));
}

/** Pick a target telegram id from args or a replied-to message. */
function pickUserId(message: TelegramMessage, args: string[]): string | null {
  if (args[0] && /^\d+$/.test(args[0])) return args[0];
  const from = message.reply_to_message?.from;
  if (from && !from.is_bot) return String(from.id);
  return null;
}
