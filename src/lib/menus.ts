/**
 * The menus themselves.
 *
 * Builders that turn "you right-clicked this" into a list of Czech actions.
 * They live apart from the components so that every entity's menu reads the
 * same way, and so adding an action to tasks does not mean editing three
 * different files that happen to show task rows.
 */

import { addDays, nextWeekday } from './dates';
import { readEditable, selectedText, spliceSelection } from './contextmenu';
import type { MenuItem } from './contextmenu';
import { readText, writeText } from './clipboard';
import type { GiftIdea, NoteDetail, Occasion, OccasionDetail } from './planner-types';
import type { Area, Project, SavedFilter, TaskDetail } from './types';

/** What the builders need from the store, passed in rather than imported. */
export interface MenuContext {
  today: string;
  confirmDelete: boolean;
  setStatus: (id: string, status: 'open' | 'completed' | 'canceled') => Promise<void>;
  patchTask: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  removeTask: (id: string) => Promise<void>;
  openInspector: (id: string | null) => void;
  startFocus: (id: string, minutes: number) => Promise<void>;
  navigate: (route: unknown) => Promise<void>;
  runSearch: (query: string) => Promise<void>;
  toast: (kind: 'success' | 'error' | 'info', message: string) => void;
  /** Re-reads whatever list the item came from. */
  refresh: () => Promise<void> | void;
}

/** Truncated for a menu caption, which must stay one line. */
function caption(text: string, max = 34): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

async function copy(text: string, ctx: MenuContext, what = 'Text'): Promise<void> {
  const ok = await writeText(text);
  ctx.toast(ok ? 'success' : 'error', ok ? `${what} zkopírován.` : 'Kopírování se nezdařilo.');
}

/** A single place for "are you sure", so the setting is honoured everywhere. */
export function confirmed(ctx: MenuContext, question: string): boolean {
  if (!ctx.confirmDelete) return true;
  return window.confirm(question);
}

// -- tasks --------------------------------------------------------------------

export function taskMenu(task: TaskDetail, ctx: MenuContext): MenuItem[] {
  const done = task.status !== 'open';

  return [
    { kind: 'header', label: caption(task.title) },
    {
      kind: 'action',
      label: 'Otevřít detail',
      shortcut: 'Enter',
      run: () => ctx.openInspector(task.id),
    },
    {
      kind: 'action',
      label: done ? 'Znovu otevřít' : 'Dokončit',
      shortcut: 'Mezerník',
      run: async () => {
        await ctx.setStatus(task.id, done ? 'open' : 'completed');
        await ctx.refresh();
      },
    },
    {
      kind: 'action',
      label: 'Soustředit se',
      shortcut: 'F',
      disabled: done,
      run: () => ctx.startFocus(task.id, 25),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Naplánovat na dnes',
      shortcut: 'T',
      run: async () => {
        await ctx.patchTask(task.id, { start_on: ctx.today });
        await ctx.refresh();
      },
    },
    {
      kind: 'action',
      label: 'Naplánovat na zítra',
      run: async () => {
        await ctx.patchTask(task.id, { start_on: addDays(ctx.today, 1) });
        await ctx.refresh();
      },
    },
    {
      kind: 'action',
      label: 'Naplánovat na příští pondělí',
      run: async () => {
        await ctx.patchTask(task.id, { start_on: nextWeekday(ctx.today, 0) });
        await ctx.refresh();
      },
    },
    {
      kind: 'action',
      label: 'Odložit na někdy',
      run: async () => {
        await ctx.patchTask(task.id, { list: 'someday' });
        await ctx.refresh();
      },
    },
    {
      kind: 'action',
      label: 'Zrušit naplánování',
      disabled: !task.start_on,
      run: async () => {
        await ctx.patchTask(task.id, { start_on: null });
        await ctx.refresh();
      },
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Kopírovat název',
      run: () => copy(task.title, ctx, 'Název'),
    },
    {
      kind: 'action',
      label: done ? 'Vrátit mezi otevřené' : 'Zahodit (nedělat)',
      run: async () => {
        await ctx.setStatus(task.id, done ? 'open' : 'canceled');
        await ctx.refresh();
      },
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Smazat úkol',
      shortcut: 'Del',
      danger: true,
      run: async () => {
        if (!confirmed(ctx, `Smazat úkol „${task.title}“?`)) return;
        await ctx.removeTask(task.id);
        await ctx.refresh();
      },
    },
  ];
}

// -- projects, areas, saved filters -------------------------------------------

export interface SidebarActions {
  renameProject: (project: Project, name: string) => Promise<void>;
  completeProject: (project: Project) => Promise<void>;
  deleteProject: (project: Project) => Promise<void>;
  renameArea: (area: Area, name: string) => Promise<void>;
  deleteArea: (area: Area) => Promise<void>;
  deleteFilter: (filter: SavedFilter) => Promise<void>;
}

