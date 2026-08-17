import type { Env, WizardData, WizardStep } from '../types';
import type { CallbackQuery, TelegramMessage } from '../telegram/types';
import { answerCallback, sendMessage, telegram } from '../telegram/api';
import { getSession, setSession, clearSession } from '../db/sessions';
import { createGiveaway, getGiveaway, setPublishInfo } from '../db/giveaways';
import { countParticipants } from '../db/participants';
import { renderCaption, wizardToPreviewRow, publishGiveaway } from '../services/giveaway';
import { previewKeyboard } from '../telegram/keyboards';
import { parseWibToUtc, formatWib, isPast } from '../utils/datetime';

const PROMPTS: Record<WizardStep, string> = {
  title: '📝 <b>1/9</b> Kirim <b>JUDUL</b> giveaway:',
  description: '📝 <b>2/9</b> Kirim <b>DESKRIPSI</b> (atau ketik <code>-</code> untuk kosong):',
  prize: '🎁 <b>3/9</b> Kirim <b>PRIZE</b> (hadiah):',
  winners_count: '🏆 <b>4/9</b> Berapa jumlah <b>WINNERS</b>? (angka)',
  required_channel: '📢 <b>5/9</b> <b>REQUIRED CHANNEL</b> (contoh: <code>@namachannel</code>):',
  deadline:
    '📅 <b>6/9</b> <b>DEADLINE</b> WIB, format <code>YYYY-MM-DD HH:MM</code>\nContoh: <code>2026-08-17 20:00</code>',
  max_referral_bonus: '🎟 <b>7/9</b> <b>MAX REFERRAL BONUS</b> (angka, default 5):',
  image: '🖼 <b>8/9</b> Kirim <b>GAMBAR/banner</b> (atau ketik <code>-</code> untuk tanpa gambar):',
  publish_dest:
    '🚀 <b>9/9</b> Publish ke mana? Kirim <code>@channel</code> / chat id, atau <code>here</code> untuk chat ini:',
  preview: '',
};

export async function startWizard(env: Env, message: TelegramMessage): Promise<void> {
  const tgId = String(message.from!.id);
  await setSession(env.DB, tgId, 'title', {});
  await sendMessage(env, message.chat.id, '🎬 <b>Buat Giveaway Baru</b>\n\n' + PROMPTS.title);
}

async function showPreview(env: Env, chatId: number, data: WizardData): Promise<void> {
  const row = wizardToPreviewRow(data);
  const caption = '🎉 <b>GIVEAWAY PREVIEW</b>\n\n' + renderCaption(row, 0);
  if (row.image_file_id) {
    await telegram(
      'sendPhoto',
      { chat_id: chatId, photo: row.image_file_id, caption, parse_mode: 'HTML', reply_markup: previewKeyboard() },
      env,
    );
  } else {
    await sendMessage(env, chatId, caption, { reply_markup: previewKeyboard() });
  }
}
// __APPEND_INPUT__

/**
 * Feed a message into an active admin wizard session.
 * Returns true if the message was consumed (an active session existed).
 */
