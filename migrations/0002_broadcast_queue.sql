-- 0002_broadcast_queue.sql — durable broadcast queue drained by the cron trigger.
-- Lets /broadcast work on the FREE plan (no Cloudflare Queues needed): messages
-- are queued here and sent in small batches per request/cron tick to stay within
-- the Workers subrequest limit.

CREATE TABLE IF NOT EXISTS broadcast_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     TEXT NOT NULL,
  text        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending|sent|failed
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcast_status ON broadcast_queue(status, id);
