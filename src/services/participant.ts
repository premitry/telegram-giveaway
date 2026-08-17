import type { Env, GiveawayRow, ParticipantRow } from '../types';
import type { TelegramUser } from '../telegram/types';
import { upsertUser } from '../db/users';
import { getParticipant, insertParticipant, countParticipants } from '../db/participants';
import { countValidReferrals } from '../db/referrals';
import { isChannelMember } from './membership';
import { creditReferralOnJoin, notifyReferrer } from './referral';

export type JoinResult =
  | { status: 'inactive' }
  | { status: 'not_member' }
  | { status: 'already'; participant: ParticipantRow }
  | { status: 'joined'; participant: ParticipantRow };

/**
 * Full join flow: validate giveaway, membership, dedupe, persist participant,
 * and credit any pending referral. Idempotent per (giveaway, user).
 */
export async function joinGiveaway(
  env: Env,
  giveaway: GiveawayRow,
  tgUser: TelegramUser,
): Promise<JoinResult> {
  const user = await upsertUser(env.DB, tgUser);

  if (giveaway.status !== 'active') return { status: 'inactive' };

  const existing = await getParticipant(env.DB, giveaway.id, user.id);
  if (existing) return { status: 'already', participant: existing };

  const member = await isChannelMember(env, giveaway, tgUser.id);
  if (!member) return { status: 'not_member' };

  const inserted = await insertParticipant(env.DB, giveaway.id, user.id);
  if (!inserted) {
    // Lost a race — someone inserted concurrently. Treat as already joined.
    const p = await getParticipant(env.DB, giveaway.id, user.id);
    if (p) return { status: 'already', participant: p };
  }

  // Credit a pending referral (if any) and notify the referrer.
  const credit = await creditReferralOnJoin(env.DB, giveaway, user.id);
  if (credit) {
    await notifyReferrer(env, credit.referrer.telegram_id, credit.newReferralEntries).catch((e) =>
      console.error('notifyReferrer failed', e),
    );
  }

  const participant = await getParticipant(env.DB, giveaway.id, user.id);
  return { status: 'joined', participant: participant! };
}

export interface EntriesSummary {
  totalEntries: number;
  validReferrals: number;
}

/** Compute a participant's entries summary for the "MY ENTRIES" card. */
export async function entriesSummary(
  db: D1Database,
  giveawayId: number,
  participant: ParticipantRow,
): Promise<EntriesSummary> {
  const validReferrals = await countValidReferrals(db, giveawayId, participant.user_id);
  return {
    totalEntries: participant.base_entries + participant.referral_entries,
    validReferrals,
  };
}

export { countParticipants };
