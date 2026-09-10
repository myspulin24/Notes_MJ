/**
 * The tags that already exist, as chips you press.
 *
 * Typing a comma-separated list still works and is still the way to invent a
 * new tag, but picking from what is already there should not require
 * remembering how you spelled it last time.
 */

import type { Tag } from '../lib/types';

export function TagPicker({
  all,
  chosen,
  onToggle,
  /** Shown before the list opens; the rest hide behind a "+N" button. */
  limit = 10,
}: {
  all: Tag[];
  chosen: string[];
  onToggle: (name: string) => void;
  limit?: number;
}) {
  if (!all.length) return null;

  const lower = chosen.map((c) => c.toLowerCase());
  // Chosen tags first, so what is on this task is never hidden behind "+N".
  const ordered = [...all].sort(
    (a, b) =>
      Number(lower.includes(b.name.toLowerCase())) -
      Number(lower.includes(a.name.toLowerCase())),
  );
  const visible = ordered.slice(0, limit);

  return (
    <div className="tag-picker">
      {visible.map((tag) => {
        const on = lower.includes(tag.name.toLowerCase());
        return (
          <button
            key={tag.id}
            type="button"
            className={`chip chip-tag pick${on ? ' on' : ''}`}
            style={on ? { borderColor: tag.color, color: tag.color } : undefined}
            aria-pressed={on}
            onClick={() => onToggle(tag.name)}
          >
            {tag.name}
          </button>
        );
      })}
      {ordered.length > visible.length ? (
        <span className="muted small">+{ordered.length - visible.length} dalších</span>
      ) : null}
    </div>
  );
}
