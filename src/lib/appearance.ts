/**
 * Turns the appearance settings into CSS custom properties on `<html>`.
 *
 * Doing it here rather than in a component means one place decides what a
 * setting looks like, and the stylesheet stays a stylesheet: it reads the
 * variables and knows nothing about where they came from.
 */

import type { Settings } from './planner-types';

const DENSITY_SCALE: Record<Settings['density'], string> = {
  comfortable: '1',
  cosy: '0.86',
  compact: '0.72',
};

/** Applies the theme, accent, density and font scale. Safe to call on a no-op. */
export function applyAppearance(settings: Settings | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const theme = settings?.theme ?? 'system';
  root.dataset.theme = theme;
  // Let the browser pick the right form controls and scrollbars too.
  root.style.colorScheme = theme === 'system' ? 'light dark' : theme;

  const accent = isHex(settings?.accent) ? settings!.accent : '#4f7cff';
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-soft', `${accent}26`);
  root.style.setProperty('--accent-strong', `${accent}80`);

  root.style.setProperty('--density', DENSITY_SCALE[settings?.density ?? 'comfortable']);

  const scale = clamp(settings?.font_scale ?? 1, 0.85, 1.4);
  root.style.setProperty('--font-size', `${Math.round(14 * scale)}px`);

  root.dataset.motion = settings?.reduce_motion ? 'reduced' : 'full';
}

function isHex(value: string | undefined): boolean {
  return (
    typeof value === 'string' &&
    value.length === 7 &&
    value.startsWith('#') &&
    /^[0-9a-f]{6}$/i.test(value.slice(1))
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
