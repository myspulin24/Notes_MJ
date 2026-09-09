/**
 * The single application store.
 *
 * All server state lives here; components are presentational. Every async
 * action follows the same shape - set a loading flag, call the backend, then
 * either commit the result or record a typed error - so that the four states
 * the UI must always be able to show (empty, loading, success, recoverable
 * error) exist for every list rather than only the ones anyone remembered.
 */

import { create } from 'zustand';

import { api, plannerApi, toAppError } from '../lib/api';
import { notifyEvent } from '../lib/notify';
import {
  checkForUpdate,
  currentVersion,
  downloadUpdate,
  relaunchApp,
  NO_PROGRESS,
} from '../lib/updater';
import type { DownloadProgress, UpdateInfo } from '../lib/updater';
import type { CatalogueGroup, NotificationEventId } from '../lib/notify';
import { plural, relativeDateLabel, today as localToday } from '../lib/dates';
import { isEmptyQuery, parseQuery, toFilter } from '../lib/query';
import type {
  AppError,
  Area,
  Bootstrap,
  Counts,
  NewTask,
  Project,
  SavedFilter,
  Tag,
  TaskDetail,
  TaskPatch,
  TaskStatus,
  ViewName,
} from '../lib/types';
import type { Settings } from '../lib/planner-types';
import type { MenuItem, MenuRequest } from '../lib/contextmenu';

export type Route =
  | { kind: 'view'; view: ViewName }
  | { kind: 'project'; id: string }
  | { kind: 'area'; id: string }
  | { kind: 'search'; query: string }
  // The planner half. These load their own data in their components, so
  // `refresh` has nothing to fetch for them.
  | { kind: 'dashboard' }
  | { kind: 'calendar' }
  | { kind: 'notes' }
  | { kind: 'occasions' }
  | { kind: 'occasion'; id: string };

/** The routes that are a list of tasks. */
export type TaskRoute = Extract<
  Route,
  { kind: 'view' } | { kind: 'project' } | { kind: 'area' } | { kind: 'search' }
>;

/** Routes that are a list of tasks, and therefore go through `refresh`. */
export function isTaskRoute(route: Route): route is TaskRoute {
  return (
    route.kind === 'view' ||
    route.kind === 'project' ||
    route.kind === 'area' ||
    route.kind === 'search'
  );
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
  /** An inline action, used for "Undo" straight after a destructive change. */
  action?: { label: string; run: () => void };
}

export interface FocusSession {
  taskId: string;
  /** Total length in seconds. */
  duration: number;
  /** Seconds left. Counted down by a 1s interval in the component. */
  remaining: number;
  running: boolean;
  /** Set when the timer finished but the notification could not be delivered. */
  finishedInApp: boolean;
}

interface State {
  // -- lifecycle
  boot: Bootstrap | null;
  bootState: LoadState;
  bootError: AppError | null;

  // -- navigation & list
  route: Route;
  tasks: TaskDetail[];
  listState: LoadState;
  listError: AppError | null;
  hasMore: boolean;
  offset: number;

  // -- reference data
  counts: Counts | null;
  areas: Area[];
  projects: Project[];
  tags: Tag[];
  savedFilters: SavedFilter[];

  // -- interaction
  selectedId: string | null;
  inspectorId: string | null;
  focus: FocusSession | null;
  searchInput: string;
  undoLabel: string | null;
  redoLabel: string | null;
  toasts: Toast[];
  today: string;

  /** `null` until the first load; the UI falls back to built-in defaults. */
  settings: Settings | null;
  /** The notification catalogue, so the settings page renders from the backend. */
  notificationCatalogue: CatalogueGroup[];
  /** The right-click menu currently on screen, if any. */
  contextMenu: MenuRequest | null;
  /** Bumped whenever the planner data changes, so open panels re-read. */
  plannerVersion: number;

