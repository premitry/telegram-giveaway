-- 0001_initial.sql — Telegram Giveaway Bot schema
-- All datetimes are stored as UTC ISO-8601 strings (e.g. 2026-08-17T13:00:00.000Z).

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id   TEXT UNIQUE NOT NULL,
  username      TEXT,
  first_name    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaways (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT NOT NULL,
  description         TEXT,
  prize               TEXT NOT NULL,
  winners_count       INTEGER NOT NULL,
  required_channel    TEXT NOT NULL,
  required_channel_id TEXT,
  deadline            TEXT NOT NULL,           -- UTC ISO string
  max_referral_bonus  INTEGER NOT NULL DEFAULT 5,
  image_file_id       TEXT,
  publish_chat_id     TEXT,
  publish_message_id  TEXT,
  status              TEXT NOT NULL DEFAULT 'draft',  -- draft|active|awaiting_draw|ended
  auto_draw           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_id      INTEGER NOT NULL,
  user_id          INTEGER NOT NULL,
  base_entries     INTEGER NOT NULL DEFAULT 1,
  referral_entries INTEGER NOT NULL DEFAULT 0,
  joined_at        TEXT NOT NULL,
  is_valid         INTEGER NOT NULL DEFAULT 1,
  UNIQUE(giveaway_id, user_id),
  FOREIGN KEY (giveaway_id) REFERENCES giveaways(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS referrals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_id       INTEGER NOT NULL,
  referrer_user_id  INTEGER NOT NULL,
  referred_user_id  INTEGER NOT NULL,
  is_valid          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  UNIQUE(giveaway_id, referred_user_id),
  FOREIGN KEY (giveaway_id) REFERENCES giveaways(id)
);

CREATE TABLE IF NOT EXISTS winners (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_id  INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  position     INTEGER NOT NULL,
  selected_at  TEXT NOT NULL,
  UNIQUE(giveaway_id, position),
  FOREIGN KEY (giveaway_id) REFERENCES giveaways(id)
);

CREATE TABLE IF NOT EXISTS admins (
  telegram_id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  telegram_id TEXT PRIMARY KEY,
  step        TEXT NOT NULL,
  data        TEXT,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participants_giveaway ON participants(giveaway_id);
CREATE INDEX IF NOT EXISTS idx_referrals_giveaway ON referrals(giveaway_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(giveaway_id, referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_giveaways_status ON giveaways(status);
