//! A smoke test against a *copy* of the real database on this machine, to
//! prove that a file written by the previous schema survives the upgrade and
//! supports everything the new one added.
//!
//! It skips itself when there is no such file, so a clean checkout still
//! passes. It never writes to the live database — only to a temporary copy.

use std::path::PathBuf;

use chrono::NaiveDate;
use notes_mj_lib::db::Store;
use notes_mj_lib::paths::Config;
use notes_mj_lib::planner::OccasionKind;

fn live_database() -> Option<PathBuf> {
    // Deliberately not using `dirs` here: the test should depend on nothing the
    // library does not already need.
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let path = PathBuf::from(home).join(".t3").join("userdata").join("t3.db");
    path.exists().then_some(path)
}

#[test]
fn a_migrated_database_supports_the_new_features() {
    let Some(live) = live_database() else {
        eprintln!("no live database on this machine, skipping");
        return;
    };

    let dir = tempfile::tempdir().unwrap();
    std::fs::copy(&live, dir.path().join("t3.db")).unwrap();

    let mut store = Store::open(Config {
        data_dir: dir.path().to_path_buf(),
        backup_keep: 2,
        backup_min_interval_minutes: 0,
        max_attachment_bytes: 1024 * 1024,
        debug: false,
    })
    .unwrap();

    let today = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
    let christmas = NaiveDate::from_ymd_opt(2026, 12, 24).unwrap();

    // Everything schema v2 added has to work on the upgraded file.
    let note = store.create_note("Kontrola migrace", "text").unwrap();
    assert_eq!(
        store.get_note(&note.note.id).unwrap().note.title,
        "Kontrola migrace"
    );

    let occasion = store
        .create_occasion("Vánoce", OccasionKind::Christmas, christmas, true, today)
        .unwrap();
    store
        .create_gift(&occasion.occasion.id, "Sluchátka", "Petra")
        .unwrap();
    assert_eq!(
        store
            .get_occasion(&occasion.occasion.id, today)
            .unwrap()
            .gift_count,
        1
    );

    // And the pre-existing machinery still works alongside it.
    let dash = store.dashboard(today).unwrap();
    assert_eq!(dash.week.len(), 7);

    let december = store
        .calendar_range(
            NaiveDate::from_ymd_opt(2026, 12, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 12, 31).unwrap(),
            false,
        )
        .unwrap();
    assert!(december.iter().any(|d| !d.occasions.is_empty()));

    assert_eq!(store.settings().unwrap().currency, "Kč");

    // The task tables came through intact and are still writable.
    let task = store
        .create_task(serde_json::from_value(serde_json::json!({ "title": "Po migraci" })).unwrap())
        .unwrap();
    assert_eq!(task.task.title, "Po migraci");
    assert!(store.counts(today).unwrap().inbox >= 1);
}

#[test]
fn an_older_settings_blob_gains_the_notification_switches() {
    // Regression guard for the real upgrade path: a settings object written
    // before notifications were switchable must come back with the full map,
    // not with an empty one that would silence everything.
    let Some(live) = live_database() else {
        eprintln!("no live database on this machine, skipping");
        return;
    };

    let dir = tempfile::tempdir().unwrap();
    std::fs::copy(&live, dir.path().join("t3.db")).unwrap();

    let store = Store::open(Config {
        data_dir: dir.path().to_path_buf(),
        backup_keep: 2,
        backup_min_interval_minutes: 0,
        max_attachment_bytes: 1024 * 1024,
        debug: false,
    })
    .unwrap();

    let settings = store.settings().unwrap();
    assert_eq!(
        settings.notification_events.len(),
        notes_mj_lib::notifications::CATALOGUE.len(),
        "every switch is present after reading an older blob"
    );
    assert!(
        settings.notification_enabled("focus.finished", "12:00"),
        "an on-by-default notification still fires"
    );
    assert!(
        !settings.notification_enabled("task.created", "12:00"),
        "an off-by-default one still does not"
    );
    assert_eq!(settings.quiet_hours, "", "no quiet hours by default");
}