  // -- updates
  /** The installed version, read from the bundle once at startup. */
  appVersion: string;
  updateStage: UpdateStage;
  updateInfo: UpdateInfo | null;
  updateProgress: DownloadProgress;
  updateError: AppError | null;
  /** When the last check finished, so the panel can say "naposledy v ...". */
  updateCheckedAt: string | null;

  // -- actions
  init: () => Promise<void>;
  retryBoot: () => Promise<void>;
  navigate: (route: Route) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  refreshSidebar: () => Promise<void>;

  capture: (input: NewTask) => Promise<TaskDetail | null>;
  patchTask: (id: string, patch: TaskPatch) => Promise<TaskDetail | null>;
  setStatus: (id: string, status: TaskStatus) => Promise<void>;
  removeTask: (id: string) => Promise<void>;

  undo: () => Promise<void>;
  redo: () => Promise<void>;

  select: (id: string | null) => void;
  moveSelection: (delta: number) => void;
  openInspector: (id: string | null) => void;

  setSearchInput: (value: string) => void;
  runSearch: (query: string) => Promise<void>;

  startFocus: (taskId: string, minutes: number) => Promise<void>;
  tickFocus: () => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  stopFocus: () => void;
  dismissFocusAlert: () => void;

  loadSettings: () => Promise<void>;
  sendStartupDigest: () => Promise<void>;
  /** Raises a notification if the user has that event switched on. */
  notify: (id: NotificationEventId, title: string, body: string) => Promise<void>;
  saveSettings: (settings: Settings) => Promise<boolean>;
  resetSettings: () => Promise<void>;
  bumpPlanner: () => void;
  openContextMenu: (x: number, y: number, items: MenuItem[]) => void;
  closeContextMenu: () => void;

  /** `manual` is the button; the startup check passes false and stays quiet. */
  checkForUpdates: (manual: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => void;

  toast: (kind: Toast['kind'], message: string, action?: Toast['action']) => void;
  dismissToast: (id: number) => void;
  reportError: (error: unknown, context?: string) => void;
  rollDate: () => void;
}

/**
 * Where the update flow currently stands.
 *
 * `current` and `idle` differ on purpose: `current` means we asked and the
 * answer was no, which is worth showing; `idle` means we never asked.
 */
export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  boot: null,
  bootState: 'idle',
  bootError: null,

  route: { kind: 'view', view: 'today' },
  tasks: [],
  listState: 'idle',
  listError: null,
  hasMore: false,
  offset: 0,

  counts: null,
  areas: [],
  projects: [],
  tags: [],
  savedFilters: [],

  selectedId: null,
  inspectorId: null,
  focus: null,
  searchInput: '',
  undoLabel: null,
  redoLabel: null,
  toasts: [],
  today: localToday(),
  settings: null,
  notificationCatalogue: [],
  contextMenu: null,
  appVersion: '',
  updateStage: 'idle',
  updateInfo: null,
  updateProgress: NO_PROGRESS,
  updateError: null,
  updateCheckedAt: null,
  plannerVersion: 0,

  // -- lifecycle --------------------------------------------------------------

