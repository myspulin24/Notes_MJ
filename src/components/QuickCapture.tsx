/**
 * Keyboard-first capture.
 *
 * The whole point is that a thought costs one keystroke to record and never
 * needs the mouse. Type the title; add `#tag`, `!1..!3` for priority, and
 * `@today` / `@tomorrow` / `@monday` / `@2026-09-20` for when - all inline.
 * Enter saves and closes; Ctrl+Enter saves and stays open for the next one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { addDays, isValidISODate, nextWeekday, relativeDateLabel } from '../lib/dates';
import type { NewTask, Project } from '../lib/types';
import { useStore } from '../state/store';
import { CloseIcon } from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-file the task, e.g. when capturing from inside a project. */
  defaultProjectId?: string | null;
  defaultAreaId?: string | null;
  /** Pre-fills the start date, e.g. when capturing into a calendar day. */
  defaultStartOn?: string | null;
}

// Both the English and the Czech names, with and without diacritics, because
// capture has to accept whatever the user types without slowing down.
const WEEKDAYS: Record<string, number> = {
  monday: 0, mon: 0, 'pondělí': 0, pondeli: 0, po: 0,
  tuesday: 1, tue: 1, 'úterý': 1, utery: 1, 'út': 1, ut: 1,
  wednesday: 2, wed: 2, 'středa': 2, streda: 2, st: 2,
  thursday: 3, thu: 3, 'čtvrtek': 3, ctvrtek: 3, 'čt': 3, ct: 3,
  friday: 4, fri: 4, 'pátek': 4, patek: 4, 'pá': 4, pa: 4,
  saturday: 5, sat: 5, sobota: 5, so: 5,
  sunday: 6, sun: 6, 'neděle': 6, nedele: 6, ne: 6,
};

export interface CaptureDraft {
  title: string;
  tags: string[];
  priority: number;
  startOn: string | null;
}

/**
 * Pulls the inline shorthand out of a typed line.
 *
 * Exported and pure so it can be unit-tested without a DOM.
 */
export function parseCapture(input: string, today: string): CaptureDraft {
  const words: string[] = [];
  const tags: string[] = [];
  let priority = 0;
  let startOn: string | null = null;

  for (const token of input.split(/\s+/)) {
    if (!token) continue;

    if (token.length > 1 && token.startsWith('#')) {
      tags.push(token.slice(1).toLowerCase());
      continue;
    }
    if (/^![1-3]$/.test(token)) {
      priority = Number(token[1]);
      continue;
    }
    if (token.length > 1 && token.startsWith('@')) {
      const value = token.slice(1).toLowerCase();
      const resolved = resolveWhen(value, today);
      if (resolved) {
        startOn = resolved;
        continue;
      }
    }
    words.push(token);
  }

  return {
    title: words.join(' ').trim(),
    tags: [...new Set(tags)],
    priority,
    startOn,
  };
}

function resolveWhen(value: string, today: string): string | null {
  if (value === 'today' || value === 'dnes') return today;
  if (value === 'tomorrow' || value === 'tmr' || value === 'zítra' || value === 'zitra') {
    return addDays(today, 1);
  }
  if (value === 'week' || value === 'týden' || value === 'tyden') return addDays(today, 7);
  if (WEEKDAYS[value] !== undefined) return nextWeekday(today, WEEKDAYS[value]);
  if (isValidISODate(value)) return value;
  return null;
}

export function QuickCapture({
  open,
  onClose,
  defaultProjectId,
  defaultAreaId,
  defaultStartOn,
}: Props) {
  const { today, capture, projects, toast } = useStore();
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setProjectId(defaultProjectId ?? null);
      // Wait for the dialog to be painted before taking focus.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, defaultProjectId]);

  const draft = useMemo(() => parseCapture(text, today), [text, today]);

  if (!open) return null;

  const submit = async (keepOpen: boolean) => {
    if (!draft.title || saving) return;
    setSaving(true);
    const input: NewTask = {
      title: draft.title,
      tag_names: draft.tags,
      priority: draft.priority,
      // Anything typed with @ wins over the day the dialog was opened from.
      start_on: draft.startOn ?? defaultStartOn ?? null,
      project_id: projectId,
      area_id: projectId ? null : (defaultAreaId ?? null),
    };
    const created = await capture(input);
    setSaving(false);
    if (!created) return;

    if (keepOpen) {
      setText('');
      inputRef.current?.focus();
      toast('success', `Přidáno „${created.title}“.`);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal capture" role="dialog" aria-modal="true" aria-label="Nový úkol">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <div className="capture-input">
            <input
              ref={inputRef}
              value={text}
              maxLength={500}
              placeholder="Co je potřeba udělat?"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onClose();
                }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void submit(true);
                }
              }}
            />
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Zavřít">
              <CloseIcon size={16} />
            </button>
          </div>

          <div className="capture-preview">
            {draft.tags.map((tag) => (
              <span key={tag} className="chip chip-tag">
                {tag}
              </span>
            ))}
            {draft.priority ? (
              <span className={`chip prio-chip prio-${draft.priority}`}>
                Priorita {draft.priority}
              </span>
            ) : null}
            {draft.startOn ?? defaultStartOn ? (
              <span className="chip chip-when">
                {relativeDateLabel((draft.startOn ?? defaultStartOn)!, today)}
              </span>
            ) : null}
            <ProjectPicker
              projects={projects}
              value={projectId}
              onChange={setProjectId}
            />
          </div>

          <footer className="capture-foot">
            <p className="hint">
              <code>#štítek</code> · <code>!1</code>–<code>!3</code> priorita ·{' '}
              <code>@dnes</code> <code>@pátek</code> <code>@2026-09-20</code>
            </p>
            <div className="capture-actions">
              <span className="hint">
                <kbd>Ctrl</kbd>+<kbd>Enter</kbd> a přidat další
              </span>
              <button
                type="submit"
                className="btn primary"
                disabled={!draft.title || saving}
              >
                {saving ? 'Ukládám…' : 'Přidat úkol'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: Project[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  if (!projects.length) return null;
  return (
    <select
      className="mini-select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Projekt"
    >
      <option value="">Doručené</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
