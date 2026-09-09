import { describe, expect, it } from 'vitest';

import {
  describeQuery,
  isEmptyQuery,
  parseQuery,
  parseRelativeDate,
  toFilter,
  tokenize,
} from '../lib/query';

const BASE = '2026-09-07'; // a Monday

const CONTEXT = {
  projects: [
    { id: 'p-car', name: 'Car admin' },
    { id: 'p-house', name: 'House renovation' },
    { id: 'p-taxes', name: 'Taxes' },
  ],
  areas: [
    { id: 'a-personal', name: 'Personal' },
    { id: 'a-work', name: 'Work' },
  ],
};

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('jedna dva   tři')).toEqual(['jedna', 'dva', 'tři']);
  });

  it('keeps quoted phrases together', () => {
    expect(tokenize('"tři nabídky" faktura')).toEqual(['tři nabídky', 'faktura']);
  });

  it('keeps quoted values attached to their key', () => {
    expect(tokenize('projekt:"Auto papíry" štítek:domov')).toEqual([
      'projekt:Auto papíry',
      'štítek:domov',
    ]);
  });

  it('runs an unterminated quote to the end rather than dropping it', () => {
    expect(tokenize('projekt:"Auto papíry')).toEqual(['projekt:Auto papíry']);
  });

  it('returns nothing for blank input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('    ')).toEqual([]);
  });
});

describe('parseQuery', () => {
  it('treats bare words as free text', () => {
    const q = parseQuery('obnovit povinné ručení', BASE);
    expect(q.text).toBe('obnovit povinné ručení');
    expect(q.tags).toEqual([]);
  });

  it('reads tags in both spellings and de-duplicates them', () => {
    const q = parseQuery('#domov štítek:Domov štítek:pochůzky', BASE);
    expect(q.tags).toEqual(['domov', 'pochůzky']);
    expect(q.text).toBe('');
  });

  it('does not treat a lone # as a tag', () => {
    const q = parseQuery('# nadpis', BASE);
    expect(q.tags).toEqual([]);
    expect(q.text).toBe('# nadpis');
  });

  it('reads a quoted project name', () => {
    const q = parseQuery('projekt:"Auto papíry" nabídky', BASE);
    expect(q.projectName).toBe('Auto papíry');
    expect(q.text).toBe('nabídky');
  });

  it('reads lists and statuses in Czech', () => {
    expect(parseQuery('seznam:někdy', BASE).list).toBe('someday');
    expect(parseQuery('stav:hotové', BASE).statuses).toEqual(['completed']);
    expect(parseQuery('stav:vše', BASE).statuses).toEqual(['open', 'completed', 'canceled']);
    expect(parseQuery('', BASE).statuses).toBeNull();
  });

  it('still accepts the English keys and diacritic-free spellings', () => {
    expect(parseQuery('in:someday', BASE).list).toBe('someday');
    expect(parseQuery('seznam:nekdy', BASE).list).toBe('someday');
    expect(parseQuery('is:done', BASE).statuses).toEqual(['completed']);
    expect(parseQuery('stav:hotove', BASE).statuses).toEqual(['completed']);
    expect(parseQuery('stitek:domov', BASE).tags).toEqual(['domov']);
    expect(parseQuery('termin:dnes', BASE).due).toEqual({ kind: 'on_or_before', date: BASE });
  });

  it('reads priorities by word and by number', () => {
    expect(parseQuery('priorita:vysoká', BASE).minPriority).toBe(3);
    expect(parseQuery('priorita:2', BASE).minPriority).toBe(2);
    expect(parseQuery('priority:high', BASE).minPriority).toBe(3);
  });

  it('resolves relative deadlines against the given day', () => {
    expect(parseQuery('termín:dnes', BASE).due).toEqual({ kind: 'on_or_before', date: BASE });
    expect(parseQuery('termín:zítra', BASE).due).toEqual({
      kind: 'on_or_before',
      date: '2026-09-08',
    });
    expect(parseQuery('termín:týden', BASE).due).toEqual({
      kind: 'on_or_before',
      date: '2026-09-14',
    });
  });

  it('treats overdue as "before today"', () => {
    expect(parseQuery('termín:prošlé', BASE).due).toEqual({
      kind: 'on_or_before',
      date: '2026-09-06',
    });
    expect(parseQuery('due:overdue', BASE).due).toEqual({
      kind: 'on_or_before',
      date: '2026-09-06',
    });
  });

  it('understands explicit comparisons and literal dates', () => {
    expect(parseQuery('termín:>=2026-10-01', BASE).due).toEqual({
      kind: 'on_or_after',
      date: '2026-10-01',
    });
    expect(parseQuery('termín:2026-12-24', BASE).due).toEqual({
      kind: 'on_or_before',
      date: '2026-12-24',
    });
  });

  it('handles "no deadline" and "any deadline"', () => {
    expect(parseQuery('termín:žádný', BASE).due).toEqual({ kind: 'none' });
    expect(parseQuery('termín:jakýkoli', BASE).due).toEqual({ kind: 'any' });
    expect(parseQuery('due:none', BASE).due).toEqual({ kind: 'none' });
  });

  it('keeps an unknown key as searchable text', () => {
    // A task really can be called "Chyba: přihlašovací stránka".
    const q = parseQuery('Chyba: přihlašovací stránka', BASE);
    expect(q.text).toBe('Chyba: přihlašovací stránka');
    expect(q.unknown).toEqual([]);
  });

  it('records a known key with an unusable value instead of guessing', () => {
    const q = parseQuery('termín:někdy-možná', BASE);
    expect(q.due).toBeNull();
    expect(q.unknown).toEqual(['termín:někdy-možná']);
  });

  it('rejects an impossible date', () => {
    expect(parseRelativeDate('2026-02-31', BASE)).toBeNull();
    expect(parseRelativeDate('2026-13-01', BASE)).toBeNull();
    expect(parseRelativeDate('2028-02-29', BASE)).toBe('2028-02-29');
  });

  it('combines everything in one query', () => {
    const q = parseQuery('daně #peníze projekt:Daně termín:týden stav:vše priorita:2', BASE);
    expect(q).toMatchObject({
      text: 'daně',
      tags: ['peníze'],
      projectName: 'Daně',
      minPriority: 2,
      statuses: ['open', 'completed', 'canceled'],
      due: { kind: 'on_or_before', date: '2026-09-14' },
    });
  });

  it('is empty for empty input', () => {
    expect(isEmptyQuery(parseQuery('', BASE))).toBe(true);
    expect(isEmptyQuery(parseQuery('   ', BASE))).toBe(true);
    expect(isEmptyQuery(parseQuery('x', BASE))).toBe(false);
    expect(isEmptyQuery(parseQuery('#domov', BASE))).toBe(false);
  });
});

