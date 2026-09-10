/**
 * The three halves of the app - which is a joke, but the split is real.
 *
 * Notes_MJ does three different jobs: it plans work, it holds notes, and it
 * keeps track of occasions and what to buy for them. Those want different
 * layouts, so rather than one sidebar trying to list all of it, each gets a
 * top-level tab and the window rearranges itself.
 *
 * Which tab is lit is *derived* from the current route, never stored. That is
 * the whole trick: pressing `Z`, clicking a gift in the calendar or restoring
 * the last-used view all move the tab without anyone remembering to.
 */

import type { Route } from '../state/store';
import type { StartView } from './planner-types';

export type Section = 'planner' | 'notes' | 'occasions';

export interface SectionMeta {
  id: Section;
  label: string;
  /** Shown as the tab's tooltip, and read out by screen readers. */
  hint: string;
  shortcut: string;
}

/**
 * Display order, left to right. The planner comes first because it is where
 * the app opens and where the daily work happens; the other two are places you
 * go on purpose.
 */
export const SECTIONS: readonly SectionMeta[] = [
  {
    id: 'planner',
    label: 'Plánovač',
    hint: 'Úkoly, projekty, kalendář a přehled',
    shortcut: 'Ctrl 1',
  },
  { id: 'notes', label: 'Poznámky', hint: 'Zápisník: všechno, co není úkol', shortcut: 'Ctrl 2' },
  {
    id: 'occasions',
    label: 'Události',
    hint: 'Vánoce, narozeniny a plánování dárků',
    shortcut: 'Ctrl 3',
  },
];

/** Which tab a route belongs to. Everything task-shaped is the planner. */
export function sectionOf(route: Route): Section {
  switch (route.kind) {
    case 'notes':
      return 'notes';
    case 'occasions':
    case 'occasion':
      return 'occasions';
    default:
      return 'planner';
  }
}

/**
 * Where a tab lands when you click it.
 *
 * The planner honours the start-view setting, so someone who always begins in
 * Dnes gets Dnes rather than the dashboard. `last_used` has no meaning here -
 * clicking the tab is the request for a fresh start - so it falls back to the
 * dashboard.
 */
export function homeRouteOf(section: Section, startView?: StartView): Route {
  if (section === 'notes') return { kind: 'notes' };
  if (section === 'occasions') return { kind: 'occasions' };

  switch (startView) {
    case 'inbox':
    case 'today':
    case 'upcoming':
      return { kind: 'view', view: startView };
    case 'calendar':
      return { kind: 'calendar' };
    // 'notes' and 'occasions' as a start view belong to another tab entirely,
    // and 'last_used' is not a place. Both mean "the planner's front page".
    default:
      return { kind: 'dashboard' };
  }
}

/**
 * Which way the new pane should slide in: 1 for rightwards, -1 for leftwards.
 *
 * Movement that matches the tabs' own left-to-right order is what makes the
 * transition read as "going somewhere" rather than as decoration.
 */
export function slideDirection(from: Section, to: Section): -1 | 0 | 1 {
  const a = indexOf(from);
  const b = indexOf(to);
  if (a === b) return 0;
  return b > a ? 1 : -1;
}

/** Steps `count` tabs along, wrapping at both ends. */
export function stepSection(current: Section, delta: number): Section {
  const size = SECTIONS.length;
  const next = (((indexOf(current) + delta) % size) + size) % size;
  return SECTIONS[next].id;
}

export function indexOf(section: Section): number {
  const found = SECTIONS.findIndex((s) => s.id === section);
  // An unknown section would otherwise land at -1 and slide the wrong way.
  return found === -1 ? 0 : found;
}
