/**
 * Focus mode: one task, one timer, nothing else on screen.
 *
 * The timer is driven by wall-clock comparison rather than by counting
 * intervals, because a browser throttles background timers and an interval
 * that ticks 300 times in 25 minutes is not a 25-minute timer.
 */

import { useEffect, useRef, useState } from 'react';

import { ensureNotifications, resetNotificationSupport } from '../lib/api';
import type { NotificationSupport } from '../lib/api';
import { useStore } from '../state/store';
import { CloseIcon, PauseIcon, PlayIcon } from './Icons';

const PRESETS = [10, 25, 45];

export function FocusView() {
  const {
    focus,
    tasks,
    pauseFocus,
    resumeFocus,
    stopFocus,
    tickFocus,
    startFocus,
    setStatus,
    dismissFocusAlert,
  } = useStore();

  const [support, setSupport] = useState<NotificationSupport | null>(null);
  const lastTick = useRef<number>(Date.now());

  useEffect(() => {
    if (focus) void ensureNotifications().then(setSupport);
  }, [focus]);

  useEffect(() => {
    if (!focus?.running) return;
    lastTick.current = Date.now();
    const id = window.setInterval(() => {
      // Catch up on any seconds the interval was throttled out of.
      const now = Date.now();
      const elapsed = Math.floor((now - lastTick.current) / 1000);
      if (elapsed <= 0) return;
      lastTick.current += elapsed * 1000;
      for (let i = 0; i < elapsed; i += 1) tickFocus();
    }, 500);
    return () => window.clearInterval(id);
  }, [focus?.running, focus?.taskId, tickFocus]);

  if (!focus) return null;

  const task = tasks.find((t) => t.id === focus.taskId);
  const done = focus.remaining <= 0;
  const progress = 1 - focus.remaining / focus.duration;

  return (
    <div className="focus-backdrop" role="dialog" aria-modal="true" aria-label="Soustředěná práce">
      <div className="focus">
        <button type="button" className="icon-btn focus-close" onClick={stopFocus} aria-label="Ukončit soustředění">
          <CloseIcon size={18} />
        </button>

        <p className="focus-eyebrow">Soustředíte se na</p>
        <h1 className="focus-title">{task?.title ?? 'Tento úkol'}</h1>
        {task?.notes ? <p className="focus-notes">{task.notes}</p> : null}

        <div className="focus-ring" role="timer" aria-live="off">
          <svg viewBox="0 0 200 200" width="220" height="220" aria-hidden="true">
            <circle cx="100" cy="100" r="88" className="ring-track" />
            <circle
              cx="100"
              cy="100"
              r="88"
              className={`ring-fill${done ? ' done' : ''}`}
              style={{
                strokeDasharray: 2 * Math.PI * 88,
                strokeDashoffset: 2 * Math.PI * 88 * (1 - Math.min(1, Math.max(0, progress))),
              }}
            />
          </svg>
          <span className="focus-clock">{formatClock(focus.remaining)}</span>
        </div>

        {done ? (
          <p className="focus-done">Čas vypršel.</p>
        ) : (
          <div className="focus-presets">
            {PRESETS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`btn subtle${focus.duration === minutes * 60 ? ' on' : ''}`}
                onClick={() => void startFocus(focus.taskId, minutes)}
              >
                {minutes} min
              </button>
            ))}
          </div>
        )}

        <div className="focus-actions">
          {!done ? (
            focus.running ? (
              <button type="button" className="btn" onClick={pauseFocus}>
                <PauseIcon size={16} />
                Pauza
              </button>
            ) : (
              <button type="button" className="btn" onClick={resumeFocus}>
                <PlayIcon size={16} />
                Pokračovat
              </button>
            )
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => void startFocus(focus.taskId, focus.duration / 60)}
            >
              <PlayIcon size={16} />
              Znovu
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={() => void setStatus(focus.taskId, 'completed')}
          >
            Označit jako hotové
          </button>
        </div>

        {/* The desktop notification is a nicety, not a requirement. Say so
            plainly rather than letting the session end in silence. */}
        {focus.finishedInApp ? (
          <div className="focus-alert" role="alert">
            <strong>Soustředění skončilo.</strong> Notes_MJ nemohlo zobrazit systémové oznámení,
            tak alespoň takhle.
            <button type="button" className="link" onClick={dismissFocusAlert}>
              Rozumím
            </button>
          </div>
        ) : support === 'denied' ? (
          <p className="focus-permission">
            Oznámení jsou vypnutá, takže vám konec času oznámíme rovnou tady.
            <button
              type="button"
              className="link"
              onClick={() => {
                resetNotificationSupport();
                void ensureNotifications().then(setSupport);
              }}
            >
              Zeptat se znovu
            </button>
          </p>
        ) : support === 'unavailable' ? (
          <p className="focus-permission">
            Systémová oznámení tu nejsou k dispozici. Notes_MJ vám dá vědět tady v okně.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
