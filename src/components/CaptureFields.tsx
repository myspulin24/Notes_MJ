/**
 * The click-anything half of quick capture.
 *
 * Typing `#štítek !2 @pátek` is the fast path and stays exactly as it was, but
 * nobody should have to know that syntax to set a priority. These rows offer
 * the same three things - when, how urgent, which labels - as buttons.
 *
 * The two halves have to agree, which is the only subtle part: what is typed
 * is parsed continuously, what is clicked is held here, and a click wins.
 * `undefined` therefore means "not decided by clicking", which is different
 * from `null`, meaning "deliberately cleared".
 */

import { addDays, nextWeekday, relativeDateLabel } from '../lib/dates';
import type { Tag } from '../lib/types';
import { CloseIcon } from './Icons';
import { TagPicker } from './TagPicker';

/** Priority as the inspector words it, so the two never disagree. */
const PRIORITIES: { value: number; label: string }[] = [
  { value: 1, label: 'Nízká' },
  { value: 2, label: 'Střední' },
  { value: 3, label: 'Vysoká' },
];

export interface CapturePicks {
  /** `undefined` = whatever was typed; `null` = explicitly no date. */
  startOn?: string | null;
  priority?: number;
  tags: string[];
}

export const NO_PICKS: CapturePicks = { tags: [] };

export function CaptureFields({
  today,
  tags,
  picks,
  onChange,
  /** What the typed text resolved to, so the buttons can show it as chosen. */
  typed,
}: {
  today: string;
  tags: Tag[];
  picks: CapturePicks;
  onChange: (picks: CapturePicks) => void;
  typed: { startOn: string | null; priority: number; tags: string[] };
}) {
  const startOn = picks.startOn !== undefined ? picks.startOn : typed.startOn;
  const priority = picks.priority ?? typed.priority;
  const chosenTags = [...new Set([...typed.tags, ...picks.tags])];

  const setStart = (value: string | null) =>
    // Clicking the day that is already set clears it, so one button does both.
    onChange({ ...picks, startOn: startOn === value ? null : value });

  const setPriority = (value: number) =>
    onChange({ ...picks, priority: priority === value ? 0 : value });

  const toggleTag = (name: string) => {
    const lower = name.toLowerCase();
    if (chosenTags.includes(lower)) {
      // Only what was clicked can be un-clicked; a typed #tag is removed by
      // deleting it from the line, where the user can see it.
      onChange({ ...picks, tags: picks.tags.filter((t) => t !== lower) });
    } else {
      onChange({ ...picks, tags: [...picks.tags, lower] });
    }
  };

  return (
    <div className="capture-fields">
      <div className="capture-row">
        <span className="capture-row-label">Kdy</span>
        <div className="seg">
          <Seg on={startOn === today} onClick={() => setStart(today)}>
            Dnes
          </Seg>
          <Seg on={startOn === addDays(today, 1)} onClick={() => setStart(addDays(today, 1))}>
            Zítra
          </Seg>
          <Seg
            on={startOn === nextWeekday(today, 0)}
            onClick={() => setStart(nextWeekday(today, 0))}
          >
            Pondělí
          </Seg>
        </div>
        <input
          type="date"
          className="capture-date"
          value={startOn ?? ''}
          onChange={(e) => onChange({ ...picks, startOn: e.target.value || null })}
          aria-label="Jiné datum"
        />
        {startOn ? (
          <span className="capture-chosen">
            {relativeDateLabel(startOn, today)}
            <button
              type="button"
              className="capture-clear"
              aria-label="Zrušit datum"
              onClick={() => onChange({ ...picks, startOn: null })}
            >
              <CloseIcon size={11} />
            </button>
          </span>
        ) : null}
      </div>

      <div className="capture-row">
        <span className="capture-row-label">Priorita</span>
        <div className="seg">
          {PRIORITIES.map((p) => (
            <Seg
              key={p.value}
              on={priority === p.value}
              tone={`prio-${p.value}`}
              onClick={() => setPriority(p.value)}
            >
              {p.label}
            </Seg>
          ))}
        </div>
      </div>

      {tags.length ? (
        <div className="capture-row">
          <span className="capture-row-label">Štítky</span>
          <TagPicker all={tags} chosen={chosenTags} onToggle={toggleTag} limit={8} />
        </div>
      ) : null}
    </div>
  );
}

function Seg({
  on,
  tone,
  onClick,
  children,
}: {
  on: boolean;
  tone?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`seg-btn${on ? ' on' : ''}${tone ? ` ${tone}` : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
