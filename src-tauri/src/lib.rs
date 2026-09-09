//! Notes_MJ - a local-first personal planner.
//!
//! Author: Michal Jašek. Copyright 2026.
//!
//! Everything the app knows lives in one SQLite file in the user's home
//! directory. There is no account, no server and no telemetry, and the only
//! paths Notes_MJ writes to are its own data directory and wherever the user
//! explicitly points an export.
//!
//! The single exception to "no network" is the updater: it asks GitHub whether
//! a newer release exists, sends nothing about the user in doing so, and can be
//! switched off. Anything it downloads must carry a signature made with the key
//! whose public half is compiled into this binary.

pub mod backup;
pub mod commands;
pub mod commands_planner;
pub mod db;
pub mod insights;
pub mod error;
pub mod models;
pub mod notifications;
pub mod paths;
pub mod planner;
pub mod recur;
pub mod settings;
pub mod store;
pub mod transfer;

use std::sync::Mutex;

use commands::AppState;
use db::Store;
use paths::Config;

/// Builds and runs the desktop application.
pub fn run() {
    let cfg = Config::load();
    let debug = cfg.debug;

    let store = match Store::open(cfg) {
        Ok(store) => store,
        Err(e) => {
            // There is no window yet, so this is the one place a message box is
            // the only way to say anything useful.
            eprintln!("Notes_MJ se nepodařilo otevřít databázi: {e}");
            rfd_fallback(&format!(
                "Notes_MJ se nepodařilo otevřít databázi.\n\n{e}\n\nZkontrolujte, že složka existuje a lze do ní zapisovat, \
                 nebo v souboru .env nastavte T3_DATA_DIR na jiné umístění."
            ));
            std::process::exit(1);
        }
    };

    // Files whose rows were deleted in an earlier session are safe to drop now.
    match store.sweep_orphan_attachments() {
        Ok(n) if n > 0 && debug => eprintln!("swept {n} orphaned attachment file(s)"),
        Err(e) if debug => eprintln!("attachment sweep skipped: {e}"),
        _ => {}
    }

    let mut builder = tauri::Builder::default();

    // The updater talks to GitHub over HTTPS and checks a signature before it
    // trusts anything. It is the one and only network call Notes_MJ ever makes,
    // it happens only when asked, and it carries nothing about the user.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { store: Mutex::new(store) })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::list_view,
            commands::get_counts,
            commands::list_project_tasks,
            commands::list_area_tasks,
            commands::search_tasks,
            commands::get_task,
            commands::create_task,
            commands::update_task,
            commands::set_task_status,
            commands::delete_task,
            commands::reorder_task,
            commands::list_areas,
            commands::create_area,
            commands::rename_area,
            commands::delete_area,
            commands::list_projects,
            commands::create_project,
            commands::update_project,
            commands::set_project_status,
            commands::delete_project,
            commands::list_tags,
            commands::set_tag_color,
            commands::delete_tag,
            commands::list_saved_filters,
            commands::save_filter,
            commands::delete_saved_filter,
            commands::undo,
            commands::redo,
            commands::undo_state,
            commands::preview_recurrence,
            commands::add_attachment,
            commands::remove_attachment,
            commands::attachment_path,
            commands::export_json,
            commands::export_bundle,
            commands::inspect_import,
            commands::import_json,
            commands::backup_now,
            commands::list_backups,
            commands::health,
            // dashboard, calendar, notebook, occasions, gifts, settings
            commands_planner::dashboard,
            commands_planner::calendar_range,
            commands_planner::list_notes,
            commands_planner::get_note,
            commands_planner::create_note,
            commands_planner::update_note,
            commands_planner::delete_note,
            commands_planner::list_occasions,
            commands_planner::get_occasion,
            commands_planner::create_occasion,
            commands_planner::update_occasion,
            commands_planner::delete_occasion,
            commands_planner::all_occasions,
            commands_planner::create_gift,
            commands_planner::update_gift,
            commands_planner::delete_gift,
            commands_planner::notification_catalogue,
            commands_planner::get_settings,
            commands_planner::save_settings,
            commands_planner::reset_settings,
        ])
        .run(tauri::generate_context!())
        .expect("Notes_MJ se nepodařilo spustit");
}

/// Last-resort message when the UI cannot be shown. Uses the OS message box on
/// Windows and falls back to stderr elsewhere.
fn rfd_fallback(message: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        extern "system" {
            fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, utype: u32) -> i32;
        }
        let to_wide = |s: &str| {
            std::ffi::OsStr::new(s)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect::<Vec<u16>>()
        };
        let text = to_wide(message);
        let caption = to_wide("Notes_MJ");
        // MB_OK | MB_ICONERROR
        unsafe { MessageBoxW(0, text.as_ptr(), caption.as_ptr(), 0x10) };
    }
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("{message}");
    }
}
