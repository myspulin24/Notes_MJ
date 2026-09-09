/**
 * The one place a notification is decided on and sent.
 *
 * Call sites say *what happened* (`notifyEvent('task.completed', …)`); this
 * file decides whether that turns into anything. Putting the decision here
 * rather than at each call site is what makes the settings page trustworthy:
 * there is exactly one code path a switch can fail to reach.
 *
 * Delivery degrades in two steps. If the OS cannot show a notification, the
 * message becomes an in-app toast; if the event is switched off, nothing
 * happens at all. An event being *off* and delivery *failing* are different
 * things, and only the second one deserves a fallback.
 */

import { notify as sendOsNotification } from './api';
import type { Settings } from './planner-types';

/** Every notification id the app can raise. Mirrors `notifications.rs`. */
export type NotificationEventId =
  | 'task.created'
  | 'task.completed'
  | 'task.reopened'
  | 'task.deleted'
  | 'task.filed'
  | 'task.repeat_rolled'
  | 'project.created'
  | 'project.completed'
  | 'area.created'
  | 'calendar.scheduled'
  | 'calendar.rescheduled'
  | 'calendar.deadline_set'
  | 'calendar.due_today'
  | 'calendar.overdue'
  | 'note.created'
  | 'note.deleted'
  | 'occasion.created'
  | 'occasion.approaching'
  | 'gift.added'
  | 'gift.bought'
  | 'gift.budget_exceeded'
  | 'focus.finished'
  | 'focus.started'
  | 'data.backup_done'
  | 'data.backup_failed'
  | 'data.export_done'
  | 'data.import_done'
  | 'app.update_available'
  | 'app.update_ready'
  | 'app.update_failed';

export interface NotificationEvent {
  id: NotificationEventId;
  category: string;
  label: string;
  description: string;
  default_on: boolean;
}

export interface CatalogueGroup {
  category: string;
  label: string;
  description: string;
  events: NotificationEvent[];
}

/** Local wall-clock time as `HH:MM`, which is what quiet hours compare against. */
export function nowHHMM(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Whether `now` falls inside a `HH:MM-HH:MM` window.
 *
 * A window whose end is before its start wraps over midnight, which is the
 * normal case for "quiet from 22:00 to 07:00". Mirrors `settings::in_quiet_hours`
 * so the UI can grey out a toggle without a round trip.
 */
export function inQuietHours(window: string, now: string): boolean {
  const parts = window.split('-');
  if (parts.length !== 2) return false;
  const [from, to] = parts;
  if (!isHHMM(from) || !isHHMM(to) || !isHHMM(now)) return false;
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

function isHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/**
 * Whether this event would be sent right now.
 *
 * Exported so the settings page can show "právě teď je ticho" without
 * duplicating the rule.
 */
export function isEventEnabled(
  settings: Settings | null,
  id: NotificationEventId,
  catalogue: CatalogueGroup[] = [],
  now = nowHHMM(),
): boolean {
  if (!settings) return false;
  if (!settings.notifications_enabled) return false;
  if (inQuietHours(settings.quiet_hours ?? '', now)) return false;

  const stored = settings.notification_events?.[id];
  if (typeof stored === 'boolean') return stored;

  // An event the saved settings predate falls back to its catalogue default,
  // so a newly added notification is not silently swallowed.
  const known = catalogue.flatMap((g) => g.events).find((e) => e.id === id);
  return known?.default_on ?? false;
}

export interface NotifyContext {
  settings: Settings | null;
  catalogue: CatalogueGroup[];
  /** Shown when the OS cannot deliver, so the message is never simply lost. */
  toast: (kind: 'success' | 'error' | 'info', message: string) => void;
}

export type NotifyOutcome = 'sent' | 'in_app' | 'disabled';

/**
 * Raises one notification. Returns what actually happened, which the tests
 * assert on and the settings page uses for its "vyzkoušet" button.
 */
export async function notifyEvent(
  ctx: NotifyContext,
  id: NotificationEventId,
  title: string,
  body: string,
): Promise<NotifyOutcome> {
  if (!isEventEnabled(ctx.settings, id, ctx.catalogue)) return 'disabled';

  const delivered = await sendOsNotification(title, body);
  if (delivered) return 'sent';

  // The user asked to be told; the OS could not oblige. Say it in the window
  // rather than dropping it.
  ctx.toast('info', `${title}: ${body}`);
  return 'in_app';
}
