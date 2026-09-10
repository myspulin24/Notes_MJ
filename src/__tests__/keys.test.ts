/**
 * Digit shortcuts across keyboard layouts.
 *
 * The bug this covers was invisible in code review and invisible in English:
 * every number shortcut in the app read `event.key`, which on a Czech keyboard
 * is a letter, not a digit. The `key` values below are the real ones a Czech
 * layout produces.
 */

import { describe, expect, it } from 'vitest';

import { digitOf } from '../lib/keys';

/** What a browser reports for a keypress, trimmed to what `digitOf` reads. */
function press(code: string, extra: { shiftKey?: boolean; altKey?: boolean } = {}) {
  return { code, ...extra };
}

describe('digitOf', () => {
  it('čte číslo z fyzické klávesy', () => {
    expect(digitOf(press('Digit1'))).toBe(1);
    expect(digitOf(press('Digit6'))).toBe(6);
    expect(digitOf(press('Digit9'))).toBe(9);
  });

  it('funguje na české klávesnici, kde ta klávesa píše písmeno', () => {
    // On the Czech layout the "2" key types ě. The old code did
    // Number('ě') - 1, which is NaN, and the shortcut did nothing.
    const czech = { code: 'Digit2', key: 'ě' };
    expect(digitOf(czech)).toBe(2);

    // The whole top row, as Czech types it: + ě š č ř ž ý á í
    const row = ['+', 'ě', 'š', 'č', 'ř', 'ž', 'ý', 'á', 'í'];
    row.forEach((key, index) => {
      expect(digitOf({ code: `Digit${index + 1}`, key })).toBe(index + 1);
    });
  });

  it('bere i numerickou klávesnici', () => {
    expect(digitOf(press('Numpad4'))).toBe(4);
  });

  it('ignoruje nulu, na které žádná zkratka nevisí', () => {
    expect(digitOf(press('Digit0'))).toBeNull();
    expect(digitOf(press('Numpad0'))).toBeNull();
  });

  it('ignoruje písmena a ostatní klávesy', () => {
    expect(digitOf(press('KeyN'))).toBeNull();
    expect(digitOf(press('Escape'))).toBeNull();
    expect(digitOf(press('F2'))).toBeNull();
    expect(digitOf(press('Minus'))).toBeNull();
  });

  it('nechá být Shift a Alt', () => {
    // Shift+2 is @ on a US layout; stealing it would be rude.
    expect(digitOf(press('Digit2', { shiftKey: true }))).toBeNull();
    expect(digitOf(press('Digit2', { altKey: true }))).toBeNull();
  });

  it('nespoléhá na to, že shiftKey a altKey vůbec dorazí', () => {
    expect(digitOf({ code: 'Digit3' })).toBe(3);
  });
});
