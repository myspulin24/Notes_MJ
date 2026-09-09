/**
 * Local-date helpers.
 *
 * Everything the backend stores is a plain `YYYY-MM-DD` calendar day with no
 * time zone, because "due Tuesday" means Tuesday wherever you happen to be.
 * These helpers therefore work on `YYYY-MM-DD` strings and the *local* clock,
 * and never go near `Date.toISOString()`, which would shift the day for anyone
 * west of Greenwich.
 */

/** `YYYY-MM-DD` for a JS Date, using its local calendar day. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today, as the user's calendar sees it. */
export function today(now: Date = new Date()): string {
  return toISODate(now);
}

/** Parses `YYYY-MM-DD` into a local midnight Date. Returns null if malformed. */
export function fromISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  // Rejects "2026-02-31", which JS would happily roll into March.
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null;
  return date;
}

export function isValidISODate(iso: string): boolean {
  return fromISODate(iso) !== null;
}

/** `iso` shifted by `days`, as `YYYY-MM-DD`. */
export function addDays(iso: string, days: number): string {
  const date = fromISODate(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const from = fromISODate(a);
  const to = fromISODate(b);
  if (!from || !to) return 0;
  // Compare local midnights via UTC to sidestep daylight-saving hours.
  const utcFrom = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const utcTo = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((utcTo - utcFrom) / 86_400_000);
}

/** The coming `weekday` (0 = Monday .. 6 = Sunday), never today itself. */
export function nextWeekday(from: string, weekday: number): string {
  const date = fromISODate(from);
  if (!date) return from;
  const current = (date.getDay() + 6) % 7; // JS Sunday=0 -> ISO Monday=0
  const delta = ((weekday - current + 7) % 7) || 7;
  return addDays(from, delta);
}

const WEEKDAY_LONG = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];

/**
 * Czech counts in three forms, and getting it wrong is the fastest way to make
 * an interface feel machine-translated: 1 den, 2–4 dny, 5+ dní.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  if (abs >= 2 && abs <= 4) return few;
  return many;
}

/** ISO weekday index, 0 = Monday. */
export function weekdayIndex(iso: string): number {
  const date = fromISODate(iso);
  if (!date) return 0;
  return (date.getDay() + 6) % 7;
}

/**
 * A short label for a date relative to today: "Dnes", "Zítra", the weekday
 * name within the coming week, "před 3 dny" just behind, otherwise the Czech
 * numeric form "12. 3." (with the year when it is a different one).
 */
export function relativeDateLabel(iso: string, base: string): string {
  const date = fromISODate(iso);
  if (!date) return iso;
  const delta = daysBetween(base, iso);

  if (delta === 0) return 'Dnes';
  if (delta === 1) return 'Zítra';
  if (delta === -1) return 'Včera';
  if (delta > 1 && delta < 7) return WEEKDAY_LONG[weekdayIndex(iso)];
  if (delta < -1 && delta > -7) {
    const n = Math.abs(delta);
    return `před ${n} ${plural(n, 'dnem', 'dny', 'dny')}`;
  }

  const sameYear = fromISODate(base)?.getFullYear() === date.getFullYear();
  const day = date.getDate();
  const month = date.getMonth() + 1;
  return sameYear ? `${day}. ${month}.` : `${day}. ${month}. ${date.getFullYear()}`;
}

/** How a deadline should be described and coloured. */
export type DeadlineTone = 'overdue' | 'today' | 'soon' | 'later';

export function deadlineTone(due: string, base: string): DeadlineTone {
  const delta = daysBetween(base, due);
  if (delta < 0) return 'overdue';
  if (delta === 0) return 'today';
  if (delta <= 3) return 'soon';
  return 'later';
}

export function deadlineLabel(due: string, base: string): string {
  const delta = daysBetween(base, due);
  if (delta < 0) {
    const n = Math.abs(delta);
    return `${n} ${plural(n, 'den', 'dny', 'dní')} po termínu`;
  }
  // Lower-cased so every variant reads the same way: "Termín: dnes",
  // "Termín: ve čtvrtek" would need a preposition, so the bare day it is.
  return `Termín: ${relativeDateLabel(due, base).toLowerCase()}`;
}

export interface DateGroup<T> {
  /** `YYYY-MM-DD`, or `''` for the "no date" bucket. */
  key: string;
  label: string;
  items: T[];
}

/**
 * Groups scheduled items into day headings for the Upcoming view.
 *
 * Items keep their incoming order inside a group, and the groups come out in
 * date order with undated items last, so the list reads as a calendar.
 */
export function groupByDate<T>(
  items: T[],
  dateOf: (item: T) => string | null,
  base: string,
): DateGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = dateOf(item) ?? '';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === b) return 0;
      // The undated bucket always sinks to the bottom.
      if (a === '') return 1;
      if (b === '') return -1;
      return a < b ? -1 : 1;
    })
    .map(([key, groupItems]) => ({
      key,
      label: key === '' ? 'Bez data' : relativeDateLabel(key, base),
      items: groupItems,
    }));
}

/** Human file size, for attachments and backups. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = value < 10 ? value.toFixed(1).replace('.', ',') : String(Math.round(value));
  return `${shown} ${units[unit]}`;
}

/** A readable local timestamp for an RFC 3339 string from the backend. */
export function formatTimestamp(rfc3339: string): string {
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return rfc3339;
  return date.toLocaleString('cs-CZ', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
