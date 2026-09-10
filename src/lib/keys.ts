/**
 * Reading keyboard shortcuts in a way that survives the keyboard layout.
 *
 * `event.key` is the character produced, which depends on the layout. On the
 * Czech layout the top row types ě š č ř ž ý á í é without Shift, so the "2"
 * key reports `key === 'ě'` and every shortcut written as `Number(event.key)`
 * quietly stops working - on the machine this app was written for, no less.
 *
 * `event.code` names the physical key instead: the same key is `Digit2` on
 * every layout in the world. Letters are a different matter and are still read
 * from `key`, because there the character is genuinely what people mean.
 */

/** Only the parts of a keyboard event this module looks at. */
export interface KeyLike {
  code: string;
  /** Deliberately unused - it is the layout-dependent value this avoids. */
  key?: string;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * The number key pressed, 1-9, or null.
 *
 * Shift and Alt disqualify it. On a US layout Shift+2 is `@` and hijacking it
 * would be rude; on the Czech layout Shift+2 really is how you type a digit,
 * but there the unshifted key already works through `code`, so nothing is lost
 * either way.
 */
export function digitOf(event: KeyLike): number | null {
  if (event.shiftKey || event.altKey) return null;
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  return match ? Number(match[1]) : null;
}
