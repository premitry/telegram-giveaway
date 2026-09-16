import type { Env, GiveawayRow, WinnerRow } from '../types';
import { listWeightedParticipants } from '../db/participants';
import {
  checkChannelMembership,
  isChannelMember,
  type MembershipStatus,
} from './membership';
import { drawWinners, repeatWinnerWeight, type WeightedEntry } from '../utils/random';
import { getUserById } from '../db/users';
import { sendMessage } from '../telegram/api';
import { escapeHtml } from '../utils/formatting';
import { prizeForPosition } from './giveaway';
import { nowIso } from '../utils/datetime';

export interface DrawnWinner {
  position: number;
  userId: number;
  telegramId: string;
  entries: number;
}

export interface WinnerMembershipAudit {
  position: number;
  userId: number;
  telegramId: string | null;
  username: string | null;
  firstName: string | null;
  status: MembershipStatus;
}

export type GuardedRerollResult =
  | { status: 'replaced'; replacement: DrawnWinner }
  | { status: 'no_candidate' | 'missing' | 'stale' };

/** Re-check channel membership for a set of candidates, keeping only eligible ones. */
async function filterEligible(env: Env, giveaway: GiveawayRow, pool: WeightedEntry[]): Promise<WeightedEntry[]> {
  const eligible: WeightedEntry[] = [];
  for (const p of pool) {
    const ok = await isChannelMember(env, giveaway, p.telegramId);
    if (ok) eligible.push(p);
  }
  return eligible;
}

async function currentWinnerUserIds(env: Env, giveawayId: number): Promise<Set<number>> {
  const res = await env.DB.prepare(`SELECT user_id FROM winners WHERE giveaway_id = ?`)
    .bind(giveawayId)
    .all<{ user_id: number }>();
  return new Set((res.results ?? []).map((r) => r.user_id));
}

export function getWinnerAtPosition(
  env: Env,
  giveawayId: number,
  position: number,
): Promise<WinnerRow | null> {
  return env.DB.prepare(
    `SELECT * FROM winners WHERE giveaway_id = ? AND position = ?`,
  )
    .bind(giveawayId, position)
    .first<WinnerRow>();
}

/** Live snapshot of every current winner's required-channel membership. */
export async function auditWinnerMemberships(
  env: Env,
  giveaway: GiveawayRow,
): Promise<WinnerMembershipAudit[]> {
  const winners = await listWinners(env, giveaway.id);
  const audits: WinnerMembershipAudit[] = [];
  for (const winner of winners) {
    const user = await getUserById(env.DB, winner.user_id);
    const status = user
      ? await checkChannelMembership(env, giveaway, user.telegram_id)
      : 'unknown';
    audits.push({
      position: winner.position,
      userId: winner.user_id,
      telegramId: user?.telegram_id ?? null,
      username: user?.username ?? null,
      firstName: user?.first_name ?? null,
      status,
    });
  }
  return audits;
}

/**
 * How many times each user has won in OTHER giveaways (all-time), keyed by
 * user_id. Used to shrink a repeat winner's odds so the prizes rotate — it
 * self-balances over time, since whoever won least keeps the highest weight.
 */
async function pastWinCounts(env: Env, excludeGiveawayId: number): Promise<Record<number, number>> {
  const res = await env.DB.prepare(
    `SELECT user_id AS uid, COUNT(*) AS c FROM winners WHERE giveaway_id != ? GROUP BY user_id`,
  )
    .bind(excludeGiveawayId)
    .all<{ uid: number; c: number }>();
  const map: Record<number, number> = {};
  for (const r of res.results ?? []) map[r.uid] = r.c;
  return map;
}

/**
 * Draw winners with a fresh membership re-check and secure random selection.
 * Everyone starts with an equal chance; anyone who already won a PREVIOUS
 * giveaway gets their odds halved per past win (never to zero).
 * Replaces any previously stored winners for this giveaway.
 */
export async function drawGiveaway(env: Env, giveaway: GiveawayRow): Promise<DrawnWinner[]> {
  const pool = await listWeightedParticipants(env.DB, giveaway.id);
  const eligible = await filterEligible(env, giveaway, pool);
  const past = await pastWinCounts(env, giveaway.id);

  const selected = drawWinners(eligible, giveaway.winners_count, (p) =>
    repeatWinnerWeight(past[p.userId] ?? 0),
  );

  await env.DB.prepare(`DELETE FROM winners WHERE giveaway_id = ?`).bind(giveaway.id).run();

  const now = nowIso();
  const drawn: DrawnWinner[] = [];
  let position = 1;
  for (const w of selected) {
    await env.DB.prepare(
      `INSERT INTO winners (giveaway_id, user_id, position, selected_at) VALUES (?, ?, ?, ?)`,
    )
      .bind(giveaway.id, w.userId, position, now)
      .run();
    drawn.push({ position, userId: w.userId, telegramId: w.telegramId, entries: w.entries });
    position++;
  }
  return drawn;
}