describe('toFilter', () => {
  it('passes text and tags straight through', () => {
    const filter = toFilter(parseQuery('faktura #peníze', BASE), CONTEXT);
    expect(filter.text).toBe('faktura');
    expect(filter.tags).toEqual(['peníze']);
  });

  it('resolves an exact project name to its id', () => {
    const filter = toFilter(parseQuery('projekt:"Car admin"', BASE), CONTEXT);
    expect(filter.project_id).toBe('p-car');
  });

  it('resolves a unique prefix', () => {
    expect(toFilter(parseQuery('projekt:Car', BASE), CONTEXT).project_id).toBe('p-car');
    expect(toFilter(parseQuery('oblast:work', BASE), CONTEXT).area_id).toBe('a-work');
  });

  it('resolves a unique substring', () => {
    expect(toFilter(parseQuery('projekt:renovation', BASE), CONTEXT).project_id).toBe('p-house');
  });

  it('returns no results for a name that matches nothing', () => {
    // The alternative - dropping the term - would quietly widen the search.
    const filter = toFilter(parseQuery('projekt:Neexistuje', BASE), CONTEXT);
    expect(filter.project_id).toBeTruthy();
    expect(filter.project_id).not.toBe('p-car');
  });

  it('returns no results when a prefix is ambiguous', () => {
    const ambiguous = {
      projects: [
        { id: 'p1', name: 'Taxes 2025' },
        { id: 'p2', name: 'Taxes 2026' },
      ],
      areas: [],
    };
    const filter = toFilter(parseQuery('projekt:Taxes', BASE), ambiguous);
    expect(['p1', 'p2']).not.toContain(filter.project_id);
  });

  it('maps due terms onto the right filter fields', () => {
    expect(toFilter(parseQuery('termín:dnes', BASE), CONTEXT).due_before).toBe(BASE);
    expect(toFilter(parseQuery('termín:>=2026-10-01', BASE), CONTEXT).due_after).toBe('2026-10-01');
    expect(toFilter(parseQuery('termín:žádný', BASE), CONTEXT).has_deadline).toBe(false);
    expect(toFilter(parseQuery('termín:jakýkoli', BASE), CONTEXT).has_deadline).toBe(true);
  });

  it('omits keys that were not asked for', () => {
    const filter = toFilter(parseQuery('obyčejná slova', BASE), CONTEXT);
    expect(filter).toEqual({ text: 'obyčejná slova' });
  });
});

describe('describeQuery', () => {
  it('describes an empty query as everything open', () => {
    expect(describeQuery(parseQuery('', BASE))).toBe('Vše otevřené');
  });

  it('reads as a sentence', () => {
    expect(describeQuery(parseQuery('daně #peníze termín:prošlé', BASE))).toBe(
      'obsahuje „daně“, se štítky #peníze, s termínem do 6. 9. 2026',
    );
  });
});
