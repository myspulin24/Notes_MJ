/**
 * The animated swap between tabs.
 *
 * Changing `section` changes the wrapper's key, so React tears the old tab
 * down and builds the new one - which is also what makes each tab reload its
 * data when you come back to it. The new pane then animates in from whichever
 * side it sits on in the tab bar.
 *
 * Only the arriving pane is animated. Crossfading would mean keeping the old
 * component tree mounted and fetching alongside the new one, and a stale
 * dashboard fading out over a fresh one is not worth two live data loads.
 */

import type { ReactNode } from 'react';

export function SectionSwitch({
  section,
  direction,
  children,
}: {
  section: string;
  /** 1 arrives from the right, -1 from the left, 0 does not animate. */
  direction: -1 | 0 | 1;
  children: ReactNode;
}) {
  return (
    <div key={section} className="section-swap" data-dir={direction}>
      {children}
    </div>
  );
}

/**
 * The same idea one level down: a much quieter fade when the route changes
 * inside a tab, so switching Dnes -> Kalendář does not simply blink.
 */
export function PaneSwitch({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  return (
    <div key={routeKey} className="pane-swap">
      {children}
    </div>
  );
}
