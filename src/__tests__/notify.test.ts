import { beforeEach, describe, expect, it, vi } from 'vitest';

import { inQuietHours, isEventEnabled, notifyEvent, nowHHMM } from '../lib/notify';
import type { CatalogueGroup, NotifyContext } from '../lib/notify';
import type { Settings } from '../lib/planner-types';

// `notifyEvent` reaches the OS through `api.notify`; stub it so the tests
// observe the decision rather than the platform.
const osNotify = vi.hoisted(() => vi.fn<(title: string, body: string) => Promise<boolean>>());
vi.mock('../lib/api', () => ({ notify: osNotify }));

const CATALOGUE: CatalogueGroup[] = [
  {
    category: 'tasks',
    label: 'Úkoly',
    description: '',
    events: [
      {
        id: 'task.created',
        category: 'tasks',
        label: 'Vytvoření úkolu',
        description: '',
        default_on: false,
      },
      {
        id: 'task.completed',
        category: 'tasks',
        label: 'Dokončení úkolu',
        description: '',
        default_on: false,
      },
    ],
  },
  {
    category: 'focus',
    label: 'Soustředění',
    description: '',
    events: [
      {
        id: 'focus.finished',
        category: 'focus',
        label: 'Konec odpočtu',
        description: '',
        default_on: true,
      },
    ],
  },
];

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    notifications_enabled: true,
    quiet_hours: '',
    notification_events: {
      'task.created': false,
      'task.completed': true,
      'focus.finished': true,
    },
    ...overrides,
  } as Settings;
}

function context(s: Settings | null): NotifyContext & { toasts: string[] } {
  const toasts: string[] = [];
  return {
    settings: s,
    catalogue: CATALOGUE,
    toast: (_kind, message) => toasts.push(message),
    toasts,
  };
}

beforeEach(() => {
  osNotify.mockReset();
  osNotify.mockResolvedValue(true);
});

describe('nowHHMM', () => {
  it('zero-pads to a comparable clock time', () => {
    expect(nowHHMM(new Date(2026, 8, 7, 9, 5))).toBe('09:05');
    expect(nowHHMM(new Date(2026, 8, 7, 23, 59))).toBe('23:59');
    expect(nowHHMM(new Date(2026, 8, 7, 0, 0))).toBe('00:00');
  });
});

describe('inQuietHours', () => {
  it('handles a window that wraps over midnight', () => {
    expect(inQuietHours('22:00-07:00', '23:30')).toBe(true);
    expect(inQuietHours('22:00-07:00', '02:00')).toBe(true);
    expect(inQuietHours('22:00-07:00', '12:00')).toBe(false);
  });

  it('is inclusive at the start and exclusive at the end', () => {
    expect(inQuietHours('22:00-07:00', '22:00')).toBe(true);
    expect(inQuietHours('22:00-07:00', '07:00')).toBe(false);
  });

  it('handles a plain daytime window', () => {
    expect(inQuietHours('09:00-17:00', '12:00')).toBe(true);
    expect(inQuietHours('09:00-17:00', '08:59')).toBe(false);
    expect(inQuietHours('09:00-17:00', '17:00')).toBe(false);
  });

  it('treats an empty or malformed window as "never quiet"', () => {
    expect(inQuietHours('', '03:00')).toBe(false);
    expect(inQuietHours('22-7', '03:00')).toBe(false);
    expect(inQuietHours('22:00', '03:00')).toBe(false);
    expect(inQuietHours('22:00-22:00', '22:00')).toBe(false);
  });

  it('agrees with the Rust implementation on the edge cases', () => {
    // These are the exact cases asserted in settings.rs, kept in step.
    expect(inQuietHours('22:00-07:00', '22:00')).toBe(true);
    expect(inQuietHours('22:00-07:00', '07:00')).toBe(false);
    expect(inQuietHours('09:00-17:00', '18:00')).toBe(false);
  });
});

describe('isEventEnabled', () => {
  it('follows the individual switch', () => {
    const s = settings();
    expect(isEventEnabled(s, 'task.completed', CATALOGUE, '12:00')).toBe(true);
    expect(isEventEnabled(s, 'task.created', CATALOGUE, '12:00')).toBe(false);
  });

  it('is silenced entirely by the master switch', () => {
    const s = settings({ notifications_enabled: false });
    expect(isEventEnabled(s, 'task.completed', CATALOGUE, '12:00')).toBe(false);
    expect(isEventEnabled(s, 'focus.finished', CATALOGUE, '12:00')).toBe(false);
  });

  it('is silenced inside quiet hours', () => {
    const s = settings({ quiet_hours: '22:00-07:00' });
    expect(isEventEnabled(s, 'task.completed', CATALOGUE, '23:00')).toBe(false);
    expect(isEventEnabled(s, 'task.completed', CATALOGUE, '12:00')).toBe(true);
  });

  it('falls back to the catalogue default for an unseen event', () => {
    // What an older saved settings blob looks like after an update.
    const s = settings({ notification_events: {} });
    expect(isEventEnabled(s, 'focus.finished', CATALOGUE, '12:00')).toBe(true);
    expect(isEventEnabled(s, 'task.created', CATALOGUE, '12:00')).toBe(false);
  });

  it('is off while the settings have not loaded', () => {
    expect(isEventEnabled(null, 'focus.finished', CATALOGUE, '12:00')).toBe(false);
  });
});

describe('notifyEvent', () => {
  it('sends an enabled event to the OS', async () => {
    const ctx = context(settings());
    const outcome = await notifyEvent(ctx, 'task.completed', 'Hotovo', 'Úkol dokončen.');
    expect(outcome).toBe('sent');
    expect(osNotify).toHaveBeenCalledWith('Hotovo', 'Úkol dokončen.');
    expect(ctx.toasts).toEqual([]);
  });

  it('does nothing at all for a disabled event', async () => {
    const ctx = context(settings());
    const outcome = await notifyEvent(ctx, 'task.created', 'Nový', 'Úkol přidán.');
    expect(outcome).toBe('disabled');
    expect(osNotify).not.toHaveBeenCalled();
    expect(ctx.toasts).toEqual([]);
  });

  it('falls back to an in-app message when the OS cannot deliver', async () => {
    // Switched on, but Windows refuses. Dropping it would lose something the
    // user explicitly asked for.
    osNotify.mockResolvedValue(false);
    const ctx = context(settings());
    const outcome = await notifyEvent(ctx, 'task.completed', 'Hotovo', 'Úkol dokončen.');
    expect(outcome).toBe('in_app');
    expect(ctx.toasts).toEqual(['Hotovo: Úkol dokončen.']);
  });

  it('does not fall back for something that was switched off', async () => {
    osNotify.mockResolvedValue(false);
    const ctx = context(settings());
    await notifyEvent(ctx, 'task.created', 'Nový', 'Úkol přidán.');
    expect(ctx.toasts).toEqual([]);
  });

  it('stays quiet during quiet hours even for an enabled event', async () => {
    const ctx = context(settings({ quiet_hours: '00:00-23:59' }));
    const outcome = await notifyEvent(ctx, 'focus.finished', 'Konec', 'Čas vypršel.');
    expect(outcome).toBe('disabled');
    expect(osNotify).not.toHaveBeenCalled();
  });

  it('sends nothing before the settings have loaded', async () => {
    const ctx = context(null);
    expect(await notifyEvent(ctx, 'focus.finished', 'x', 'y')).toBe('disabled');
    expect(osNotify).not.toHaveBeenCalled();
  });
});
