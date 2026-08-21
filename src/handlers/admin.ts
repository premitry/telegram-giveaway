import type { Env, WizardData, WizardStep } from '../types';
import type { CallbackQuery, TelegramMessage, InlineKeyboardMarkup } from '../telegram/types';
import { answerCallback, sendMessage, telegram, deleteMessage } from '../telegram/api';
import { getSession, setSession, clearSession } from '../db/sessions';
import { createGiveaway, getGiveaway, setPublishInfo } from '../db/giveaways';
import { countParticipants } from '../db/participants';
import { renderCaption, wizardToPreviewRow, publishGiveaway } from '../services/giveaway';
import {
  previewKeyboard,
  wizardFieldsKeyboard,
  wizardStepKeyboard,
  wizardEditFieldKeyboard,
} from '../telegram/keyboards';
import { parseWibToUtc, formatWib, isPast } from '../utils/datetime';
import { entitiesToHtml } from '../utils/formatting';

/** Steps in fill order (preview excluded — it's the terminal step). */
const ORDER: WizardStep[] = [
  'title',
  'description',
  'prize',
  'winners_count',
  'required_channel',
  'deadline',
  'image',
  'publish_dest',
];

const PROMPTS: Record<WizardStep, string> = {
  title: '📝 <b>1/8</b> Kirim <b>JUDUL</b> giveaway:',
  description: '📝 <b>2/8</b> Kirim <b>DESKRIPSI</b> (atau ketik <code>-</code> untuk kosong):',
  prize: '🎁 <b>3/8</b> Kirim <b>PRIZE</b> (hadiah):',
  winners_count: '🏆 <b>4/8</b> Berapa jumlah <b>WINNERS</b>? (angka)',
  required_channel: '📢 <b>5/8</b> <b>REQUIRED CHANNEL</b> (contoh: <code>@namachannel</code>):',
  deadline:
    '📅 <b>6/8</b> <b>DEADLINE</b> WIB, format <code>YYYY-MM-DD HH:MM</code>\nContoh: <code>2026-08-17 20:00</code>',
  image: '🖼 <b>7/8</b> Kirim <b>GAMBAR/banner</b> (atau ketik <code>-</code> untuk tanpa gambar):',
  publish_dest:
    '🚀 <b>8/8</b> Publish ke mana? Kirim <code>@channel</code> / chat id, atau <code>here</code> untuk chat ini:',
  preview: '',
};

export async function startWizard(env: Env, chatId: number, tgId: string): Promise<void> {
  const data: WizardData = {};
  await renderAnchor(env, chatId, data, '🎬 <b>Buat Giveaway Baru</b>\n\n' + PROMPTS.title, wizardStepKeyboard(false));
  await setSession(env.DB, tgId, 'title', data);
}

/**
 * Render the wizard's single "anchor" message: edit it in place when it already
 * exists (so the chat doesn't pile up), otherwise send it. Switches between a
 * text bubble and a photo bubble automatically (delete + resend on switch).
 * Pass no keyboard for a terminal message (published/cancelled) to drop buttons.
 */
async function renderAnchor(
  env: Env,
  chatId: number,
  data: WizardData,
  text: string,
  keyboard?: InlineKeyboardMarkup,
  photoId?: string,
): Promise<void> {
  const wantPhoto = !!photoId;
  const anchor = data._anchor;

  // Same bubble kind → edit in place.
  if (anchor && !!data._anchorPhoto === wantPhoto) {
    const method = wantPhoto ? 'editMessageCaption' : 'editMessageText';
    const payload = wantPhoto
      ? { chat_id: chatId, message_id: anchor, caption: text, parse_mode: 'HTML', reply_markup: keyboard }
      : { chat_id: chatId, message_id: anchor, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard };
    const res = await telegram(method, payload, env);
    if (res.ok || (res.description ?? '').includes('not modified')) return;
    // fall through to resend on any other failure
  }

  // No anchor yet, or bubble kind changed (text↔photo) → replace it.
  if (anchor) await deleteMessage(env, chatId, anchor);
  const res = wantPhoto
    ? await telegram<TelegramMessage>(
        'sendPhoto',
        { chat_id: chatId, photo: photoId, caption: text, parse_mode: 'HTML', reply_markup: keyboard },
        env,
      )
    : await telegram<TelegramMessage>(
        'sendMessage',
        { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard },
        env,
      );
  if (res.ok && res.result) {
    data._anchor = res.result.message_id;
    data._anchorPhoto = wantPhoto;
  }
}

/** Show the prompt for a step in the anchor, with back/cancel controls. */
async function promptStep(env: Env, chatId: number, step: WizardStep, data: WizardData): Promise<void> {
  const canBack = ORDER.indexOf(step) > 0;
  await renderAnchor(env, chatId, data, PROMPTS[step], wizardStepKeyboard(canBack));
}

