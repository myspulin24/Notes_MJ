//! The IPC surface.
//!
//! Every command is a thin wrapper: lock the store, call one method, return.
//! The logic lives in `store.rs` / `transfer.rs` / `backup.rs` so that the
//! end-to-end test can exercise it without a window, and so that reviewing the
//! trust boundary means reading one short file.
//!
//! Nothing here takes a path from the UI and uses it unchecked - attachment and
//! export paths are resolved against the data directory or come from the OS
//! file dialog, and `paths::ensure_within` is the backstop.

use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{NaiveDate, Utc};
use serde::Serialize;
use tauri::State;

use crate::backup::{BackupInfo, BackupOutcome};
use crate::db::Store;
use crate::error::{AppError, Result};
use crate::models::*;
use crate::recur::RecurrenceRule;
use crate::store::{Counts, SearchFilter, ViewPayload};
use crate::transfer::{ExportFile, ImportMode, ImportReport};

pub struct AppState {
    pub store: Mutex<Store>,
}

impl AppState {
    /// Locks the store. A poisoned mutex means another command panicked; treat
    /// that as internal rather than panicking a second time.
    pub(crate) fn lock(&self) -> Result<std::sync::MutexGuard<'_, Store>> {
        self.store
            .lock()
            .map_err(|_| AppError::Internal("databáze je v nekonzistentním stavu - restartujte Notes_MJ".into()))
    }
}

/// Everything the UI needs on launch, in one round trip: no loading waterfall.
#[derive(Serialize)]
pub struct Bootstrap {
    pub app_version: String,
    pub data_dir: String,
    pub attachments_dir: String,
    pub backups_dir: String,
    pub counts: Counts,
    pub areas: Vec<Area>,
    pub projects: Vec<Project>,
    pub tags: Vec<Tag>,
    pub saved_filters: Vec<SavedFilter>,
    pub undo_label: Option<String>,
    pub redo_label: Option<String>,
    /// `None` when the startup backup could not be taken; the UI shows a
    /// dismissible warning rather than blocking.
    pub backup: Option<BackupOutcome>,
}

#[tauri::command]
pub fn bootstrap(state: State<'_, AppState>, today: String) -> Result<Bootstrap> {
    let store = state.lock()?;
    let today = parse_today(&today)?;
    // A failed backup must never stop the app from opening.
    let backup = store.backup_if_due().ok();
    Ok(Bootstrap {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: store.cfg.data_dir.to_string_lossy().to_string(),
        attachments_dir: store.cfg.attachments_dir().to_string_lossy().to_string(),
        backups_dir: store.cfg.backups_dir().to_string_lossy().to_string(),
        counts: store.counts(today)?,
        areas: store.list_areas()?,
        projects: store.list_projects(false)?,
        tags: store.list_tags()?,
        saved_filters: store.list_saved_filters()?,
        undo_label: store.undo_state()?.0,
        redo_label: store.undo_state()?.1,
        backup,
    })
}

pub(crate) fn parse_today(s: &str) -> Result<NaiveDate> {
    // The UI sends its own local date, so "today" matches the user's clock and
    // time zone rather than the server-ish UTC the backend would otherwise use.
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| AppError::Validation(format!("'{s}' není datum")))
}

// -- views --------------------------------------------------------------------

#[tauri::command]
pub fn list_view(
    state: State<'_, AppState>,
    view: View,
    today: String,
    offset: Option<i64>,
) -> Result<ViewPayload> {
    let store = state.lock()?;
    store.list_view(view, parse_today(&today)?, offset.unwrap_or(0))
}

#[tauri::command]
pub fn get_counts(state: State<'_, AppState>, today: String) -> Result<Counts> {
    let store = state.lock()?;
    store.counts(parse_today(&today)?)
}

#[tauri::command]
pub fn list_project_tasks(state: State<'_, AppState>, project_id: String) -> Result<Vec<TaskDetail>> {
    state.lock()?.list_project_tasks(&project_id)
}

#[tauri::command]
pub fn list_area_tasks(state: State<'_, AppState>, area_id: String) -> Result<Vec<TaskDetail>> {
    state.lock()?.list_area_tasks(&area_id)
}

#[tauri::command]
pub fn search_tasks(state: State<'_, AppState>, filter: SearchFilter) -> Result<Vec<TaskDetail>> {
    state.lock()?.search(&filter)
}

#[tauri::command]
pub fn get_task(state: State<'_, AppState>, id: String) -> Result<TaskDetail> {
    state.lock()?.task_detail(&id)
}

// -- tasks --------------------------------------------------------------------

#[tauri::command]
pub fn create_task(state: State<'_, AppState>, input: NewTask) -> Result<TaskDetail> {
    state.lock()?.create_task(input)
}

#[tauri::command]
pub fn update_task(state: State<'_, AppState>, id: String, patch: TaskPatch) -> Result<TaskDetail> {
    state.lock()?.update_task(&id, patch)
}

