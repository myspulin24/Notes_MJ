//! IPC for the dashboard, calendar, notebook, occasions, gifts and settings.
//!
//! Kept apart from `commands.rs` only so neither file becomes a wall of
//! one-line wrappers. The rule is the same: lock the store, call one method,
//! return.

use chrono::NaiveDate;
use tauri::State;

use crate::commands::{parse_today, AppState};
use crate::error::Result;
use crate::insights::{CalendarDay, Dashboard};
use crate::planner::{
    GiftIdea, GiftPatch, NoteDetail, NotePatch, Occasion, OccasionDetail, OccasionKind,
    OccasionPatch,
};
use crate::notifications::{grouped_catalogue, CatalogueGroup};
use crate::settings::Settings;

// -- dashboard & calendar -----------------------------------------------------

#[tauri::command]
pub fn dashboard(state: State<'_, AppState>, today: String) -> Result<Dashboard> {
    let store = state.lock()?;
    store.dashboard(parse_today(&today)?)
}

#[tauri::command]
pub fn calendar_range(
    state: State<'_, AppState>,
    from: String,
    to: String,
    include_completed: Option<bool>,
) -> Result<Vec<CalendarDay>> {
    let store = state.lock()?;
    let include = match include_completed {
        Some(v) => v,
        // Fall back to the user's calendar preference when the UI does not say.
        None => store.settings()?.calendar_show_completed,
    };
    store.calendar_range(parse_today(&from)?, parse_today(&to)?, include)
}

// -- notebook -----------------------------------------------------------------

#[tauri::command]
pub fn list_notes(state: State<'_, AppState>, search: Option<String>) -> Result<Vec<NoteDetail>> {
    state.lock()?.list_notes(search.as_deref())
}

#[tauri::command]
pub fn get_note(state: State<'_, AppState>, id: String) -> Result<NoteDetail> {
    state.lock()?.get_note(&id)
}

#[tauri::command]
pub fn create_note(
    state: State<'_, AppState>,
    title: String,
    body: Option<String>,
) -> Result<NoteDetail> {
    state
        .lock()?
        .create_note(&title, body.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn update_note(
    state: State<'_, AppState>,
    id: String,
    patch: NotePatch,
) -> Result<NoteDetail> {
    state.lock()?.update_note(&id, patch)
}

#[tauri::command]
pub fn delete_note(state: State<'_, AppState>, id: String) -> Result<()> {
    state.lock()?.delete_note(&id)
}

// -- occasions ----------------------------------------------------------------

#[tauri::command]
pub fn list_occasions(state: State<'_, AppState>, today: String) -> Result<Vec<OccasionDetail>> {
    state.lock()?.list_occasions(parse_today(&today)?)
}

#[tauri::command]
pub fn get_occasion(
    state: State<'_, AppState>,
    id: String,
    today: String,
) -> Result<OccasionDetail> {
    let today = parse_today(&today)?;
    state.lock()?.get_occasion(&id, today)
}

#[tauri::command]
pub fn create_occasion(
    state: State<'_, AppState>,
    name: String,
    kind: OccasionKind,
    on_date: String,
    yearly: Option<bool>,
    today: String,
) -> Result<OccasionDetail> {
    let on_date: NaiveDate = parse_today(&on_date)?;
    let today = parse_today(&today)?;
    state
        .lock()?
        .create_occasion(&name, kind, on_date, yearly.unwrap_or(true), today)
}

#[tauri::command]
pub fn update_occasion(
    state: State<'_, AppState>,
    id: String,
    patch: OccasionPatch,
    today: String,
) -> Result<OccasionDetail> {
    let today = parse_today(&today)?;
    state.lock()?.update_occasion(&id, patch, today)
}

#[tauri::command]
pub fn delete_occasion(state: State<'_, AppState>, id: String) -> Result<()> {
    state.lock()?.delete_occasion(&id)
}

/// Every occasion, ignoring the date filter. Used by the calendar legend.
#[tauri::command]
pub fn all_occasions(state: State<'_, AppState>) -> Result<Vec<Occasion>> {
    let store = state.lock()?;
    let mut stmt = store
        .conn
        .prepare("SELECT * FROM occasions ORDER BY on_date")?;
    let rows = stmt.query_map([], Occasion::from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// -- gifts --------------------------------------------------------------------

#[tauri::command]
pub fn create_gift(
    state: State<'_, AppState>,
    occasion_id: String,
    title: String,
    recipient: Option<String>,
) -> Result<GiftIdea> {
    state
        .lock()?
        .create_gift(&occasion_id, &title, recipient.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn update_gift(state: State<'_, AppState>, id: String, patch: GiftPatch) -> Result<GiftIdea> {
    state.lock()?.update_gift(&id, patch)
}

#[tauri::command]
pub fn delete_gift(state: State<'_, AppState>, id: String) -> Result<()> {
    state.lock()?.delete_gift(&id)
}

// -- settings -----------------------------------------------------------------

/// The notification catalogue, so the settings page renders itself from the
/// same list the backend validates against.
#[tauri::command]
pub fn notification_catalogue() -> Vec<CatalogueGroup> {
    grouped_catalogue()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings> {
    state.lock()?.settings()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings> {
    state.lock()?.save_settings(settings)
}

#[tauri::command]
pub fn reset_settings(state: State<'_, AppState>) -> Result<Settings> {
    state.lock()?.reset_settings()
}
