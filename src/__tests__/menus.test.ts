/**
 * The right-click menus.
 *
 * Two things are worth pinning down: every record in the app can be deleted
 * from its menu, and every label is Czech. Both are easy to lose the next time
 * a menu gains an entry, and neither shows up in a type error.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  areaMenu,
  calendarOccasionMenu,
  filterMenu,
  giftMenu,
  noteMenu,
  occasionMenu,
  projectMenu,
  taskMenu,
} from '../lib/menus';
import type { MenuContext } from '../lib/menus';
import type { MenuItem } from '../lib/contextmenu';

/** A context that answers everything and confirms nothing. */
function context(overrides: Partial<MenuContext> = {}): MenuContext {
  return {
    today: '2026-09-08',
    confirmDelete: false,
    setStatus: vi.fn(async () => {}),
    patchTask: vi.fn(async () => ({})),
    removeTask: vi.fn(async () => {}),
    openInspector: vi.fn(),
    startFocus: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    runSearch: vi.fn(async () => {}),
    toast: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

const task = {
  id: 'task-1',
  title: 'Zaplatit pojištění',
  notes: '',
  status: 'open',
  list: 'anytime',
  start_on: '2026-09-08',
  due_on: null,
  priority: 0,
  project_id: null,
  project_name: null,
  area_id: null,
  area_name: null,
  tags: [],
  subtasks: [],
  attachments: [],
  recurrence: null,
  completed_at: null,
  created_at: '2026-09-01T08:00:00Z',
  updated_at: '2026-09-01T08:00:00Z',
} as never;

const project = { id: 'p1', name: 'Rekonstrukce', notes: '', area_id: null } as never;
const area = { id: 'a1', name: 'Domácnost' } as never;
const filter = { id: 'f1', name: 'Po termínu', query: 'stav:otevřené' } as never;
const note = { id: 'n1', title: 'Nákup', body: 'mléko', pinned: false, tags: [] } as never;
const occasion = {
  id: 'o1',
  name: 'Vánoce',
  kind: 'christmas',
  on_date: '2026-12-24',
  yearly: true,
  next_date: '2026-12-24',
  days_until: 107,
  gift_count: 3,
  bought_count: 1,
  budget_minor: null,
  spent_minor: 0,
  planned_minor: 0,
  remaining_minor: null,
  gifts: [],
} as never;
const gift = {
  id: 'g1',
  occasion_id: 'o1',
  title: 'Ponožky',
  recipient: 'Petra',
  status: 'idea',
  price_minor: null,
  url: '',
  notes: '',
} as never;

/** The action items only, in order. */
function actions(items: MenuItem[]) {
  return items.filter((item): item is Extract<MenuItem, { kind: 'action' }> =>
    item.kind === 'action',
  );
}

function lastAction(items: MenuItem[]) {
  const list = actions(items);
  return list[list.length - 1];
}

const noop = async () => {};
const sidebarActions = {
  renameProject: noop,
  completeProject: noop,
  deleteProject: noop,
  renameArea: noop,
  deleteArea: noop,
  deleteFilter: noop,
};

describe('every record can be deleted from its own menu', () => {
  const menus: [string, MenuItem[], string][] = [
    ['úkol', taskMenu(task, context()), 'Smazat úkol'],
    ['projekt', projectMenu(project, context(), sidebarActions), 'Smazat projekt'],
    ['oblast', areaMenu(area, context(), sidebarActions), 'Smazat oblast'],
    ['filtr', filterMenu(filter, context(), sidebarActions), 'Smazat filtr'],
    [
      'poznámka',
      noteMenu(note, context(), { open: () => {}, togglePin: noop, remove: noop }),
      'Smazat poznámku',
    ],
    [
      'událost',
      occasionMenu(occasion, context(), { open: () => {}, remove: noop }),
      'Smazat událost',
    ],
    [
      'událost v kalendáři',
      calendarOccasionMenu(occasion, context(), { open: () => {}, remove: noop }),
      'Smazat událost',
    ],
    ['dárek', giftMenu(gift, context(), { setStatus: noop, openLink: noop, remove: noop }), 'Smazat dárek'],
  ];

  for (const [what, items, label] of menus) {
    it(`nabízí smazání: ${what}`, () => {
      const last = lastAction(items);
      expect(last.label).toBe(label);
      // Destructive entries are marked so they can be coloured and read apart.
      expect(last.danger).toBe(true);
    });
  }

  it('nikde nezůstal anglický popisek', () => {
    // Anything a Czech menu should never say. `Del` is a key cap, not a word.
    const english = /\b(Delete|Remove|Copy|Paste|Cut|Open|Select All|Rename|Cancel)\b/;
    for (const [, items] of menus) {
      for (const item of items) {
        if (item.kind === 'separator') continue;
        expect(item.label).not.toMatch(english);
        expect(item.label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the delete entries call through', () => {
  it('smaže projekt přes předanou akci', async () => {
    const deleteProject = vi.fn(async () => {});
    const items = projectMenu(project, context(), { ...sidebarActions, deleteProject });
    await lastAction(items).run();
    expect(deleteProject).toHaveBeenCalledWith(project);
  });

  it('smaže úkol a znovu načte seznam', async () => {
    const ctx = context();
    await lastAction(taskMenu(task, ctx)).run();
    expect(ctx.removeTask).toHaveBeenCalledWith('task-1');
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it('respektuje vypnuté potvrzování i zapnuté odmítnutí', async () => {
    // These tests run without a DOM, so `window.confirm` has to be stood up.
    const confirm = vi.fn(() => false);
    vi.stubGlobal('window', { confirm });
    const deleteArea = vi.fn(async () => {});
    const items = areaMenu(area, context({ confirmDelete: true }), {
      ...sidebarActions,
      deleteArea,
    });

    await lastAction(items).run();

    expect(confirm).toHaveBeenCalled();
    // The user said no, so nothing happened.
    expect(deleteArea).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('menu contents', () => {
  it('nabízí u dokončeného úkolu znovuotevření místo dokončení', () => {
    const done = { ...(task as object), status: 'completed' } as never;
    const labels = actions(taskMenu(done, context())).map((i) => i.label);
    expect(labels).toContain('Znovu otevřít');
    expect(labels).not.toContain('Dokončit');
  });

  it('zakáže otevření odkazu u dárku bez odkazu', () => {
    const items = giftMenu(gift, context(), { setStatus: noop, openLink: noop, remove: noop });
    const link = actions(items).find((i) => i.label === 'Otevřít odkaz');
    expect(link?.disabled).toBe(true);
  });

  it('spustí uložený filtr přes runSearch, aby se dotaz objevil ve vyhledávání', async () => {
    const ctx = context();
    const items = filterMenu(filter, ctx, sidebarActions);
    const run = actions(items).find((i) => i.label === 'Spustit hledání');
    await run?.run();
    expect(ctx.runSearch).toHaveBeenCalledWith('stav:otevřené');
  });
});