#[tauri::command]
pub fn set_task_status(
    state: State<'_, AppState>,
    id: String,
    status: TaskStatus,
    today: String,
) -> Result<TaskDetail> {
    let today = parse_today(&today)?;
    state.lock()?.set_task_status(&id, status, today)
}

#[tauri::command]
pub fn delete_task(state: State<'_, AppState>, id: String) -> Result<()> {
    state.lock()?.delete_task(&id)
}

#[tauri::command]
pub fn reorder_task(state: State<'_, AppState>, id: String, position: f64) -> Result<()> {
    state.lock()?.reorder_task(&id, position)
}

// -- areas & projects ---------------------------------------------------------

#[tauri::command]
pub fn list_areas(state: State<'_, AppState>) -> Result<Vec<Area>> {
    state.lock()?.list_areas()
}

#[tauri::command]
pub fn create_area(state: State<'_, AppState>, name: String) -> Result<Area> {
    state.lock()?.create_area(&name)
}

#[tauri::command]
pub fn rename_area(state: State<'_, AppState>, id: String, name: String) -> Result<Area> {
    state.lock()?.rename_area(&id, &name)
}

#[tauri::command]
pub fn delete_area(state: State<'_, AppState>, id: String) -> Result<()> {
    state.lock()?.delete_area(&id)
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>, include_done: Option<bool>) -> Result<Vec<Project>> {
    state.lock()?.list_projects(include_done.unwrap_or(false))
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    name: String,
    area_id: Option<String>,
    notes: Option<String>,
) -> Result<Project> {
    state
        .lock()?
        .create_project(&name, area_id.as_deref(), notes.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn update_project(
    state: State<'_, AppState>,
    id: String,
    patch: TaskPatch,
) -> Result<Project> {
    state.lock()?.update_project(&id, &patch)
}

#[tauri::command]
pub fn set_project_status(
    state: State<'_, AppState>,
    id: String,
    status: TaskStatus,
) -> Result<Project> {
    state.lock()?.set_project_status(&id, status)
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> Result<()> {
    state.lock()?.delete_project(&id)
}

// -- tags & filters -----------------------------------------------------------

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>> {
    state.lock()?.list_tags()
}

#[tauri::command]
pub fn set_tag_color(state: State<'_, AppState>, id: String, color: String) -> Result<Tag> {
    state.lock()?.set_tag_color(&id, &color)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: String) -> Result<()> {
    state.lock()?.delete_tag(&id)
}

#[tauri::command]
pub fn list_saved_filters(state: State<'_, AppState>) -> Result<Vec<SavedFilter>> {
    state.lock()?.list_saved_filters()
}

#[tauri::command]
pub fn save_filter(state: State<'_, AppState>, name: String, query: String) -> Result<SavedFilter> {
    state.lock()?.save_filter(&name, &query)
}

#[tauri::command]
pub fn delete_saved_filter(state: State<'_, AppState>, id: String) -> Result<()> {
    state.lock()?.delete_saved_filter(&id)
}

// -- undo ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct UndoResult {
    /// What was undone or redone, for the toast. `None` means nothing to do.
    pub label: Option<String>,
    pub undo_label: Option<String>,
    pub redo_label: Option<String>,
}

#[tauri::command]
pub fn undo(state: State<'_, AppState>) -> Result<UndoResult> {
    let mut store = state.lock()?;
    let label = store.undo()?;
    let (undo_label, redo_label) = store.undo_state()?;
    Ok(UndoResult { label, undo_label, redo_label })
}

#[tauri::command]
pub fn redo(state: State<'_, AppState>) -> Result<UndoResult> {
    let mut store = state.lock()?;
    let label = store.redo()?;
    let (undo_label, redo_label) = store.undo_state()?;
    Ok(UndoResult { label, undo_label, redo_label })
}

#[tauri::command]
pub fn undo_state(state: State<'_, AppState>) -> Result<UndoResult> {
    let store = state.lock()?;
    let (undo_label, redo_label) = store.undo_state()?;
    Ok(UndoResult { label: None, undo_label, redo_label })
}

// -- recurrence preview -------------------------------------------------------

#[derive(Serialize)]
pub struct RecurrencePreview {
    pub description: String,
    pub dates: Vec<String>,
}

/// Validates a rule and shows the next few dates, so the repeat editor can be
/// honest about what the user just built before they save it.
#[tauri::command]
pub fn preview_recurrence(rule: RecurrenceRule, from: String, count: Option<usize>) -> Result<RecurrencePreview> {
    rule.validate()?;
    let from = parse_today(&from)?;
    let horizon = from
        .checked_add_signed(chrono::Duration::days(365 * 12))
        .unwrap_or(from);
    let dates = rule
        .occurrences_between(from, horizon, count.unwrap_or(5).clamp(1, 50))
        .into_iter()
        .map(|d| d.format("%Y-%m-%d").to_string())
        .collect();
    Ok(RecurrencePreview { description: rule.describe(), dates })
}

// -- attachments --------------------------------------------------------------

#[tauri::command]
pub fn add_attachment(
    state: State<'_, AppState>,
    task_id: String,
    source_path: String,
) -> Result<Attachment> {
    let source = PathBuf::from(&source_path);
    if !source.is_absolute() {
        return Err(AppError::Validation(
            "vyberte soubor přes dialog pro výběr souboru".into(),
        ));
    }
    state.lock()?.add_attachment(&task_id, &source)
}

#[tauri::command]
pub fn remove_attachment(state: State<'_, AppState>, id: String) -> Result<()> {
    state.lock()?.remove_attachment(&id)
}

/// Absolute path of an attachment, for the "reveal in Explorer" action.
#[tauri::command]
pub fn attachment_path(state: State<'_, AppState>, id: String) -> Result<String> {
    Ok(state.lock()?.attachment_path(&id)?.to_string_lossy().to_string())
}

// -- export / import ----------------------------------------------------------

#[tauri::command]
pub fn export_json(state: State<'_, AppState>, path: String) -> Result<u64> {
    let path = PathBuf::from(&path);
    if !path.is_absolute() {
        return Err(AppError::Validation("zvolte, kam soubor uložit".into()));
    }
    state.lock()?.export_to_file(&path)
}

#[tauri::command]
pub fn export_bundle(state: State<'_, AppState>, dir: String) -> Result<String> {
    let dir = PathBuf::from(&dir);
    if !dir.is_absolute() {
        return Err(AppError::Validation("zvolte složku, do které se má export uložit".into()));
    }
    state.lock()?.export_bundle(&dir)
}

/// Reads a file and reports what is in it, without importing anything.
#[tauri::command]
pub fn inspect_import(path: String) -> Result<ImportSummary> {
    let json = read_import_file(&PathBuf::from(&path))?;
    let doc: ExportFile = Store::inspect_import(&json)?;
    Ok(ImportSummary {
        version: doc.version,
        exported_at: doc.exported_at,
        app_version: doc.app_version,
        areas: doc.areas.len(),
        projects: doc.projects.len(),
        tags: doc.tags.len(),
        tasks: doc.tasks.len(),
        saved_filters: doc.saved_filters.len(),
    })
}

#[derive(Serialize)]
pub struct ImportSummary {
    pub version: u32,
    pub exported_at: String,
    pub app_version: String,
    pub areas: usize,
    pub projects: usize,
    pub tags: usize,
    pub tasks: usize,
    pub saved_filters: usize,
}

#[tauri::command]
pub fn import_json(
    state: State<'_, AppState>,
    path: String,
    mode: ImportMode,
    with_settings: Option<bool>,
) -> Result<ImportReport> {
    let json = read_import_file(&PathBuf::from(&path))?;
    state
        .lock()?
        .import_json(&json, mode, with_settings.unwrap_or(false))
}

/// 256 MB of JSON is far past anything a personal task list produces; refusing
/// larger files keeps a mis-selected video from exhausting memory.
const MAX_IMPORT_BYTES: u64 = 256 * 1024 * 1024;

fn read_import_file(path: &std::path::Path) -> Result<String> {
    if !path.is_absolute() {
        return Err(AppError::Validation("vyberte soubor k importu".into()));
    }
    let meta = std::fs::metadata(path)
        .map_err(|e| AppError::Io(format!("nelze přečíst {}: {e}", path.display())))?;
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(AppError::Validation(
            "tento soubor je příliš velký na to, aby šlo o export z Notes_MJ".into(),
        ));
    }
    std::fs::read_to_string(path)
        .map_err(|e| AppError::Io(format!("nelze přečíst {}: {e}", path.display())))
}

// -- backups & health ---------------------------------------------------------

#[tauri::command]
pub fn backup_now(state: State<'_, AppState>) -> Result<BackupInfo> {
    state.lock()?.backup_now().map(|(info, _)| info)
}

#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupInfo>> {
    state.lock()?.list_backups()
}

