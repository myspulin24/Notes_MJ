import { describe, expect, it } from 'vitest';

import {
  addDays,
  plural,
  daysBetween,
  deadlineLabel,
  deadlineTone,
  formatBytes,
  fromISODate,
  groupByDate,
  isValidISODate,
  nextWeekday,
  relativeDateLabel,
  toISODate,
  weekdayIndex,
} from '../lib/dates';

const MONDAY = '2026-09-07';

describe('ISO date handling', () => {
  it('formats a Date as its local calendar day', () => {
    // Deliberately late in the evening: `toISOString()` would report the 8th
    // for anyone east of UTC and the 6th for anyone far enough west.
    expect(toISODate(new Date(2026, 8, 7, 23, 30))).toBe('2026-09-07');
    expect(toISODate(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });

  it('round-trips through fromISODate', () => {
    const date = fromISODate('2026-09-07');
    expect(date).not.toBeNull();
    expect(toISODate(date!)).toBe('2026-09-07');
  });

  it('rejects dates that do not exist', () => {
    expect(isValidISODate('2026-02-31')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-00-10')).toBe(false);
    expect(isValidISODate('not a date')).toBe(false);
    expect(isValidISODate('7/9/2026')).toBe(false);
  });

  it('accepts a real leap day', () => {
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(isValidISODate('2026-02-29')).toBe(false);
  });
});

describe('addDays and daysBetween', () => {
  it('moves forwards and backwards', () => {
    expect(addDays(MONDAY, 1)).toBe('2026-09-08');
    expect(addDays(MONDAY, -1)).toBe('2026-09-06');
    expect(addDays(MONDAY, 0)).toBe(MONDAY);
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('counts whole days in both directions', () => {
    expect(daysBetween(MONDAY, '2026-09-14')).toBe(7);
    expect(daysBetween('2026-09-14', MONDAY)).toBe(-7);
    expect(daysBetween(MONDAY, MONDAY)).toBe(0);
  });

  it('counts whole days across a daylight-saving change', () => {
    // Most of Europe puts the clocks back on 2026-10-25. A naive
    // milliseconds-divided-by-86,400,000 would give 30.96 days here.
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });
});

describe('weekdays', () => {
  it('numbers Monday as 0', () => {
    expect(weekdayIndex('2026-09-07')).toBe(0);
    expect(weekdayIndex('2026-09-13')).toBe(6);
  });

  it('finds the next weekday, never today', () => {
    expect(nextWeekday(MONDAY, 3)).toBe('2026-09-10'); // Thursday this week
    expect(nextWeekday(MONDAY, 0)).toBe('2026-09-14'); // next Monday, not today
    expect(nextWeekday('2026-09-12', 0)).toBe('2026-09-14'); // Saturday -> Monday
  });
});

describe('relativeDateLabel', () => {
  it('names the days around today', () => {
    expect(relativeDateLabel(MONDAY, MONDAY)).toBe('Dnes');
    expect(relativeDateLabel('2026-09-08', MONDAY)).toBe('Zítra');
    expect(relativeDateLabel('2026-09-06', MONDAY)).toBe('Včera');
  });

  it('uses weekday names inside the coming week', () => {
    expect(relativeDateLabel('2026-09-10', MONDAY)).toBe('Čtvrtek');
    expect(relativeDateLabel('2026-09-13', MONDAY)).toBe('Neděle');
  });

  it('switches to a date once the week is out', () => {
    expect(relativeDateLabel('2026-09-14', MONDAY)).toBe('14. 9.');
    expect(relativeDateLabel('2026-12-24', MONDAY)).toBe('24. 12.');
  });

  it('adds the year when it is a different one', () => {
    expect(relativeDateLabel('2027-01-05', MONDAY)).toBe('5. 1. 2027');
  });

  it('says how long ago, just behind today', () => {
    expect(relativeDateLabel('2026-09-04', MONDAY)).toBe('před 3 dny');
  });
});

describe('plural', () => {
  it('picks the three Czech forms', () => {
    expect(plural(1, 'den', 'dny', 'dní')).toBe('den');
    expect(plural(2, 'den', 'dny', 'dní')).toBe('dny');
    expect(plural(4, 'den', 'dny', 'dní')).toBe('dny');
    expect(plural(5, 'den', 'dny', 'dní')).toBe('dní');
    expect(plural(11, 'den', 'dny', 'dní')).toBe('dní');
    expect(plural(21, 'den', 'dny', 'dní')).toBe('dní');
  });

  it('uses the many form for zero', () => {
    expect(plural(0, 'úkol', 'úkoly', 'úkolů')).toBe('úkolů');
  });

  it('ignores the sign, so "6 dní po termínu" works', () => {
    expect(plural(-6, 'den', 'dny', 'dní')).toBe('dní');
    expect(plural(-1, 'den', 'dny', 'dní')).toBe('den');
  });
});

describe('deadlines', () => {
  it('classifies by urgency', () => {
    expect(deadlineTone('2026-09-01', MONDAY)).toBe('overdue');
    expect(deadlineTone(MONDAY, MONDAY)).toBe('today');
    expect(deadlineTone('2026-09-09', MONDAY)).toBe('soon');
    expect(deadlineTone('2026-10-09', MONDAY)).toBe('later');
  });

  it('labels them the way a person would say it', () => {
    expect(deadlineLabel(MONDAY, MONDAY)).toBe('Termín: dnes');
    expect(deadlineLabel('2026-09-08', MONDAY)).toBe('Termín: zítra');
    expect(deadlineLabel('2026-09-10', MONDAY)).toBe('Termín: čtvrtek');
    expect(deadlineLabel('2026-09-14', MONDAY)).toBe('Termín: 14. 9.');
    // Czech needs three plural forms, and the label gets each of them right.
    expect(deadlineLabel('2026-09-06', MONDAY)).toBe('1 den po termínu');
    expect(deadlineLabel('2026-09-04', MONDAY)).toBe('3 dny po termínu');
    expect(deadlineLabel('2026-09-01', MONDAY)).toBe('6 dní po termínu');
  });
});

describe('groupByDate', () => {
  interface Row {
    id: string;
    on: string | null;
  }
  const dateOf = (r: Row) => r.on;

  it('returns nothing for an empty list', () => {
    expect(groupByDate([], dateOf, MONDAY)).toEqual([]);
  });

  it('groups by day, in date order', () => {
    const rows: Row[] = [
      { id: 'c', on: '2026-09-14' },
      { id: 'a', on: '2026-09-08' },
      { id: 'b', on: '2026-09-08' },
    ];
    const groups = groupByDate(rows, dateOf, MONDAY);
    expect(groups.map((g) => g.key)).toEqual(['2026-09-08', '2026-09-14']);
    expect(groups[0].items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(groups[0].label).toBe('Zítra');
    expect(groups[1].label).toBe('14. 9.');
  });

  it('keeps the incoming order inside a group', () => {
    const rows: Row[] = [
      { id: 'second', on: '2026-09-08' },
      { id: 'first', on: '2026-09-08' },
    ];
    expect(groupByDate(rows, dateOf, MONDAY)[0].items.map((r) => r.id)).toEqual([
      'second',
      'first',
    ]);
  });

  it('sinks undated items to the bottom', () => {
    const rows: Row[] = [
      { id: 'none', on: null },
      { id: 'dated', on: '2026-09-08' },
    ];
    const groups = groupByDate(rows, dateOf, MONDAY);
    expect(groups.map((g) => g.key)).toEqual(['2026-09-08', '']);
    expect(groups[1].label).toBe('Bez data');
  });

  it('handles a list that is entirely undated', () => {
    const groups = groupByDate([{ id: 'x', on: null }], dateOf, MONDAY);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Bez data');
  });
});

describe('formatBytes', () => {
  it('scales through the units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    // Czech writes the decimal separator as a comma.
    expect(formatBytes(1024)).toBe('1,0 KB');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(20 * 1024)).toBe('20 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3,0 GB');
  });

  it('does not fall over on nonsense', () => {
    expect(formatBytes(-1)).toBe('-');
    expect(formatBytes(Number.NaN)).toBe('-');
  });
});
