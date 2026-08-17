# Telegram Giveaway Bot — Cloudflare Workers

A complete Telegram giveaway bot running **100% on Cloudflare Workers** — no Python, no
long polling, no VPS. Uses Telegram **webhooks**, **D1** for storage, **Queues** for
broadcasts, and **Cron Triggers** to close expired giveaways.

## Features

- Native giveaway cards (photo/banner + caption + inline keyboard)
- `JOIN GIVEAWAY` flow with channel-membership verification (`getChatMember`)
- Referral system with deep links (`?start=g_<id>_r_<uid>`), anti-abuse rules, and configurable bonus
- Live participant counter (`editMessageCaption` / `editMessageText`)
- Admin `/newgiveaway` wizard (state persisted in D1 — Workers are stateless)
- Secure **weighted** winner draw using `crypto.getRandomValues()` (never `Math.random`)
- `/draw`, `/reroll`, `/end`, `/stats`, `/participants`, `/broadcast`
- Broadcasts via Cloudflare Queues (no giant loops → no Worker timeouts)
- Cron every 5 min: `active → awaiting_draw` past deadline (auto-draw optional)
- All timestamps stored as UTC, displayed as **Asia/Jakarta (WIB)**
- TypeScript strict mode, prepared statements everywhere (no SQL string concatenation)

## Tech stack

TypeScript · Cloudflare Workers · Wrangler · D1 · Cloudflare Queues · Cron Triggers ·
Telegram Bot API via `fetch()`.

## Project structure

```
telegram-giveaway/
├── src/
│   ├── index.ts            # fetch (webhook + health), scheduled (cron), queue (broadcast)
│   ├── types.ts            # Env + DB row types
│   ├── telegram/           # api wrapper, types, keyboards
│   ├── handlers/           # commands, callback, admin wizard, start
│   ├── services/           # giveaway, participant, referral, membership, draw, broadcast, cron
│   ├── db/                 # users, giveaways, participants, referrals, sessions
│   └── utils/              # datetime (WIB), random (crypto)
├── migrations/0001_initial.sql
├── scripts/set-webhook.ts
├── wrangler.toml
└── ...
```
<!-- __APPEND_README__ -->

## Deploy — step by step

### 1. Create a Telegram bot (BotFather)
- Open [@BotFather](https://t.me/BotFather) → `/newbot` → copy the **BOT_TOKEN**.
- (Recommended) `/setjoingroups` and `/setprivacy` as you prefer.

### 2. Install the project
```bash
npm install
```

### 3. Log in to Cloudflare
```bash
npx wrangler login
```

### 4. Create the D1 database
```bash
npx wrangler d1 create telegram-giveaway
```
Copy the printed `database_id`.

### 5. Put `database_id` into `wrangler.toml`
Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID`. Also set your admin ids:
```toml
[vars]
ADMIN_IDS = "123456789,987654321"   # your Telegram numeric user id(s)
```
Find your id via [@userinfobot](https://t.me/userinfobot).

### 6. Run the migration
```bash
npm run migrate:remote      # applies migrations/*.sql to the live D1 db
# for local dev: npm run migrate:local
```

### 7. Set the BOT_TOKEN secret
```bash
npx wrangler secret put BOT_TOKEN
```

### 8. Set the webhook secret
```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
# enter any long random string (letters/digits/_/-)
```
<!-- __APPEND_README2__ -->

### 9. (First deploy only) create the Queue
Cloudflare Queues require a **paid Workers plan**.
```bash
npx wrangler queues create giveaway-broadcast
npx wrangler queues create giveaway-broadcast-dlq
```
> No paid plan / don't need broadcast? Comment out the `[[queues.producers]]`,
> `[[queues.consumers]]` blocks in `wrangler.toml` and skip `/broadcast`.

### 10. Deploy the Worker
```bash
npx wrangler deploy
```
Note the deployed URL, e.g. `https://telegram-giveaway-bot.<you>.workers.dev`.

### 11. Set the Telegram webhook
```bash
WEBHOOK_URL="https://telegram-giveaway-bot.<you>.workers.dev/webhook" \
BOT_TOKEN="<token>" \
TELEGRAM_WEBHOOK_SECRET="<same-secret-as-step-8>" \
npm run set-webhook
```
This calls `setWebhook` with the `secret_token`, so the Worker can reject forged requests
via the `X-Telegram-Bot-Api-Secret-Token` header.

### 12. Make the bot an admin of your channel
Required so `getChatMember` can verify membership. Add the bot to the channel as an admin.

### 13. Create your first giveaway
DM the bot `/newgiveaway` (as an admin) and follow the 9-step wizard → **PUBLISH**.

### 14. Test JOIN / referral / draw
- Tap **JOIN GIVEAWAY**, then **INVITE FRIENDS** to get your referral link.
- `/stats` and `/participants` to inspect.
- `/draw` to pick winners (re-checks membership, weighted by entries).
- `/reroll <position>` to replace one winner, `/end` to close early.

## Local development
```bash
cp .dev.vars.example .dev.vars     # fill BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET
npm run migrate:local
npm run dev                        # wrangler dev (local D1)
npm run typecheck                  # tsc --noEmit
```
Expose `localhost` with a tunnel (e.g. `cloudflared`) if you want Telegram to reach it.

## Referral rules
- 1 base entry per participant, **+1 entry per valid referral**, capped at `max_referral_bonus` (default 5).
- No self-referral; one attribution per referred user per giveaway (DB `UNIQUE`).
- Referral only counts once the referred user **completes** the join (channel check passes).
- A user who is already a participant cannot be referred.

## Notes
- Secrets (`BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`) are never stored in source — use `wrangler secret put`.
- All DB access uses D1 prepared statements; no user input is concatenated into SQL.
- Winner selection uses `crypto.getRandomValues()` with rejection sampling (no modulo bias).


