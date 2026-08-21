/** Worker bindings (wrangler.toml [vars]/[[d1_databases]] + secrets). */
export interface Env {
  DB: D1Database;
  // secrets
  BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  // vars
  ADMIN_IDS: string;
  BOT_USERNAME?: string;
}

export type GiveawayStatus = 'draft' | 'active' | 'awaiting_draw' | 'ended';

export interface UserRow {
  id: number;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  created_at: string;
}

export interface GiveawayRow {
  id: number;
  title: string;
  description: string | null;
  prize: string;
  winners_count: number;
  required_channel: string;
  required_channel_id: string | null;
  deadline: string;
  max_referral_bonus: number;
  image_file_id: string | null;
  publish_chat_id: string | null;
  publish_message_id: string | null;
  status: GiveawayStatus;
  auto_draw: number;
  created_at: string;
}

export interface ParticipantRow {
  id: number;
  giveaway_id: number;
  user_id: number;
  base_entries: number;
  referral_entries: number;
  joined_at: string;
  is_valid: number;
}

export interface ReferralRow {
  id: number;
  giveaway_id: number;
  referrer_user_id: number;
  referred_user_id: number;
  is_valid: number;
  created_at: string;
}

export interface WinnerRow {
  id: number;
  giveaway_id: number;
  user_id: number;
  position: number;
  selected_at: string;
}

/** Admin /newgiveaway wizard state (persisted in admin_sessions.data as JSON). */
export interface WizardData {
  title?: string;
  description?: string | null;
  prize?: string;
  winners_count?: number;
  required_channel?: string;
  deadline?: string; // UTC ISO
  max_referral_bonus?: number;
  image_file_id?: string | null;
  publish_chat_id?: string;
  /** Internal: set while editing a single field from the preview, so the next
   * valid input returns to the preview instead of advancing to the next step. */
  _edit?: boolean;
  /** Internal: id of the single "anchor" message that the wizard edits in place
   * as steps advance (so the chat doesn't pile up). */
  _anchor?: number;
  /** Internal: whether the current anchor message is a photo (preview w/ image),
   * so we know to edit its caption vs its text. */
  _anchorPhoto?: boolean;
}

export type WizardStep =
  | 'title'
  | 'description'
  | 'prize'
  | 'winners_count'
  | 'required_channel'
  | 'deadline'
  | 'max_referral_bonus'
  | 'image'
  | 'publish_dest'
  | 'preview';