export function projectMenu(
  project: Project,
  ctx: MenuContext,
  actions: SidebarActions,
): MenuItem[] {
  return [
    { kind: 'header', label: caption(project.name) },
    {
      kind: 'action',
      label: 'Otevřít projekt',
      run: () => ctx.navigate({ kind: 'project', id: project.id }),
    },
    {
      kind: 'action',
      label: 'Přejmenovat…',
      run: async () => {
        const name = window.prompt('Nový název projektu', project.name);
        if (name && name.trim() && name.trim() !== project.name) {
          await actions.renameProject(project, name.trim());
        }
      },
    },
    {
      kind: 'action',
      label: 'Dokončit projekt',
      run: async () => {
        if (!confirmed(ctx, `Dokončit projekt „${project.name}“ i s jeho otevřenými úkoly?`)) {
          return;
        }
        await actions.completeProject(project);
      },
    },
    { kind: 'separator' },
    { kind: 'action', label: 'Kopírovat název', run: () => copy(project.name, ctx, 'Název') },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Smazat projekt',
      danger: true,
      run: async () => {
        if (
          !confirmed(
            ctx,
            `Smazat projekt „${project.name}“?\n\nÚkoly v něm zůstanou zachované, jen přestanou být zařazené.`,
          )
        ) {
          return;
        }
        await actions.deleteProject(project);
      },
    },
  ];
}

export function areaMenu(area: Area, ctx: MenuContext, actions: SidebarActions): MenuItem[] {
  return [
    { kind: 'header', label: caption(area.name) },
    {
      kind: 'action',
      label: 'Otevřít oblast',
      run: () => ctx.navigate({ kind: 'area', id: area.id }),
    },
    {
      kind: 'action',
      label: 'Přejmenovat…',
      run: async () => {
        const name = window.prompt('Nový název oblasti', area.name);
        if (name && name.trim() && name.trim() !== area.name) {
          await actions.renameArea(area, name.trim());
        }
      },
    },
    { kind: 'separator' },
    { kind: 'action', label: 'Kopírovat název', run: () => copy(area.name, ctx, 'Název') },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Smazat oblast',
      danger: true,
      run: async () => {
        if (
          !confirmed(
            ctx,
            `Smazat oblast „${area.name}“?\n\nProjekty a úkoly v ní zůstanou zachované, jen přestanou být zařazené.`,
          )
        ) {
          return;
        }
        await actions.deleteArea(area);
      },
    },
  ];
}

export function filterMenu(
  filter: SavedFilter,
  ctx: MenuContext,
  actions: SidebarActions,
): MenuItem[] {
  return [
    { kind: 'header', label: caption(filter.name) },
    {
      kind: 'action',
      label: 'Spustit hledání',
      // Through runSearch, so the search box shows the query it is running.
      run: () => ctx.runSearch(filter.query),
    },
    { kind: 'action', label: 'Kopírovat dotaz', run: () => copy(filter.query, ctx, 'Dotaz') },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Smazat filtr',
      danger: true,
      run: async () => {
        if (!confirmed(ctx, `Smazat uložený filtr „${filter.name}“?`)) return;
        await actions.deleteFilter(filter);
      },
    },
  ];
}

// -- notebook -----------------------------------------------------------------

export interface NoteActions {
  open: (note: NoteDetail) => void;
  togglePin: (note: NoteDetail) => Promise<void>;
  remove: (note: NoteDetail) => Promise<void>;
}

export function noteMenu(note: NoteDetail, ctx: MenuContext, actions: NoteActions): MenuItem[] {
  return [
    { kind: 'header', label: caption(note.title) },
    { kind: 'action', label: 'Otevřít poznámku', run: () => actions.open(note) },
    {
      kind: 'action',
      label: note.pinned ? 'Odepnout' : 'Připnout nahoru',
      run: () => actions.togglePin(note),
    },
    { kind: 'separator' },
    { kind: 'action', label: 'Kopírovat nadpis', run: () => copy(note.title, ctx, 'Nadpis') },
    {
      kind: 'action',
      label: 'Kopírovat text',
      disabled: !note.body,
      run: () => copy(note.body, ctx, 'Text'),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Smazat poznámku',
      danger: true,
      run: async () => {
        if (!confirmed(ctx, `Smazat poznámku „${note.title}“?`)) return;
        await actions.remove(note);
      },
    },
  ];
}

// -- occasions and gifts ------------------------------------------------------

export interface OccasionActions {
  open: (occasion: OccasionDetail) => void;
  remove: (occasion: OccasionDetail) => Promise<void>;
}

