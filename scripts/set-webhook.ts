/**
 * Set (or delete) the Telegram webhook.
 *
 * Usage:
 *   BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... WEBHOOK_URL=https://your-worker.workers.dev/webhook \
 *     npm run set-webhook
 *
 *   npm run delete-webhook           # removes the webhook
 *
 * Values are also read from a local `.dev.vars` file if present, and WEBHOOK_URL
 * may be given as just the domain (the script appends /webhook).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDevVars(): Record<string, string> {
  const path = join(__dirname, '..', '.dev.vars');
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const devVars = loadDevVars();
const env = { ...devVars, ...process.env };

const BOT_TOKEN = env.BOT_TOKEN;
const SECRET = env.TELEGRAM_WEBHOOK_SECRET;
let WEBHOOK_URL = env.WEBHOOK_URL || env.WORKER_DOMAIN || '';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is required (set it in .dev.vars or as an env var).');
  process.exit(1);
}

const isDelete = process.argv.includes('--delete');
const api = (method: string) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

async function main(): Promise<void> {
  if (isDelete) {
    const res = await fetch(api('deleteWebhook'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
    console.log('deleteWebhook:', await res.json());
    return;
  }

  if (!WEBHOOK_URL) {
    console.error('❌ WEBHOOK_URL (or WORKER_DOMAIN) is required.');
    process.exit(1);
  }
  if (!/\/webhook$/.test(WEBHOOK_URL)) {
    WEBHOOK_URL = WEBHOOK_URL.replace(/\/$/, '') + '/webhook';
  }
  if (!/^https:\/\//.test(WEBHOOK_URL)) WEBHOOK_URL = 'https://' + WEBHOOK_URL;

  const body: Record<string, unknown> = {
    url: WEBHOOK_URL,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  };
  if (SECRET) body.secret_token = SECRET;
  else console.warn('⚠️  TELEGRAM_WEBHOOK_SECRET not set — webhook will be unprotected.');

  const res = await fetch(api('setWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log('setWebhook ->', WEBHOOK_URL);
  console.log(json);

  const info = await fetch(api('getWebhookInfo'));
  console.log('getWebhookInfo:', await info.json());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
