-- Speed up the per-user past-win lookup used to shrink a repeat winner's odds
-- (SELECT user_id, COUNT(*) FROM winners WHERE giveaway_id != ? GROUP BY user_id).
-- Covering index so the draw reads the index instead of scanning the table.
CREATE INDEX IF NOT EXISTS idx_winners_user ON winners(user_id, giveaway_id);
