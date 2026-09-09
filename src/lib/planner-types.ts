/**
 * Wire types for the planner half of the app: notebook, occasions, gifts,
 * dashboard, calendar and settings.
 *
 * Mirrors `src-tauri/src/planner.rs`, `insights.rs` and `settings.rs`.
 */

import type { Counts, Project, Tag, TaskDetail } from './types';

// -- notebook -----------------------------------------------------------------

export interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface NoteDetail extends Note {
  tags: Tag[];
}

export interface NotePatch {
  title?: string;
  body?: string;
  pinned?: boolean;
  color?: string;
  position?: number;
  tag_names?: string[];
}

// -- occasions and gifts ------------------------------------------------------

export type OccasionKind =
  | 'christmas'
  | 'birthday'
  | 'anniversary'
  | 'nameday'
  | 'holiday'
  | 'other';

export type GiftStatus = 'idea' | 'decided' | 'bought' | 'wrapped' | 'given';

export interface Occasion {
  id: string;
  name: string;
  kind: OccasionKind;
  on_date: string;
  yearly: boolean;
  /** Budget in minor units (haléře). */
  budget_minor: number | null;
  notes: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface GiftIdea {
  id: string;
  occasion_id: string;
  recipient: string;
  title: string;
  notes: string;
  url: string;
  price_minor: number | null;
  status: GiftStatus;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface OccasionDetail extends Occasion {
  gifts: GiftIdea[];
  next_date: string;
  days_until: number;
  planned_minor: number;
  spent_minor: number;
  remaining_minor: number | null;
  gift_count: number;
  bought_count: number;
}

export interface OccasionPatch {
  name?: string;
  kind?: OccasionKind;
  on_date?: string;
  yearly?: boolean;
  budget_minor?: number | null;
  notes?: string;
  position?: number;
}

export interface GiftPatch {
  recipient?: string;
  title?: string;
  notes?: string;
  url?: string;
  price_minor?: number | null;
  status?: GiftStatus;
  position?: number;
}

// -- dashboard ----------------------------------------------------------------

export interface ProjectProgress extends Project {
  total: number;
  done: number;
  /** 0..1 */
  ratio: number;
  next_due: string | null;
}

export interface DayLoad {
  date: string;
  scheduled: number;
  due: number;
  occasions: number;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface Dashboard {
  today: string;
  counts: Counts;
  today_tasks: TaskDetail[];
  overdue_tasks: TaskDetail[];
  week: DayLoad[];
  completed_today: number;
  completed_week: number;
  completed_month: number;
  created_week: number;
  streak_days: number;
  best_streak_days: number;
  activity: DayCount[];
  projects: ProjectProgress[];
  occasions: OccasionDetail[];
  pinned_notes: NoteDetail[];
}

// -- calendar -----------------------------------------------------------------

export interface CalendarDay {
  date: string;
  tasks: TaskDetail[];
  occasions: Occasion[];
  completed: number;
}

// -- settings -----------------------------------------------------------------

export type Theme = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'cosy' | 'compact';
export type StartView =
  | 'dashboard'
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'calendar'
  | 'notes'
  | 'occasions'
  | 'last_used';
export type SortOrder =
  | 'manual'
  | 'due_date'
  | 'priority'
  | 'alphabetical'
  | 'created_newest'
  | 'created_oldest';

export interface Settings {
  // vzhled
  theme: Theme;
  accent: string;
  density: Density;
  font_scale: number;
  show_sidebar_counts: boolean;
  show_keyboard_hints: boolean;
  reduce_motion: boolean;

  // chování
  start_view: StartView;
  /** 0 = Monday .. 6 = Sunday. */
  first_weekday: number;
  default_sort: SortOrder;
  confirm_delete: boolean;
  show_completed_in_lists: boolean;
  updates_check_on_start: boolean;
  updates_auto_download: boolean;
  filing_leaves_inbox: boolean;
  auto_archive_days: number;
  archive_page_size: number;

  // Dnes a Nadcházející
  today_includes_overdue: boolean;
  overdue_first: boolean;
  upcoming_days: number;
  hide_weekends_in_upcoming: boolean;

  // kalendář
  calendar_show_weekends: boolean;
  calendar_show_completed: boolean;
  calendar_show_occasions: boolean;
  calendar_show_week_numbers: boolean;

  // soustředění
  focus_minutes: number;
  focus_presets: number[];
  focus_break_minutes: number;
  focus_notify: boolean;
  focus_complete_on_finish: boolean;

  // oznámení
  notifications_enabled: boolean;
  daily_plan_enabled: boolean;
  daily_plan_time: string;
  deadline_lead_days: number;
  occasion_lead_days: number;
  /** Per-event switches, keyed by the ids in `notifications.rs`. */
  notification_events: Record<string, boolean>;
  /** `HH:MM-HH:MM`, or empty for none. */
  quiet_hours: string;

  // dashboard
  dashboard_cards: string[];
  dashboard_show_greeting: boolean;

  // dárky
  currency: string;
  gifts_hide_prices: boolean;

  // data
  backup_keep: number | null;
  backup_interval_minutes: number | null;
  max_attachment_mb: number | null;
  backup_on_start: boolean;
}
