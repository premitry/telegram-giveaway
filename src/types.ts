import type { BroadcastMessage } from './services/broadcast';

/** Worker bindings (wrangler.toml [vars]/[[d1_databases]]/[[queues.*]] + secrets). */
export interface Env {
  DB: D1Database;
  // Optional: only bound on paid plans (Cloudflare Queues). Broadcast degrades
  // gracefully when this is absent.
  BROADCAST_QUEUE?: Queue<BroadcastMessage>;
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
