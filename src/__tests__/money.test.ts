import { describe, expect, it } from 'vitest';

import { formatMinor, formatMinorShort, parseMinor, spentRatio } from '../lib/money';

const CZK = 'Kč';
// The formatter uses a non-breaking space to group thousands AND before the
// currency, so that '3 499 Kč' never wraps mid-amount.
const NBSP = ' ';

describe('formatMinor', () => {
  it('formats whole crowns with two decimals, Czech style', () => {
    expect(formatMinor(0, CZK)).toBe(`0,00${NBSP}Kč`);
    expect(formatMinor(100, CZK)).toBe(`1,00${NBSP}Kč`);
    expect(formatMinor(34999, CZK)).toBe(`349,99${NBSP}Kč`);
  });

  it('groups thousands', () => {
    expect(formatMinor(349900, CZK)).toBe(`3${NBSP}499,00${NBSP}Kč`);
    expect(formatMinor(123456789, CZK)).toBe(`1${NBSP}234${NBSP}567,89${NBSP}Kč`);
  });

  it('shows a dash rather than a number for "no price"', () => {
    expect(formatMinor(null, CZK)).toBe('—');
    expect(formatMinor(undefined, CZK)).toBe('—');
    expect(formatMinor(Number.NaN, CZK)).toBe('—');
  });

  it('handles a negative amount, for a budget already overspent', () => {
    expect(formatMinor(-50000, CZK)).toBe(`−500,00${NBSP}Kč`);
  });

  it('uses whatever currency it is given', () => {
    expect(formatMinor(1000, 'EUR')).toBe(`10,00${NBSP}EUR`);
  });
});

describe('formatMinorShort', () => {
  it('drops the decimals when they are zero', () => {
    expect(formatMinorShort(349900, CZK)).toBe(`3${NBSP}499${NBSP}Kč`);
    expect(formatMinorShort(0, CZK)).toBe(`0${NBSP}Kč`);
  });

  it('keeps them when they are not', () => {
    expect(formatMinorShort(34999, CZK)).toBe(`349,99${NBSP}Kč`);
  });
});

describe('parseMinor', () => {
  it('reads a plain number as whole crowns', () => {
    expect(parseMinor('3499')).toBe(349900);
    expect(parseMinor('0')).toBe(0);
  });

  it('accepts both decimal separators', () => {
    expect(parseMinor('349,99')).toBe(34999);
    expect(parseMinor('349.99')).toBe(34999);
  });

  it('pads a single decimal digit', () => {
    expect(parseMinor('10,5')).toBe(1050);
  });

  it('ignores grouping spaces, including the ones we print', () => {
    expect(parseMinor('3 499')).toBe(349900);
    expect(parseMinor(`3${NBSP}499,00`)).toBe(349900);
  });

  it('treats an empty box as "no price", not as zero', () => {
    // These mean different things: one clears the field, the other is free.
    expect(parseMinor('')).toBeNull();
    expect(parseMinor('   ')).toBeNull();
    expect(parseMinor('0')).toBe(0);
  });

  it('returns undefined for something that is not a number', () => {
    expect(parseMinor('drahé')).toBeUndefined();
    expect(parseMinor('12abc')).toBeUndefined();
    expect(parseMinor('.')).toBeUndefined();
    expect(parseMinor('-')).toBeUndefined();
  });

  it('refuses more precision than money has', () => {
    expect(parseMinor('10,999')).toBeUndefined();
  });

  it('round-trips through the formatter', () => {
    for (const value of [0, 1, 100, 34999, 349900, 123456789]) {
      const text = formatMinor(value, CZK).replace(`${NBSP}${CZK}`, '');
      expect(parseMinor(text)).toBe(value);
    }
  });
});

describe('spentRatio', () => {
  it('is the share of the budget used', () => {
    expect(spentRatio(50000, 100000)).toBe(0.5);
    expect(spentRatio(0, 100000)).toBe(0);
  });

  it('clamps once the budget is blown', () => {
    expect(spentRatio(200000, 100000)).toBe(1);
  });

  it('is zero when there is no budget to compare against', () => {
    expect(spentRatio(50000, null)).toBe(0);
    expect(spentRatio(50000, 0)).toBe(0);
  });
});
