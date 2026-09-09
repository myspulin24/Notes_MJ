import { describe, expect, it } from 'vitest';

import {
  moveSelection,
  placeMenu,
  selectableIndexes,
  spliceSelection,
  tidyItems,
} from '../lib/contextmenu';
import type { MenuItem } from '../lib/contextmenu';

const action = (label: string, extra: Partial<Extract<MenuItem, { kind: 'action' }>> = {}): MenuItem => ({
  kind: 'action',
  label,
  run: () => {},
  ...extra,
});
const sep: MenuItem = { kind: 'separator' };
const header = (label: string): MenuItem => ({ kind: 'header', label });

describe('tidyItems', () => {
  it('leaves a well-formed menu alone', () => {
    const items = [action('Otevřít'), sep, action('Smazat')];
    expect(tidyItems(items)).toHaveLength(3);
  });

  it('drops a leading separator', () => {
    const out = tidyItems([sep, action('Otevřít')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'action', label: 'Otevřít' });
  });

  it('drops a trailing separator', () => {
    const out = tidyItems([action('Otevřít'), sep]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('action');
  });

  it('collapses runs of separators', () => {
    // These appear naturally when a section is conditionally empty.
    const out = tidyItems([action('A'), sep, sep, sep, action('B')]);
    expect(out.filter((i) => i.kind === 'separator')).toHaveLength(1);
  });

  it('drops a separator that would sit right under a header', () => {
    const out = tidyItems([header('Úkol'), sep, action('Smazat')]);
    expect(out.map((i) => i.kind)).toEqual(['header', 'action']);
  });

  it('handles a menu that is only separators', () => {
    expect(tidyItems([sep, sep])).toEqual([]);
  });
});

describe('placeMenu', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 200, height: 300 };

  it('puts the menu at the cursor when there is room', () => {
    expect(placeMenu(100, 100, size, viewport)).toEqual({ x: 100, y: 100 });
  });

  it('flips left when it would run off the right edge', () => {
    // Flipping rather than clamping keeps the cursor outside the menu.
    expect(placeMenu(900, 100, size, viewport).x).toBe(700);
  });

  it('flips up when it would run off the bottom', () => {
    expect(placeMenu(100, 700, size, viewport).y).toBe(400);
  });

  it('flips both ways in the bottom-right corner', () => {
    expect(placeMenu(950, 750, size, viewport)).toEqual({ x: 750, y: 450 });
  });

  it('never goes past the top-left margin', () => {
    const out = placeMenu(4, 4, size, viewport);
    expect(out.x).toBeGreaterThanOrEqual(8);
    expect(out.y).toBeGreaterThanOrEqual(8);
  });

  it('still produces something usable when the menu is taller than the window', () => {
    const out = placeMenu(100, 100, { width: 200, height: 900 }, viewport);
    expect(out.y).toBe(8);
  });
});

describe('selectableIndexes and moveSelection', () => {
  const items = [header('Úkol'), action('Otevřít'), sep, action('Smazat', { disabled: true }), action('Kopírovat')];

  it('skips headers, separators and disabled items', () => {
    expect(selectableIndexes(items)).toEqual([1, 4]);
  });

  it('starts at the first item going down', () => {
    expect(moveSelection(items, null, 1)).toBe(1);
  });

  it('starts at the last item going up', () => {
    expect(moveSelection(items, null, -1)).toBe(4);
  });

  it('wraps at both ends', () => {
    expect(moveSelection(items, 4, 1)).toBe(1);
    expect(moveSelection(items, 1, -1)).toBe(4);
  });

  it('recovers when the current index is no longer selectable', () => {
    expect(moveSelection(items, 3, 1)).toBe(1);
  });

  it('returns null for a menu with nothing to select', () => {
    expect(moveSelection([header('Nic'), sep], null, 1)).toBeNull();
  });
});

describe('spliceSelection', () => {
  it('inserts at the caret when nothing is selected', () => {
    expect(spliceSelection('abcd', 2, 2, 'XY')).toEqual({ value: 'abXYcd', caret: 4 });
  });

  it('replaces a selection', () => {
    expect(spliceSelection('abcd', 1, 3, 'X')).toEqual({ value: 'aXd', caret: 2 });
  });

  it('appends at the end', () => {
    expect(spliceSelection('ab', 2, 2, 'cd')).toEqual({ value: 'abcd', caret: 4 });
  });

  it('handles an empty field', () => {
    expect(spliceSelection('', 0, 0, 'text')).toEqual({ value: 'text', caret: 4 });
  });

  it('clamps positions that are out of range', () => {
    // A stale selection range must not produce a corrupted value.
    expect(spliceSelection('ab', 99, 99, 'X')).toEqual({ value: 'abX', caret: 3 });
    expect(spliceSelection('ab', -5, 1, 'X')).toEqual({ value: 'Xb', caret: 1 });
  });

  it('handles a reversed range as an insert at its start', () => {
    expect(spliceSelection('abcd', 3, 1, 'X')).toEqual({ value: 'abcXd', caret: 4 });
  });
});
