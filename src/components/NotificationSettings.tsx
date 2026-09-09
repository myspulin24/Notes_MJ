/**
 * "Připomínky a aplikace" — the notification settings page.
 *
 * The list of switches is rendered from the backend catalogue rather than
 * written out here, so a notification added in Rust shows up in this page with
 * no second edit. Categories come from the catalogue too, in its order.
 *
 * The page shows what is *effective*, not just what is stored: if the master
 * switch is off, or Windows has blocked notifications, or you are inside quiet
 * hours, it says so at the top instead of leaving twenty green toggles that do
 * nothing.
 */

import { useEffect, useMemo, useState } from 'react';

import { ensureNotifications, notify as sendOsNotification, resetNotificationSupport } from '../lib/api';
import type { NotificationSupport } from '../lib/api';
import { inQuietHours, nowHHMM } from '../lib/notify';
import type { CatalogueGroup } from '../lib/notify';
import type { Settings } from '../lib/planner-types';
import { useStore } from '../state/store';
import { CheckIcon, CloseIcon } from './Icons';

export function NotificationSettings({
  settings,
  set,
}: {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const { notificationCatalogue, toast } = useStore();
  const [support, setSupport] = useState<NotificationSupport | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void ensureNotifications().then(setSupport);
  }, []);

  const quietNow = useMemo(
    () => inQuietHours(settings.quiet_hours ?? '', nowHHMM()),
    [settings.quiet_hours],
  );

  const events = settings.notification_events ?? {};
  const enabledCount = notificationCatalogue
    .flatMap((g) => g.events)
    .filter((e) => events[e.id] ?? e.default_on).length;
  const totalCount = notificationCatalogue.flatMap((g) => g.events).length;

  const setEvent = (id: string, on: boolean) => {
    set('notification_events', { ...events, [id]: on });
  };

  const setGroup = (group: CatalogueGroup, on: boolean) => {
    const next = { ...events };
    for (const event of group.events) next[event.id] = on;
    set('notification_events', next);
  };

  const setAll = (on: boolean) => {
    const next = { ...events };
    for (const group of notificationCatalogue) {
      for (const event of group.events) next[event.id] = on;
    }
    set('notification_events', next);
  };

  return (
    <>
      {/* -- the master switch and how things actually stand ----------------- */}
      <section className="settings-section">
        <h3>Oznámení celkem</h3>

        <div className="field-block">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.notifications_enabled}
              onChange={(e) => set('notifications_enabled', e.target.checked)}
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-knob" />
            </span>
            <span className="toggle-label">Posílat oznámení</span>
          </label>
          <p className="hint">
            Hlavní vypínač. Když je vypnutý, nepošle se nic bez ohledu na
            nastavení níže.
          </p>
        </div>

        <ul className="status-list">
          <StatusRow
            ok={support === 'ready'}
            label={
              support === 'ready'
                ? 'Windows oznámení povoluje'
                : support === 'denied'
                  ? 'Windows oznámení blokuje'
                  : 'Systémová oznámení nejsou k dispozici'
            }
            hint={
              support === 'ready'
                ? undefined
                : 'Notes_MJ v takovém případě zprávu ukáže přímo v okně.'
            }
            action={
              support !== 'ready' ? (
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
              ) : undefined
            }
          />
          <StatusRow
            ok={settings.notifications_enabled}
            label={
              settings.notifications_enabled
                ? 'Hlavní vypínač je zapnutý'
                : 'Hlavní vypínač je vypnutý'
            }
          />
          <StatusRow
            ok={!quietNow}
            label={
              quietNow
                ? `Právě je tichý režim (${settings.quiet_hours})`
                : settings.quiet_hours
                  ? `Tichý režim ${settings.quiet_hours} — teď neplatí`
                  : 'Tichý režim není nastavený'
            }
          />
          <StatusRow
            ok={enabledCount > 0}
            label={`Zapnuto ${enabledCount} z ${totalCount} jednotlivých oznámení`}
          />
        </ul>

        <div className="button-row">
          <button
            type="button"
            className="btn"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              const delivered = await sendOsNotification(
                'Zkušební oznámení',
                'Takhle bude oznámení z Notes_MJ vypadat.',
              );
              setTesting(false);
              toast(
                delivered ? 'success' : 'info',
                delivered
                  ? 'Zkušební oznámení odesláno.'
                  : 'Systém oznámení nezobrazil — Notes_MJ je bude ukazovat v okně.',
              );
            }}
          >
            {testing ? 'Posílám…' : 'Vyzkoušet oznámení'}
          </button>
        </div>
      </section>

      {/* -- quiet hours ------------------------------------------------------ */}
      <section className="settings-section">
        <h3>Tichý režim</h3>
        <p className="muted">
          V tomto rozmezí se nepošle žádné oznámení. Rozmezí přes půlnoc je
          v pořádku, například 22:00–07:00.
        </p>
        <QuietHours
          value={settings.quiet_hours ?? ''}
          onChange={(v) => set('quiet_hours', v)}
          onInvalid={() => toast('error', 'Zadejte čas ve tvaru 22:00 a 07:00.')}
        />
      </section>

      {/* -- scheduled reminders ---------------------------------------------- */}
      <section className="settings-section">
        <h3>Připomínky</h3>
        <div className="field-block">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.daily_plan_enabled}
              onChange={(e) => set('daily_plan_enabled', e.target.checked)}
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-knob" />
            </span>
            <span className="toggle-label">Ranní přehled dne</span>
          </label>
          <p className="hint">
            Připomínku pošle Notes_MJ v uvedený čas, pokud zrovna běží. Naplánování na
            pozadí i při zavřené aplikaci zatím není.
          </p>
        </div>
        <div className="field-block">
          <span className="field-label">Čas ranního přehledu</span>
          <input
            type="time"
            value={settings.daily_plan_time}
            onChange={(e) => set('daily_plan_time', e.target.value)}
            aria-label="Čas ranního přehledu"
          />
        </div>
        <div className="field-block">
          <span className="field-label">Upozornit na termín dní předem</span>
          <input
            type="number"
            min={0}
            max={60}
            value={settings.deadline_lead_days}
            onChange={(e) => set('deadline_lead_days', clamp(e.target.value, 0, 60))}
            aria-label="Upozornit na termín dní předem"
          />
        </div>
        <div className="field-block">
          <span className="field-label">Události hlásit dní předem</span>
          <input
            type="number"
            min={0}
            max={365}
            value={settings.occasion_lead_days}
            onChange={(e) => set('occasion_lead_days', clamp(e.target.value, 0, 365))}
            aria-label="Události hlásit dní předem"
          />
          <p className="hint">
            Kolik dní dopředu se blížící narozeniny nebo Vánoce ohlásí při
            spuštění a objeví se v Přehledu.
          </p>
        </div>
      </section>

      {/* -- the catalogue ---------------------------------------------------- */}
      <section className="settings-section">
        <h3>Jednotlivá oznámení</h3>
        <p className="muted">
          Ke každé akci v aplikaci si můžete zapnout nebo vypnout vlastní
          oznámení.
        </p>
        <div className="button-row">
          <button type="button" className="btn small" onClick={() => setAll(true)}>
            Zapnout vše
          </button>
          <button type="button" className="btn small" onClick={() => setAll(false)}>
            Vypnout vše
          </button>
        </div>
      </section>

      {notificationCatalogue.length === 0 ? (
        <p className="hint">Katalog oznámení se nepodařilo načíst.</p>
      ) : (
        notificationCatalogue.map((group) => {
          const on = group.events.filter((e) => events[e.id] ?? e.default_on).length;
          return (
            <section className="settings-section notif-group" key={group.category}>
              <header className="notif-group-head">
                <div>
                  <h3>{group.label}</h3>
                  <p className="muted small">{group.description}</p>
                </div>
                <span className="notif-group-actions">
                  <span className="badge">
                    {on}/{group.events.length}
                  </span>
                  <button
                    type="button"
                    className="link"
                    onClick={() => setGroup(group, on < group.events.length)}
                  >
                    {on < group.events.length ? 'Zapnout vše' : 'Vypnout vše'}
                  </button>
                </span>
              </header>

              <ul className="notif-list">
                {group.events.map((event) => {
                  const checked = events[event.id] ?? event.default_on;
                  return (
                    <li key={event.id}>
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setEvent(event.id, e.target.checked)}
                        />
                        <span className="toggle-track" aria-hidden="true">
                          <span className="toggle-knob" />
                        </span>
                        <span className="notif-text">
                          <span className="toggle-label">{event.label}</span>
                          <span className="muted small">{event.description}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}

function StatusRow({
  ok,
  label,
  hint,
  action,
}: {
  ok: boolean;
  label: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <li className={ok ? 'ok-row' : 'warn-row'}>
      <span className="status-icon" aria-hidden="true">
        {ok ? <CheckIcon size={14} /> : <CloseIcon size={14} />}
      </span>
      <span>
        {label}
        {hint ? <span className="muted small"> {hint}</span> : null}
      </span>
      {action}
    </li>
  );
}

/**
 * Two clock fields that only commit a complete, valid range.
 *
 * Editing them one at a time would produce an invalid half-range on every
 * keystroke, which the backend would rightly reject.
 */
function QuietHours({
  value,
  onChange,
  onInvalid,
}: {
  value: string;
  onChange: (value: string) => void;
  onInvalid: () => void;
}) {
  const [from, to] = value.includes('-') ? value.split('-') : ['22:00', '07:00'];
  const enabled = value !== '';

  const commit = (nextFrom: string, nextTo: string) => {
    if (!nextFrom || !nextTo) {
      onInvalid();
      return;
    }
    onChange(`${nextFrom}-${nextTo}`);
  };

  return (
    <div className="field-block">
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => (e.target.checked ? commit(from, to) : onChange(''))}
        />
        <span className="toggle-track" aria-hidden="true">
          <span className="toggle-knob" />
        </span>
        <span className="toggle-label">Zapnout tichý režim</span>
      </label>

      {enabled ? (
        <div className="field-row quiet-range">
          <label>
            <span className="muted small">Od</span>
            <input
              type="time"
              value={from}
              onChange={(e) => commit(e.target.value, to)}
              aria-label="Tichý režim od"
            />
          </label>
          <label>
            <span className="muted small">Do</span>
            <input
              type="time"
              value={to}
              onChange={(e) => commit(from, e.target.value)}
              aria-label="Tichý režim do"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function clamp(raw: string, min: number, max: number): number {
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
