// Timezone helpers. Storage is always UTC ISO strings; display is Asia/Jakarta (WIB, UTC+7, no DST).

const WIB_OFFSET_MINUTES = 7 * 60;

/** Current instant as a UTC ISO-8601 string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Parse an admin-entered WIB datetime into a UTC ISO string.
 * Accepts "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS" (also tolerates a 'T' separator).
 * Returns null when the input cannot be parsed.
 */
export function parseWibToUtc(input: string): string | null {
  const m = input
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s ? Number(s) : 0;

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  // Interpret the wall-clock time as WIB, then shift back to UTC.
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - WIB_OFFSET_MINUTES * 60_000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Format a UTC ISO string as "17 August 2026 • 20:00 WIB". */
export function formatWib(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${dateFmt.format(date)} • ${timeFmt.format(date)} WIB`;
}

/** True when the given UTC ISO deadline is in the past. */
export function isPast(iso: string): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t <= Date.now();
}
