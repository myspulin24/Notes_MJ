import { describe, expect, it } from 'vitest';

import { parseCapture } from '../components/QuickCapture';

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
