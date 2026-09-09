/**
 * The interactive dashboard.
 *
 * Every card is a way in, not a read-only report: clicking a heading navigates
 * to the list behind it, and the task rows can be ticked off without leaving
 * the page. Which cards appear, and in what order, comes from settings.
 */

import { useCallback, useEffect, useState } from 'react';

import { plannerApi, toAppError } from '../lib/api';
import { taskMenu } from '../lib/menus';
import { useMenu } from '../lib/useMenu';
import { plural, relativeDateLabel } from '../lib/dates';
import { formatMinorShort, spentRatio } from '../lib/money';
import type { Dashboard as DashboardData } from '../lib/planner-types';
import type { AppError } from '../lib/types';
import { useStore } from '../state/store';
import {
  ArchiveIcon,
  CalendarIcon,
  GiftIcon,
  InboxIcon,
  NoteIcon,
  PlusIcon,
  StarIcon,
  TargetIcon,
} from './Icons';
import { EmptyState, ErrorState, LoadingState } from './States';
import { TaskRow } from './TaskRow';

const DEFAULT_CARDS = ['today', 'overdue', 'week', 'progress', 'occasions', 'notes', 'streak'];

export function Dashboard({ onCapture }: { onCapture: () => void }) {
  const {
    today,
    settings,
    plannerVersion,
    navigate,
    setStatus,
    openInspector,
    select,
    selectedId,
    startFocus,
  } = useStore();

  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const menu = useMenu(() => load());

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await plannerApi.dashboard(today));
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void load();
  }, [load, plannerVersion]);

  if (loading && !data) return <LoadingState label="Sestavuji přehled" />;
  if (error && !data) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!data) return null;

  const currency = settings?.currency ?? 'Kč';
  const cards = settings?.dashboard_cards?.length ? settings.dashboard_cards : DEFAULT_CARDS;

  const toggle = async (id: string) => {
    const task = [...data.today_tasks, ...data.overdue_tasks].find((t) => t.id === id);
    if (!task) return;
    await setStatus(id, task.status === 'open' ? 'completed' : 'open');
    await load();
  };

  const rowProps = (task: DashboardData['today_tasks'][number]) => ({
    key: task.id,
    task,
    today,
    selected: task.id === selectedId,
    onSelect: select,
    onOpen: openInspector,
    onToggle: (id: string) => void toggle(id),
    onMenu: (event: React.MouseEvent, item: DashboardData['today_tasks'][number]) =>
      menu.open(event, taskMenu(item, menu.ctx)),
  });

  const maxLoad = Math.max(1, ...data.week.map((d) => d.scheduled + d.due));

  return (
    <div className="dashboard">
      {settings?.dashboard_show_greeting !== false ? (
        <header className="dash-greeting">
          <h1>{greeting()}</h1>
          <p className="muted">
            {longDate(today)}
            {data.counts.today > 0
              ? ` · na dnešek ${data.counts.today} ${plural(
                  data.counts.today,
                  'úkol',
                  'úkoly',
                  'úkolů',
                )}`
              : ' · na dnešek nic nezbývá'}
          </p>
        </header>
      ) : null}

      {/* -- the numbers at a glance ---------------------------------------- */}
      <div className="stat-row">
        <StatTile
          label="Dnes hotovo"
          value={String(data.completed_today)}
          hint={`za týden ${data.completed_week}`}
          onClick={() => void navigate({ kind: 'view', view: 'completed' })}
        />
        <StatTile
          label="Po termínu"
          value={String(data.counts.overdue)}
          tone={data.counts.overdue > 0 ? 'danger' : undefined}
          hint={data.counts.overdue === 0 ? 'vše v termínu' : 'vyžaduje pozornost'}
          onClick={() => void navigate({ kind: 'view', view: 'today' })}
        />
        <StatTile
          label="Doručené"
          value={String(data.counts.inbox)}
          hint={data.counts.inbox === 0 ? 'prázdné' : 'čeká na zařazení'}
          onClick={() => void navigate({ kind: 'view', view: 'inbox' })}
        />
        <StatTile
          label="Nadcházející"
          value={String(data.counts.upcoming)}
          hint={`${data.created_week} nových za týden`}
          onClick={() => void navigate({ kind: 'view', view: 'upcoming' })}
        />
      </div>

      <div className="dash-grid">
        {cards.map((card) => {
          switch (card) {
            case 'today':
              return (
                <Card
                  key={card}
                  icon={<StarIcon size={16} />}
                  title="Dnes"
                  count={data.today_tasks.length}
                  onOpen={() => void navigate({ kind: 'view', view: 'today' })}
                  action={
                    <button type="button" className="btn small primary" onClick={onCapture}>
                      <PlusIcon size={14} />
                      Přidat
                    </button>
                  }
                >
                  {data.today_tasks.length ? (
                    <ul className="rows compact">
                      {data.today_tasks.slice(0, 7).map((task) => (
                        <TaskRow {...rowProps(task)} />
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      icon={<StarIcon size={26} />}
                      title="Hotovo"
                      hint="Na dnešek nic nezbývá."
                    />
                  )}
                </Card>
              );

            case 'overdue':
              if (!data.overdue_tasks.length) return null;
              return (
                <Card
                  key={card}
                  icon={<CalendarIcon size={16} />}
                  title="Po termínu"
                  count={data.overdue_tasks.length}
                  tone="danger"
                  onOpen={() => void navigate({ kind: 'view', view: 'today' })}
                >
                  <ul className="rows compact">
                    {data.overdue_tasks.slice(0, 6).map((task) => (
                      <TaskRow {...rowProps(task)} />
                    ))}
                  </ul>
                </Card>
              );

            case 'week':
              return (
                <Card
                  key={card}
                  icon={<CalendarIcon size={16} />}
                  title="Příštích 7 dní"
                  onOpen={() => void navigate({ kind: 'calendar' })}
                >
                  <div className="week-bars">
                    {data.week.map((day) => {
                      const total = day.scheduled + day.due;
                      return (
                        <button
                          key={day.date}
                          type="button"
                          className="week-bar"
                          title={`${day.scheduled} naplánováno, ${day.due} s termínem`}
                          onClick={() => void navigate({ kind: 'calendar' })}
                        >
                          <span className="week-bar-track">
                            <span
                              className="week-bar-fill"
                              style={{ height: `${(total / maxLoad) * 100}%` }}
                            />
                            {day.due > 0 ? (
                              <span
                                className="week-bar-due"
                                style={{ height: `${(day.due / maxLoad) * 100}%` }}
                              />
                            ) : null}
                          </span>
                          <span className="week-bar-day">{shortWeekday(day.date)}</span>
                          <span className="week-bar-count">{total || ''}</span>
                          {day.occasions > 0 ? <span className="week-bar-dot" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </Card>
              );

            case 'progress':
              if (!data.projects.length) return null;
              return (
                <Card key={card} icon={<ArchiveIcon size={16} />} title="Projekty">
                  <ul className="progress-list">
                    {data.projects.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="progress-row"
                          onClick={() => void navigate({ kind: 'project', id: p.id })}
                        >
                          <span className="progress-name">{p.name}</span>
                          <span className="progress-bar">
                            <span
                              className="progress-fill"
                              style={{ width: `${Math.round(p.ratio * 100)}%` }}
                            />
                          </span>
                          <span className="progress-count muted">
                            {p.done}/{p.total}
                          </span>
                        </button>
                        {p.next_due ? (
                          <span className="progress-due muted">
                            nejbližší termín {relativeDateLabel(p.next_due, today).toLowerCase()}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Card>
              );

            case 'occasions':
              if (!data.occasions.length) return null;
              return (
                <Card
                  key={card}
                  icon={<GiftIcon size={16} />}
                  title="Blíží se"
                  onOpen={() => void navigate({ kind: 'occasions' })}
                >
                  <ul className="occasion-mini">
                    {data.occasions.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => void navigate({ kind: 'occasion', id: o.id })}
                        >
                          <span className="occasion-mini-name">{o.name}</span>
                          <span className="occasion-mini-when">{countdown(o.days_until)}</span>
                          <span className="muted">
                            {o.bought_count}/{o.gift_count} dárků
                            {o.budget_minor !== null
                              ? ` · zbývá ${formatMinorShort(o.remaining_minor, currency)}`
                              : ''}
                          </span>
                          {o.budget_minor !== null ? (
                            <span className="progress-bar thin">
                              <span
                                className="progress-fill"
                                style={{
                                  width: `${Math.round(
                                    spentRatio(o.spent_minor, o.budget_minor) * 100,
                                  )}%`,
                                }}
                              />
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              );

            case 'notes':
              if (!data.pinned_notes.length) return null;
              return (
                <Card
                  key={card}
                  icon={<NoteIcon size={16} />}
                  title="Připnuté poznámky"
                  onOpen={() => void navigate({ kind: 'notes' })}
                >
                  <ul className="note-mini">
                    {data.pinned_notes.map((n) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => void navigate({ kind: 'notes' })}>
                          <strong>{n.title}</strong>
                          {n.body ? <span className="muted">{firstLine(n.body)}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              );

            case 'streak':
              return (
                <Card key={card} icon={<TargetIcon size={16} />} title="Aktivita">
                  <div className="streak">
                    <div className="streak-number">
                      <strong>{data.streak_days}</strong>
                      <span className="muted">
                        {plural(data.streak_days, 'den v řadě', 'dny v řadě', 'dní v řadě')}
                      </span>
                    </div>
                    <p className="muted small">
                      Nejlepší série: {data.best_streak_days}{' '}
                      {plural(data.best_streak_days, 'den', 'dny', 'dní')} · za 30 dní{' '}
                      {data.completed_month} hotovo
                    </p>
                  </div>
                  <div className="activity">
                    {data.activity.map((day) => (
                      <span
                        key={day.date}
                        className={`activity-cell level-${level(day.count)}`}
                        title={`${relativeDateLabel(day.date, today)}: ${day.count}`}
                      />
                    ))}
                  </div>
                  {data.today_tasks.length ? (
                    <button
                      type="button"
                      className="btn small wide"
                      onClick={() => void startFocus(data.today_tasks[0].id, settings?.focus_minutes ?? 25)}
                    >
                      <TargetIcon size={14} />
                      Pustit se do „{truncate(data.today_tasks[0].title, 28)}“
                    </button>
                  ) : null}
                </Card>
              );

            case 'inbox':
              return (
                <Card
                  key={card}
                  icon={<InboxIcon size={16} />}
                  title="Doručené"
                  count={data.counts.inbox}
                  onOpen={() => void navigate({ kind: 'view', view: 'inbox' })}
                >
                  <p className="muted">
                    {data.counts.inbox === 0
                      ? 'Doručené jsou prázdné.'
                      : `${data.counts.inbox} ${plural(
                          data.counts.inbox,
                          'položka čeká',
                          'položky čekají',
                          'položek čeká',
                        )} na zařazení.`}
                  </p>
                </Card>
              );

            default:
              return null;
          }
        })}
      </div>

      {error ? (
        <p className="hint">Přehled se nepodařilo obnovit: {error.message}</p>
      ) : null}
    </div>
  );
}

function Card({
  icon,
  title,
  count,
  tone,
  onOpen,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  tone?: 'danger';
  onOpen?: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`dash-card${tone ? ` tone-${tone}` : ''}`}>
      <header>
        <span className="dash-card-icon">{icon}</span>
        {onOpen ? (
          <button type="button" className="dash-card-title" onClick={onOpen}>
            {title}
          </button>
        ) : (
          <span className="dash-card-title static">{title}</span>
        )}
        {count !== undefined && count > 0 ? <span className="badge">{count}</span> : null}
        <span className="grow" />
        {action}
      </header>
      <div className="dash-card-body">{children}</div>
    </section>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'danger';
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`stat-tile${tone ? ` tone-${tone}` : ''}`}
      onClick={onClick}
    >
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint ? <span className="stat-hint muted">{hint}</span> : null}
    </button>
  );
}

// -- small helpers ------------------------------------------------------------

function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Ještě vzhůru?';
  if (h < 10) return 'Dobré ráno';
  if (h < 12) return 'Dobré dopoledne';
  if (h < 18) return 'Dobré odpoledne';
  return 'Dobrý večer';
}

const WEEKDAYS_SHORT = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'];
const MONTHS = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
];

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${MONTHS[m - 1]} ${y}`;
}

function shortWeekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return WEEKDAYS_SHORT[(date.getDay() + 6) % 7];
}

function countdown(days: number): string {
  if (days === 0) return 'dnes';
  if (days === 1) return 'zítra';
  return `za ${days} ${plural(days, 'den', 'dny', 'dní')}`;
}

/** Four buckets, so the activity strip reads at a glance. */
function level(count: number): 0 | 1 | 2 | 3 {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  return 3;
}

function firstLine(body: string): string {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  return truncate(line, 90);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

