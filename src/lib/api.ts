/**
 * The typed bridge to the Rust backend.
 *
 * Two things happen here beyond calling `invoke`:
 *
 * 1. Errors are normalised. A rejected command carries a tagged `AppError`;
 *    anything else (a panic, a torn-down window, a bug in this file) is turned
 *    into one, so no caller has to handle `unknown`.
 * 2. Optional platform APIs degrade. Notifications and the native file dialogs
 *    live in Tauri plugins that can be missing, denied, or unavailable in a
 *    plain browser tab during `npm run dev`. Every wrapper here returns a
 *    result the caller can carry on from rather than throwing.
 */

import { invoke } from '@tauri-apps/api/core';

import type {
  Area,
  Attachment,
  BackupInfo,
  Bootstrap,
  Counts,
  Health,
  ImportReport,
  ImportSummary,
  NewTask,
  Project,
  RecurrencePreview,
  RecurrenceRule,
  SavedFilter,
  SearchFilter,
  Tag,
  TaskDetail,
  TaskPatch,
  TaskStatus,
  UndoResult,
  ViewName,
  ViewPayload,
  AppError,
} from './types';
import type {
  CalendarDay,
  Dashboard,
  GiftIdea,
  GiftPatch,
  NoteDetail,
  NotePatch,
  Occasion,
  OccasionDetail,
  OccasionKind,
  OccasionPatch,
  Settings,
} from './planner-types';
import type { CatalogueGroup } from './notify';

/** True when running inside the Tauri shell rather than a plain browser tab. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as AppError).message === 'string'
  );
}

/** Coerces anything thrown into the one error shape the UI renders. */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  if (value instanceof Error) {
    return { kind: 'internal', message: value.message, retryable: false };
  }
  if (typeof value === 'string') {
    return { kind: 'internal', message: value, retryable: false };
  }
  return {
    kind: 'internal',
    message: 'Něco se pokazilo. Zkuste to prosím znovu.',
    retryable: true,
  };
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) {
    throw {
      kind: 'unavailable',
      message:
        'Notes_MJ potřebuje ke svým datům desktopovou aplikaci. Spusťte `npm run first-run` (nebo `npm run app`) místo otevírání vývojového serveru v prohlížeči.',
      retryable: false,
    } satisfies AppError;
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toAppError(error);
  }
}

// -- bootstrap & views --------------------------------------------------------