async function showPreview(env: Env, chatId: number, data: WizardData): Promise<void> {
  const row = wizardToPreviewRow(data);
  const caption = '🎉 <b>GIVEAWAY PREVIEW</b>\n\n' + renderCaption(row, 0);
  await renderAnchor(env, chatId, data, caption, previewKeyboard(), row.image_file_id ?? undefined);
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
  // Delete the admin's own input right away so the chat stays a single bubble.
  await deleteMessage(env, chatId, message.message_id);
  const text = (message.text ?? '').trim();
  // Free-text fields preserve bold/italic/etc. via entity → HTML conversion.
  const html = (): string => entitiesToHtml(message.text ?? '', message.entities).trim();

  // Store the field value, then either return to preview (single-field edit)
  // or advance to the next step — always by editing the anchor in place.
  const commit = async (nextStep: WizardStep): Promise<void> => {
    if (data._edit || nextStep === 'preview') {
      delete data._edit;
      await showPreview(env, chatId, data);
      await setSession(env.DB, tgId, 'preview', data);
      return;
    }
    await promptStep(env, chatId, nextStep, data);
    await setSession(env.DB, tgId, nextStep, data);
  };
  const reject = async (msg: string): Promise<void> => {
    const kb = data._edit ? wizardEditFieldKeyboard() : wizardStepKeyboard(ORDER.indexOf(session.step) > 0);
    await renderAnchor(env, chatId, data, msg, kb);
    await setSession(env.DB, tgId, session.step, data);
  };

  switch (session.step) {
    case 'title':
      if (!text) { await reject('❌ Judul tidak boleh kosong. Coba lagi:'); return true; }
      data.title = text; await commit('description'); return true;
    case 'description':
      data.description = text === '-' ? null : html(); await commit('prize'); return true;
    case 'prize':
      if (!text) { await reject('❌ Prize tidak boleh kosong. Coba lagi:'); return true; }
      data.prize = html(); await commit('winners_count'); return true;
    case 'winners_count': {
      const n = Number.parseInt(text, 10);
      if (!Number.isInteger(n) || n < 1) { await reject('❌ Masukkan angka ≥ 1:'); return true; }
      data.winners_count = n; await commit('required_channel'); return true;
    }
    case 'required_channel': {
      let ch = text;
      if (!ch.startsWith('@') && !ch.startsWith('http') && !ch.startsWith('-100')) ch = '@' + ch;
      data.required_channel = ch; await commit('deadline'); return true;
    }
    case 'deadline': {
      const iso = parseWibToUtc(text);
      if (!iso) { await reject('❌ Format salah. Pakai <code>YYYY-MM-DD HH:MM</code>:'); return true; }
      if (isPast(iso)) { await reject('❌ Deadline sudah lewat. Masukkan waktu mendatang:'); return true; }
      data.deadline = iso; await commit('image'); return true;
    }
    case 'image':
      if (message.photo && message.photo.length > 0) {
        data.image_file_id = message.photo[message.photo.length - 1].file_id;
      } else if (text === '-') {
        data.image_file_id = null;
      } else {
        await reject('❌ Kirim gambar, atau ketik <code>-</code> untuk lewati:'); return true;
      }
      await commit('publish_dest'); return true;
    case 'publish_dest': {
      const dest = text === 'here' ? String(chatId) : text;
      if (!dest) { await reject('❌ Tujuan tidak valid:'); return true; }
      data.publish_chat_id = dest;
      await commit('preview');
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
  const parts = (cq.data ?? '').split(':');
  const action = parts[1];

  if (action === 'cancel') {
    await answerCallback(env, cq.id, 'Dibatalkan.');
    await renderAnchor(env, chatId, session.data, '❌ Pembuatan giveaway dibatalkan.');
    await clearSession(env.DB, tgId);
    return;
  }
  // Go back one step during the initial fill (data preserved).
  if (action === 'back') {
    const idx = ORDER.indexOf(session.step);
    if (idx <= 0) {
      await answerCallback(env, cq.id, 'Sudah di langkah pertama.', true);
      return;
    }
    const prev = ORDER[idx - 1];
    await answerCallback(env, cq.id);
    await promptStep(env, chatId, prev, session.data);
    await setSession(env.DB, tgId, prev, session.data);
    return;
  }
  // Preview EDIT → show the field picker (in place).
  if (action === 'edit') {
    await answerCallback(env, cq.id);
    await renderAnchor(env, chatId, session.data, '✏️ Pilih bagian yang mau diperbaiki:', wizardFieldsKeyboard());
    await setSession(env.DB, tgId, session.step, session.data);
    return;
  }
  // Edit a single field → re-prompt just that field, then return to preview.
  if (action === 'field') {
    const step = parts[2] as WizardStep;
    if (!ORDER.includes(step)) {
      await answerCallback(env, cq.id, 'Field tidak dikenal.', true);
      return;
    }
    const data = { ...session.data, _edit: true };
    await answerCallback(env, cq.id);
    await renderAnchor(env, chatId, data, '✏️ ' + PROMPTS[step], wizardEditFieldKeyboard());
    await setSession(env.DB, tgId, step, data);
    return;
  }
  // Return to preview (cancel a single-field edit, or from the field picker).
  if (action === 'preview') {
    const data = { ...session.data };
    delete data._edit;
    await answerCallback(env, cq.id);
    await showPreview(env, chatId, data);
    await setSession(env.DB, tgId, 'preview', data);
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
    // Turn the single wizard bubble into the success line (drops the buttons).
    await renderAnchor(
      env,
      chatId,
      session.data,
      `✅ Giveaway <b>#${id}</b> aktif!\n📅 Deadline: ${formatWib(giveaway.deadline)}`,
    );
    await clearSession(env.DB, tgId);
    return;
  }
  await answerCallback(env, cq.id);
}
