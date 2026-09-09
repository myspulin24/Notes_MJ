/**
 * The app shell: layout, routing between panes, and the global keyboard map.
 *
 * The keyboard map is the reason this file exists at the top level - shortcuts
 * have to be able to see whether a dialog is open and whether the user is
 * typing, and that knowledge belongs in one place rather than sprinkled
 * through the components.
 */

import { useCallback, useEffect, useState } from 'react';

import { isDesktop } from './lib/api';
import { applyAppearance } from './lib/appearance';
import { editableMenu } from './lib/menus';
import { useStore } from './state/store';
import { CalendarView } from './components/CalendarView';
import { ContextMenu } from './components/ContextMenu';
import { Dashboard } from './components/Dashboard';
import { FocusView } from './components/FocusView';
import { NotesView } from './components/NotesView';
import { OccasionsView } from './components/OccasionsView';
import { Inspector } from './components/Inspector';
import { QuickCapture } from './components/QuickCapture';
import { SearchBar } from './components/SearchBar';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { TaskList } from './components/TaskList';
import { Toasts } from './components/Toasts';
import { UpdateBanner } from './components/UpdateBanner';
import { ErrorState, LoadingState } from './components/States';
import type { ViewName } from './lib/types';

const VIEW_TITLES: Record<ViewName, { title: string; subtitle?: string }> = {
  inbox: { title: 'Doručené', subtitle: 'Vše, co jste zapsali a zatím nezařadili' },
  today: { title: 'Dnes', subtitle: 'Co je na řadě a co jste si na dnešek naplánovali' },
  upcoming: { title: 'Nadcházející', subtitle: 'Naplánované na den, který ještě nepřišel' },
  anytime: { title: 'Kdykoli', subtitle: 'Někam zařazené, bez konkrétního dne' },
  someday: { title: 'Někdy', subtitle: 'Odložené záměrně' },
  completed: { title: 'Dokončené', subtitle: 'Váš archiv, uložený v tomto počítači' },
};

/** Number keys 1-6 jump straight to a view. */
const NUMBER_VIEWS: ViewName[] = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'completed'];

