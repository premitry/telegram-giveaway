import type { Env, GiveawayRow, WizardData } from '../types';
import { telegram, getBotUsername } from '../telegram/api';
import { joinKeyboard, joinDeepLinkKeyboard } from '../telegram/keyboards';
import { formatWib } from '../utils/datetime';
import { escapeHtml } from '../utils/formatting';
import { channelUrl } from './membership';
import type { TelegramMessage, InlineKeyboardMarkup } from '../telegram/types';

// Re-export so existing importers of escapeHtml from this module keep working.
export { escapeHtml };

/** Build a synthetic GiveawayRow from wizard data for previewing. */
export function wizardToPreviewRow(data: WizardData): GiveawayRow {
  return {
    id: 0,
    title: data.title ?? '(untitled)',
    description: data.description ?? null,
    prize: data.prize ?? '-',
    winners_count: data.winners_count ?? 1,
    required_channel: data.required_channel ?? '-',
    required_channel_id: null,
    deadline: data.deadline ?? new Date().toISOString(),
    max_referral_bonus: data.max_referral_bonus ?? 5,
    image_file_id: data.image_file_id ?? null,
    publish_chat_id: data.publish_chat_id ?? null,
    publish_message_id: null,
    status: 'draft',
    auto_draw: 0,
    created_at: new Date().toISOString(),
  };
}

/** Render the public giveaway card caption. When the giveaway has ended and a
 * winnersHtml block is given, the winners are shown INSIDE the card. */
export function renderCaption(g: GiveawayRow, participantCount: number, winnersHtml?: string): string {
  const lines: string[] = [];
  lines.push(`🎉 <b>${escapeHtml(g.title)}</b>`);
  lines.push('');
  if (g.description && g.description.trim()) {
    // description is stored as pre-rendered safe HTML (formatting preserved).
    lines.push(g.description);
    lines.push('');
  }
  lines.push('🎁 <b>Prize</b>');
  lines.push(g.prize); // pre-rendered safe HTML
  lines.push('');
  lines.push('🏆 <b>Winners</b>');
  lines.push(`${g.winners_count} Orang`);
  lines.push('');
  lines.push('👥 <b>Participants</b>');
  lines.push(`${participantCount} Participants`);
  lines.push('');
  lines.push('📢 <b>Requirements</b>');
  lines.push(`Join <a href="${channelUrl(g)}">${escapeHtml(g.required_channel)}</a>`);
  lines.push('');
  lines.push('📅 <b>Winner Selection</b>');
  lines.push(formatWib(g.deadline));

  if (g.status === 'ended') {
    lines.push('');
    if (winnersHtml && winnersHtml.trim()) {
      lines.push('🎊 <b>PEMENANG</b>');
      lines.push(winnersHtml);
    } else {
      lines.push('🔒 <b>GIVEAWAY ENDED</b>');
    }
  } else if (g.status === 'awaiting_draw') {
    lines.push('');
    lines.push('⏳ <b>Waiting for winner draw…</b>');
  }
  return lines.join('\n');
}

/**
 * Publish a giveaway to its destination chat.
 * Uses sendPhoto when an image is present, otherwise sendMessage.
 * Returns the published message id, or null on failure.
 */
export async function publishGiveaway(
  env: Env,
  giveaway: GiveawayRow,
  participantCount: number,
): Promise<{ chatId: string; messageId: string } | null> {
  if (!giveaway.publish_chat_id) {
    console.error('publishGiveaway: missing publish_chat_id');
    return null;
  }
  const caption = renderCaption(giveaway, participantCount);
  // Channel post: JOIN is a deep-link into the bot so the user is guaranteed to
  // /start it first (otherwise the bot can't DM confirmations/winner notices).
  const botUsername = await getBotUsername(env);
  const keyboard = joinDeepLinkKeyboard(botUsername, giveaway.id);

  let res;
  if (giveaway.image_file_id) {
    res = await telegram<TelegramMessage>(
      'sendPhoto',
      {
        chat_id: giveaway.publish_chat_id,
        photo: giveaway.image_file_id,
        caption,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      },
      env,
    );
  } else {
    res = await telegram<TelegramMessage>(
      'sendMessage',
      {
        chat_id: giveaway.publish_chat_id,
        text: caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: keyboard,
      },
      env,
    );
  }

  if (!res.ok || !res.result) {
    console.error('publishGiveaway failed:', res.description);
    return null;
  }
  return { chatId: giveaway.publish_chat_id, messageId: String(res.result.message_id) };
}

/**
 * Send the giveaway card to an arbitrary chat (e.g. a user's DM via a deep link),
 * with the JOIN button attached. Returns the sent message id or null.
 */
export async function sendGiveawayCard(
  env: Env,
  chatId: string | number,
  giveaway: GiveawayRow,
  participantCount: number,
): Promise<string | null> {
  const caption = renderCaption(giveaway, participantCount);
  const keyboard = joinKeyboard(giveaway.id);
  const res = giveaway.image_file_id
    ? await telegram<TelegramMessage>(
        'sendPhoto',
        { chat_id: chatId, photo: giveaway.image_file_id, caption, parse_mode: 'HTML', reply_markup: keyboard },
        env,
      )
    : await telegram<TelegramMessage>(
        'sendMessage',
        { chat_id: chatId, text: caption, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard },
        env,
      );
  if (!res.ok || !res.result) {
    console.warn('sendGiveawayCard failed:', res.description);
    return null;
  }
  return String(res.result.message_id);
}

/**
 * Edit the published giveaway message to reflect a new participant count / status.
 * Never throws — logs and continues so registration is not blocked by edit failures.
 */
export async function updatePublishedCard(
  env: Env,
  giveaway: GiveawayRow,
  participantCount: number,
  keepJoinButton = true,
  winnersHtml?: string,
): Promise<void> {
  if (!giveaway.publish_chat_id || !giveaway.publish_message_id) return;
  const caption = renderCaption(giveaway, participantCount, winnersHtml);
  let reply_markup: InlineKeyboardMarkup = { inline_keyboard: [] };
  if (keepJoinButton) {
    const botUsername = await getBotUsername(env);
    reply_markup = joinDeepLinkKeyboard(botUsername, giveaway.id);
  }
  const base = {
    chat_id: giveaway.publish_chat_id,
    message_id: Number(giveaway.publish_message_id),
    parse_mode: 'HTML',
    reply_markup,
  };

  const method = giveaway.image_file_id ? 'editMessageCaption' : 'editMessageText';
  const payload = giveaway.image_file_id
    ? { ...base, caption }
    : { ...base, text: caption, disable_web_page_preview: true };

  const res = await telegram(method, payload, env);
  if (!res.ok && res.description && !res.description.includes('message is not modified')) {
    console.warn(`updatePublishedCard (${method}) failed: ${res.description}`);
  }
}
