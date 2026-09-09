/**
 * Money, in minor units.
 *
 * The backend stores every price as an integer number of haléře. That is the
 * only way a list of three items at 899,99 does not add up to
 * 2699,9700000000003 — so the UI never converts to a float either, it only
 * formats for display and parses on input.
 */

/** `349900` → `"3 499,00 Kč"`. */
export function formatMinor(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const major = Math.floor(abs / 100);
  const cents = abs % 100;
  // Czech groups thousands with a non-breaking space and uses a comma.
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const body = `${grouped},${String(cents).padStart(2, '0')}`;
  return `${negative ? '−' : ''}${body} ${currency}`;
}

/** The same, but without the decimals when they are zero — for tight rows. */
export function formatMinorShort(
  minor: number | null | undefined,
  currency: string,
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  if (Math.abs(Math.round(minor)) % 100 === 0) {
    const negative = minor < 0;
    const major = Math.floor(Math.abs(Math.round(minor)) / 100);
    const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${negative ? '−' : ''}${grouped} ${currency}`;
  }
  return formatMinor(minor, currency);
}

/**
 * Parses what a person types into minor units.
 *
 * Accepts `3499`, `3 499`, `3499,50`, `3499.50` and `3 499,5`. Returns `null`
 * for an empty box (meaning "no price") and `undefined` for something that is
 * not a number at all, so the caller can tell "cleared" from "typo".
 */
export function parseMinor(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Strip spaces (including the non-breaking ones we emit) and unify the
  // decimal separator.
  const normalised = trimmed
    .replace(/[\s ]/g, '')
    .replace(/,/g, '.')
    .replace(/^\+/, '');

  if (!/^-?\d*\.?\d*$/.test(normalised) || normalised === '.' || normalised === '-') {
    return undefined;
  }

  const [whole, fraction = ''] = normalised.split('.');
  if (fraction.length > 2) return undefined;

  const sign = whole.startsWith('-') ? -1 : 1;
  const wholeDigits = whole.replace('-', '') || '0';
  const cents = (fraction + '00').slice(0, 2);

  const value = sign * (Number(wholeDigits) * 100 + Number(cents));
  return Number.isSafeInteger(value) ? value : undefined;
}

/** `0..1` share of a budget already spent, clamped for the progress bar. */
export function spentRatio(spent: number, budget: number | null): number {
  if (!budget || budget <= 0) return 0;
  return Math.max(0, Math.min(1, spent / budget));
}
