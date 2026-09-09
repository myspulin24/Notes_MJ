/**
 * The search query language.
 *
 * Search is one text box. Typing words searches titles and notes; typing a
 * `key:value` narrows it down. Anything unrecognised is treated as text rather
 * than rejected, so a stray colon in a task title never produces an error
 * message instead of results.
 *
 * ```text
 *   faktura                       words match the title and the notes
 *   "tři nabídky"                 a quoted phrase stays together
 *   štítek:domov  #domov          has this tag (repeatable, all must match)
 *   projekt:"Auto"                in this project
 *   oblast:Osobní                 in this area
 *   seznam:doručené|kdykoli|někdy in this list
 *   stav:otevřené|hotové|vše      by status (default: open only)
 *   termín:dnes|zítra|týden|prošlé|žádný|jakýkoli|2026-09-20
 *   začátek:dnes|týden|2026-09-20
 *   priorita:vysoká|střední|nízká
 * ```
 *
 * The English keys (`tag:`, `project:`, `due:`, …) and the diacritic-free
 * spellings (`stitek:`, `termin:`) are accepted too, because a search box that
 * only works if you get the accent right is a search box people stop using.
 *
 * Parsing is deliberately separate from turning the result into a backend
 * filter: the parser knows nothing about which projects exist, and the
 * resolver does no text handling.
 */

import { addDays, isValidISODate } from './dates';
import type { SearchFilter, TaskList, TaskStatus } from './types';

export type DueTerm =
  | { kind: 'on_or_before'; date: string }
  | { kind: 'on_or_after'; date: string }
  | { kind: 'none' }
  | { kind: 'any' };

export interface ParsedQuery {
  /** Free text, with quoted phrases unwrapped and joined by spaces. */
  text: string;
  tags: string[];
  projectName: string | null;
  areaName: string | null;
  list: TaskList | null;
  statuses: TaskStatus[] | null;
  minPriority: number | null;
  due: DueTerm | null;
  startBefore: string | null;
  /** Terms that looked like `key:value` but were not understood. */
  unknown: string[];
}

const EMPTY: ParsedQuery = {
  text: '',
  tags: [],
  projectName: null,
  areaName: null,
  list: null,
  statuses: null,
  minPriority: null,
  due: null,
  startBefore: null,
  unknown: [],
};

/**
 * Splits on whitespace, keeping `"quoted phrases"` and `key:"quoted values"`
 * in one piece. An unterminated quote runs to the end of the input rather than
 * discarding what the user typed.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;

  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

const LISTS: Record<string, TaskList> = {
  inbox: 'inbox',
  anytime: 'anytime',
  someday: 'someday',
  'doručené': 'inbox',
  'dorucene': 'inbox',
  schránka: 'inbox',
  schranka: 'inbox',
  kdykoli: 'anytime',
  kdykoliv: 'anytime',
  'někdy': 'someday',
  nekdy: 'someday',
};

const PRIORITIES: Record<string, number> = {
  high: 3,
  medium: 2,
  med: 2,
  low: 1,
  any: 1,
  'vysoká': 3,
  vysoka: 3,
  'střední': 2,
  stredni: 2,
  'nízká': 1,
  nizka: 1,
  'jakákoli': 1,
  jakakoli: 1,
  '1': 1,
  '2': 2,
  '3': 3,
};

/** Every spelling of a filter key, normalised to one canonical name. */
const KEYS: Record<string, string> = {
  tag: 'tag', 'štítek': 'tag', stitek: 'tag', 'štítky': 'tag', stitky: 'tag',
  project: 'project', proj: 'project', projekt: 'project',
  area: 'area', oblast: 'area',
  in: 'list', list: 'list', seznam: 'list',
  is: 'status', status: 'status', stav: 'status',
  priority: 'priority', p: 'priority', priorita: 'priority',
  due: 'due', 'termín': 'due', termin: 'due', deadline: 'due',
  start: 'start', when: 'start', 'začátek': 'start', zacatek: 'start', kdy: 'start',
};

/** Every spelling of a status value. */
const STATUSES: Record<string, TaskStatus[]> = {
  open: ['open'], todo: ['open'], 'otevřené': ['open'], otevrene: ['open'],
  'nehotové': ['open'], nehotove: ['open'],
  done: ['completed'], completed: ['completed'], 'hotové': ['completed'], hotove: ['completed'],
  'dokončené': ['completed'], dokoncene: ['completed'],
  canceled: ['canceled'], cancelled: ['canceled'], 'zrušené': ['canceled'], zrusene: ['canceled'],
  any: ['open', 'completed', 'canceled'], all: ['open', 'completed', 'canceled'],
  'vše': ['open', 'completed', 'canceled'], vse: ['open', 'completed', 'canceled'],
};

