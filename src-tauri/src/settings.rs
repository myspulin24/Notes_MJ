//! User settings.
//!
//! Everything is one JSON object stored in `meta['settings']`. That means
//! adding a setting is a one-line struct change: every field carries a
//! `#[serde(default = ...)]`, so a database written by an older build simply
//! gets the new default rather than failing to load.
//!
//! Settings are deliberately **not** on the undo stack. Ctrl+Z after ticking a
//! task off should not also flip your theme back.
//!
//! Three of these knobs also exist in `.env` (`T3_BACKUP_KEEP`,
//! `T3_BACKUP_MIN_INTERVAL_MINUTES`, `T3_MAX_ATTACHMENT_MB`). The `.env` value
//! is the *default*; if the user sets it in the UI, the UI wins. That way
//! there is one obvious place to change it without taking away the ability to
//! preseed a machine from a file.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::db::Store;
use crate::notifications;
use crate::error::{AppError, Result};
use crate::paths::Config;

const KEY: &str = "settings";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Density {
    Comfortable,
    Cosy,
    Compact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartView {
    Dashboard,
    Inbox,
    Today,
    Upcoming,
    Calendar,
    Notes,
    Occasions,
    /// Whatever was on screen when the window was last closed.
    LastUsed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortOrder {
    Manual,
    DueDate,
    Priority,
    Alphabetical,
    CreatedNewest,
    CreatedOldest,
}

// -- defaults -----------------------------------------------------------------
// Free functions because serde's `default` attribute needs a path, and keeping
// them next to the field list makes the whole default profile readable at once.

fn theme() -> Theme { Theme::System }
fn accent() -> String { "#4f7cff".into() }
fn density() -> Density { Density::Comfortable }
fn font_scale() -> f64 { 1.0 }
fn start_view() -> StartView { StartView::Dashboard }
fn first_weekday() -> u32 { 0 }
fn sort_order() -> SortOrder { SortOrder::Manual }
fn yes() -> bool { true }
fn no() -> bool { false }
fn focus_minutes() -> u32 { 25 }
fn focus_presets() -> Vec<u32> { vec![10, 25, 45] }
fn break_minutes() -> u32 { 5 }
fn deadline_lead_days() -> i64 { 2 }
fn occasion_lead_days() -> i64 { 21 }
fn daily_plan_time() -> String { "08:30".into() }
fn currency() -> String { "Kč".into() }
fn archive_page() -> i64 { 200 }
fn upcoming_days() -> i64 { 30 }
fn auto_archive_days() -> i64 { 0 }
fn notification_events() -> BTreeMap<String, bool> {
    notifications::defaults()
}
fn quiet_hours() -> String {
    // Empty means "never quiet". A range is stored as "22:00-07:00".
    String::new()
}
fn dashboard_cards() -> Vec<String> {
    vec![
        "today".into(),
        "overdue".into(),
        "week".into(),
        "progress".into(),
        "occasions".into(),
        "notes".into(),
        "streak".into(),
    ]
}

/// Everything the user can change. Grouped by the panel section it appears in.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    // -- vzhled ------------------------------------------------------------
    #[serde(default = "theme")]
    pub theme: Theme,
    /// Hex accent colour used for buttons, selection and the focus ring.
    #[serde(default = "accent")]
    pub accent: String,
    #[serde(default = "density")]
    pub density: Density,
    /// 0.85 - 1.4. Multiplies the base font size.
    #[serde(default = "font_scale")]
    pub font_scale: f64,
    #[serde(default = "yes")]
    pub show_sidebar_counts: bool,
    #[serde(default = "yes")]
    pub show_keyboard_hints: bool,
    #[serde(default = "no")]
    pub reduce_motion: bool,

    // -- chování -----------------------------------------------------------
    #[serde(default = "start_view")]
    pub start_view: StartView,
    /// 0 = Monday .. 6 = Sunday.
    #[serde(default = "first_weekday")]
    pub first_weekday: u32,
    #[serde(default = "sort_order")]
    pub default_sort: SortOrder,
    #[serde(default = "yes")]
    pub confirm_delete: bool,
    #[serde(default = "no")]
    pub show_completed_in_lists: bool,
    /// Look for a new version shortly after the window opens.
    #[serde(default = "yes")]
    pub updates_check_on_start: bool,
    /// Fetch the new version straight away, so Restart is the only step left.
    #[serde(default = "yes")]
    pub updates_auto_download: bool,
    #[serde(default = "yes")]
    pub filing_leaves_inbox: bool,
    /// Completed tasks older than this many days are hidden from the archive's
    /// first page. 0 keeps everything visible.
    #[serde(default = "auto_archive_days")]
    pub auto_archive_days: i64,
    #[serde(default = "archive_page")]
    pub archive_page_size: i64,

    // -- Dnes a Nadcházející -----------------------------------------------
    #[serde(default = "yes")]
    pub today_includes_overdue: bool,
    #[serde(default = "yes")]
    pub overdue_first: bool,
    #[serde(default = "upcoming_days")]
    pub upcoming_days: i64,
    #[serde(default = "no")]
    pub hide_weekends_in_upcoming: bool,

    // -- kalendář ----------------------------------------------------------
    #[serde(default = "yes")]
    pub calendar_show_weekends: bool,
    #[serde(default = "no")]
    pub calendar_show_completed: bool,
    #[serde(default = "yes")]
    pub calendar_show_occasions: bool,
    #[serde(default = "yes")]
    pub calendar_show_week_numbers: bool,

    // -- soustředění -------------------------------------------------------
    #[serde(default = "focus_minutes")]
    pub focus_minutes: u32,
    #[serde(default = "focus_presets")]
    pub focus_presets: Vec<u32>,
    #[serde(default = "break_minutes")]
    pub focus_break_minutes: u32,
    #[serde(default = "yes")]
    pub focus_notify: bool,
    #[serde(default = "no")]
    pub focus_complete_on_finish: bool,

    // -- oznámení ----------------------------------------------------------
    #[serde(default = "yes")]
    pub notifications_enabled: bool,
    #[serde(default = "no")]
    pub daily_plan_enabled: bool,
    /// `HH:MM`, local time.
    #[serde(default = "daily_plan_time")]
    pub daily_plan_time: String,
    #[serde(default = "deadline_lead_days")]
    pub deadline_lead_days: i64,
    #[serde(default = "occasion_lead_days")]
    pub occasion_lead_days: i64,
    /// Per-event on/off switches, keyed by the ids in [`crate::notifications`].
    ///
    /// Stored as a full map rather than a list of overrides so that flipping a
    /// default in a later version does not silently change what an existing
    /// user already sees. Unknown keys are dropped and missing ones filled in
    /// from the catalogue, so the map stays in step with the code.
    #[serde(default = "notification_events")]
    pub notification_events: BTreeMap<String, bool>,
    /// `HH:MM-HH:MM`, or empty for none. Inside the window nothing is sent.
    #[serde(default = "quiet_hours")]
    pub quiet_hours: String,

    // -- dashboard ---------------------------------------------------------
    #[serde(default = "dashboard_cards")]
    pub dashboard_cards: Vec<String>,
    #[serde(default = "yes")]
    pub dashboard_show_greeting: bool,

    // -- dárky a peníze ----------------------------------------------------
    #[serde(default = "currency")]
    pub currency: String,
    /// For showing the screen to the family without spoiling the amounts.
    /// Off by default - the whole point of the budget is seeing it.
    #[serde(default = "no")]
    pub gifts_hide_prices: bool,

    // -- data (override the .env defaults) ---------------------------------
    #[serde(default)]
    pub backup_keep: Option<usize>,
    #[serde(default)]
    pub backup_interval_minutes: Option<i64>,
    #[serde(default)]
    pub max_attachment_mb: Option<u64>,
    #[serde(default = "yes")]
    pub backup_on_start: bool,
}

impl Default for Settings {
    fn default() -> Self {
        // Round-tripping an empty object through serde applies every
        // `#[serde(default)]` above, so the defaults live in exactly one place.
        serde_json::from_str("{}").expect("default settings must deserialise")
    }
}

impl Settings {
    /// Clamps everything into a usable range and rejects what cannot be fixed.
    ///
    /// A font scale of 40 or an empty preset list would make the app unusable,
    /// and the user would have no way back except editing the database. So the
    /// backend refuses to store nonsense rather than trusting the UI.
    pub fn validate(&mut self) -> Result<()> {
        let bad = |m: &str| AppError::Validation(m.to_string());

        let accent = self.accent.trim().to_lowercase();
        let accent_ok = accent.len() == 7
            && accent.starts_with('#')
            && accent[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !accent_ok {
            return Err(bad("barva zvýraznění se zadává ve tvaru #4f7cff"));
        }
        self.accent = accent;

        if !self.font_scale.is_finite() {
            return Err(bad("velikost písma není číslo"));
        }
        self.font_scale = self.font_scale.clamp(0.85, 1.4);

        if self.first_weekday > 6 {
            return Err(bad("první den týdne musí být 0 (pondělí) až 6 (neděle)"));
        }

        self.auto_archive_days = self.auto_archive_days.clamp(0, 3650);
        self.archive_page_size = self.archive_page_size.clamp(20, 1000);
        self.upcoming_days = self.upcoming_days.clamp(7, 365);
        self.deadline_lead_days = self.deadline_lead_days.clamp(0, 60);
        self.occasion_lead_days = self.occasion_lead_days.clamp(0, 365);

        self.focus_minutes = self.focus_minutes.clamp(1, 180);
        self.focus_break_minutes = self.focus_break_minutes.clamp(1, 60);
        self.focus_presets.retain(|m| (1..=180).contains(m));
        self.focus_presets.sort_unstable();
        self.focus_presets.dedup();
        if self.focus_presets.is_empty() {
            self.focus_presets = focus_presets();
        }
        self.focus_presets.truncate(6);

        if !is_hhmm(&self.daily_plan_time) {
            return Err(bad("čas denního přehledu se zadává ve tvaru 08:30"));
        }

        if !self.quiet_hours.is_empty() {
            let ok = self
                .quiet_hours
                .split_once('-')
                .is_some_and(|(from, to)| is_hhmm(from) && is_hhmm(to));
            if !ok {
                return Err(bad("tichý režim se zadává ve tvaru 22:00-07:00"));
            }
        }

        // Drop switches for events this build does not have, and fill in any
        // the user has never seen. Without this a rename would leave dead keys
        // behind and a new notification would have no entry at all.
        self.notification_events
            .retain(|id, _| notifications::is_known(id));
        for (id, default_on) in notifications::defaults() {
            self.notification_events.entry(id).or_insert(default_on);
        }

        let currency = self.currency.trim();
        if currency.is_empty() || currency.chars().count() > 8 {
            return Err(bad("měna musí mít 1 až 8 znaků"));
        }
        self.currency = currency.to_string();

        // Only cards the UI knows how to draw, and no duplicates.
        const KNOWN_CARDS: &[&str] = &[
            "today", "overdue", "week", "progress", "occasions", "notes", "streak", "inbox",
        ];
        self.dashboard_cards
            .retain(|c| KNOWN_CARDS.contains(&c.as_str()));
        let mut seen = std::collections::HashSet::new();
        self.dashboard_cards.retain(|c| seen.insert(c.clone()));

        if let Some(v) = self.backup_keep {
            self.backup_keep = Some(v.clamp(1, 1000));
        }
        if let Some(v) = self.backup_interval_minutes {
            self.backup_interval_minutes = Some(v.clamp(0, 60 * 24 * 30));
        }
        if let Some(v) = self.max_attachment_mb {
            self.max_attachment_mb = Some(v.clamp(1, 4096));
        }
        Ok(())
    }

    /// Whether a given notification should actually be sent.
    ///
    /// One function so that "is the master switch on", "is this event on" and
    /// "are we inside quiet hours" cannot drift apart between call sites.
    /// `now_hhmm` is the caller's local wall-clock time.
    pub fn notification_enabled(&self, event_id: &str, now_hhmm: &str) -> bool {
        if !self.notifications_enabled {
            return false;
        }
        if in_quiet_hours(&self.quiet_hours, now_hhmm) {
            return false;
        }
        match self.notification_events.get(event_id) {
            Some(on) => *on,
            // An event the settings have not caught up with yet falls back to
            // its catalogue default rather than being silently swallowed.
            None => notifications::find(event_id).is_some_and(|e| e.default_on),
        }
    }

    // -- effective values, .env acting as the default ----------------------

    pub fn effective_backup_keep(&self, cfg: &Config) -> usize {
        self.backup_keep.unwrap_or(cfg.backup_keep)
    }

    pub fn effective_backup_interval(&self, cfg: &Config) -> i64 {
        self.backup_interval_minutes
            .unwrap_or(cfg.backup_min_interval_minutes)
    }

    pub fn effective_max_attachment_bytes(&self, cfg: &Config) -> u64 {
        self.max_attachment_mb
            .map(|mb| mb * 1024 * 1024)
            .unwrap_or(cfg.max_attachment_bytes)
    }
}

/// Whether `now` falls inside a `HH:MM-HH:MM` window.
///
/// A window that ends before it starts wraps over midnight, which is the
/// normal case for "quiet from 22:00 to 07:00".
pub fn in_quiet_hours(window: &str, now: &str) -> bool {
    let Some((from, to)) = window.split_once('-') else {
        return false;
    };
    if !(is_hhmm(from) && is_hhmm(to) && is_hhmm(now)) {
        return false;
    }
    if from == to {
        return false; // a zero-length window is "never", not "always"
    }
    if from < to {
        now >= from && now < to
    } else {
        now >= from || now < to
    }
}

fn is_hhmm(s: &str) -> bool {
    let Some((h, m)) = s.split_once(':') else {
        return false;
    };
    matches!((h.parse::<u32>(), m.parse::<u32>()), (Ok(h), Ok(m)) if h < 24 && m < 60)
        && h.len() == 2
        && m.len() == 2
}

impl Store {
    /// Reads the stored settings, falling back to the defaults.
    ///
    /// A corrupt or hand-edited blob yields the defaults rather than an error:
    /// being unable to open the app because a preference is malformed would be
    /// a much worse failure than silently resetting it.
    pub fn settings(&self) -> Result<Settings> {
        match self.meta_get(KEY)? {
            None => Ok(Settings::default()),
            Some(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        }
    }

    pub fn save_settings(&self, mut settings: Settings) -> Result<Settings> {
        settings.validate()?;
        self.meta_set(KEY, &serde_json::to_string(&settings)?)?;
        Ok(settings)
    }

    pub fn reset_settings(&self) -> Result<Settings> {
        let defaults = Settings::default();
        self.meta_set(KEY, &serde_json::to_string(&defaults)?)?;
        Ok(defaults)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid() {
        let mut s = Settings::default();
        assert!(s.validate().is_ok());
        assert_eq!(s.theme, Theme::System);
        assert_eq!(s.first_weekday, 0, "Czech weeks start on Monday");
        assert_eq!(s.currency, "Kč");
        assert_eq!(s.focus_minutes, 25);
    }

    #[test]
    fn an_empty_object_gets_every_default() {
        // This is what happens when an old database meets a new build.
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.accent, "#4f7cff");
        assert_eq!(s.focus_presets, vec![10, 25, 45]);
        assert!(s.dashboard_cards.contains(&"today".to_string()));
    }

    #[test]
    fn a_partial_object_keeps_the_rest_of_the_defaults() {
        let s: Settings = serde_json::from_str(r#"{"theme":"dark","font_scale":1.2}"#).unwrap();
        assert_eq!(s.theme, Theme::Dark);
        assert_eq!(s.font_scale, 1.2);
        assert_eq!(s.currency, "Kč", "untouched fields still default");
    }

    #[test]
    fn nonsense_is_clamped_rather_than_stored() {
        let mut s = Settings::default();
        s.font_scale = 40.0;
        s.focus_minutes = 9999;
        s.upcoming_days = 100_000;
        s.archive_page_size = 1;
        s.validate().unwrap();
        assert_eq!(s.font_scale, 1.4);
        assert_eq!(s.focus_minutes, 180);
        assert_eq!(s.upcoming_days, 365);
        assert_eq!(s.archive_page_size, 20);
    }

    #[test]
    fn an_empty_preset_list_falls_back_instead_of_leaving_no_buttons() {
        let mut s = Settings::default();
        s.focus_presets = vec![0, 500];
        s.validate().unwrap();
        assert_eq!(s.focus_presets, vec![10, 25, 45]);
    }

    #[test]
    fn presets_are_sorted_and_de_duplicated() {
        let mut s = Settings::default();
        s.focus_presets = vec![45, 10, 25, 10];
        s.validate().unwrap();
        assert_eq!(s.focus_presets, vec![10, 25, 45]);
    }

    #[test]
    fn bad_values_are_refused_with_a_message() {
        let mut s = Settings::default();
        s.accent = "blue".into();
        assert!(s.validate().unwrap_err().to_string().contains("#4f7cff"));

        let mut s = Settings::default();
        s.daily_plan_time = "8:30".into();
        assert!(s.validate().unwrap_err().to_string().contains("08:30"));

        let mut s = Settings::default();
        s.first_weekday = 9;
        assert!(s.validate().is_err());

        let mut s = Settings::default();
        s.currency = "  ".into();
        assert!(s.validate().is_err());
    }

    #[test]
    fn unknown_dashboard_cards_are_dropped() {
        let mut s = Settings::default();
        s.dashboard_cards = vec!["today".into(), "nonsense".into(), "today".into()];
        s.validate().unwrap();
        assert_eq!(s.dashboard_cards, vec!["today".to_string()]);
    }

    #[test]
    fn hhmm_accepts_only_a_real_clock_time() {
        assert!(is_hhmm("00:00"));
        assert!(is_hhmm("23:59"));
        assert!(!is_hhmm("24:00"));
        assert!(!is_hhmm("12:60"));
        assert!(!is_hhmm("8:30"), "must be zero-padded");
        assert!(!is_hhmm("0830"));
        assert!(!is_hhmm(""));
    }

    #[test]
    fn env_provides_the_default_and_the_ui_overrides_it() {
        let cfg = Config {
            data_dir: ".".into(),
            backup_keep: 20,
            backup_min_interval_minutes: 60,
            max_attachment_bytes: 64 * 1024 * 1024,
            debug: false,
        };
        let mut s = Settings::default();
        assert_eq!(s.effective_backup_keep(&cfg), 20, "falls back to .env");

        s.backup_keep = Some(5);
        s.max_attachment_mb = Some(10);
        assert_eq!(s.effective_backup_keep(&cfg), 5);
        assert_eq!(s.effective_max_attachment_bytes(&cfg), 10 * 1024 * 1024);
    }
}

#[cfg(test)]
mod notification_tests {
    use super::*;

    #[test]
    fn defaults_include_every_catalogue_event() {
        let s = Settings::default();
        assert_eq!(s.notification_events.len(), notifications::CATALOGUE.len());
        assert_eq!(s.notification_events["focus.finished"], true);
        assert_eq!(s.notification_events["task.created"], false);
    }

    #[test]
    fn the_master_switch_silences_everything() {
        let mut s = Settings::default();
        assert!(s.notification_enabled("focus.finished", "12:00"));
        s.notifications_enabled = false;
        assert!(!s.notification_enabled("focus.finished", "12:00"));
        assert!(!s.notification_enabled("data.backup_failed", "12:00"));
    }

    #[test]
    fn an_individual_switch_only_affects_its_own_event() {
        let mut s = Settings::default();
        s.notification_events.insert("focus.finished".into(), false);
        s.notification_events.insert("task.created".into(), true);
        assert!(!s.notification_enabled("focus.finished", "12:00"));
        assert!(s.notification_enabled("task.created", "12:00"));
        assert!(
            s.notification_enabled("data.backup_failed", "12:00"),
            "untouched events keep their own setting"
        );
    }

    #[test]
    fn an_event_the_settings_have_not_seen_falls_back_to_its_default() {
        // What happens right after an update adds a new notification.
        let mut s = Settings::default();
        s.notification_events.remove("focus.finished");
        s.notification_events.remove("task.created");
        assert!(s.notification_enabled("focus.finished", "12:00"));
        assert!(!s.notification_enabled("task.created", "12:00"));
    }

    #[test]
    fn validation_drops_unknown_keys_and_fills_in_missing_ones() {
        let mut s = Settings::default();
        s.notification_events.insert("task.invented".into(), true);
        s.notification_events.remove("focus.finished");
        s.validate().unwrap();

        assert!(!s.notification_events.contains_key("task.invented"));
        assert_eq!(
            s.notification_events["focus.finished"], true,
            "a missing event comes back at its default"
        );
        assert_eq!(s.notification_events.len(), notifications::CATALOGUE.len());
    }

    #[test]
    fn validation_keeps_a_choice_that_differs_from_the_default() {
        let mut s = Settings::default();
        s.notification_events.insert("task.created".into(), true);
        s.notification_events.insert("focus.finished".into(), false);
        s.validate().unwrap();
        assert!(s.notification_events["task.created"]);
        assert!(!s.notification_events["focus.finished"]);
    }

    #[test]
    fn quiet_hours_silence_the_window_and_nothing_else() {
        let mut s = Settings::default();
        s.quiet_hours = "22:00-07:00".into();
        s.validate().unwrap();

        assert!(!s.notification_enabled("focus.finished", "23:30"), "late evening");
        assert!(!s.notification_enabled("focus.finished", "02:00"), "after midnight");
        assert!(!s.notification_enabled("focus.finished", "22:00"), "the start is inclusive");
        assert!(s.notification_enabled("focus.finished", "07:00"), "the end is not");
        assert!(s.notification_enabled("focus.finished", "12:00"), "midday");
    }

    #[test]
    fn a_daytime_quiet_window_does_not_wrap() {
        assert!(in_quiet_hours("09:00-17:00", "12:00"));
        assert!(!in_quiet_hours("09:00-17:00", "08:00"));
        assert!(!in_quiet_hours("09:00-17:00", "18:00"));
    }

    #[test]
    fn no_quiet_window_means_never_quiet() {
        assert!(!in_quiet_hours("", "03:00"));
        assert!(!in_quiet_hours("22:00-22:00", "22:00"), "zero length is never");
        assert!(!in_quiet_hours("nonsense", "03:00"));
    }

    #[test]
    fn a_malformed_quiet_window_is_refused_rather_than_stored() {
        let mut s = Settings::default();
        s.quiet_hours = "22-7".into();
        assert!(s.validate().unwrap_err().to_string().contains("22:00-07:00"));

        let mut s = Settings::default();
        s.quiet_hours = "22:00".into();
        assert!(s.validate().is_err());

        let mut s = Settings::default();
        s.quiet_hours = String::new();
        assert!(s.validate().is_ok(), "empty means no quiet hours");
    }

    #[test]
    fn an_older_database_gains_the_new_switches() {
        // A settings blob written before notifications were switchable.
        let s: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(s.notification_events.len(), notifications::CATALOGUE.len());
        assert_eq!(s.quiet_hours, "");
    }
}
