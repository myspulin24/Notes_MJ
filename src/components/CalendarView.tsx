/**
 * The calendar / planner.
 *
 * A month grid on the left, the selected day on the right. Clicking a day
 * shows what is on it and lets you add straight into it, which is the whole
 * point of planning in a calendar rather than reading one.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { plannerApi, toAppError } from '../lib/api';
import { calendarOccasionMenu, taskMenu } from '../lib/menus';
import { useMenu } from '../lib/useMenu';
import {
  isWeekend,
  monthGrid,
  monthName,
  monthOf,
  shiftMonth,
  todayMonth,
  weekdayHeadings,
} from '../lib/calendar';
import { plural, relativeDateLabel } from '../lib/dates';
import type { CalendarDay, Occasion } from '../lib/planner-types';
import type { AppError } from '../lib/types';
import { useStore } from '../state/store';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GiftIcon,
  PlusIcon,
  RepeatIcon,
} from './Icons';
import { EmptyState, ErrorState, LoadingState } from './States';

export function CalendarView({ onCaptureOn }: { onCaptureOn: (date: string) => void }) {
  const {
    today,
    settings,
    plannerVersion,
    navigate,
    openInspector,
    setStatus,
    patchTask,
    bumpPlanner,
  } = useStore();

  const [{ year, month }, setCursor] = useState(() => todayMonth(today));
  const [selected, setSelected] = useState(today);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const menu = useMenu(() => load());

  /** Occasions shown on a day can be opened or deleted from here too. */
  const occasionActions = {
    open: (o: Occasion) => void navigate({ kind: 'occasion', id: o.id }),
    remove: async (o: Occasion) => {
      await plannerApi.deleteOccasion(o.id);
      bumpPlanner();
      await load();
    },
  };

  const firstWeekday = settings?.first_weekday ?? 0;
  const showWeekNumbers = settings?.calendar_show_week_numbers ?? true;
  const showWeekends = settings?.calendar_show_weekends ?? true;
  const showOccasions = settings?.calendar_show_occasions ?? true;

  const grid = useMemo(
    () => monthGrid(year, month, firstWeekday),
    [year, month, firstWeekday],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      setDays(
        await plannerApi.calendarRange(
          grid.from,
          grid.to,
          settings?.calendar_show_completed ?? false,
        ),
      );
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setLoading(false);
    }
  }, [grid.from, grid.to, settings?.calendar_show_completed]);

  useEffect(() => {
    void load();
  }, [load, plannerVersion]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const day of days) map.set(day.date, day);
    return map;
  }, [days]);

  const selectedDay = byDate.get(selected);
  const headings = weekdayHeadings(firstWeekday);
  // Hiding the weekend narrows the grid to five columns.
  const columnCount = showWeekends
    ? 7
    : headings.filter((_, i) => !isWeekendColumn(i, firstWeekday)).length;

  const goToday = () => {
    setCursor(todayMonth(today));
    setSelected(today);
  };

  if (loading && !days.length) return <LoadingState label="Načítám kalendář" />;

  return (
    <div className="calendar-pane">
      <div className="calendar-main">
        <header className="calendar-head">
          <div className="calendar-nav">
            <button
              type="button"
              className="icon-btn"
              aria-label="Předchozí měsíc"
              onClick={() => setCursor(shiftMonth(year, month, -1))}
            >
              <ChevronLeftIcon size={18} />
            </button>
            <h1>
              {monthName(month)} <span className="muted">{year}</span>
            </h1>
            <button
              type="button"
              className="icon-btn"
              aria-label="Další měsíc"
              onClick={() => setCursor(shiftMonth(year, month, 1))}
            >
              <ChevronRightIcon size={18} />
            </button>
          </div>
          <div className="calendar-actions">
            <button type="button" className="btn subtle" onClick={goToday}>
              Dnes
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => onCaptureOn(selected)}
            >
              <PlusIcon size={15} />
              Přidat na {relativeDateLabel(selected, today).toLowerCase()}
            </button>
          </div>
        </header>

        {error ? (
          <ErrorState error={error} onRetry={() => void load()} />
        ) : (
          <div
            className={`calendar-grid${showWeekNumbers ? ' with-weeks' : ''}`}
            style={{
              gridTemplateColumns: `${showWeekNumbers ? 'auto ' : ''}repeat(${
                columnCount
              }, minmax(0, 1fr))`,
            }}
          >
            {showWeekNumbers ? <span className="cal-corner" /> : null}
            {headings.map((name, i) =>
              !showWeekends && isWeekendColumn(i, firstWeekday) ? null : (
                <span key={name} className="cal-heading">
                  {name}
                </span>
              ),
            )}

            {grid.days.map((iso, index) => {
              if (!showWeekends && isWeekend(iso)) return null;
              const isRowStart = index % 7 === 0;
              const day = byDate.get(iso);
              const outside = monthOf(iso) !== month;
              const isToday = iso === today;
              const taskCount = day?.tasks.length ?? 0;
              const occasions = showOccasions ? (day?.occasions ?? []) : [];

              return (
                <Fragment key={iso}>
                  {showWeekNumbers && isRowStart ? (
                    <span className="cal-week">{grid.weekNumbers[index / 7]}</span>
                  ) : null}
                  <button
                    type="button"
                    className={[
                      'cal-day',
                      outside ? 'outside' : '',
                      isToday ? 'today' : '',
                      iso === selected ? 'selected' : '',
                      isWeekend(iso) ? 'weekend' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setSelected(iso)}
                    onDoubleClick={() => onCaptureOn(iso)}
                  >
                    <span className="cal-daynum">{Number(iso.slice(8, 10))}</span>

                    {occasions.length ? (
                      <span className="cal-occasion" title={occasions.map((o) => o.name).join(', ')}>
                        <GiftIcon size={11} />
                        {occasions[0].name}
                      </span>
                    ) : null}

                    <span className="cal-items">
                      {(day?.tasks ?? []).slice(0, 3).map((task) => (
                        <span
                          key={task.id}
                          className={`cal-item${task.status !== 'open' ? ' done' : ''}${
                            task.due_on === iso ? ' due' : ''
                          }`}
                        >
                          {task.title}
                        </span>
                      ))}
                      {taskCount > 3 ? (
                        <span className="cal-more muted">+{taskCount - 3} další</span>
                      ) : null}
                    </span>
                  </button>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* -- the day panel --------------------------------------------------- */}
      <aside className="calendar-day-panel">
        <header>
          <h2>{relativeDateLabel(selected, today)}</h2>
          <p className="muted">
            {longDate(selected)}
            {selectedDay?.tasks.length
              ? ` · ${selectedDay.tasks.length} ${plural(
                  selectedDay.tasks.length,
                  'úkol',
                  'úkoly',
                  'úkolů',
                )}${selectedDay.completed > 0 ? `, ${selectedDay.completed} hotovo` : ''}`
              : ''}
          </p>
        </header>

        {selectedDay?.occasions.length ? (
          <ul className="day-occasions">
            {selectedDay.occasions.map((o) => (
              <li
                key={o.id}
                onContextMenu={(e) =>
                  menu.open(e, calendarOccasionMenu(o, menu.ctx, occasionActions))
                }
              >
                <button type="button" onClick={() => void navigate({ kind: 'occasion', id: o.id })}>
                  <GiftIcon size={14} />
                  {o.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {selectedDay?.tasks.length ? (
          <ul className="day-tasks">
            {selectedDay.tasks.map((task) => (
              <li
                key={task.id}
                className={task.status !== 'open' ? 'done' : ''}
                onContextMenu={(e) => menu.open(e, taskMenu(task, menu.ctx))}
              >
                <button
                  type="button"
                  className={`check small${task.status !== 'open' ? ' checked' : ''}`}
                  aria-label={task.status === 'open' ? 'Dokončit' : 'Znovu otevřít'}
                  onClick={async () => {
                    await setStatus(task.id, task.status === 'open' ? 'completed' : 'open');
                    bumpPlanner();
                  }}
                />
                <button
                  type="button"
                  className="day-task-title"
                  onClick={() => openInspector(task.id)}
                >
                  <span>{task.title}</span>
                  <span className="muted small">
                    {task.due_on === selected ? 'termín' : 'zahájení'}
                    {task.recurrence ? ' · opakuje se' : ''}
                    {task.project_name ? ` · ${task.project_name}` : ''}
                  </span>
                </button>
                {task.recurrence ? (
                  <span className="row-icon" title={task.recurrence.description}>
                    <RepeatIcon size={12} />
                  </span>
                ) : null}
                {task.status === 'open' && task.start_on === selected ? (
                  <button
                    type="button"
                    className="link"
                    title="Přesunout o den později"
                    onClick={async () => {
                      await patchTask(task.id, { start_on: addOneDay(selected) });
                      bumpPlanner();
                      void load();
                    }}
                  >
                    +1 den
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : selectedDay?.occasions.length ? null : (
          <EmptyState
            icon={<PlusIcon size={26} />}
            title="Volný den"
            hint="Dvojklikem na den v mřížce sem rovnou přidáte úkol."
          />
        )}

        <button type="button" className="btn wide" onClick={() => onCaptureOn(selected)}>
          <PlusIcon size={15} />
          Přidat úkol na tento den
        </button>
      </aside>
    </div>
  );
}

const MONTHS = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
];

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${MONTHS[m - 1]} ${y}`;
}

function addOneDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** Whether column `i` of the heading row is a weekend, given the week start. */
function isWeekendColumn(i: number, firstWeekday: number): boolean {
  const weekday = (firstWeekday + i) % 7;
  return weekday === 5 || weekday === 6;
}