export function occasionMenu(
  occasion: OccasionDetail,
  ctx: MenuContext,
  actions: OccasionActions,
): MenuItem[] {
  return [
    { kind: 'header', label: caption(occasion.name) },
    { kind: 'action', label: 'Otevřít událost', run: () => actions.open(occasion) },
    {
      kind: 'action',
      label: 'Zobrazit v kalendáři',
      run: () => ctx.navigate({ kind: 'calendar' }),
    },
    { kind: 'separator' },
    { kind: 'action', label: 'Kopírovat název', run: () => copy(occasion.name, ctx, 'Název') },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Smazat událost',
      danger: true,
      run: async () => {
        if (
          !confirmed(
            ctx,
            `Smazat událost „${occasion.name}“${
              occasion.gift_count ? ` i s ${occasion.gift_count} dárky` : ''
            }?`,
          )
        ) {
          return;
        }
        await actions.remove(occasion);
      },
    },
  ];
}

export interface GiftActions {
  setStatus: (gift: GiftIdea, status: GiftIdea['status']) => Promise<void>;
  openLink: (gift: GiftIdea) => Promise<void>;
  remove: (gift: GiftIdea) => Promise<void>;
}

export function giftMenu(gift: GiftIdea, ctx: MenuContext, actions: GiftActions): MenuItem[] {
  const bought = gift.status === 'bought' || gift.status === 'wrapped' || gift.status === 'given';
  return [
    { kind: 'header', label: caption(gift.title) },
    {
      kind: 'action',
      label: bought ? 'Vrátit na nápad' : 'Označit jako koupené',
      run: () => actions.setStatus(gift, bought ? 'idea' : 'bought'),
    },
    {
      kind: 'action',
      label: 'Otevřít odkaz',
      disabled: !gift.url,
      run: () => actions.openLink(gift),
    },
    { kind: 'separator' },
    { kind: 'action', label: 'Kopírovat název', run: () => copy(gift.title, ctx, 'Název') },
    {
      kind: 'action',
      label: 'Kopírovat odkaz',
      disabled: !gift.url,
      run: () => copy(gift.url, ctx, 'Odkaz'),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Smazat dárek',
      danger: true,
      run: async () => {
        if (!confirmed(ctx, `Smazat dárek „${gift.title}“?`)) return;
        await actions.remove(gift);
      },
    },
  ];
}

/** The calendar knows an occasion only as a name and a date. */
export function calendarOccasionMenu(
  occasion: Occasion,
  ctx: MenuContext,
  actions: { open: (o: Occasion) => void; remove: (o: Occasion) => Promise<void> },
): MenuItem[] {
  return [
    { kind: 'header', label: caption(occasion.name) },
    { kind: 'action', label: 'Otevřít událost', run: () => actions.open(occasion) },
    { kind: 'action', label: 'Kopírovat název', run: () => copy(occasion.name, ctx, 'Název') },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Smazat událost',
      danger: true,
      run: async () => {
        if (!confirmed(ctx, `Smazat událost „${occasion.name}“ i s dárky, které k ní patří?`)) {
          return;
        }
        await actions.remove(occasion);
      },
    },
  ];
}

// -- text fields ---------------------------------------------------------------

/**
 * The Czech replacement for the browser's own edit menu.
 *
 * Returns `null` when the target is not a text field, so the caller can fall
 * through to whatever item was clicked.
 */
export function editableMenu(target: EventTarget | null): MenuItem[] | null {
  const state = readEditable(target);
  if (!state) return null;

  const field = target as HTMLInputElement | HTMLTextAreaElement;
  const isField = field.tagName === 'INPUT' || field.tagName === 'TEXTAREA';

  return [
    {
      kind: 'action',
      label: 'Vyjmout',
      shortcut: 'Ctrl X',
      disabled: !state.hasSelection || !state.editable,
      run: async () => {
        if (!isField) return;
        const text = selectedText(field);
        if (!(await writeText(text))) return;
        replaceSelection(field, '');
      },
    },
    {
      kind: 'action',
      label: 'Kopírovat',
      shortcut: 'Ctrl C',
      disabled: !state.hasSelection,
      run: async () => {
        if (isField) await writeText(selectedText(field));
        else await writeText(window.getSelection()?.toString() ?? '');
      },
    },
    {
      kind: 'action',
      label: 'Vložit',
      shortcut: 'Ctrl V',
      disabled: !state.editable,
      run: async () => {
        const text = await readText();
        if (text === null || !isField) return;
        replaceSelection(field, text);
      },
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Vybrat vše',
      shortcut: 'Ctrl A',
      disabled: !state.hasContent,
      run: () => {
        if (isField) field.select();
        else document.execCommand('selectAll');
      },
    },
  ];
}

/**
 * Writes into a field the way a user would, so React sees the change.
 *
 * Setting `.value` directly bypasses React's synthetic events and the change
 * is lost on the next render; going through the native setter and dispatching
 * `input` is what makes a controlled component notice.
 */
function replaceSelection(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const { value, caret } = spliceSelection(
    field.value,
    field.selectionStart ?? 0,
    field.selectionEnd ?? 0,
    text,
  );

  const prototype =
    field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(field, value);
  else field.value = value;

  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.setSelectionRange(caret, caret);
  field.focus();
}