export default function App() {
  const {
    bootState,
    bootError,
    route,
    tasks,
    selectedId,
    inspectorId,
    focus,
    today,
    projects,
    areas,
    init,
    navigate,
    moveSelection,
    openInspector,
    setStatus,
    removeTask,
    undo,
    redo,
    patchTask,
    runSearch,
    startFocus,
    rollDate,
  } = useStore();

  const [capturing, setCapturing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Set when capture was opened from a calendar day, so it lands on that day. */
  const [captureDate, setCaptureDate] = useState<string | null>(null);
  const searching = route.kind === 'search';
  const settings = useStore((s) => s.settings);

  // The theme, accent, density and font size all live in CSS variables.
  useEffect(() => {
    applyAppearance(settings);
  }, [settings]);

  // WebView2 has its own context menu - in English, offering Reload, Print and
  // Inspect. Replace it everywhere: text fields get Czech edit commands, and
  // anything that has registered its own menu handles the event itself before
  // this listener sees it.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();

      const items = editableMenu(event.target);
      if (items) {
        useStore.getState().openContextMenu(event.clientX, event.clientY, items);
      } else {
        // Nothing sensible to offer here; just suppress the browser's menu.
        useStore.getState().closeContextMenu();
      }
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  // The app can be left open overnight; notice when "today" changes.
  useEffect(() => {
    const id = window.setInterval(rollDate, 60_000);
    const onVisible = () => rollDate();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [rollDate]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;

      // Undo and redo work everywhere except inside a text field, where the
      // browser's own undo is the more useful behaviour.
      if (mod && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
        return;
      }
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        void runSearch(useStore.getState().searchInput);
        return;
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setCapturing(true);
        return;
      }

      if (event.key === 'Escape') {
        if (focus) return; // the focus view handles its own close button
        if (capturing) setCapturing(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (inspectorId) openInspector(null);
        else if (searching) void navigate({ kind: 'view', view: 'today' });
        return;
      }

      if (typing || capturing || settingsOpen || focus) return;

      switch (event.key) {
        case 'n':
        case 'N':
          event.preventDefault();
          setCapturing(true);
          break;
        case 'ArrowDown':
        case 'j':
          event.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowUp':
        case 'k':
          event.preventDefault();
          moveSelection(-1);
          break;
        case 'Enter':
          if (selectedId) {
            event.preventDefault();
            openInspector(selectedId);
          }
          break;
        case ' ': {
          if (!selectedId) break;
          event.preventDefault();
          const task = tasks.find((t) => t.id === selectedId);
          if (task) void setStatus(task.id, task.status === 'open' ? 'completed' : 'open');
          break;
        }
        case 'f':
        case 'F':
          if (selectedId) {
            event.preventDefault();
            void startFocus(selectedId, 25);
          }
          break;
        case 't':
        case 'T':
          if (selectedId) {
            event.preventDefault();
            void patchTask(selectedId, { start_on: today });
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedId) {
            event.preventDefault();
            void removeTask(selectedId);
          }
          break;
        case '?':
          event.preventDefault();
          setSettingsOpen(true);
          break;
        case 'd':
        case 'D':
          event.preventDefault();
          void navigate({ kind: 'dashboard' });
          break;
        case 'c':
        case 'C':
          event.preventDefault();
          void navigate({ kind: 'calendar' });
          break;
        case 'z':
        case 'Z':
          // Plain Z, not Ctrl+Z: the notebook ("zápisník").
          event.preventDefault();
          void navigate({ kind: 'notes' });
          break;
        case 'u':
        case 'U':
          event.preventDefault();
          void navigate({ kind: 'occasions' });
          break;
        default: {
          const view = NUMBER_VIEWS[Number(event.key) - 1];
          if (view) {
            event.preventDefault();
            void navigate({ kind: 'view', view });
          }
        }
      }
    },
    [
      capturing,
      settingsOpen,
      inspectorId,
      searching,
      focus,
      selectedId,
      tasks,
      today,
      moveSelection,
      openInspector,
      setStatus,
      removeTask,
      undo,
      redo,
      navigate,
      runSearch,
      startFocus,
      patchTask,
    ],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  if (bootState === 'loading' || bootState === 'idle') {
    return (
      <div className="boot">
        <LoadingState label="Otevírám vaše úkoly" />
      </div>
    );
  }

  if (bootState === 'error' && bootError) {
    return (
      <div className="boot">
        <ErrorState error={bootError} onRetry={() => void init()} />
        {!isDesktop() ? (
          <p className="hint centered">
            Tohle vypadá jako karta prohlížeče. Notes_MJ je desktopová aplikace - spusťte
            ji příkazem <code>npm run first-run</code>.
          </p>
        ) : null}
      </div>
    );
  }

  const openCapture = (date: string | null) => {
    setCaptureDate(date);
    setCapturing(true);
  };

  const heading = headingFor(route, { projects, areas });

  return (
    <div className={`app${inspectorId ? ' with-inspector' : ''}`}>
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />

      <main className="main">
        <UpdateBanner />
        {searching ? <SearchBar onClose={() => void navigate({ kind: 'view', view: 'today' })} /> : null}

        {route.kind === 'dashboard' ? (
          <Dashboard onCapture={() => openCapture(null)} />
        ) : route.kind === 'calendar' ? (
          <CalendarView onCaptureOn={(date) => openCapture(date)} />
        ) : route.kind === 'notes' ? (
          <NotesView />
        ) : route.kind === 'occasions' || route.kind === 'occasion' ? (
          <OccasionsView focusId={route.kind === 'occasion' ? route.id : null} />
        ) : (
          <TaskList
            title={heading.title}
            subtitle={heading.subtitle}
            onCapture={() => openCapture(null)}
          />
        )}
      </main>

      {inspectorId ? (
        <Inspector taskId={inspectorId} onClose={() => openInspector(null)} />
      ) : null}

      <QuickCapture
        open={capturing}
        onClose={() => {
          setCapturing(false);
          setCaptureDate(null);
        }}
        defaultProjectId={route.kind === 'project' ? route.id : null}
        defaultAreaId={route.kind === 'area' ? route.id : null}
        defaultStartOn={captureDate}
      />

      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}

      <FocusView />
      <ContextMenu />
      <Toasts />
    </div>
  );
}

function headingFor(
  route: ReturnType<typeof useStore.getState>['route'],
  ctx: { projects: { id: string; name: string; notes: string }[]; areas: { id: string; name: string }[] },
): { title: string; subtitle?: string } {
  switch (route.kind) {
    case 'view':
      return VIEW_TITLES[route.view];
    case 'project': {
      const project = ctx.projects.find((p) => p.id === route.id);
      return {
        title: project?.name ?? 'Projekt',
        subtitle: project?.notes || 'Vše, co tento projekt potřebuje',
      };
    }
    case 'area': {
      const area = ctx.areas.find((a) => a.id === route.id);
      return { title: area?.name ?? 'Oblast', subtitle: 'Otevřené úkoly zařazené do této oblasti' };
    }
    case 'search':
      return { title: 'Hledání', subtitle: undefined };
    // The planner views draw their own headings.
    default:
      return { title: '', subtitle: undefined };
  }
}
