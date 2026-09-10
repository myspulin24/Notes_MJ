import { describe, expect, it } from 'vitest';

import { parseCapture, resolveCzechDate } from '../components/QuickCapture';

const MONDAY = '2026-09-07';

describe('parseCapture', () => {
  it('treats a plain line as the title', () => {
    expect(parseCapture('Renew the car insurance', MONDAY)).toEqual({
      title: 'Renew the car insurance',
      tags: [],
      priority: 0,
      startOn: null,
    });
  });

  it('pulls out tags and lowercases them', () => {
    const draft = parseCapture('Zavolat instalatérovi #domov #Pochůzky', MONDAY);
    expect(draft.title).toBe('Zavolat instalatérovi');
    expect(draft.tags).toEqual(['domov', 'pochůzky']);
  });

  it('de-duplicates tags', () => {
    expect(parseCapture('Úkol #domov #domov', MONDAY).tags).toEqual(['domov']);
  });

  it('reads a priority', () => {
    expect(parseCapture('Ship the release !3', MONDAY)).toMatchObject({
      title: 'Ship the release',
      priority: 3,
    });
    expect(parseCapture('Tidy up !1', MONDAY).priority).toBe(1);
  });

  it('ignores a priority that is out of range, keeping it as text', () => {
    const draft = parseCapture('Fix bug !9', MONDAY);
    expect(draft.priority).toBe(0);
    expect(draft.title).toBe('Fix bug !9');
  });

  it('resolves @dnes and @zítra (and their English twins)', () => {
    expect(parseCapture('Zaplatit nájem @dnes', MONDAY).startOn).toBe(MONDAY);
    expect(parseCapture('Zaplatit nájem @zítra', MONDAY).startOn).toBe('2026-09-08');
    expect(parseCapture('Zaplatit nájem @zitra', MONDAY).startOn).toBe('2026-09-08');
    expect(parseCapture('Pay rent @today', MONDAY).startOn).toBe(MONDAY);
  });

  it('resolves a weekday to the next one, never today', () => {
    // The base day is itself a Monday.
    expect(parseCapture('Týdenní přehled @pondělí', MONDAY).startOn).toBe('2026-09-14');
    expect(parseCapture('Posilovna @čtvrtek', MONDAY).startOn).toBe('2026-09-10');
    expect(parseCapture('Posilovna @ctvrtek', MONDAY).startOn).toBe('2026-09-10');
    expect(parseCapture('Posilovna @čt', MONDAY).startOn).toBe('2026-09-10');
    expect(parseCapture('Gym @thursday', MONDAY).startOn).toBe('2026-09-10');
  });

  it('accepts a literal date', () => {
    expect(parseCapture('Renew passport @2026-12-24', MONDAY).startOn).toBe('2026-12-24');
  });

  it('keeps an unrecognised @word in the title', () => {
    // An email address or a handle must survive capture intact.
    const draft = parseCapture('Odpovědět @martina ohledně nabídky', MONDAY);
    expect(draft.startOn).toBeNull();
    expect(draft.title).toBe('Odpovědět @martina ohledně nabídky');
  });

  it('keeps an invalid date in the title rather than guessing', () => {
    const draft = parseCapture('Termín @2026-02-31', MONDAY);
    expect(draft.startOn).toBeNull();
    expect(draft.title).toBe('Termín @2026-02-31');
  });

  it('handles everything at once, in any order', () => {
    const draft = parseCapture('#práce !2 Připravit čtvrtletní report @pátek', MONDAY);
    expect(draft).toEqual({
      title: 'Připravit čtvrtletní report',
      tags: ['práce'],
      priority: 2,
      startOn: '2026-09-11',
    });
  });

  it('collapses extra whitespace', () => {
    expect(parseCapture('  spaced    out  ', MONDAY).title).toBe('spaced out');
  });

  it('returns an empty title when there is only shorthand', () => {
    // The dialog uses this to keep the Add button disabled.
    expect(parseCapture('#domov @dnes !2', MONDAY).title).toBe('');
  });

  it('does not treat a bare # or @ as shorthand', () => {
    expect(parseCapture('Email # and @ symbols', MONDAY)).toMatchObject({
      title: 'Email # and @ symbols',
      tags: [],
    });
  });
});

describe('české datum v rychlém zadávání', () => {
  const today = '2026-09-10';

  it('bere 20.9. jako letošní datum', () => {
    expect(resolveCzechDate('20.9.', today)).toBe('2026-09-20');
    expect(resolveCzechDate('20.09.', today)).toBe('2026-09-20');
  });

  it('den, který už letos byl, patří příštímu roku', () => {
    // Typed in September, 1.3. means next March, not one six months gone.
    expect(resolveCzechDate('1.3.', today)).toBe('2027-03-01');
  });

  it('dnešek se počítá jako platný, ne jako minulost', () => {
    expect(resolveCzechDate('10.9.', today)).toBe('2026-09-10');
  });

  it('bere i celý rok', () => {
    expect(resolveCzechDate('24.12.2026', today)).toBe('2026-12-24');
    expect(resolveCzechDate('1.1.2030', today)).toBe('2030-01-01');
  });

  it('snese mezery, jak se to česky píše', () => {
    expect(resolveCzechDate('20. 9.', today)).toBe('2026-09-20');
    expect(resolveCzechDate('24. 12. 2026', today)).toBe('2026-12-24');
  });

  it('odmítne den, který neexistuje', () => {
    // Rolling 31.2. forward into March would file the task on the wrong day.
    expect(resolveCzechDate('31.2.', today)).toBeNull();
    expect(resolveCzechDate('32.1.', today)).toBeNull();
    expect(resolveCzechDate('1.13.', today)).toBeNull();
  });

  it('u 29.2. přeskočí na nejbližší přestupný rok', () => {
    // 2027, 2028, 2029 - only 2028 has a 29 February.
    expect(resolveCzechDate('29.2.', '2026-09-10')).toBe('2028-02-29');
  });

  it('nechá být, co datum není', () => {
    expect(resolveCzechDate('dnes', today)).toBeNull();
    expect(resolveCzechDate('20.9', today)).toBeNull();
    expect(resolveCzechDate('2026-09-20', today)).toBeNull();
  });

  it('funguje i přes @ v celé větě', () => {
    const draft = parseCapture('Zaplatit pojištění @24.12.', today);
    expect(draft.title).toBe('Zaplatit pojištění');
    expect(draft.startOn).toBe('2026-12-24');
  });
});
