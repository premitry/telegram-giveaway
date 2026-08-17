import type { Env, GiveawayRow } from '../types';
import { getChatMember } from '../telegram/api';

const VALID_STATUSES = new Set(['member', 'administrator', 'creator']);

/** The chat identifier to query: prefer the numeric id, fall back to @username. */
export function channelIdentifier(giveaway: GiveawayRow): string {
  return giveaway.required_channel_id ?? giveaway.required_channel;
}

/** Public URL for the required channel (works for @username channels). */
export function channelUrl(giveaway: GiveawayRow): string {
  const ch = giveaway.required_channel.trim();
  if (ch.startsWith('http')) return ch;
  const handle = ch.startsWith('@') ? ch.slice(1) : ch;
  return `https://t.me/${handle}`;
}

/** True when the user is a member/administrator/creator of the required channel. */
export async function isChannelMember(
  env: Env,
  giveaway: GiveawayRow,
  telegramUserId: string | number,
): Promise<boolean> {
  const res = await getChatMember(env, channelIdentifier(giveaway), telegramUserId);
  if (!res.ok || !res.result) {
    // Common cause: the bot is not an admin of the channel, or the user is not found.
    console.warn(`membership check failed for user ${telegramUserId}: ${res.description}`);
    return false;
  }
  return VALID_STATUSES.has(res.result.status);
}