export function parseQuery(input: string, base: string): ParsedQuery {
  const result: ParsedQuery = { ...EMPTY, tags: [], statuses: null, unknown: [] };
  const words: string[] = [];

  for (const token of tokenize(input)) {
    // `#home` is shorthand for `tag:home`, but only when it is the whole word.
    if (token.startsWith('#') && token.length > 1) {
      result.tags.push(token.slice(1).toLowerCase());
      continue;
    }

    const colon = token.indexOf(':');
    if (colon <= 0 || colon === token.length - 1) {
      words.push(token);
      continue;
    }

    const rawKey = token.slice(0, colon).toLowerCase();
    const key = KEYS[rawKey];
    const value = token.slice(colon + 1);
    const lower = value.toLowerCase();

    switch (key) {
      case 'tag':
        result.tags.push(lower);
        break;
      case 'project':
        result.projectName = value;
        break;
      case 'area':
        result.areaName = value;
        break;
      case 'list':
        if (LISTS[lower]) result.list = LISTS[lower];
        else result.unknown.push(token);
        break;
      case 'status':
        if (STATUSES[lower]) result.statuses = STATUSES[lower];
        else result.unknown.push(token);
        break;
      case 'priority':
        if (PRIORITIES[lower] !== undefined) result.minPriority = PRIORITIES[lower];
        else result.unknown.push(token);
        break;
      case 'due': {
        const term = parseDueTerm(lower, base);
        if (term) result.due = term;
        else result.unknown.push(token);
        break;
      }
      case 'start': {
        const date = parseRelativeDate(lower, base);
        if (date) result.startBefore = date;
        else result.unknown.push(token);
        break;
      }
      default:
        // Not a known key: it is just text with a colon in it.
        words.push(token);
    }
  }

  result.text = words.join(' ').trim();
  // De-duplicate tags without disturbing the order they were typed in.
  result.tags = [...new Set(result.tags.filter(Boolean))];
  return result;
}

const NO_DEADLINE = ['none', 'never', 'žádný', 'zadny', 'bez'];
const ANY_DEADLINE = ['any', 'set', 'jakýkoli', 'jakykoli', 'libovolný', 'libovolny'];
const OVERDUE = ['overdue', 'late', 'prošlé', 'prosle', 'po', 'zmeškané', 'zmeskane'];

function parseDueTerm(value: string, base: string): DueTerm | null {
  if (NO_DEADLINE.includes(value)) return { kind: 'none' };
  if (ANY_DEADLINE.includes(value)) return { kind: 'any' };
  if (OVERDUE.includes(value)) {
    return { kind: 'on_or_before', date: addDays(base, -1) };
  }
  if (value.startsWith('>=')) {
    const date = parseRelativeDate(value.slice(2), base);
    return date ? { kind: 'on_or_after', date } : null;
  }
  if (value.startsWith('<=')) {
    const date = parseRelativeDate(value.slice(2), base);
    return date ? { kind: 'on_or_before', date } : null;
  }
  const date = parseRelativeDate(value, base);
  return date ? { kind: 'on_or_before', date } : null;
}

/** `dnes`, `zítra`, `týden`, `měsíc` (or their English twins), or `YYYY-MM-DD`. */
export function parseRelativeDate(value: string, base: string): string | null {
  const OFFSETS: Record<string, number> = {
    today: 0, dnes: 0,
    tomorrow: 1, 'zítra': 1, zitra: 1,
    yesterday: -1, 'včera': -1, vcera: -1,
    week: 7, 'týden': 7, tyden: 7,
    fortnight: 14, '14dní': 14, '14dni': 14,
    month: 30, 'měsíc': 30, mesic: 30,
  };
  const offset = OFFSETS[value];
  if (offset !== undefined) return offset === 0 ? base : addDays(base, offset);
  return isValidISODate(value) ? value : null;
}

export interface NamedThing {
  id: string;
  name: string;
}

