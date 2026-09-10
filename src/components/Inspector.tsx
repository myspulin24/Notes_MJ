/**
 * The task editor, in a right-hand panel.
 *
 * Edits save on blur rather than behind a Save button: the backend validates
 * every field and returns a message when it refuses, so an invalid value never
 * silently sticks. Only the fields that changed are sent.
 */

import { useEffect, useState } from 'react';

import { api, pickFile, revealInExplorer, toAppError } from '../lib/api';
import { addDays, formatBytes, formatTimestamp, nextWeekday } from '../lib/dates';
import type { AppError, TaskDetail, TaskPatch } from '../lib/types';
import { useStore } from '../state/store';
import {
  CloseIcon,
  PaperclipIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
} from './Icons';
import { RepeatEditor } from './RepeatEditor';
import { TagPicker } from './TagPicker';
import { InlineError, LoadingState } from './States';

export function Inspector({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const {
    today,
    projects,
    areas,
    tags: allTags,
    patchTask,
    removeTask,
    setStatus,
    startFocus,
    reportError,
    refresh,
  } = useStore();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tagText, setTagText] = useState('');
  const [subtaskDraft, setSubtaskDraft] = useState('');

  const load = async () => {
    setError(null);
    try {
      const detail = await api.getTask(taskId);
      setTask(detail);
      setTitle(detail.title);
      setNotes(detail.notes);
      setTagText(detail.tags.map((t) => t.name).join(', '));
    } catch (e) {
      setTask(null);
      setError(toAppError(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const apply = async (patch: TaskPatch) => {
    const updated = await patchTask(taskId, patch);
    if (updated) setTask(updated);
    else await load();
  };

  if (error) {
    return (
      <aside className="inspector">
        <header className="inspector-head">
          <h2>Úkol</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Zavřít">
            <CloseIcon size={16} />
          </button>
        </header>
        <div className="inspector-body">
          <InlineError error={error} onRetry={() => void load()} />
        </div>
      </aside>
    );
  }

  if (!task) {
    return (
      <aside className="inspector">
        <div className="inspector-body">
          <LoadingState label="Otevírám" />
        </div>
      </aside>
    );
  }

  const done = task.status !== 'open';

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <h2>{done ? (task.status === 'canceled' ? 'Zrušený úkol' : 'Dokončený úkol') : 'Úkol'}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Zavřít">
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="inspector-body">
        <input
          className="title-input"
          value={title}
          maxLength={500}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== task.title) void apply({ title });
            else setTitle(task.title);
          }}
          aria-label="Název"
        />

        <textarea
          className="notes-input"
          value={notes}
          rows={5}
          placeholder="Poznámky"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== task.notes) void apply({ notes });
          }}
          aria-label="Poznámky"
        />

        {/* -- when & deadline -------------------------------------------- */}
        <section className="field">
          <h3>Kdy</h3>
          <div className="field-row">
            <input
              type="date"
              value={task.start_on ?? ''}
              onChange={(e) => void apply({ start_on: e.target.value || null })}
              aria-label="Datum zahájení"
            />
            {task.start_on ? (
              <button type="button" className="link" onClick={() => void apply({ start_on: null })}>
                Vymazat
              </button>
            ) : null}
          </div>
          <div className="quick-dates">
            <button type="button" className="btn subtle" onClick={() => void apply({ start_on: today })}>
              Dnes
            </button>
            <button
              type="button"
              className="btn subtle"
              onClick={() => void apply({ start_on: addDays(today, 1) })}
            >
              Zítra
            </button>
            <button
              type="button"
              className="btn subtle"
              onClick={() => void apply({ start_on: nextWeekday(today, 0) })}
            >
              Příští pondělí
            </button>
            <button
              type="button"
              className="btn subtle"
              onClick={() => void apply({ list: 'someday' })}
            >
              Někdy
            </button>
          </div>
        </section>

        <section className="field">
          <h3>Termín</h3>
          <div className="field-row">
            <input
              type="date"
              value={task.due_on ?? ''}
              onChange={(e) => void apply({ due_on: e.target.value || null })}
              aria-label="Termín"
            />
            {task.due_on ? (
              <button type="button" className="link" onClick={() => void apply({ due_on: null })}>
                Vymazat
              </button>
            ) : null}
          </div>
        </section>

        {/* -- filing ------------------------------------------------------ */}
        <section className="field">
          <h3>Zařazení</h3>
          <div className="field-row">
            <select
              value={task.project_id ?? ''}
              onChange={(e) => void apply({ project_id: e.target.value || null })}
              aria-label="Projekt"
            >
              <option value="">Bez projektu</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={task.area_id ?? ''}
              onChange={(e) => void apply({ area_id: e.target.value || null })}
              aria-label="Oblast"
            >
              <option value="">Bez oblasti</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <select
              value={task.list}
              onChange={(e) => void apply({ list: e.target.value as TaskDetail['list'] })}
              aria-label="Seznam"
            >
              <option value="inbox">Doručené</option>
              <option value="anytime">Kdykoli</option>
              <option value="someday">Někdy</option>
            </select>
            <select
              value={task.priority}
              onChange={(e) => void apply({ priority: Number(e.target.value) })}
              aria-label="Priorita"
            >
              <option value={0}>Bez priority</option>
              <option value={1}>Nízká</option>
              <option value={2}>Střední</option>
              <option value={3}>Vysoká</option>
            </select>
          </div>
        </section>

        {/* -- tags -------------------------------------------------------- */}
        <section className="field">
          <h3>Štítky</h3>
          <TagPicker
            all={allTags}
            chosen={task.tags.map((t) => t.name)}
            onToggle={(name) => {
              const current = task.tags.map((t) => t.name);
              const next = current.some((c) => c.toLowerCase() === name.toLowerCase())
                ? current.filter((c) => c.toLowerCase() !== name.toLowerCase())
                : [...current, name];
              // The text field mirrors the task, so it has to follow along.
              setTagText(next.join(', '));
              void apply({ tag_names: next });
            }}
          />
          <input
            value={tagText}
            placeholder="domov, pochůzky"
            onChange={(e) => setTagText(e.target.value)}
            onBlur={() => {
              const names = tagText
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
              const current = task.tags.map((t) => t.name);
              if (names.join('\u0000') !== current.join('\u0000')) {
                void apply({ tag_names: names });
              }
            }}
            aria-label="Štítky oddělené čárkami"
          />
        </section>

        {/* -- repeat ------------------------------------------------------ */}
        <section className="field">
          <h3>Opakování</h3>
          <RepeatEditor
            value={task.recurrence?.rule ?? null}
            startsOn={task.start_on ?? today}
            today={today}
            onChange={(rule) => void apply({ recurrence: rule })}
          />
        </section>

        {/* -- checklist --------------------------------------------------- */}
        <section className="field">
          <h3>Kontrolní seznam</h3>
          <ul className="subtasks">
            {task.subtasks.map((sub) => (
              <li key={sub.id}>
                <button
                  type="button"
                  className={`check small${sub.status !== 'open' ? ' checked' : ''}`}
                  aria-label={
                    sub.status === 'open' ? `Dokončit ${sub.title}` : `Znovu otevřít ${sub.title}`
                  }
                  onClick={() =>
                    void setStatus(sub.id, sub.status === 'open' ? 'completed' : 'open').then(load)
                  }
                >
                  {sub.status !== 'open' ? (
                    <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                      <path
                        d="m3 8.4 3.2 3.2L13 4.8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </button>
                <span className={sub.status !== 'open' ? 'struck' : ''}>{sub.title}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Smazat ${sub.title}`}
                  onClick={async () => {
                    try {
                      await api.deleteTask(sub.id);
                      await load();
                      await refresh();
                    } catch (e) {
                      reportError(e, 'Položku se nepodařilo smazat');
                    }
                  }}
                >
                  <CloseIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="subtask-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const value = subtaskDraft.trim();
              if (!value) return;
              try {
                await api.createTask({ title: value, parent_id: task.id });
                setSubtaskDraft('');
                await load();
                await refresh();
              } catch (err) {
                reportError(err, 'Položku se nepodařilo přidat');
              }
            }}
          >
            <PlusIcon size={14} />
            <input
              value={subtaskDraft}
              maxLength={500}
              placeholder="Přidat krok"
              onChange={(e) => setSubtaskDraft(e.target.value)}
            />
          </form>
        </section>

        {/* -- attachments -------------------------------------------------- */}
        <section className="field">
          <h3>Přílohy</h3>
          <ul className="attachments">
            {task.attachments.map((file) => (
              <li key={file.id}>
                <PaperclipIcon size={14} />
                <button
                  type="button"
                  className="link grow"
                  title="Zobrazit v Průzkumníku"
                  onClick={async () => {
                    try {
                      const path = await api.attachmentPath(file.id);
                      const shown = await revealInExplorer(path);
                      if (!shown) {
                        reportError(
                          {
                            kind: 'unavailable',
                            message: 'Průzkumník souborů tu není k dispozici.',
                          },
                          'Složku se nepodařilo otevřít',
                        );
                      }
                    } catch (e) {
                      reportError(e, 'Soubor se nepodařilo najít');
                    }
                  }}
                >
                  {file.display_name}
                </button>
                <span className="muted">{formatBytes(file.size_bytes)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Odebrat ${file.display_name}`}
                  onClick={async () => {
                    try {
                      await api.removeAttachment(file.id);
                      await load();
                    } catch (e) {
                      reportError(e, 'Soubor se nepodařilo odebrat');
                    }
                  }}
                >
                  <CloseIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn subtle wide"
            onClick={async () => {
              const path = await pickFile({ title: 'Přiložit soubor' });
              if (!path) return;
              try {
                await api.addAttachment(task.id, path);
                await load();
                await refresh();
              } catch (e) {
                reportError(e, 'Soubor se nepodařilo přiložit');
              }
            }}
          >
            <PaperclipIcon size={14} />
            Přiložit soubor
          </button>
          <p className="hint">
            Přílohy se kopírují do složky s daty Notes_MJ, takže zůstanou u úkolu.
          </p>
        </section>

        <section className="field muted small">
          <p>Vytvořeno {formatTimestamp(task.created_at)}</p>
          {task.completed_at ? <p>Dokončeno {formatTimestamp(task.completed_at)}</p> : null}
        </section>
      </div>

      <footer className="inspector-foot">
        {!done ? (
          <button
            type="button"
            className="btn"
            onClick={() => void startFocus(task.id, 25)}
            title="Pracovat jen na tomto úkolu"
          >
            <TargetIcon size={15} />
            Soustředit se
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => void setStatus(task.id, done ? 'open' : 'canceled').then(onClose)}
        >
          {done ? 'Znovu otevřít' : 'Zahodit'}
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={() => void removeTask(task.id).then(onClose)}
        >
          <TrashIcon size={15} />
          Smazat
        </button>
      </footer>
    </aside>
  );
}
