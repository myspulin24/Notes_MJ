/**
 * The app's own right-click menu.
 *
 * Renders whatever `store.contextMenu` holds. Keyboard-navigable, closes on
 * Escape, on a click elsewhere, on scroll and on window blur — a menu that
 * survives the thing it was opened on is worse than no menu.
 *
 * Positioning is measured after the first paint: the height depends on how
 * many items there are, and guessing it wrong puts the menu half off screen.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { moveSelection, placeMenu, tidyItems } from '../lib/contextmenu';
import { useStore } from '../state/store';

export function ContextMenu() {
  const { contextMenu, closeContextMenu } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const items = contextMenu ? tidyItems(contextMenu.items) : [];

  // Measure, then place. Rendering off screen first avoids a visible jump.
  useLayoutEffect(() => {
    if (!contextMenu || !ref.current) {
      setPosition(null);
      return;
    }
    const box = ref.current.getBoundingClientRect();
    setPosition(
      placeMenu(
        contextMenu.x,
        contextMenu.y,
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    setActive(null);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeContextMenu();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((current) => moveSelection(items, current, event.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (event.key === 'Enter' && active !== null) {
        event.preventDefault();
        const item = items[active];
        if (item?.kind === 'action' && !item.disabled) {
          closeContextMenu();
          void item.run();
        }
      }
    };

    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) closeContextMenu();
    };

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('blur', closeContextMenu);
    // `true` catches scrolling inside panes, not just on the window.
    window.addEventListener('scroll', closeContextMenu, true);
    window.addEventListener('resize', closeContextMenu);

    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('blur', closeContextMenu);
      window.removeEventListener('scroll', closeContextMenu, true);
      window.removeEventListener('resize', closeContextMenu);
    };
  }, [contextMenu, items, active, closeContextMenu]);

  if (!contextMenu || items.length === 0) return null;

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="Místní nabídka"
      style={
        position
          ? { left: position.x, top: position.y }
          : // Not measured yet: render out of sight rather than at 0,0.
            { left: -9999, top: -9999 }
      }
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <div key={`sep-${index}`} className="ctx-separator" role="separator" />;
        }
        if (item.kind === 'header') {
          return (
            <div key={`head-${index}`} className="ctx-header" title={item.label}>
              {item.label}
            </div>
          );
        }
        return (
          <button
            key={`${item.label}-${index}`}
            type="button"
            role="menuitem"
            className={`ctx-item${item.danger ? ' danger' : ''}${
              index === active ? ' active' : ''
            }`}
            disabled={item.disabled}
            onMouseEnter={() => setActive(index)}
            onClick={() => {
              closeContextMenu();
              void item.run();
            }}
          >
            <span className="ctx-label">{item.label}</span>
            {item.shortcut ? <span className="ctx-shortcut">{item.shortcut}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