  init: async () => {
    set({ bootState: 'loading', bootError: null });
    try {
      const today = localToday();
      const boot = await api.bootstrap(today);
      set({
        boot,
        bootState: 'ready',
        today,
        counts: boot.counts,
        areas: boot.areas,
        projects: boot.projects,
        tags: boot.tags,
        savedFilters: boot.saved_filters,
        undoLabel: boot.undo_label,
        redoLabel: boot.redo_label,
      });
      // Settings first: the theme and the start view both depend on them,
      // and a wrong first paint is more jarring than a slightly later one.
      await get().loadSettings();
      const start = get().settings?.start_view ?? 'dashboard';
      if (start !== 'last_used') {
        const route: Route =
          start === 'dashboard'
            ? { kind: 'dashboard' }
            : start === 'calendar'
              ? { kind: 'calendar' }
              : start === 'notes'
                ? { kind: 'notes' }
                : start === 'occasions'
                  ? { kind: 'occasions' }
                  : { kind: 'view', view: start };
        set({ route });
      }

      // A backup that could not be written is worth saying out loud, once.
      if (boot.backup === null) {
        get().toast(
          'error',
          'Notes_MJ nemohlo zapsat automatickou zálohu. Zkontrolujte volné místo na disku v Nastavení.',
        );
        void get().notify(
          'data.backup_failed',
          'Zálohu se nepodařilo vytvořit',
          'Zkontrolujte volné místo na disku.',
        );
      } else if (boot.backup.outcome === 'created') {
        void get().notify('data.backup_done', 'Záloha hotova', boot.backup.backup.file_name);
      }
      await get().refresh();
      void get().sendStartupDigest();

      void currentVersion().then((version) => set({ appVersion: version }));

      // Deliberately after the first paint and off the critical path: a slow
      // or unreachable GitHub must never delay the window opening.
      if (get().settings?.updates_check_on_start ?? true) {
        window.setTimeout(() => void get().checkForUpdates(false), 4000);
      }
    } catch (error) {
      set({ bootState: 'error', bootError: toAppError(error) });
    }
  },

  retryBoot: async () => {
    await get().init();
  },

  navigate: async (route) => {
    set({ route, offset: 0, selectedId: null });
    await get().refresh();
  },

  refresh: async () => {
    const { route, today } = get();
    if (!isTaskRoute(route)) {
      // Dashboard, calendar, notebook and occasions fetch their own data.
      // Still refresh the sidebar so the counts stay honest.
      set({ tasks: [], listState: 'ready', listError: null, hasMore: false });
      await get().refreshSidebar();
      return;
    }
    set({ listState: 'loading', listError: null });
    try {
      let tasks: TaskDetail[] = [];
      let hasMore = false;

      if (route.kind === 'view') {
        const payload = await api.listView(route.view, today, 0);
        tasks = payload.tasks;
        hasMore = payload.has_more;
      } else if (route.kind === 'project') {
        tasks = await api.listProjectTasks(route.id);
      } else if (route.kind === 'area') {
        tasks = await api.listAreaTasks(route.id);
      } else {
        const parsed = parseQuery(route.query, today);
        tasks = isEmptyQuery(parsed)
          ? []
          : await api.search(toFilter(parsed, { projects: get().projects, areas: get().areas }));
      }

      set((s) => ({
        tasks,
        hasMore,
        offset: 0,
        listState: 'ready',
        // Keep the selection if the task is still on screen.
        selectedId: tasks.some((t) => t.id === s.selectedId) ? s.selectedId : null,
      }));
      await get().refreshSidebar();
    } catch (error) {
      set({ listState: 'error', listError: toAppError(error) });
    }
  },

  loadMore: async () => {
    const { route, today, offset, tasks } = get();
    if (route.kind !== 'view' || !get().hasMore) return;
    try {
      const next = offset + tasks.length;
      const payload = await api.listView(route.view, today, next);
      set({ tasks: [...tasks, ...payload.tasks], hasMore: payload.has_more, offset: 0 });
    } catch (error) {
      get().reportError(error, 'Nepodařilo se načíst další');
    }
  },

  refreshSidebar: async () => {
    try {
      const [counts, areas, projects, tags, savedFilters, undo] = await Promise.all([
        api.counts(get().today),
        api.listAreas(),
        api.listProjects(false),
        api.listTags(),
        api.listSavedFilters(),
        api.undoState(),
      ]);
      set({
        counts,
        areas,
        projects,
        tags,
        savedFilters,
        undoLabel: undo.undo_label,
        redoLabel: undo.redo_label,
      });
    } catch {
      // The sidebar is decoration around the list; a stale count is far better
      // than an error page over working content.
    }
  },

  // -- mutations --------------------------------------------------------------

