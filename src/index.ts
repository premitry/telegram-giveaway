import type { Env } from './types';
import type { TelegramUpdate } from './telegram/types';
import { handleCommand } from './handlers/commands';
import { handleCallback } from './handlers/callback';
import { handleWizardInput } from './handlers/admin';
import { runCron } from './services/cron';

/** Dispatch a single Telegram update. */
async function handleUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallback(env, update.callback_query);
    return;
  }

  const message = update.message;
  if (!message || !message.from) return;

  if (message.text && message.text.startsWith('/')) {
    await handleCommand(env, message);
    return;
  }

  // Non-command text or a photo: feed it to an active admin wizard, if any.
  await handleWizardInput(env, message);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('OK — telegram-giveaway-bot is running', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        console.warn('webhook rejected: bad secret token');
        return new Response('forbidden', { status: 403 });
      }

      let update: TelegramUpdate;
      try {
        update = (await request.json()) as TelegramUpdate;
      } catch {
        return new Response('bad request', { status: 400 });
      }

      // Acknowledge immediately; process asynchronously so Telegram does not retry.
      ctx.waitUntil(
        handleUpdate(env, update).catch((err) => console.error('handleUpdate error', err)),
      );
      return new Response('OK', { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env).catch((err) => console.error('cron error', err)));
  },
} satisfies ExportedHandler<Env>;
