import type { Env, GiveawayRow, WinnerRow } from '../types';
import { listWeightedParticipants } from '../db/participants';
import { isChannelMember } from './membership';
import { drawWinners, type WeightedEntry } from '../utils/random';
import { getUserById } from '../db/users';
import { sendMessage } from '../telegram/api';
import { escapeHtml } from '../utils/formatting';
import { nowIso } from '../utils/datetime';

export interface DrawnWinner {
  position: number;
  userId: number;
  telegramId: string;
  entries: number;
}

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

/**
 * Draw winners with a fresh membership re-check and secure weighted selection.
 * Replaces any previously stored winners for this giveaway.
 */
export async function drawGiveaway(env: Env, giveaway: GiveawayRow): Promise<DrawnWinner[]> {
  const pool = await listWeightedParticipants(env.DB, giveaway.id);
  const eligible = await filterEligible(env, giveaway, pool);

  const selected = drawWinners(eligible, giveaway.winners_count);

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

/**
 * Reroll a single position: pick a replacement excluding all current winners,
 * re-checking membership. Returns the new winner, or null if no candidate remains.
 */
export async function rerollWinner(
  env: Env,
  giveaway: GiveawayRow,
  position: number,
): Promise<DrawnWinner | null> {
  const existing = await currentWinnerUserIds(env, giveaway.id);
  const pool = (await listWeightedParticipants(env.DB, giveaway.id)).filter(
    (p) => !existing.has(p.userId),
  );
  const eligible = await filterEligible(env, giveaway, pool);
  const [replacement] = drawWinners(eligible, 1);
  if (!replacement) return null;

  await env.DB.prepare(`DELETE FROM winners WHERE giveaway_id = ? AND position = ?`)
    .bind(giveaway.id, position)
    .run();
  await env.DB.prepare(
    `INSERT INTO winners (giveaway_id, user_id, position, selected_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(giveaway.id, replacement.userId, position, nowIso())
    .run();

  return {
    position,
    userId: replacement.userId,
    telegramId: replacement.telegramId,
    entries: replacement.entries,
  };
}

export async function listWinners(env: Env, giveawayId: number): Promise<WinnerRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM winners WHERE giveaway_id = ? ORDER BY position ASC`,
  )
    .bind(giveawayId)
    .all<WinnerRow>();
  return res.results ?? [];
}

/** Render a winners announcement, resolving each winner's display handle. */
export async function renderWinnersAnnouncement(
  env: Env,
  giveaway: GiveawayRow,
  winners: DrawnWinner[],
): Promise<string> {
  if (winners.length === 0) {
    return `🎉 <b>${giveaway.title}</b>\n\n😕 Tidak ada pemenang yang memenuhi syarat.`;
  }
  const lines = [`🎉 <b>${giveaway.title}</b>`, '', '🏆 <b>WINNERS</b>', ''];
  for (const w of winners) {
    const user = await getUserById(env.DB, w.userId);
    const handle = user?.username
      ? `@${user.username}`
      : `<a href="tg://user?id=${w.telegramId}">${user?.first_name ?? 'Winner'}</a>`;
    lines.push(`${w.position}. ${handle} — ${w.entries} 🎟`);
  }
  lines.push('');
  lines.push('Selamat kepada para pemenang! 🎊');
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
      `🎁 Hadiah: ${giveaway.prize}`,
      '',
      'Admin akan menghubungi kamu untuk klaim hadiah. 🎊',
    ].join('\n');
    const res = await sendMessage(env, w.telegramId, text);
    if (res.ok) delivered++;
    else console.warn(`notifyWinners: could not DM winner ${w.telegramId}: ${res.description}`);
  }
  return delivered;
}
