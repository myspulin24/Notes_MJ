/**
 * The notebook.
 *
 * A list of notes on the left, the open one on the right. No status, no dates,
 * nothing to tick off — it is deliberately not a task list. Notes save on blur
 * the same way the task inspector does.
 */

import { useCallback, useEffect, useState } from 'react';

import { plannerApi, toAppError } from '../lib/api';
import { noteMenu } from '../lib/menus';
import type { NoteActions } from '../lib/menus';
import { useMenu } from '../lib/useMenu';
import { formatTimestamp } from '../lib/dates';
import type { NoteDetail } from '../lib/planner-types';
import type { AppError } from '../lib/types';
import { useStore } from '../state/store';
import { CloseIcon, NoteIcon, PinIcon, PlusIcon, SearchIcon, TrashIcon } from './Icons';
import { EmptyState, ErrorState, LoadingState } from './States';

export function NotesView() {
  const { settings, toast, reportError, bumpPlanner, notify } = useStore();

  const [notes, setNotes] = useState<NoteDetail[]>([]);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);

  // Local copies of the open note, so typing does not fight the list refresh.
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tagText, setTagText] = useState('');
  const menu = useMenu(async () => {
    await load(search);
  });

  const load = useCallback(
    async (query: string) => {
      setError(null);
      try {
        const list = await plannerApi.listNotes(query || undefined);
        setNotes(list);
        return list;
      } catch (e) {
        setError(toAppError(e));
        return [];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const id = setTimeout(() => void load(search), 180);
    return () => clearTimeout(id);
  }, [search, load]);

  const open = (note: NoteDetail) => {
    setOpenId(note.id);
    setTitle(note.title);
    setBody(note.body);
    setTagText(note.tags.map((t) => t.name).join(', '));
  };

  const openNote = notes.find((n) => n.id === openId) ?? null;

  const save = async (patch: Parameters<typeof plannerApi.updateNote>[1]) => {
    if (!openId) return;
    try {
      const updated = await plannerApi.updateNote(openId, patch);
      setNotes((list) => list.map((n) => (n.id === openId ? updated : n)));
      bumpPlanner();
    } catch (e) {
      reportError(e, 'Poznámku se nepodařilo uložit');
      await load(search);
    }
  };

  const create = async () => {
    try {
      const note = await plannerApi.createNote('Nová poznámka', '');
      await load(search);
      open(note);
      bumpPlanner();
      void notify('note.created', 'Nová poznámka', note.title);
    } catch (e) {
      reportError(e, 'Poznámku se nepodařilo vytvořit');
    }
  };

  /** Deleting a note, from the button or from the right-click menu. */
  const removeNote = async (note: NoteDetail) => {
    try {
      await plannerApi.deleteNote(note.id);
      setOpenId((current) => (current === note.id ? null : current));
      await load(search);
      bumpPlanner();
      void notify('note.deleted', 'Poznámka smazána', note.title);
      toast('success', `Poznámka „${note.title}“ smazána.`, {
        label: 'Zpět',
        run: () => void useStore.getState().undo().then(() => load(search)),
      });
    } catch (e) {
      reportError(e, 'Poznámku se nepodařilo smazat');
    }
  };

  const noteActions: NoteActions = {
    open,
    togglePin: async (note) => {
      try {
        const updated = await plannerApi.updateNote(note.id, { pinned: !note.pinned });
        setNotes((list) => list.map((n) => (n.id === note.id ? updated : n)));
        bumpPlanner();
      } catch (e) {
        reportError(e, 'Poznámku se nepodařilo upravit');
      }
    },
    remove: removeNote,
  };

  if (loading && !notes.length && !search) {
    return <LoadingState label="Načítám zápisník" />;
  }

  return (
    <div className="notes-pane">
      <div className="notes-list">
        <header className="notes-head">
          <div className="searchbar-input small">
            <SearchIcon size={15} />
            <input
              value={search}
              maxLength={200}
              placeholder="Hledat v poznámkách"
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Hledat v poznámkách"
            />
            {search ? (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSearch('')}
                aria-label="Vymazat hledání"
              >
                <CloseIcon size={14} />
              </button>
            ) : null}
          </div>
          <button type="button" className="btn primary" onClick={() => void create()}>
            <PlusIcon size={15} />
            Nová
          </button>
        </header>

        {error ? (
          <ErrorState error={error} onRetry={() => void load(search)} />
        ) : notes.length === 0 ? (
          <EmptyState
            icon={<NoteIcon size={30} />}
            title={search ? 'Nic nenalezeno' : 'Zápisník je prázdný'}
            hint={
              search
                ? 'Zkuste jiné slovo. Hledá se v nadpisu i v textu.'
                : 'Sem patří všechno, co není úkol: nápady, seznamy, poznámky z hovoru.'
            }
            action={
              search ? undefined : (
                <button type="button" className="btn primary" onClick={() => void create()}>
                  <PlusIcon size={15} />
                  První poznámka
                </button>
              )
            }
          />
        ) : (
          <ul className="note-cards">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className={`note-card${note.id === openId ? ' selected' : ''}${
                    note.pinned ? ' pinned' : ''
                  }`}
                  onClick={() => open(note)}
                  onContextMenu={(e) => menu.open(e, noteMenu(note, menu.ctx, noteActions))}
                >
                  <span className="note-card-title">
                    {note.pinned ? <PinIcon size={12} /> : null}
                    {note.title}
                  </span>
                  {note.body ? (
                    <span className="note-card-body">{preview(note.body)}</span>
                  ) : null}
                  <span className="note-card-meta">
                    {note.tags.map((t) => (
                      <span key={t.id} className="chip chip-tag" style={{ borderColor: t.color }}>
                        {t.name}
                      </span>
                    ))}
                    <span className="muted">{formatTimestamp(note.updated_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* -- the open note --------------------------------------------------- */}
      {openNote ? (
        <section className="note-editor">
          <header>
            <input
              className="title-input"
              value={title}
              maxLength={500}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim() && title !== openNote.title) void save({ title });
                else setTitle(openNote.title);
              }}
              aria-label="Nadpis poznámky"
            />
            <button
              type="button"
              className={`icon-btn${openNote.pinned ? ' on' : ''}`}
              title={openNote.pinned ? 'Odepnout' : 'Připnout nahoru'}
              aria-pressed={openNote.pinned}
              onClick={() => void save({ pinned: !openNote.pinned })}
            >
              <PinIcon size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Zavřít"
              onClick={() => setOpenId(null)}
            >
              <CloseIcon size={16} />
            </button>
          </header>

          <textarea
            className="note-body"
            value={body}
            placeholder="Pište, co potřebujete…"
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => {
              if (body !== openNote.body) void save({ body });
            }}
            aria-label="Text poznámky"
          />

          <div className="note-foot">
            <label className="field-row">
              <span className="muted small">Štítky</span>
              <input
                value={tagText}
                placeholder="nápady, dovolená"
                onChange={(e) => setTagText(e.target.value)}
                onBlur={() => {
                  const names = tagText
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean);
                  const current = openNote.tags.map((t) => t.name);
                  if (names.join(' ') !== current.join(' ')) void save({ tag_names: names });
                }}
                aria-label="Štítky oddělené čárkami"
              />
            </label>

            <div className="note-actions">
              <span className="muted small">
                Upraveno {formatTimestamp(openNote.updated_at)}
              </span>
              <button
                type="button"
                className="btn danger small"
                onClick={() => {
                  if (
                    settings?.confirm_delete !== false &&
                    !window.confirm(`Smazat poznámku „${openNote.title}“?`)
                  ) {
                    return;
                  }
                  void removeNote(openNote);
                }}
              >
                <TrashIcon size={14} />
                Smazat
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="note-editor empty">
          <EmptyState
            icon={<NoteIcon size={30} />}
            title="Vyberte poznámku"
            hint="Nebo si vlevo založte novou."
          />
        </section>
      )}
    </div>
  );
}

function preview(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
