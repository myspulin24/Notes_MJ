import { describe, expect, it } from 'vitest';

import {
  isWeekend,
  isoWeek,
  monthGrid,
  monthKey,
  monthName,
  monthOf,
  shiftMonth,
  weekdayHeadings,
  yearOf,
} from '../lib/calendar';

describe('monthGrid', () => {
  it('always emits whole weeks', () => {
    for (let month = 1; month <= 12; month += 1) {
      const grid = monthGrid(2026, month);
      expect(grid.days.length % 7).toBe(0);
    }
  });

  it('starts on the weekday the week starts on', () => {
    // September 2026 begins on a Tuesday, so a Monday-start grid leads with
    // Monday 31 August.
    const grid = monthGrid(2026, 9, 0);
    expect(grid.from).toBe('2026-08-31');
    expect(grid.days[0]).toBe('2026-08-31');
  });

  it('respects a Sunday-start week', () => {
    const grid = monthGrid(2026, 9, 6);
    expect(grid.from).toBe('2026-08-30');
  });

  it('contains every day of the month', () => {
    const grid = monthGrid(2026, 2);
    for (let day = 1; day <= 28; day += 1) {
      expect(grid.days).toContain(`2026-02-${String(day).padStart(2, '0')}`);
    }
    expect(grid.days).not.toContain('2026-02-29');
  });

  it('includes the leap day when there is one', () => {
    expect(monthGrid(2028, 2).days).toContain('2028-02-29');
  });

  it('never shows fewer than five rows', () => {
    for (let month = 1; month <= 12; month += 1) {
      expect(monthGrid(2026, month).days.length).toBeGreaterThanOrEqual(35);
    }
  });

  it('trims a trailing row that is entirely in the next month', () => {
    // A 42-cell grid for a short month would end with a whole spare week.
    const grid = monthGrid(2026, 2, 0);
    const lastRowStart = grid.days[grid.days.length - 7];
    expect(monthOf(lastRowStart)).toBe(2);
  });

  it('reports one week number per row', () => {
    const grid = monthGrid(2026, 9);
    expect(grid.weekNumbers.length).toBe(grid.days.length / 7);
  });

  it('spans a year boundary cleanly', () => {
    const grid = monthGrid(2026, 12, 0);
    expect(grid.days).toContain('2026-12-31');
    expect(yearOf(grid.days[grid.days.length - 1])).toBe(2027);
  });
});

describe('shiftMonth', () => {
  it('moves forwards and backwards', () => {
    expect(shiftMonth(2026, 9, 1)).toEqual({ year: 2026, month: 10 });
    expect(shiftMonth(2026, 9, -1)).toEqual({ year: 2026, month: 8 });
  });

  it('wraps the year', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('handles a jump of several years', () => {
    expect(shiftMonth(2026, 6, 24)).toEqual({ year: 2028, month: 6 });
    expect(shiftMonth(2026, 6, -30)).toEqual({ year: 2023, month: 12 });
  });
});

describe('isoWeek', () => {
  it('numbers ordinary weeks', () => {
    expect(isoWeek('2026-01-05')).toBe(2);
    expect(isoWeek('2026-09-07')).toBe(37);
  });

  it('puts early January in the previous year last week when ISO says so', () => {
    // 1 January 2027 is a Friday, so it belongs to week 53 of 2026.
    expect(isoWeek('2027-01-01')).toBe(53);
  });

  it('starts a new week 1 at the right point', () => {
    // 4 January is always in week 1, by definition.
    expect(isoWeek('2026-01-04')).toBe(1);
    expect(isoWeek('2028-01-04')).toBe(1);
  });
});

describe('weekdayHeadings', () => {
  it('starts on Monday by default', () => {
    expect(weekdayHeadings(0)).toEqual(['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']);
  });

  it('rotates to any start day', () => {
    expect(weekdayHeadings(6)).toEqual(['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So']);
    expect(weekdayHeadings(5)).toEqual(['So', 'Ne', 'Po', 'Út', 'St', 'Čt', 'Pá']);
  });
});

describe('small helpers', () => {
  it('reads the year and month out of an ISO date', () => {
    expect(yearOf('2026-09-07')).toBe(2026);
    expect(monthOf('2026-09-07')).toBe(9);
  });

  it('knows the weekend', () => {
    expect(isWeekend('2026-09-12')).toBe(true); // Saturday
    expect(isWeekend('2026-09-13')).toBe(true); // Sunday
    expect(isWeekend('2026-09-07')).toBe(false); // Monday
  });

  it('makes a stable month key', () => {
    expect(monthKey(2026, 9)).toBe('2026-09');
    expect(monthKey(2026, 12)).toBe('2026-12');
  });

  it('names months in Czech', () => {
    expect(monthName(1)).toBe('Leden');
    expect(monthName(9)).toBe('Září');
    expect(monthName(12)).toBe('Prosinec');
  });
});