/**
 * Turns a parsed query into the filter the backend understands, resolving
 * project and area names against what actually exists.
 *
 * A name that matches nothing becomes an impossible id rather than being
 * dropped, so `project:Nonexistent` returns no results instead of silently
 * returning everything.
 */
export function toFilter(
  parsed: ParsedQuery,
  context: { projects: NamedThing[]; areas: NamedThing[] },
): SearchFilter {
  const filter: SearchFilter = { text: parsed.text };

  if (parsed.tags.length) filter.tags = parsed.tags;
  if (parsed.list) filter.list = parsed.list;
  if (parsed.statuses) filter.statuses = parsed.statuses;
  if (parsed.minPriority !== null) filter.min_priority = parsed.minPriority;
  if (parsed.startBefore) filter.start_before = parsed.startBefore;

  if (parsed.projectName !== null) {
    filter.project_id = matchByName(context.projects, parsed.projectName);
  }
  if (parsed.areaName !== null) {
    filter.area_id = matchByName(context.areas, parsed.areaName);
  }

  if (parsed.due) {
    switch (parsed.due.kind) {
      case 'on_or_before':
        filter.due_before = parsed.due.date;
        break;
      case 'on_or_after':
        filter.due_after = parsed.due.date;
        break;
      case 'none':
        filter.has_deadline = false;
        break;
      case 'any':
        filter.has_deadline = true;
        break;
    }
  }

  return filter;
}

const NO_MATCH = ' no-match';

/** Exact match first, then a unique case-insensitive prefix. */
function matchByName(things: NamedThing[], name: string): string {
  const needle = name.trim().toLowerCase();
  if (!needle) return NO_MATCH;

  const exact = things.find((t) => t.name.toLowerCase() === needle);
  if (exact) return exact.id;

  const prefixed = things.filter((t) => t.name.toLowerCase().startsWith(needle));
  if (prefixed.length === 1) return prefixed[0].id;

  const contained = things.filter((t) => t.name.toLowerCase().includes(needle));
  if (contained.length === 1) return contained[0].id;

  return NO_MATCH;
}

/** True when the query would not narrow anything down. */
export function isEmptyQuery(parsed: ParsedQuery): boolean {
  return (
    !parsed.text &&
    parsed.tags.length === 0 &&
    parsed.projectName === null &&
    parsed.areaName === null &&
    parsed.list === null &&
    parsed.statuses === null &&
    parsed.minPriority === null &&
    parsed.due === null &&
    parsed.startBefore === null
  );
}

const LIST_NAMES: Record<TaskList, string> = {
  inbox: 'Doručených',
  anytime: 'Kdykoli',
  someday: 'Někdy',
};

const STATUS_NAMES: Record<TaskStatus, string> = {
  open: 'jen otevřené',
  completed: 'jen dokončené',
  canceled: 'jen zrušené',
};

/** A one-line plain-Czech summary, shown under the search box. */
export function describeQuery(parsed: ParsedQuery): string {
  const parts: string[] = [];
  if (parsed.text) parts.push(`obsahuje „${parsed.text}“`);
  if (parsed.tags.length) parts.push(`se štítky ${parsed.tags.map((t) => `#${t}`).join(' + ')}`);
  if (parsed.projectName) parts.push(`v projektu ${parsed.projectName}`);
  if (parsed.areaName) parts.push(`v oblasti ${parsed.areaName}`);
  if (parsed.list) parts.push(`v ${LIST_NAMES[parsed.list]}`);
  if (parsed.minPriority) parts.push(`priorita ${parsed.minPriority}+`);
  if (parsed.due?.kind === 'on_or_before') parts.push(`s termínem do ${czDate(parsed.due.date)}`);
  if (parsed.due?.kind === 'on_or_after') parts.push(`s termínem od ${czDate(parsed.due.date)}`);
  if (parsed.due?.kind === 'none') parts.push('bez termínu');
  if (parsed.due?.kind === 'any') parts.push('s termínem');
  if (parsed.startBefore) parts.push(`se zahájením do ${czDate(parsed.startBefore)}`);
  if (parsed.statuses) {
    parts.push(
      parsed.statuses.length > 1 ? 'včetně dokončených' : STATUS_NAMES[parsed.statuses[0]],
    );
  }
  if (!parts.length) return 'Vše otevřené';
  return parts.join(', ');
}

/** `2026-09-07` as `7. 9. 2026`. */
function czDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${Number(parts[2])}. ${Number(parts[1])}. ${parts[0]}`;
}
