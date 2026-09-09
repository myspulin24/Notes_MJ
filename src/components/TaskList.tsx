/**
 * The main pane: a heading, then either the four load states or the rows.
 *
 * Upcoming and Completed group by date; everything else is a flat list in the
 * user's own order.
 */

import { useEffect, useRef } from 'react';

import { taskMenu } from '../lib/menus';
import { useMenu } from '../lib/useMenu';

import { groupByDate } from '../lib/dates';
import type { TaskDetail } from '../lib/types';
import { useStore } from '../state/store';
import { ArchiveIcon, CalendarIcon, InboxIcon, PlusIcon, StarIcon } from './Icons';
import { EmptyState, ErrorState, LoadingState } from './States';
import { TaskRow } from './TaskRow';

interface Props {
  title: string;
  subtitle?: string;
  onCapture: () => void;
}

export function TaskList({ title, subtitle, onCapture }: Props) {
  const {
    route,
    tasks,
    listState,
    listError,
    hasMore,
    today,
    selectedId,
    select,
    openInspector,
    setStatus,
    refresh,
    loadMore,
  } = useStore();

  const listRef = useRef<HTMLDivElement>(null);
  const menu = useMenu(refresh);

  // Keep the keyboard selection in view as it moves.
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const row = listRef.current.querySelector(`[data-task-id="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const grouped =
    route.kind === 'view' && (route.view === 'upcoming' || route.view === 'completed');

  const toggle = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    void setStatus(id, task.status === 'open' ? 'completed' : 'open');
  };

  const rowProps = (task: TaskDetail) => ({
    key: task.id,
    task,
    today,
    selected: task.id === selectedId,
    hideStartDate: grouped,
    onSelect: select,
    onOpen: openInspector,
    onToggle: toggle,
    onMenu: (event: React.MouseEvent, item: TaskDetail) =>
      menu.open(event, taskMenu(item, menu.ctx)),
  });

  return (
    <section className="pane">
      <header className="pane-head">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="pane-subtitle">{subtitle}</p> : null}
        </div>
        <button type="button" className="btn primary" onClick={onCapture}>
          <PlusIcon size={16} />
          Nový úkol
          <kbd>N</kbd>
        </button>
      </header>

      <div className="pane-body" ref={listRef}>
        {listState === 'loading' && tasks.length === 0 ? (
          <LoadingState label="Načítám úkoly" />
        ) : listState === 'error' && listError ? (
          <ErrorState error={listError} onRetry={() => void refresh()} />
        ) : tasks.length === 0 ? (
          <Empty route={route} onCapture={onCapture} />
        ) : grouped ? (
          <>
            {groupByDate(
              tasks,
              (t) =>
                route.kind === 'view' && route.view === 'completed'
                  ? (t.completed_at?.slice(0, 10) ?? null)
                  : (t.start_on ?? t.due_on),
              today,
            ).map((group) => (
              <div className="group" key={group.key || 'undated'}>
                <h2 className="group-head">{group.label}</h2>
                <ul className="rows">
                  {group.items.map((task) => (
                    <TaskRow {...rowProps(task)} />
                  ))}
                </ul>
              </div>
            ))}
            {hasMore ? (
              <button type="button" className="btn wide" onClick={() => void loadMore()}>
                Načíst starší
              </button>
            ) : null}
          </>
        ) : (
          <ul className="rows">
            {tasks.map((task) => (
              <TaskRow {...rowProps(task)} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** An empty list is a normal, often good, state - so say something useful. */
function Empty({
  route,
  onCapture,
}: {
  route: ReturnType<typeof useStore.getState>['route'];
  onCapture: () => void;
}) {
  const capture = (
    <button type="button" className="btn primary" onClick={onCapture}>
      <PlusIcon size={16} />
      Přidat úkol
    </button>
  );

  if (route.kind === 'search') {
    return (
      <EmptyState
        icon={<ArchiveIcon size={32} />}
        title={route.query.trim() ? 'Nic tomu neodpovídá' : 'Pište a hledejte'}
        hint={
          route.query.trim()
            ? 'Zkuste méně slov, nebo přidejte stav:vše a zahrňte i dokončené úkoly.'
            : 'Prohledává názvy i poznámky. Zúžit lze pomocí štítek:, projekt:, termín: a stav:.'
        }
      />
    );
  }

  if (route.kind === 'project') {
    return (
      <EmptyState
        icon={<ArchiveIcon size={32} />}
        title="Tenhle projekt je prázdný"
        hint="Rozeberte projekt na několik konkrétních dalších kroků."
        action={capture}
      />
    );
  }

  if (route.kind === 'area') {
    return (
      <EmptyState
        icon={<ArchiveIcon size={32} />}
        title="V téhle oblasti nic otevřeného"
        hint="Úkoly a projekty zařazené sem se objeví v tomto seznamu."
        action={capture}
      />
    );
  }

  // The planner routes (dashboard, calendar, notebook, occasions) never reach
  // this component; they draw their own empty states.
  if (route.kind !== 'view') {
    return <EmptyState icon={<ArchiveIcon size={32} />} title="Tady nic není" />;
  }

  switch (route.view) {
    case 'inbox':
      return (
        <EmptyState
          icon={<InboxIcon size={32} />}
          title="Doručené jsou prázdné"
          hint="Cokoli zapíšete bez zařazení, přistane tady. Nový úkol přidáte klávesou N."
          action={capture}
        />
      );
    case 'today':
      return (
        <EmptyState
          icon={<StarIcon size={32} />}
          title="Na dnešek nic nezbývá"
          hint="Pro dnešek máte hotovo. Co je naplánované později, najdete v Nadcházejících."
          action={capture}
        />
      );
    case 'upcoming':
      return (
        <EmptyState
          icon={<CalendarIcon size={32} />}
          title="Nic naplánovaného"
          hint="Dejte úkolu datum zahájení a bude tu čekat, dokud ten den nepřijde."
          action={capture}
        />
      );
    case 'anytime':
      return (
        <EmptyState
          icon={<ArchiveIcon size={32} />}
          title="Není do čeho se pustit"
          hint="Tady jsou úkoly zařazené do projektu nebo oblasti, bez konkrétního dne."
          action={capture}
        />
      );
    case 'someday':
      return (
        <EmptyState
          icon={<ArchiveIcon size={32} />}
          title="Nic odloženého"
          hint="Nápady, ke kterým se zatím nezavazujete, tu počkají, aniž by zaplevelily Dnešek."
          action={capture}
        />
      );
    case 'completed':
      return (
        <EmptyState
          icon={<ArchiveIcon size={32} />}
          title="Zatím žádná historie"
          hint="Vše, co dokončíte, tu zůstane natrvalo uložené v tomto počítači."
        />
      );
    default:
      return <EmptyState icon={<ArchiveIcon size={32} />} title="Tady nic není" />;
  }
}