#[derive(Serialize)]
pub struct Health {
    pub data_dir: String,
    pub db_path: String,
    pub db_size_bytes: u64,
    pub integrity: String,
    pub backups: usize,
    pub attachments: usize,
    pub checked_at: String,
}

/// Powers the "Where is my data?" panel: what is on disk, and is it sound.
#[tauri::command]
pub fn health(state: State<'_, AppState>) -> Result<Health> {
    let store = state.lock()?;
    let db_path = store.cfg.db_path();
    Ok(Health {
        data_dir: store.cfg.data_dir.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        db_size_bytes: std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0),
        integrity: crate::store::integrity_check(&store.conn)?,
        backups: store.list_backups()?.len(),
        attachments: std::fs::read_dir(store.cfg.attachments_dir())
            .map(|d| d.flatten().count())
            .unwrap_or(0),
        checked_at: fmt_ts(Utc::now()),
    })
}

/// Quits and reopens the app, used to finish an update.
///
/// Only macOS and Linux need this. On Windows the updater hands over to the
/// NSIS installer, which relaunches for us and never returns here; everywhere
/// else `install` swaps the bundle on disk and comes straight back, leaving
/// the old build still running in memory. Without this the Restart button
/// looks like it did nothing.
///
/// `restart` never returns, so there is no success to report.
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart()
}
