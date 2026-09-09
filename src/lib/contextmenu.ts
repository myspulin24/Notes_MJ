/**
 * The right-click menu.
 *
 * WebView2 ships its own context menu — in English, offering Reload, Print and
 * Inspect, none of which mean anything in a task list. This module replaces it
 * with the app's own Czech menu, built per item.
 *
 * The building blocks are here (pure data and geometry) so they can be tested
 * without a DOM; the rendering lives in `components/ContextMenu.tsx`.
 */

export type MenuItem =
  | {
      kind: 'action';
      label: string;
      /** Shown greyed on the right, e.g. `Del`. Purely informative. */
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      run: () => void | Promise<void>;
    }
  | { kind: 'separator' }
  /** A non-clickable caption, used to say what the menu is acting on. */
  | { kind: 'header'; label: string };

export interface MenuRequest {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Drops separators that would render at the edges or next to each other. */
export function tidyItems(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const item of items) {
    if (item.kind === 'separator') {
      const previous = out[out.length - 1];
      if (!previous || previous.kind === 'separator' || previous.kind === 'header') continue;
    }
    out.push(item);
  }
  while (out.length && out[out.length - 1].kind === 'separator') out.pop();
  return out;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

/**
 * Keeps the menu on screen.
 *
 * Flips to the other side of the cursor when it would overflow, and only
 * clamps as a last resort — flipping keeps the pointer outside the menu, so
 * the click that opened it cannot land on an item.
 */
export function placeMenu(
  x: number,
  y: number,
  size: MenuSize,
  viewport: Viewport,
  margin = 8,
): { x: number; y: number } {
  let left = x;
  let top = y;

  if (left + size.width + margin > viewport.width) {
    left = x - size.width;
  }
  if (top + size.height + margin > viewport.height) {
    top = y - size.height;
  }

  left = Math.max(margin, Math.min(left, viewport.width - size.width - margin));
  top = Math.max(margin, Math.min(top, viewport.height - size.height - margin));

  // A menu taller than the window still has to start somewhere sensible.
  if (size.height + margin * 2 > viewport.height) top = margin;
  if (size.width + margin * 2 > viewport.width) left = margin;

  return { x: Math.round(left), y: Math.round(top) };
}

/** Indices of the items a keyboard can land on. */
export function selectableIndexes(items: MenuItem[]): number[] {
  return items
    .map((item, index) => (item.kind === 'action' && !item.disabled ? index : -1))
    .filter((index) => index >= 0);
}

/** The next selectable index in `direction`, wrapping at both ends. */
export function moveSelection(
  items: MenuItem[],
  current: number | null,
  direction: 1 | -1,
): number | null {
  const usable = selectableIndexes(items);
  if (!usable.length) return null;
  if (current === null) return direction === 1 ? usable[0] : usable[usable.length - 1];

  const position = usable.indexOf(current);
  if (position === -1) return direction === 1 ? usable[0] : usable[usable.length - 1];
  return usable[(position + direction + usable.length) % usable.length];
}

// -- text fields --------------------------------------------------------------

/** What a right-click inside an editable field can offer. */
export interface EditableState {
  /** Some text is selected, so cut and copy make sense. */
  hasSelection: boolean;
  /** The field can be typed into, so cut and paste make sense. */
  editable: boolean;
  /** There is something to select. */
  hasContent: boolean;
}

/**
 * Reads what a right-click landed on.
 *
 * Returns `null` when the target is not a text field, which is the signal to
 * fall back to the item menu.
 */
export function readEditable(target: EventTarget | null): EditableState | null {
  const element = target as HTMLElement | null;
  if (!element) return null;

  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    // Checkboxes and date pickers have no text to cut or paste.
    const textual =
      tag === 'TEXTAREA' ||
      ['text', 'search', 'url', 'email', 'tel', 'password', 'number', ''].includes(
        (field as HTMLInputElement).type ?? '',
      );
    if (!textual) return null;

    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    return {
      hasSelection: end > start,
      editable: !field.readOnly && !field.disabled,
      hasContent: (field.value ?? '').length > 0,
    };
  }

  if (element.isContentEditable) {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    return {
      hasSelection: !!selection && !selection.isCollapsed,
      editable: true,
      hasContent: (element.textContent ?? '').length > 0,
    };
  }

  return null;
}

/** The current selection inside a field, or `''`. */
export function selectedText(field: HTMLInputElement | HTMLTextAreaElement): string {
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? 0;
  return field.value.slice(start, end);
}

/**
 * Replaces the selection with `text` and reports the new value.
 *
 * Returns the value and where the caret should end up, so the caller can apply
 * both and fire the React change event in one place.
 */
export function spliceSelection(
  value: string,
  start: number,
  end: number,
  text: string,
): { value: string; caret: number } {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  return {
    value: value.slice(0, from) + text + value.slice(to),
    caret: from + text.length,
  };
}