export const api = {
  bootstrap: (today: string) => call<Bootstrap>('bootstrap', { today }),

  listView: (view: ViewName, today: string, offset = 0) =>
    call<ViewPayload>('list_view', { view, today, offset }),

  counts: (today: string) => call<Counts>('get_counts', { today }),

  listProjectTasks: (projectId: string) =>
    call<TaskDetail[]>('list_project_tasks', { projectId }),

  listAreaTasks: (areaId: string) => call<TaskDetail[]>('list_area_tasks', { areaId }),

  search: (filter: SearchFilter) => call<TaskDetail[]>('search_tasks', { filter }),

  getTask: (id: string) => call<TaskDetail>('get_task', { id }),

  // -- tasks ------------------------------------------------------------------

  createTask: (input: NewTask) => call<TaskDetail>('create_task', { input }),

  updateTask: (id: string, patch: TaskPatch) =>
    call<TaskDetail>('update_task', { id, patch }),

  setTaskStatus: (id: string, status: TaskStatus, today: string) =>
    call<TaskDetail>('set_task_status', { id, status, today }),

  deleteTask: (id: string) => call<void>('delete_task', { id }),

  reorderTask: (id: string, position: number) =>
    call<void>('reorder_task', { id, position }),

  // -- areas & projects -------------------------------------------------------

  listAreas: () => call<Area[]>('list_areas'),
  createArea: (name: string) => call<Area>('create_area', { name }),
  renameArea: (id: string, name: string) => call<Area>('rename_area', { id, name }),
  deleteArea: (id: string) => call<void>('delete_area', { id }),

  listProjects: (includeDone = false) =>
    call<Project[]>('list_projects', { includeDone }),
  createProject: (name: string, areaId: string | null, notes = '') =>
    call<Project>('create_project', { name, areaId, notes }),
  updateProject: (id: string, patch: TaskPatch) =>
    call<Project>('update_project', { id, patch }),
  setProjectStatus: (id: string, status: TaskStatus) =>
    call<Project>('set_project_status', { id, status }),
  deleteProject: (id: string) => call<void>('delete_project', { id }),

  // -- tags & filters ---------------------------------------------------------

  listTags: () => call<Tag[]>('list_tags'),
  setTagColor: (id: string, color: string) => call<Tag>('set_tag_color', { id, color }),
  deleteTag: (id: string) => call<void>('delete_tag', { id }),

  listSavedFilters: () => call<SavedFilter[]>('list_saved_filters'),
  saveFilter: (name: string, query: string) =>
    call<SavedFilter>('save_filter', { name, query }),
  deleteSavedFilter: (id: string) => call<void>('delete_saved_filter', { id }),

  // -- undo -------------------------------------------------------------------

  undo: () => call<UndoResult>('undo'),
  redo: () => call<UndoResult>('redo'),
  undoState: () => call<UndoResult>('undo_state'),

  // -- recurrence -------------------------------------------------------------

  previewRecurrence: (rule: RecurrenceRule, from: string, count = 5) =>
    call<RecurrencePreview>('preview_recurrence', { rule, from, count }),

  // -- attachments ------------------------------------------------------------

  addAttachment: (taskId: string, sourcePath: string) =>
    call<Attachment>('add_attachment', { taskId, sourcePath }),
  removeAttachment: (id: string) => call<void>('remove_attachment', { id }),
  attachmentPath: (id: string) => call<string>('attachment_path', { id }),

  // -- export / import --------------------------------------------------------

  exportJson: (path: string) => call<number>('export_json', { path }),
  exportBundle: (dir: string) => call<string>('export_bundle', { dir }),
  inspectImport: (path: string) => call<ImportSummary>('inspect_import', { path }),
  importJson: (path: string, mode: 'merge' | 'replace', withSettings = false) =>
    call<ImportReport>('import_json', { path, mode, withSettings }),

  // -- backups & health -------------------------------------------------------

  backupNow: () => call<BackupInfo>('backup_now'),
  listBackups: () => call<BackupInfo[]>('list_backups'),
  health: () => call<Health>('health'),

  /**
   * Quits and reopens the app to finish an update.
   *
   * Never resolves when it works - the process is gone before a reply can come
   * back - so callers must treat a rejection as the only outcome worth acting
   * on, not wait for success.
   */
  restartApp: () => call<void>('restart_app'),
};

// -- optional platform APIs ---------------------------------------------------

export type NotificationSupport = 'ready' | 'denied' | 'unavailable';

let notificationSupport: NotificationSupport | null = null;

/**
 * Asks for notification permission once and remembers the answer.
 *
 * Never throws: on a system without a notification service (or in a browser
 * tab) it reports `unavailable` and the focus timer falls back to an in-app
 * banner, which is the whole point of checking.
 */
export async function ensureNotifications(): Promise<NotificationSupport> {
  if (notificationSupport) return notificationSupport;
  if (!isDesktop()) {
    notificationSupport = 'unavailable';
    return notificationSupport;
  }
  try {
    const plugin = await import('@tauri-apps/plugin-notification');
    let granted = await plugin.isPermissionGranted();
    if (!granted) {
      granted = (await plugin.requestPermission()) === 'granted';
    }
    notificationSupport = granted ? 'ready' : 'denied';
  } catch {
    notificationSupport = 'unavailable';
  }
  return notificationSupport;
}

