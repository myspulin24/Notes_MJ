/**
 * The strip of tabs across the top of the window.
 *
 * The lit tab comes from the route, so this component holds no state of its
 * own beyond where to draw the underline. It measures the active tab and moves
 * a single sliding bar rather than toggling a border on each one, because a
 * bar that travels is what tells you *which way* you just went.
 */

import { useLayoutEffect, useRef, useState } from 'react';

import { SECTIONS, homeRouteOf } from '../lib/sections';
import type { Section } from '../lib/sections';
import { useStore } from '../state/store';
import { CalendarIcon, GiftIcon, NoteIcon, SettingsIcon } from './Icons';

const ICONS: Record<Section, JSX.Element> = {
  planner: <CalendarIcon size={15} />,
  notes: <NoteIcon size={15} />,
  occasions: <GiftIcon size={15} />,
};

export function SectionTabs({
  active,
  onOpenSettings,
}: {
  active: Section;
  onOpenSettings: () => void;
}) {
  const navigate = useStore((s) => s.navigate);
  const settings = useStore((s) => s.settings);
  const showHints = settings?.show_keyboard_hints ?? true;

  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);

  // Measure after paint: the tabs are text, so their widths depend on the font
  // size setting and cannot be worked out ahead of time.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const current = list.querySelector<HTMLElement>('[data-active="true"]');
      if (!current) return setBar(null);
      setBar({ left: current.offsetLeft, width: current.offsetWidth });
    };

    measure();
    // Font-size and density changes resize the tabs under us.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [active, settings?.font_scale, settings?.density]);

  return (
    <header className="section-bar">
      <div className="section-tabs" ref={listRef} role="tablist" aria-label="Části aplikace">
        {SECTIONS.map((section) => {
          const isActive = section.id === active;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-active={isActive}
              className="section-tab"
              title={`${section.hint} (${section.shortcut})`}
              onClick={() => {
                // Clicking the tab you are already on is a way back to its
                // front page, which is what people expect from a tab bar.
                void navigate(homeRouteOf(section.id, settings?.start_view));
              }}
            >
              <span className="section-tab-icon">{ICONS[section.id]}</span>
              <span className="section-tab-label">{section.label}</span>
              {showHints ? <kbd>{section.shortcut}</kbd> : null}
            </button>
          );
        })}

        {bar ? (
          <span
            className="section-tab-bar"
            aria-hidden="true"
            style={{ transform: `translateX(${bar.left}px)`, width: bar.width }}
          />
        ) : null}
      </div>

      {/*
        Settings used to live at the foot of the sidebar, which only the planner
        shows now. It has to be reachable from every tab, so it moved up here.
      */}
      <button
        type="button"
        className="section-settings"
        onClick={onOpenSettings}
        title="Nastavení a data (?)"
      >
        <SettingsIcon size={16} />
        <span>Nastavení a data</span>
      </button>
    </header>
  );
}
