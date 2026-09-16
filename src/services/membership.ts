import type { Env, GiveawayRow } from '../types';
import { getChatMember } from '../telegram/api';

const VALID_STATUSES = new Set(['member', 'administrator', 'creator']);

export type MembershipStatus = 'member' | 'not_member' | 'unknown';

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

/**
 * Current membership reported by Telegram. API/configuration failures stay
 * `unknown` so administrative checks never mistake an outage for a departed user.
 */
export async function checkChannelMembership(
  env: Env,
  giveaway: GiveawayRow,
  telegramUserId: string | number,
): Promise<MembershipStatus> {
  const res = await getChatMember(env, channelIdentifier(giveaway), telegramUserId);
  if (!res.ok || !res.result) {
    console.warn(`membership check failed for user ${telegramUserId}: ${res.description}`);
    return 'unknown';
  }

  if (VALID_STATUSES.has(res.result.status)) return 'member';
  if (res.result.status === 'restricted') {
    return res.result.is_member === true ? 'member' : 'not_member';
  }
  if (res.result.status === 'left' || res.result.status === 'kicked') return 'not_member';

  console.warn(`membership check returned unknown status for user ${telegramUserId}`);
  return 'unknown';
}

/**
 * Fail-closed boolean wrapper used by JOIN and winner selection. Only a positive
 * current membership response counts as eligible.
 */
export async function isChannelMember(
  env: Env,
  giveaway: GiveawayRow,
  telegramUserId: string | number,
): Promise<boolean> {
  return (await checkChannelMembership(env, giveaway, telegramUserId)) === 'member';
}
