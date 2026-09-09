/**
 * The wire types, mirroring `src-tauri/src/models.rs`.
 *
 * Kept hand-written rather than generated: the surface is small, and a change
 * on the Rust side that is not reflected here should be a TypeScript error at
 * the call site, which is exactly what we want.
 */

export type TaskList = 'inbox' | 'anytime' | 'someday';
export type TaskStatus = 'open' | 'completed' | 'canceled';
export type ViewName =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'anytime'
  | 'someday'
  | 'completed';

/** 0 none, 1 low, 2 medium, 3 high. */
export type Priority = 0 | 1 | 2 | 3;

export interface Area {
  id: string;
  name: string;
  position: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  notes: string;
  area_id: string | null;
  status: TaskStatus;
  list: TaskList;
  start_on: string | null;
  due_on: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Attachment {
  id: string;
  task_id: string;
  stored_name: string;
  display_name: string;
  size_bytes: number;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  project_id: string | null;
  area_id: string | null;
  parent_id: string | null;
  status: TaskStatus;
  list: TaskList;
  /** ISO `YYYY-MM-DD`: the day this starts showing up in Today. */
  start_on: string | null;
  /** ISO `YYYY-MM-DD`: the hard deadline. */
  due_on: string | null;
  priority: number;
  position: number;
  recurrence_id: string | null;
  series_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** The user local calendar day it was finished on. */
  completed_on: string | null;
}

// -- recurrence ---------------------------------------------------------------

export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Anchor = 'fixed_schedule' | 'after_completion';

export type MonthlyMode =
  | { type: 'day_of_month'; day: number }
  | { type: 'nth_weekday'; nth: number; weekday: number };

export type Ends =
  | { type: 'never' }
  | { type: 'on_date'; date: string }
  | { type: 'after_occurrences'; count: number };

export interface RecurrenceRule {
  freq: Freq;
  interval: number;
  /** 0 = Monday .. 6 = Sunday. Empty means "the weekday `starts_on` falls on". */
  weekdays: number[];
  monthly: MonthlyMode | null;
  month: number | null;
  anchor: Anchor;
  starts_on: string;
  ends: Ends;
}

export interface RecurrenceState {
  occurrences_done: number;
  last_scheduled: string | null;
  last_completed: string | null;
}

export interface Recurrence {
  id: string;
  rule: RecurrenceRule;
  state: RecurrenceState;
  /** The rule as a sentence, computed by the backend. */
  description: string;
}

/** A task plus everything needed to draw its row, from one query. */
export interface TaskDetail extends Task {
  tags: Tag[];
  subtasks: Task[];
  attachments: Attachment[];
  recurrence: Recurrence | null;
  project_name: string | null;
  area_name: string | null;
}

export interface SavedFilter {
  id: string;
  name: string;
  query: string;
  created_at: string;
}

export interface Counts {
  inbox: number;
  today: number;
  upcoming: number;
  anytime: number;
  someday: number;
  completed: number;
  overdue: number;
}

export interface ViewPayload {
  view: ViewName;
  tasks: TaskDetail[];
  has_more: boolean;
}

// -- requests -----------------------------------------------------------------

export interface NewTask {
  title: string;
  notes?: string;
  project_id?: string | null;
  area_id?: string | null;
  parent_id?: string | null;
  list?: TaskList;
  start_on?: string | null;
  due_on?: string | null;
  priority?: number;
  tag_names?: string[];
  recurrence?: RecurrenceRule | null;
}

/**
 * A partial edit. An absent key means "leave it alone"; an explicit `null`
 * means "clear it". The backend distinguishes the two.
 */
export interface TaskPatch {
  title?: string;
  notes?: string;
  project_id?: string | null;
  area_id?: string | null;
  list?: TaskList;
  start_on?: string | null;
  due_on?: string | null;
  priority?: number;
  position?: number;
  tag_names?: string[];
  recurrence?: RecurrenceRule | null;
}

export interface SearchFilter {
  text?: string;
  tags?: string[];
  project_id?: string | null;
  area_id?: string | null;
  list?: TaskList | null;
  statuses?: TaskStatus[] | null;
  min_priority?: number | null;
  due_before?: string | null;
  due_after?: string | null;
  start_before?: string | null;
  has_deadline?: boolean | null;
  limit?: number | null;
}

// -- responses ----------------------------------------------------------------

export interface BackupInfo {
  file_name: string;
  path: string;
  size_bytes: number;
  created_at: string;
}

export type BackupOutcome =
  | { outcome: 'created'; backup: BackupInfo; pruned: number }
  | { outcome: 'skipped'; reason: string };

export interface Bootstrap {
  app_version: string;
  data_dir: string;
  attachments_dir: string;
  backups_dir: string;
  counts: Counts;
  areas: Area[];
  projects: Project[];
  tags: Tag[];
  saved_filters: SavedFilter[];
  undo_label: string | null;
  redo_label: string | null;
  backup: BackupOutcome | null;
}

export interface UndoResult {
  label: string | null;
  undo_label: string | null;
  redo_label: string | null;
}

export interface RecurrencePreview {
  description: string;
  dates: string[];
}

export interface ImportSummary {
  version: number;
  exported_at: string;
  app_version: string;
  areas: number;
  projects: number;
  tags: number;
  tasks: number;
  saved_filters: number;
}

export interface ImportReport {
  areas: number;
  projects: number;
  tags: number;
  tasks: number;
  saved_filters: number;
  notes: number;
  occasions: number;
  gifts: number;
  skipped_existing: number;
  settings_applied: boolean;
  warnings: string[];
}

export interface Health {
  data_dir: string;
  db_path: string;
  db_size_bytes: number;
  integrity: string;
  backups: number;
  attachments: number;
  checked_at: string;
}

/** The shape every rejected command returns. See `src-tauri/src/error.rs`. */
export interface AppError {
  kind: 'validation' | 'not_found' | 'io' | 'unavailable' | 'internal';
  message: string;
  retryable: boolean;
}
