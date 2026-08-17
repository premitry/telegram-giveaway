import type { Env, GiveawayRow, UserRow } from '../types';
import { sendMessage } from '../telegram/api';
import { getUserByTelegramId, getUserById } from '../db/users';
import { getParticipant, incrementReferralEntry } from '../db/participants';
import {
  insertPendingReferral,
  getPendingReferral,
  markReferralValid,
} from '../db/referrals';

export interface StartPayload {
  giveawayId: number;
  referrerTelegramId: string;
}

/** Parse a deep-link payload like "g_5_r_12345678". Returns null when not a referral. */
export function parseStartPayload(payload: string | undefined): StartPayload | null {
  if (!payload) return null;
  const m = payload.match(/^g_(\d+)_r_(\d+)$/);
  if (!m) return null;
  return { giveawayId: Number(m[1]), referrerTelegramId: m[2] };
}

/**
 * Record a pending referral when a user opens a referral link.
 * Enforces: no self-referral, referrer must be an existing participant,
 * referred user must not already be a participant, no duplicates.
 */
export async function recordPendingReferral(
  db: D1Database,
  giveaway: GiveawayRow,
  referrerTelegramId: string,
  referredUser: UserRow,
): Promise<void> {
  if (referrerTelegramId === referredUser.telegram_id) return; // self-referral

  const referrer = await getUserByTelegramId(db, referrerTelegramId);
  if (!referrer) return; // referrer unknown → cannot credit

  // Referrer must already be a participant of this giveaway.
  const referrerParticipant = await getParticipant(db, giveaway.id, referrer.id);
  if (!referrerParticipant) return;

  // Referral from/for an existing participant is not counted.
  const referredParticipant = await getParticipant(db, giveaway.id, referredUser.id);
  if (referredParticipant) return;

  await insertPendingReferral(db, giveaway.id, referrer.id, referredUser.id);
}

/**
 * Called after a user successfully joins. If a pending referral exists, mark it
 * valid and grant the referrer +1 entry (capped at max_referral_bonus).
 * Returns the referrer user (for optional notification) or null.
 */
export async function creditReferralOnJoin(
  db: D1Database,
  giveaway: GiveawayRow,
  referredUserId: number,
): Promise<{ referrer: UserRow; newReferralEntries: number } | null> {
  const pending = await getPendingReferral(db, giveaway.id, referredUserId);
  if (!pending) return null;

  await markReferralValid(db, pending.id);
  const newReferralEntries = await incrementReferralEntry(
    db,
    giveaway.id,
    pending.referrer_user_id,
    giveaway.max_referral_bonus,
  );
  if (newReferralEntries === null) return null; // referrer no longer a participant

  const referrer = await getUserById(db, pending.referrer_user_id);
  if (!referrer) return null;
  return { referrer, newReferralEntries };
}

/** Build the referral deep link for a participant. */
export function buildReferralLink(
  botUsername: string,
  giveawayId: number,
  referrerTelegramId: string,
): string {
  return `https://t.me/${botUsername}?start=g_${giveawayId}_r_${referrerTelegramId}`;
}

/** Notify a referrer that they earned a new valid referral entry. */
export async function notifyReferrer(
  env: Env,
  referrerTelegramId: string,
  newReferralEntries: number,
): Promise<void> {
  await sendMessage(
    env,
    referrerTelegramId,
    `🎉 Salah satu teman yang kamu undang berhasil ikut giveaway!\n\n🎟 Entry referral kamu sekarang: <b>${newReferralEntries}</b>`,
  );
}
