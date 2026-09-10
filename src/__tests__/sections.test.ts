/**
 * The tab logic.
 *
 * The active tab is derived from the route rather than stored, so the thing
 * worth pinning down is that *every* route maps somewhere sensible - including
 * the ones nobody thinks about, like a single occasion opened from the
 * calendar, or a search.
 */

import { describe, expect, it } from 'vitest';

import {
  SECTIONS,
  homeRouteOf,
  indexOf,
  sectionOf,
  slideDirection,
  stepSection,
} from '../lib/sections';
import type { Route } from '../state/store';

describe('sectionOf', () => {
  const planner: Route[] = [
    { kind: 'dashboard' },
    { kind: 'calendar' },
    { kind: 'view', view: 'today' },
    { kind: 'view', view: 'completed' },
    { kind: 'project', id: 'p1' },
    { kind: 'area', id: 'a1' },
    { kind: 'search', query: 'cokoliv' },
  ];

  for (const route of planner) {
    it(`řadí ${route.kind} do plánovače`, () => {
      expect(sectionOf(route)).toBe('planner');
    });
  }

  it('řadí zápisník do poznámek', () => {
    expect(sectionOf({ kind: 'notes' })).toBe('notes');
  });

  it('řadí seznam i jednu událost do Událostí', () => {
    expect(sectionOf({ kind: 'occasions' })).toBe('occasions');
    // Opened from the calendar, this must still light the Události tab.
    expect(sectionOf({ kind: 'occasion', id: 'o1' })).toBe('occasions');
  });
});

describe('homeRouteOf', () => {
  it('respektuje nastavený úvodní pohled', () => {
    expect(homeRouteOf('planner', 'today')).toEqual({ kind: 'view', view: 'today' });
    expect(homeRouteOf('planner', 'inbox')).toEqual({ kind: 'view', view: 'inbox' });
    expect(homeRouteOf('planner', 'calendar')).toEqual({ kind: 'calendar' });
  });

  it('u „naposledy otevřené“ jde na přehled', () => {
    // Clicking a tab is a request to start somewhere, not to resume.
    expect(homeRouteOf('planner', 'last_used')).toEqual({ kind: 'dashboard' });
  });

  it('nepošle plánovač do cizí sekce', () => {
    // These are valid start views but they live under other tabs; the planner
    // tab must not navigate away from itself.
    expect(homeRouteOf('planner', 'notes')).toEqual({ kind: 'dashboard' });
    expect(homeRouteOf('planner', 'occasions')).toEqual({ kind: 'dashboard' });
  });

  it('bez nastavení jde na přehled', () => {
    expect(homeRouteOf('planner')).toEqual({ kind: 'dashboard' });
  });

  it('ostatní karty mají jediný domov', () => {
    expect(homeRouteOf('notes', 'today')).toEqual({ kind: 'notes' });
    expect(homeRouteOf('occasions', 'today')).toEqual({ kind: 'occasions' });
  });

  it('každá karta má domov, který na ni zase ukazuje', () => {
    for (const section of SECTIONS) {
      expect(sectionOf(homeRouteOf(section.id))).toBe(section.id);
    }
  });
});

describe('slideDirection', () => {
  it('jde doprava k pozdější kartě', () => {
    expect(slideDirection('planner', 'notes')).toBe(1);
    expect(slideDirection('planner', 'occasions')).toBe(1);
    expect(slideDirection('notes', 'occasions')).toBe(1);
  });

  it('jde doleva k dřívější kartě', () => {
    expect(slideDirection('occasions', 'planner')).toBe(-1);
    expect(slideDirection('notes', 'planner')).toBe(-1);
  });

  it('nikam, když se karta nemění', () => {
    // No animation for a route change inside the same tab.
    expect(slideDirection('notes', 'notes')).toBe(0);
  });
});

describe('stepSection', () => {
  it('posouvá o kartu dál', () => {
    expect(stepSection('planner', 1)).toBe('notes');
    expect(stepSection('notes', 1)).toBe('occasions');
  });

  it('zabalí se na obou koncích', () => {
    expect(stepSection('occasions', 1)).toBe('planner');
    expect(stepSection('planner', -1)).toBe('occasions');
  });

  it('zvládne krok delší než počet karet', () => {
    expect(stepSection('planner', 4)).toBe('notes');
    expect(stepSection('planner', -4)).toBe('occasions');
  });

  it('krok o nula nic nedělá', () => {
    expect(stepSection('notes', 0)).toBe('notes');
  });
});

describe('SECTIONS', () => {
  it('má tři karty v pořadí, na které se spoléhá směr animace', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['planner', 'notes', 'occasions']);
    expect(indexOf('planner')).toBe(0);
    expect(indexOf('occasions')).toBe(2);
  });

  it('každá karta má český popisek i nápovědu', () => {
    for (const section of SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.hint.length).toBeGreaterThan(0);
      expect(section.label).not.toMatch(/\b(Planner|Notes|Events|Occasions)\b/);
    }
  });
});
