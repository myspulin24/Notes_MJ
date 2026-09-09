/**
 * The calendar grid, as pure arithmetic.
 *
 * The backend answers "what is on these days"; this file decides *which* days
 * a month view has to ask about. Keeping it separate from the component makes
 * the fiddly part - week alignment, the leading and trailing days from the
 * neighbouring months - testable without a DOM.
 */

import { addDays, fromISODate, toISODate, weekdayIndex } from './dates';

export interface MonthGrid {
  /** First cell, which may belong to the previous month. */
  from: string;
  /** Last cell, which may belong to the next month. */
  to: string;
  /** Every day in the grid, always a whole number of weeks. */
  days: string[];
  /** ISO week numbers, one per row. */
  weekNumbers: number[];
  year: number;
  /** 1-12. */
  month: number;
}

/**
 * Builds the grid for `year`/`month`, starting weeks on `firstWeekday`
 * (0 = Monday .. 6 = Sunday).
 *
 * Always emits whole weeks, and always at least six rows, so the grid does not
 * change height as you page through the year - a jumping layout is the fastest
 * way to lose your place.
 */
export function monthGrid(year: number, month: number, firstWeekday = 0): MonthGrid {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const firstDate = fromISODate(first);
  if (!firstDate) {
    // A malformed month is a programming error, not user input; fall back to
    // something drawable rather than throwing inside a render.
    return { from: first, to: first, days: [first], weekNumbers: [], year, month };
  }

  const lead = (weekdayIndex(first) - firstWeekday + 7) % 7;
  const from = addDays(first, -lead);

  const days: string[] = [];
  for (let i = 0; i < 42; i += 1) days.push(addDays(from, i));

  // Trim the last row when it is entirely in the next month, but never go
  // below five rows.
  while (days.length > 35) {
    const rowStart = days[days.length - 7];
    if (monthOf(rowStart) === month) break;
    days.splice(days.length - 7, 7);
  }

  const weekNumbers: number[] = [];
  for (let i = 0; i < days.length; i += 7) weekNumbers.push(isoWeek(days[i]));

  return { from: days[0], to: days[days.length - 1], days, weekNumbers, year, month };
}

export function monthOf(iso: string): number {
  return Number(iso.slice(5, 7));
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** Moves `delta` months from `year`/`month`, wrapping the year. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * The ISO-8601 week number.
 *
 * ISO weeks belong to the year containing their Thursday, which is why the
 * first days of January can be week 52 or 53 of the previous year.
 */
export function isoWeek(iso: string): number {
  const date = fromISODate(iso);
  if (!date) return 0;
  // Shift to the Thursday of this week, then count weeks from 4 January.
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  thursday.setDate(thursday.getDate() - ((thursday.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  const diff = thursday.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 86_400_000));
}

/** Weekday headings, rotated to start on `firstWeekday`. */
export function weekdayHeadings(firstWeekday = 0): string[] {
  const names = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
  return [...names.slice(firstWeekday), ...names.slice(0, firstWeekday)];
}

/** Saturday or Sunday, whatever the week starts on. */
export function isWeekend(iso: string): boolean {
  const index = weekdayIndex(iso);
  return index === 5 || index === 6;
}

/** `2026-09` style key, handy for memoising a month's data. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function todayMonth(today: string): { year: number; month: number } {
  return { year: yearOf(today), month: monthOf(today) };
}

/** The Czech month name in the "in September" form used for a heading. */
export function monthName(month: number): string {
  const names = [
    'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
    'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec',
  ];
  return names[Math.max(0, Math.min(11, month - 1))];
}

export { toISODate };