/** Sends a desktop notification. Returns false if it could not be delivered. */
export async function notify(title: string, body: string): Promise<boolean> {
  const support = await ensureNotifications();
  if (support !== 'ready') return false;
  try {
    const plugin = await import('@tauri-apps/plugin-notification');
    await plugin.sendNotification({ title, body });
    return true;
  } catch {
    // The permission can be revoked between the check and the send.
    notificationSupport = 'unavailable';
    return false;
  }
}

/** Forgets the cached answer, so Settings can re-request permission. */
export function resetNotificationSupport(): void {
  notificationSupport = null;
}

export interface FileDialogOptions {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
}

/** Native "open file" dialog. `null` means cancelled *or* unavailable. */
export async function pickFile(options: FileDialogOptions = {}): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: false, directory: false, ...options });
    return typeof picked === 'string' ? picked : null;
  } catch {
    return null;
  }
}

export async function pickDirectory(title: string): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: false, directory: true, title });
    return typeof picked === 'string' ? picked : null;
  } catch {
    return null;
  }
}

export async function pickSavePath(
  options: FileDialogOptions & { defaultPath?: string },
): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return (await save(options)) ?? null;
  } catch {
    return null;
  }
}

/** Opens a folder in Explorer. Silently does nothing if unavailable. */
export async function revealInExplorer(path: string): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(path);
    return true;
  } catch {
    return false;
  }
}

// -- planner, dashboard, calendar and settings --------------------------------

/**
 * A second namespace rather than more keys on `api`, so the task surface and
 * the planner surface stay legible on their own.
 */
export const plannerApi = {
  dashboard: (today: string) => call<Dashboard>('dashboard', { today }),

  calendarRange: (from: string, to: string, includeCompleted?: boolean) =>
    call<CalendarDay[]>('calendar_range', { from, to, includeCompleted }),

  // -- notebook ---------------------------------------------------------------

  listNotes: (search?: string) => call<NoteDetail[]>('list_notes', { search }),
  getNote: (id: string) => call<NoteDetail>('get_note', { id }),
  createNote: (title: string, body?: string) =>
    call<NoteDetail>('create_note', { title, body }),
  updateNote: (id: string, patch: NotePatch) =>
    call<NoteDetail>('update_note', { id, patch }),
  deleteNote: (id: string) => call<void>('delete_note', { id }),

  // -- occasions --------------------------------------------------------------

  listOccasions: (today: string) => call<OccasionDetail[]>('list_occasions', { today }),
  getOccasion: (id: string, today: string) =>
    call<OccasionDetail>('get_occasion', { id, today }),
  createOccasion: (
    name: string,
    kind: OccasionKind,
    onDate: string,
    yearly: boolean,
    today: string,
  ) => call<OccasionDetail>('create_occasion', { name, kind, onDate, yearly, today }),
  updateOccasion: (id: string, patch: OccasionPatch, today: string) =>
    call<OccasionDetail>('update_occasion', { id, patch, today }),
  deleteOccasion: (id: string) => call<void>('delete_occasion', { id }),
  allOccasions: () => call<Occasion[]>('all_occasions'),

  // -- gifts ------------------------------------------------------------------

  createGift: (occasionId: string, title: string, recipient?: string) =>
    call<GiftIdea>('create_gift', { occasionId, title, recipient }),
  updateGift: (id: string, patch: GiftPatch) => call<GiftIdea>('update_gift', { id, patch }),
  deleteGift: (id: string) => call<void>('delete_gift', { id }),

  // -- settings ---------------------------------------------------------------

  notificationCatalogue: () => call<CatalogueGroup[]>('notification_catalogue'),

  getSettings: () => call<Settings>('get_settings'),
  saveSettings: (settings: Settings) => call<Settings>('save_settings', { settings }),
  resetSettings: () => call<Settings>('reset_settings'),
};

/** Opens an external link in the default browser, if the shell allows it. */
export async function openExternal(url: string): Promise<boolean> {
  if (!isDesktop()) return false;
  // Belt and braces: the backend already refuses to store anything else.
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return true;
  } catch {
    return false;
  }
}
