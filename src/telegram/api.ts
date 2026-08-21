import type { Env } from '../types';
import type { ChatMember, TelegramMessage, TelegramResponse, TelegramUser } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reusable Telegram Bot API wrapper.
 * Handles HTTP errors, ok:false responses, and 429 rate limits (retry_after).
 */
export async function telegram<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
  env: Env,
): Promise<TelegramResponse<T>> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error(`telegram ${method} network error (attempt ${attempt})`, err);
      if (attempt === maxAttempts) return { ok: false, description: 'network error' };
      await sleep(500 * attempt);
      continue;
    }

    let data: TelegramResponse<T>;
    try {
      data = (await res.json()) as TelegramResponse<T>;
    } catch {
      console.error(`telegram ${method} invalid JSON, http ${res.status}`);
      return { ok: false, description: `invalid json (http ${res.status})` };
    }

    if (data.ok) return data;

    if (res.status === 429 && data.parameters?.retry_after) {
      const wait = Math.min(data.parameters.retry_after, 30);
      console.warn(`telegram ${method} rate limited, retry after ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }

    console.error(`telegram ${method} api error [${data.error_code}]: ${data.description}`);
    return data;
  }
  return { ok: false, description: 'max attempts exceeded' };
}

export function answerCallback(
  env: Env,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
  url?: string,
): Promise<TelegramResponse<boolean>> {
  return telegram<boolean>(
    'answerCallbackQuery',
    { callback_query_id: callbackQueryId, text, show_alert: showAlert, url },
    env,
  );
}

export function getChatMember(
  env: Env,
  chatId: string,
  userId: string | number,
): Promise<TelegramResponse<ChatMember>> {
  return telegram<ChatMember>('getChatMember', { chat_id: chatId, user_id: userId }, env);
}

export function sendMessage(
  env: Env,
  chatId: string | number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<TelegramResponse<TelegramMessage>> {
  return telegram<TelegramMessage>(
    'sendMessage',
    { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra },
    env,
  );
}

/** Edit an existing text message in place (used for the in-menu navigation). */
export function editMessageText(
  env: Env,
  chatId: string | number,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<TelegramResponse<TelegramMessage>> {
  return telegram<TelegramMessage>(
    'editMessageText',
    { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra },
    env,
  );
}

/** Delete a message (best-effort; used to remove a published giveaway post). */
export function deleteMessage(
  env: Env,
  chatId: string | number,
  messageId: number,
): Promise<TelegramResponse<boolean>> {
  return telegram<boolean>('deleteMessage', { chat_id: chatId, message_id: messageId }, env);
}

// Module-level cache for the bot username within an isolate.
let cachedUsername: string | null = null;

export async function getBotUsername(env: Env): Promise<string> {
  if (env.BOT_USERNAME) return env.BOT_USERNAME;
  if (cachedUsername) return cachedUsername;
  const res = await telegram<TelegramUser>('getMe', {}, env);
  if (res.ok && res.result?.username) {
    cachedUsername = res.result.username;
    return cachedUsername;
  }
  console.error('getBotUsername: could not resolve bot username', res.description);
  return 'unknown_bot';
}
