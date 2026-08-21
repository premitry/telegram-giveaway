-- Per-winner prizes. Stored as a JSON array of strings, index = position-1.
-- NULL means the giveaway uses the single shared `prize` for every winner.
ALTER TABLE giveaways ADD COLUMN prizes_json TEXT;