async function pickReplacement(
  env: Env,
  giveaway: GiveawayRow,
): Promise<WeightedEntry | null> {
  const existing = await currentWinnerUserIds(env, giveaway.id);
  const pool = (await listWeightedParticipants(env.DB, giveaway.id)).filter(
    (p) => !existing.has(p.userId),
  );
  const eligible = await filterEligible(env, giveaway, pool);
  const past = await pastWinCounts(env, giveaway.id);
  return drawWinners(eligible, 1, (p) => repeatWinnerWeight(past[p.userId] ?? 0))[0] ?? null;
}

/**
 * Replace a position only if it is still occupied by the expected winner. The
 * conditional update prevents delayed/double callback clicks from replacing a
 * newer winner or creating a winner at a missing position.
 */
export async function rerollWinnerGuarded(
  env: Env,
  giveaway: GiveawayRow,
  position: number,
  expectedUserId: number,
): Promise<GuardedRerollResult> {
  const current = await getWinnerAtPosition(env, giveaway.id, position);
  if (!current) return { status: 'missing' };
  if (current.user_id !== expectedUserId) return { status: 'stale' };

  const replacement = await pickReplacement(env, giveaway);
  if (!replacement) return { status: 'no_candidate' };

  const updated = await env.DB.prepare(
    `UPDATE winners
        SET user_id = ?, selected_at = ?
      WHERE giveaway_id = ? AND position = ? AND user_id = ?`,
  )
    .bind(replacement.userId, nowIso(), giveaway.id, position, expectedUserId)
    .run();
  if ((updated.meta.changes ?? 0) === 0) return { status: 'stale' };

  return {
    status: 'replaced',
    replacement: {
      position,
      userId: replacement.userId,
      telegramId: replacement.telegramId,
      entries: replacement.entries,
    },
  };
}

/** Manual admin reroll. Missing positions are rejected rather than inserted. */
export async function rerollWinner(
  env: Env,
  giveaway: GiveawayRow,
  position: number,
): Promise<DrawnWinner | null> {
  const current = await getWinnerAtPosition(env, giveaway.id, position);
  if (!current) return null;
  const result = await rerollWinnerGuarded(env, giveaway, position, current.user_id);
  return result.status === 'replaced' ? result.replacement : null;
}

export async function listWinners(env: Env, giveawayId: number): Promise<WinnerRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM winners WHERE giveaway_id = ? ORDER BY position ASC`,
  )
    .bind(giveawayId)
    .all<WinnerRow>();
  return res.results ?? [];
}

/**
 * Compact winners list (HTML) to embed INSIDE the published giveaway card.
 * Accepts any winner shape carrying a position + user_id; the handle is
 * resolved from the users table. Returns '' when there are no winners.
 */
export async function renderWinnersCardBlock(
  env: Env,
  winners: { position: number; userId: number }[],
  prizes?: string[],
): Promise<string> {
  if (winners.length === 0) return '';
  const perWinnerPrize = !!prizes && prizes.length > 1;
  const sorted = [...winners].sort((a, b) => a.position - b.position);
  const lines: string[] = [];
  for (const w of sorted) {
    const user = await getUserById(env.DB, w.userId);
    const handle = user?.username
      ? `@${escapeHtml(user.username)}`
      : `<a href="tg://user?id=${user?.telegram_id ?? ''}">${escapeHtml(user?.first_name ?? 'Winner')}</a>`;
    let line = `🥇 ${w.position}. ${handle}`;
    if (perWinnerPrize && prizes![w.position - 1]) {
      line += ` → 🎁 ${prizes![w.position - 1]}`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * DM each winner a personal congratulations. Best-effort: a user who never
 * started the bot (or blocked it) is skipped without failing the draw.
 * Returns how many notifications were delivered.
 */
export async function notifyWinners(
  env: Env,
  giveaway: GiveawayRow,
  winners: DrawnWinner[],
): Promise<number> {
  let delivered = 0;
  for (const w of winners) {
    const text = [
      '🎉 <b>SELAMAT!</b>',
      '',
      `Kamu menang di giveaway <b>${escapeHtml(giveaway.title)}</b> (posisi #${w.position}).`,
      `🎁 Hadiah: ${prizeForPosition(giveaway, w.position)}`,
      '',
      'Admin akan menghubungi kamu untuk klaim hadiah. 🎊',
    ].join('\n');
    const res = await sendMessage(env, w.telegramId, text);
    if (res.ok) delivered++;
    else console.warn(`notifyWinners: could not DM winner ${w.telegramId}: ${res.description}`);
  }
  return delivered;
}