  capture: async (input) => {
    try {
      const task = await api.createTask(input);
      await get().refresh();
      set({ selectedId: task.id });

      void get().notify('task.created', 'Nový úkol', task.title);
      if (task.start_on) {
        void get().notify(
          'calendar.scheduled',
          'Naplánováno',
          `„${task.title}“ na ${relativeDateLabel(task.start_on, get().today).toLowerCase()}.`,
        );
      }
      if (task.due_on) {
        void get().notify(
          'calendar.deadline_set',
          'Termín nastaven',
          `„${task.title}“ do ${relativeDateLabel(task.due_on, get().today).toLowerCase()}.`,
        );
      }
      return task;
    } catch (error) {
      get().reportError(error, 'Úkol se nepodařilo uložit');
      return null;
    }
  },

  patchTask: async (id, patch) => {
    try {
      const before = get().tasks.find((t) => t.id === id);
      const task = await api.updateTask(id, patch);
      // Patch in place so the row does not jump while the user is editing it.
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
      await get().refreshSidebar();

      // Only announce what the edit actually changed.
      if (patch.start_on !== undefined && task.start_on) {
        const when = relativeDateLabel(task.start_on, get().today).toLowerCase();
        const moved = before?.start_on && before.start_on !== task.start_on;
        void get().notify(
          moved ? 'calendar.rescheduled' : 'calendar.scheduled',
          moved ? 'Přesunuto' : 'Naplánováno',
          `„${task.title}“ na ${when}.`,
        );
      }
      if (patch.due_on !== undefined && task.due_on && before?.due_on !== task.due_on) {
        void get().notify(
          'calendar.deadline_set',
          'Termín nastaven',
          `„${task.title}“ do ${relativeDateLabel(task.due_on, get().today).toLowerCase()}.`,
        );
      }
      if (patch.project_id !== undefined && task.project_name) {
        void get().notify('task.filed', 'Zařazeno', `„${task.title}“ → ${task.project_name}`);
      } else if (patch.area_id !== undefined && task.area_name) {
        void get().notify('task.filed', 'Zařazeno', `„${task.title}“ → ${task.area_name}`);
      }
      return task;
    } catch (error) {
      get().reportError(error, 'Změnu se nepodařilo uložit');
      // Re-read from the backend so the UI stops showing a value that was
      // rejected.
      await get().refresh();
      return null;
    }
  },

  setStatus: async (id, status) => {
    const previous = get().tasks.find((t) => t.id === id);
    try {
      const result = await api.setTaskStatus(id, status, get().today);
      await get().refresh();

      if (status !== 'open') {
        const rolled = result.id !== id;
        get().toast(
          'success',
          rolled
            ? `Hotovo. Další termín: ${
                result.start_on
                  ? relativeDateLabel(result.start_on, get().today).toLowerCase()
                  : 'zatím žádný'
              }.`
            : `Dokončeno „${previous?.title ?? 'úkol'}“.`,
          { label: 'Zpět', run: () => void get().undo() },
        );
      }
      if (status === 'open') {
        void get().notify('task.reopened', 'Znovu otevřeno', previous?.title ?? 'Úkol');
      } else {
        void get().notify(
          'task.completed',
          status === 'canceled' ? 'Zahozeno' : 'Hotovo',
          previous?.title ?? 'Úkol',
        );
        if (result.id !== id && result.start_on) {
          void get().notify(
            'task.repeat_rolled',
            'Další výskyt',
            `„${result.title}“ je na ${relativeDateLabel(result.start_on, get().today).toLowerCase()}.`,
          );
        }
      }

      // Finishing the task you were focusing on ends the session.
      if (get().focus?.taskId === id && status !== 'open') {
        set({ focus: null });
      }
    } catch (error) {
      get().reportError(error, 'Úkol se nepodařilo upravit');
      await get().refresh();
    }
  },

  removeTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    try {
      await api.deleteTask(id);
      if (get().inspectorId === id) set({ inspectorId: null });
      if (get().focus?.taskId === id) set({ focus: null });
      await get().refresh();
      void get().notify('task.deleted', 'Smazáno', task?.title ?? 'Úkol');
      get().toast('success', `Smazáno „${task?.title ?? 'úkol'}“.`, {
        label: 'Zpět',
        run: () => void get().undo(),
      });
    } catch (error) {
      get().reportError(error, 'Úkol se nepodařilo smazat');
    }
  },

  undo: async () => {
    try {
      const result = await api.undo();
      set({ undoLabel: result.undo_label, redoLabel: result.redo_label });
      await get().refresh();
      get().toast(
        'info',
        result.label ? `Vráceno zpět: ${result.label}.` : 'Není co vrátit zpět.',
      );
    } catch (error) {
      get().reportError(error, 'Nepodařilo se vrátit zpět');
    }
  },

  redo: async () => {
    try {
      const result = await api.redo();
      set({ undoLabel: result.undo_label, redoLabel: result.redo_label });
      await get().refresh();
      get().toast(
        'info',
        result.label ? `Provedeno znovu: ${result.label}.` : 'Není co provést znovu.',
      );
    } catch (error) {
      get().reportError(error, 'Nepodařilo se provést znovu');
    }
  },

  // -- selection --------------------------------------------------------------

  select: (id) => set({ selectedId: id }),

  moveSelection: (delta) => {
    const { tasks, selectedId } = get();
    if (!tasks.length) return;
    const index = tasks.findIndex((t) => t.id === selectedId);
    const next = index === -1 ? (delta > 0 ? 0 : tasks.length - 1) : index + delta;
    const clamped = Math.max(0, Math.min(tasks.length - 1, next));
    set({ selectedId: tasks[clamped].id });
  },

  openInspector: (id) => set({ inspectorId: id, selectedId: id ?? get().selectedId }),

  // -- search -----------------------------------------------------------------

  setSearchInput: (value) => set({ searchInput: value }),

  runSearch: async (query) => {
    set({ searchInput: query });
    await get().navigate({ kind: 'search', query });
  },

  // -- focus timer ------------------------------------------------------------

  startFocus: async (taskId, minutes) => {
    const duration = Math.round(Math.max(1, Math.min(180, minutes)) * 60);
    set({
      focus: { taskId, duration, remaining: duration, running: true, finishedInApp: false },
      selectedId: taskId,
    });
    const task = get().tasks.find((t) => t.id === taskId);
    void get().notify(
      'focus.started',
      'Soustředění spuštěno',
      `${Math.round(duration / 60)} min na „${task?.title ?? 'úkol'}“.`,
    );
  },

  tickFocus: () => {
    const focus = get().focus;
    if (!focus || !focus.running) return;

    const remaining = focus.remaining - 1;
    if (remaining > 0) {
      set({ focus: { ...focus, remaining } });
      return;
    }

    set({ focus: { ...focus, remaining: 0, running: false } });
    const task = get().tasks.find((t) => t.id === focus.taskId);
    const title = task?.title ?? 'váš úkol';

    // Try the desktop notification; if it cannot be delivered, say so in the
    // window instead of letting the timer end in silence.
    if (get().settings?.focus_complete_on_finish) {
      void get().setStatus(focus.taskId, 'completed');
    }

    // `focus_notify` is the old per-feature switch; the catalogue entry is the
    // new one. Both have to agree before anything is sent, so turning either
    // off does what the person expected when they turned it off.
    const wanted = get().settings?.focus_notify !== false;
    void (wanted
      ? notifyEvent(
          {
            settings: get().settings,
            catalogue: get().notificationCatalogue,
            toast: () => {},
          },
          'focus.finished',
          'Soustředění skončilo',
          `Čas na „${title}“ vypršel.`,
        )
      : Promise.resolve('disabled' as const)
    ).then((outcome) => {
      if (outcome === 'sent') return;
      // Nothing reached the desktop, so say it in the window. The timer
      // finishing is the one thing that must never pass unnoticed.
      const current = get().focus;
      if (current && current.taskId === focus.taskId) {
        set({ focus: { ...current, finishedInApp: true } });
      }
      get().toast('info', `Soustředění skončilo: „${title}“.`);
    });
  },

  pauseFocus: () => {
    const focus = get().focus;
    if (focus) set({ focus: { ...focus, running: false } });
  },

  resumeFocus: () => {
    const focus = get().focus;
    if (focus && focus.remaining > 0) set({ focus: { ...focus, running: true } });
  },

  stopFocus: () => set({ focus: null }),

  dismissFocusAlert: () => {
    const focus = get().focus;
    if (focus) set({ focus: { ...focus, finishedInApp: false } });
  },

  // -- messaging --------------------------------------------------------------

  notify: async (id, title, body) => {
    await notifyEvent(
      {
        settings: get().settings,
        catalogue: get().notificationCatalogue,
        toast: (kind, message) => get().toast(kind, message),
      },
      id,
      title,
      body,
    );
  },

  loadSettings: async () => {
    try {
      // The catalogue barely changes, but it is cheap and keeps the settings
      // page in step with whatever this build actually knows how to send.
      const [settings, catalogue] = await Promise.all([
        plannerApi.getSettings(),
        plannerApi.notificationCatalogue().catch(() => get().notificationCatalogue),
      ]);
      set({ settings, notificationCatalogue: catalogue });
    } catch {
      // Defaults in the UI are good enough to work with; never block startup
      // because a preference could not be read.
    }
  },

  saveSettings: async (settings) => {
    try {
      // The backend clamps and normalises, so store what it returns rather
      // than what we sent - otherwise the UI shows a value that was not kept.
      const saved = await plannerApi.saveSettings(settings);
      set({ settings: saved });
      return true;
    } catch (error) {
      get().reportError(error, 'Nastavení se nepodařilo uložit');
      return false;
    }
  },

  resetSettings: async () => {
    try {
      set({ settings: await plannerApi.resetSettings() });
      get().toast('success', 'Nastavení vráceno na výchozí hodnoty.');
    } catch (error) {
      get().reportError(error, 'Nastavení se nepodařilo obnovit');
    }
  },

  bumpPlanner: () => set((s) => ({ plannerVersion: s.plannerVersion + 1 })),

  checkForUpdates: async (manual) => {
    // A check already running must not be started twice by an impatient click,
    // and a download in flight must certainly not be interrupted by one.
    const stage = get().updateStage;
    if (stage === 'checking' || stage === 'downloading') return;
    if (stage === 'ready') {
      if (manual) get().toast('info', 'Aktualizace je stažená a čeká na restart.');
      return;
    }

    set({ updateStage: 'checking', updateError: null });
    const result = await checkForUpdate();
    const checkedAt = new Date().toISOString();

    if (result.kind === 'unsupported') {
      // A browser tab. Say so only if the user asked.
      set({ updateStage: 'idle', updateCheckedAt: checkedAt });
      if (manual) {
        get().toast('info', 'Aktualizace fungují jen v nainstalované aplikaci.');
      }
      return;
    }

    if (result.kind === 'error') {
      set({ updateStage: 'error', updateError: result.error, updateCheckedAt: checkedAt });
      // A failed background check is not news; a failed deliberate one is.
      if (manual) {
        get().toast('error', `Kontrolu aktualizací se nepodařilo dokončit: ${result.error.message}`);
      }
      void get().notify(
        'app.update_failed',
        'Kontrola aktualizací selhala',
        result.error.message,
      );
      return;
    }

    if (result.kind === 'current') {
      set({ updateStage: 'current', updateInfo: null, updateCheckedAt: checkedAt });
      if (manual) get().toast('success', 'Máte nejnovější verzi.');
      return;
    }

    set({ updateStage: 'available', updateInfo: result.info, updateCheckedAt: checkedAt });
    void get().notify(
      'app.update_available',
      `K dispozici je verze ${result.info.version}`,
      'Stahuje se na pozadí.',
    );

    if (!(get().settings?.updates_auto_download ?? true)) {
      if (manual) {
        get().toast('info', `K dispozici je verze ${result.info.version}. Stažení spustíte v nastavení.`);
      }
      return;
    }

    set({ updateStage: 'downloading', updateProgress: NO_PROGRESS });
    const downloaded = await downloadUpdate((progress) => set({ updateProgress: progress }));

    if (!downloaded.ok) {
      set({ updateStage: 'error', updateError: downloaded.error });
      get().toast('error', `Aktualizaci se nepodařilo stáhnout: ${downloaded.error.message}`);
      void get().notify(
        'app.update_failed',
        'Aktualizaci se nepodařilo stáhnout',
        downloaded.error.message,
      );
      return;
    }

    set({ updateStage: 'ready' });
    void get().notify(
      'app.update_ready',
      `Verze ${result.info.version} je připravená`,
      'Dokončí se restartem aplikace.',
    );
  },

  installUpdate: async () => {
    if (get().updateStage !== 'ready') return;
    const error = await relaunchApp();
    if (error) {
      set({ updateStage: 'error', updateError: error });
      get().toast('error', `Restart se nepodařil: ${error.message}. Zavřete a spusťte aplikaci ručně.`);
    }
  },

  dismissUpdate: () => set({ updateStage: 'idle', updateError: null }),

  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),

  /**
   * The "here is where you stand" notifications, sent once at startup.
   *
   * These are the only ones Notes_MJ raises without the user having just done
   * something, so they are deliberately a single summary each rather than one
   * per task.
   */
  sendStartupDigest: async () => {
    const { counts, today } = get();
    if (!counts) return;

    if (counts.overdue > 0) {
      await get().notify(
        'calendar.overdue',
        'Něco je po termínu',
        `${counts.overdue} ${plural(counts.overdue, 'úkol', 'úkoly', 'úkolů')} po termínu.`,
      );
    }
    if (counts.today > 0) {
      await get().notify(
        'calendar.due_today',
        'Dnešní plán',
        `Na dnešek máte ${counts.today} ${plural(counts.today, 'úkol', 'úkoly', 'úkolů')}.`,
      );
    }

    // Occasions inside the configured lead time.
    try {
      const lead = get().settings?.occasion_lead_days ?? 21;
      const soon = (await plannerApi.listOccasions(today)).filter(
        (o) => o.days_until >= 0 && o.days_until <= lead,
      );
      for (const occasion of soon.slice(0, 3)) {
        await get().notify(
          'occasion.approaching',
          occasion.name,
          occasion.days_until === 0
            ? 'Je to dnes.'
            : `Zbývá ${occasion.days_until} ${plural(occasion.days_until, 'den', 'dny', 'dní')}, ` +
              `pořízeno ${occasion.bought_count} z ${occasion.gift_count} dárků.`,
        );
      }
    } catch {
      // A digest is a nicety; never let it interfere with starting up.
    }
  },

  toast: (kind, message, action) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, action }] }));
    // Errors stay until dismissed; the rest fade.
    if (kind !== 'error') {
      setTimeout(() => get().dismissToast(id), 6000);
    }
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  reportError: (error, context) => {
    const appError = toAppError(error);
    const message = context ? `${context}: ${appError.message}` : appError.message;
    get().toast('error', message);
  },

  /**
   * Handles the app being left open past midnight: everything scheduled for
   * "tomorrow" quietly becomes "today", so re-read with the new date.
   */
  rollDate: () => {
    const now = localToday();
    if (now !== get().today) {
      set({ today: now });
      void get().refresh();
    }
  },
}));
