/** One row in a list: the checkbox, the title, and the badges that matter. */

import { memo } from 'react';

import { deadlineLabel, deadlineTone, plural, relativeDateLabel } from '../lib/dates';
import type { TaskDetail } from '../lib/types';
import { PaperclipIcon, RepeatIcon } from './Icons';

interface Props {
  task: TaskDetail;
  /** Right-click handler, wired by whichever list is showing the row. */
  onMenu?: (event: React.MouseEvent, task: TaskDetail) => void;
  today: string;
  selected: boolean;
  /** Hide the start-date badge in views that already group by date. */
  hideStartDate?: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
}

const PRIORITY_LABEL = ['', 'nízká', 'střední', 'vysoká'];

function TaskRowInner({
  task,
  today,
  selected,
  hideStartDate,
  onSelect,
  onOpen,
  onToggle,
  onMenu,
}: Props) {
  const done = task.status !== 'open';
  const doneSubtasks = task.subtasks.filter((s) => s.status !== 'open').length;

  return (
    <li
      className={`row${selected ? ' selected' : ''}${done ? ' done' : ''}`}
      onClick={() => onSelect(task.id)}
      onDoubleClick={() => onOpen(task.id)}
      onContextMenu={(e) => {
        onSelect(task.id);
        onMenu?.(e, task);
      }}
      data-task-id={task.id}
    >
      <button
        type="button"
        className={`check${done ? ' checked' : ''}${
          task.status === 'canceled' ? ' canceled' : ''
        }`}
        aria-label={done ? `Znovu otevřít ${task.title}` : `Dokončit ${task.title}`}
        aria-pressed={done}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task.id);
        }}
      >
        {task.status === 'completed' ? (
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="m3 8.4 3.2 3.2L13 4.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : task.status === 'canceled' ? (
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M4 8h8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
      </button>

      <div className="row-body">
        <div className="row-title-line">
          {task.priority > 0 ? (
            <span
              className={`prio prio-${task.priority}`}
              title={`Priorita ${PRIORITY_LABEL[task.priority]}`}
              aria-label={`Priorita ${PRIORITY_LABEL[task.priority]}`}
            />
          ) : null}
          <span className="row-title">{task.title}</span>
          {task.recurrence ? (
            <span className="row-icon" title={task.recurrence.description}>
              <RepeatIcon size={13} />
            </span>
          ) : null}
          {task.attachments.length ? (
            <span
              className="row-icon"
              title={`${task.attachments.length} ${plural(
                task.attachments.length,
                'příloha',
                'přílohy',
                'příloh',
              )}`}
            >
              <PaperclipIcon size={13} />
            </span>
          ) : null}
        </div>

        {task.notes ? <p className="row-notes">{firstLine(task.notes)}</p> : null}

        <div className="row-meta">
          {task.project_name ? (
            <span className="chip chip-project">{task.project_name}</span>
          ) : task.area_name ? (
            <span className="chip chip-area">{task.area_name}</span>
          ) : null}

          {task.subtasks.length ? (
            <span className="chip">
              {doneSubtasks}/{task.subtasks.length}
            </span>
          ) : null}

          {task.tags.map((tag) => (
            <span
              key={tag.id}
              className="chip chip-tag"
              style={{ borderColor: tag.color, color: tag.color }}
            >
              {tag.name}
            </span>
          ))}

          {!hideStartDate && task.start_on && !done ? (
            <span className="chip chip-when">{relativeDateLabel(task.start_on, today)}</span>
          ) : null}

          {task.due_on && !done ? (
            <span className={`chip chip-due tone-${deadlineTone(task.due_on, today)}`}>
              {deadlineLabel(task.due_on, today)}
            </span>
          ) : null}

          {done && task.completed_at ? (
            <span className="chip chip-done">
              {task.status === 'canceled' ? 'Zrušeno' : 'Dokončeno'}{' '}
              {relativeDateLabel(task.completed_at.slice(0, 10), today)}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function firstLine(notes: string): string {
  const line = notes.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.length > 140 ? `${line.slice(0, 140)}…` : line;
}

export const TaskRow = memo(TaskRowInner);