export async function handleWizardInput(env: Env, message: TelegramMessage): Promise<boolean> {
  const tgId = String(message.from!.id);
  const session = await getSession(env.DB, tgId);
  if (!session) return false;

  const chatId = message.chat.id;
  const data = session.data;
  const text = (message.text ?? '').trim();

  const advance = async (step: WizardStep): Promise<void> => {
    await setSession(env.DB, tgId, step, data);
    await sendMessage(env, chatId, PROMPTS[step]);
  };
  const reject = (msg: string): Promise<unknown> => sendMessage(env, chatId, msg);

  switch (session.step) {
    case 'title':
      if (!text) { await reject('❌ Judul tidak boleh kosong. Coba lagi:'); return true; }
      data.title = text; await advance('description'); return true;
    case 'description':
      data.description = text === '-' ? null : text; await advance('prize'); return true;
    case 'prize':
      if (!text) { await reject('❌ Prize tidak boleh kosong. Coba lagi:'); return true; }
      data.prize = text; await advance('winners_count'); return true;
    case 'winners_count': {
      const n = Number.parseInt(text, 10);
      if (!Number.isInteger(n) || n < 1) { await reject('❌ Masukkan angka ≥ 1:'); return true; }
      data.winners_count = n; await advance('required_channel'); return true;
    }
    case 'required_channel': {
      let ch = text;
      if (!ch.startsWith('@') && !ch.startsWith('http') && !ch.startsWith('-100')) ch = '@' + ch;
      data.required_channel = ch; await advance('deadline'); return true;
    }
    case 'deadline': {
      const iso = parseWibToUtc(text);
      if (!iso) { await reject('❌ Format salah. Pakai <code>YYYY-MM-DD HH:MM</code>:'); return true; }
      if (isPast(iso)) { await reject('❌ Deadline sudah lewat. Masukkan waktu mendatang:'); return true; }
      data.deadline = iso; await advance('max_referral_bonus'); return true;
    }
    case 'max_referral_bonus': {
      const n = Number.parseInt(text, 10);
      if (!Number.isInteger(n) || n < 0) { await reject('❌ Masukkan angka ≥ 0:'); return true; }
      data.max_referral_bonus = n; await advance('image'); return true;
    }
    case 'image':
      if (message.photo && message.photo.length > 0) {
        data.image_file_id = message.photo[message.photo.length - 1].file_id;
      } else if (text === '-') {
        data.image_file_id = null;
      } else {
        await reject('❌ Kirim gambar, atau ketik <code>-</code> untuk lewati:'); return true;
      }
      await advance('publish_dest'); return true;
    case 'publish_dest': {
      const dest = text === 'here' ? String(chatId) : text;
      if (!dest) { await reject('❌ Tujuan tidak valid:'); return true; }
      data.publish_chat_id = dest;
      await setSession(env.DB, tgId, 'preview', data);
      await showPreview(env, chatId, data);
      return true;
    }
    case 'preview':
      await reject('Tekan tombol 🚀 PUBLISH / ✏️ EDIT / ❌ CANCEL di atas.');
      return true;
  }
  return true;
}
// __APPEND_CALLBACK__

/** Handle the wiz:publish / wiz:edit / wiz:cancel preview buttons. */
export async function handleWizardCallback(env: Env, cq: CallbackQuery): Promise<void> {
  const tgId = String(cq.from.id);
  const chatId = cq.from.id;
  const session = await getSession(env.DB, tgId);
  if (!session) {
    await answerCallback(env, cq.id, 'Sesi tidak ditemukan / sudah selesai.', true);
    return;
  }
  const action = (cq.data ?? '').split(':')[1];

  if (action === 'cancel') {
    await clearSession(env.DB, tgId);
    await answerCallback(env, cq.id, 'Dibatalkan.');
    await sendMessage(env, chatId, '❌ Pembuatan giveaway dibatalkan.');
    return;
  }
  if (action === 'edit') {
    await setSession(env.DB, tgId, 'title', session.data);
    await answerCallback(env, cq.id, 'Edit ulang dari awal.');
    await sendMessage(env, chatId, '✏️ Mari isi ulang.\n\n' + PROMPTS.title);
    return;
  }
  if (action === 'publish') {
    const d = session.data;
    if (!d.title || !d.prize || !d.winners_count || !d.required_channel || !d.deadline || !d.publish_chat_id) {
      await answerCallback(env, cq.id, 'Data belum lengkap.', true);
      return;
    }
    await answerCallback(env, cq.id, 'Publishing…');
    const id = await createGiveaway(env.DB, {
      title: d.title, description: d.description ?? null, prize: d.prize,
      winners_count: d.winners_count, required_channel: d.required_channel,
      deadline: d.deadline, max_referral_bonus: d.max_referral_bonus ?? 5,
      image_file_id: d.image_file_id ?? null, publish_chat_id: d.publish_chat_id,
    });
    const giveaway = await getGiveaway(env.DB, id);
    if (!giveaway) { await sendMessage(env, chatId, '❌ Gagal membuat giveaway.'); return; }
    const count = await countParticipants(env.DB, id);
    const published = await publishGiveaway(env, giveaway, count);
    if (!published) {
      await sendMessage(env, chatId, `❌ Gagal publish. Pastikan bot adalah admin channel & chat id benar. Disimpan sebagai draft (#${id}).`);
      return;
    }
    await setPublishInfo(env.DB, id, published.chatId, published.messageId);
    await clearSession(env.DB, tgId);
    await sendMessage(env, chatId, `✅ Giveaway <b>#${id}</b> aktif!\n📅 Deadline: ${formatWib(giveaway.deadline)}`);
    return;
  }
  await answerCallback(env, cq.id);
}
