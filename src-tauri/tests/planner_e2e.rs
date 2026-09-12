//! End-to-end coverage of the planner half of the app: the notebook, the
//! occasion/gift planner, the calendar and the dashboard.
//!
//! `happy_path_christmas_planning` is the full walk-through: create Christmas,
//! list who gets what, set a budget, buy some of it, watch the money and the
//! countdown move, and see it all turn up on the calendar and the dashboard.

use chrono::NaiveDate;
use notes_mj_lib::db::Store;
use notes_mj_lib::models::TaskStatus;
use notes_mj_lib::paths::Config;
use notes_mj_lib::planner::{GiftStatus, OccasionKind};
use notes_mj_lib::settings::{Settings, Theme};
use notes_mj_lib::transfer::ImportMode;

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

struct Fixture {
    store: Store,
    _dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let cfg = Config {
            data_dir: dir.path().to_path_buf(),
            backup_keep: 3,
            backup_min_interval_minutes: 0,
            max_attachment_bytes: 1024 * 1024,
            debug: false,
        };
        Fixture {
            store: Store::open(cfg).unwrap(),
            _dir: dir,
        }
    }
}

fn quick_task(store: &mut Store, title: &str, start_on: Option<&str>) -> String {
    let input = match start_on {
        Some(day) => serde_json::json!({ "title": title, "start_on": day }),
        None => serde_json::json!({ "title": title }),
    };
    store
        .create_task(serde_json::from_value(input).unwrap())
        .unwrap()
        .task
        .id
}

// ---------------------------------------------------------------------------
// The gift-planning happy path
// ---------------------------------------------------------------------------

#[test]
fn happy_path_christmas_planning() {
    let mut f = Fixture::new();
    let store = &mut f.store;
    let today = d("2026-11-01");

    // -- 1. An occasion ------------------------------------------------------
    let christmas = store
        .create_occasion("Vánoce", OccasionKind::Christmas, d("2026-12-24"), true, today)
        .unwrap();
    assert_eq!(christmas.days_until, 53);
    assert_eq!(christmas.next_date, d("2026-12-24"));
    assert_eq!(christmas.gift_count, 0);
    assert_eq!(christmas.planned_minor, 0);
    assert_eq!(christmas.remaining_minor, None, "no budget set yet");

    // A budget of 8 000 Kč, in haléře.
    let christmas = store
        .update_occasion(
            &christmas.occasion.id,
            serde_json::from_value(serde_json::json!({ "budget_minor": 800_000 })).unwrap(),
            today,
        )
        .unwrap();
    assert_eq!(christmas.remaining_minor, Some(800_000));

    // -- 2. The list ---------------------------------------------------------
    let sluchatka = store
        .create_gift(&christmas.occasion.id, "Sluchátka", "Petra")
        .unwrap();
    let kniha = store
        .create_gift(&christmas.occasion.id, "Kniha o pečení", "Máma")
        .unwrap();
    let vrtacka = store
        .create_gift(&christmas.occasion.id, "Aku vrtačka", "Táta")
        .unwrap();

    assert_eq!(sluchatka.status, GiftStatus::Idea);
    assert_eq!(sluchatka.recipient, "Petra");
    assert_eq!(sluchatka.price_minor, None);

    // Prices and a link.
    for (id, price) in [
        (&sluchatka.id, 349_900),
        (&kniha.id, 39_900),
        (&vrtacka.id, 259_900),
    ] {
        store
            .update_gift(
                id,
                serde_json::from_value(serde_json::json!({ "price_minor": price })).unwrap(),
            )
            .unwrap();
    }
    store
        .update_gift(
            &sluchatka.id,
            serde_json::from_value(serde_json::json!({
                "url": "https://alza.cz/sluchatka",
                "notes": "Bezdrátová, s potlačením hluku."
            }))
            .unwrap(),
        )
        .unwrap();

    let planned = store.get_occasion(&christmas.occasion.id, today).unwrap();
    assert_eq!(planned.gift_count, 3);
    assert_eq!(planned.planned_minor, 649_700, "3 499 + 399 + 2 599 Kč");
    assert_eq!(planned.spent_minor, 0, "nothing bought yet");
    assert_eq!(planned.remaining_minor, Some(800_000), "budget untouched");
    assert_eq!(planned.bought_count, 0);

    // -- 3. Buying some of it ------------------------------------------------
    store
        .update_gift(
            &sluchatka.id,
            serde_json::from_value(serde_json::json!({ "status": "bought" })).unwrap(),
        )
        .unwrap();
    store
        .update_gift(
            &kniha.id,
            serde_json::from_value(serde_json::json!({ "status": "wrapped" })).unwrap(),
        )
        .unwrap();

    let midway = store.get_occasion(&christmas.occasion.id, today).unwrap();
    assert_eq!(midway.spent_minor, 389_800, "3 499 + 399 Kč");
    assert_eq!(midway.remaining_minor, Some(410_200));
    assert_eq!(midway.bought_count, 2);
    assert_eq!(
        midway.planned_minor, 649_700,
        "the plan does not shrink as you buy"
    );

    // -- 4. Undo works here too ---------------------------------------------
    store.undo().unwrap();
    let after_undo = store.get_occasion(&christmas.occasion.id, today).unwrap();
    assert_eq!(after_undo.bought_count, 1, "the wrapping was undone");
    store.redo().unwrap();
    assert_eq!(
        store
            .get_occasion(&christmas.occasion.id, today)
            .unwrap()
            .bought_count,
        2
    );

    // -- 5. A birthday, stored with the year of birth ------------------------
    let birthday = store
        .create_occasion(
            "Petra - narozeniny",
            OccasionKind::Birthday,
            d("1990-03-15"),
            true,
            today,
        )
        .unwrap();
    assert_eq!(
        birthday.next_date,
        d("2027-03-15"),
        "the next one, not the year she was born"
    );
    assert!(birthday.days_until > 0);

    // -- 6. The list is ordered by what is coming up -------------------------
    let all = store.list_occasions(today).unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].occasion.name, "Vánoce", "soonest first");
    assert_eq!(all[1].occasion.name, "Petra - narozeniny");

    // -- 7. Occasions show up on the calendar --------------------------------
    let december = store
        .calendar_range(d("2026-12-01"), d("2026-12-31"), false)
        .unwrap();
    assert_eq!(december.len(), 31);
    let christmas_eve = december.iter().find(|day| day.date == d("2026-12-24")).unwrap();
    assert_eq!(christmas_eve.occasions.len(), 1);
    assert_eq!(christmas_eve.occasions[0].name, "Vánoce");

    // And in a different year too, because it repeats.
    let next_december = store
        .calendar_range(d("2027-12-20"), d("2027-12-31"), false)
        .unwrap();
    assert!(next_december
        .iter()
        .any(|day| day.date == d("2027-12-24") && !day.occasions.is_empty()));

    // -- 8. Deleting the occasion takes the gift list, and undo restores it --
    store.delete_occasion(&christmas.occasion.id).unwrap();
    assert!(store.get_occasion(&christmas.occasion.id, today).is_err());
    assert!(store.get_gift(&vrtacka.id).is_err(), "gifts went with it");

    store.undo().unwrap();
    let restored = store.get_occasion(&christmas.occasion.id, today).unwrap();
    assert_eq!(restored.gift_count, 3, "and came back with it");
    assert_eq!(restored.spent_minor, 389_800);
}

// ---------------------------------------------------------------------------
// Notebook
// ---------------------------------------------------------------------------

#[test]
fn the_notebook_pins_searches_and_tags() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    let shopping = store
        .create_note("Nákupní seznam", "mléka\nchleba\nkáva")
        .unwrap();
    store.create_note("Nápady na dovolenou", "Chorvatsko?").unwrap();

    // Newest first while nothing is pinned.
    let notes = store.list_notes(None).unwrap();
    assert_eq!(notes.len(), 2);

    // Pinning floats it to the top.
    store
        .update_note(
            &shopping.note.id,
            serde_json::from_value(serde_json::json!({ "pinned": true })).unwrap(),
        )
        .unwrap();
    let notes = store.list_notes(None).unwrap();
    assert_eq!(notes[0].note.title, "Nákupní seznam");
    assert!(notes[0].note.pinned);

    // Search covers the body, not just the title.
    let hits = store.list_notes(Some("chleba")).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].note.title, "Nákupní seznam");
    assert!(store.list_notes(Some("neexistuje")).unwrap().is_empty());

    // Notes share the tag vocabulary with tasks.
    store
        .update_note(
            &shopping.note.id,
            serde_json::from_value(serde_json::json!({ "tag_names": ["domov", "nákupy"] })).unwrap(),
        )
        .unwrap();
    let tagged = store.get_note(&shopping.note.id).unwrap();
    assert_eq!(
        tagged.tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        vec!["domov", "nákupy"]
    );
    assert!(
        store.list_tags().unwrap().iter().any(|t| t.name == "domov"),
        "the tag is now available to tasks as well"
    );

    // Delete and undo.
    store.delete_note(&shopping.note.id).unwrap();
    assert_eq!(store.list_notes(None).unwrap().len(), 1);
    store.undo().unwrap();
    assert_eq!(store.get_note(&shopping.note.id).unwrap().tags.len(), 2);
}

#[test]
fn a_note_search_treats_wildcards_literally() {
    let mut f = Fixture::new();
    let store = &mut f.store;
    store.create_note("Sleva 50%", "Platí do konce měsíce").unwrap();
    store.create_note("Něco jiného", "").unwrap();

    assert_eq!(store.list_notes(Some("50%")).unwrap().len(), 1);
    assert!(
        store.list_notes(Some("9%")).unwrap().is_empty(),
        "a bare % must not match everything"
    );
}

#[test]
fn planner_input_is_validated() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    assert!(store.create_note("   ", "").is_err(), "a note needs a title");

    let occasion = store
        .create_occasion("Vánoce", OccasionKind::Christmas, d("2026-12-24"), true, d("2026-11-01"))
        .unwrap();
    let gift = store
        .create_gift(&occasion.occasion.id, "Něco", "Někdo")
        .unwrap();

    // A `javascript:` URL must never reach the opener.
    let err = store
        .update_gift(
            &gift.id,
            serde_json::from_value(serde_json::json!({ "url": "javascript:alert(1)" })).unwrap(),
        )
        .unwrap_err()
        .to_string();
    assert!(err.contains("http://"), "got: {err}");

    // Negative money, and a price with an extra zero too many.
    assert!(store
        .update_gift(
            &gift.id,
            serde_json::from_value(serde_json::json!({ "price_minor": -100 })).unwrap()
        )
        .is_err());
    assert!(store
        .update_gift(
            &gift.id,
            serde_json::from_value(serde_json::json!({ "price_minor": 99_999_999_999i64 })).unwrap()
        )
        .is_err());

    // A gift for an occasion that is not there.
    assert!(store.create_gift("nope", "Dárek", "").is_err());

    // The gift survived every rejected edit untouched.
    let unchanged = store.get_gift(&gift.id).unwrap();
    assert_eq!(unchanged.url, "");
    assert_eq!(unchanged.price_minor, None);
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

#[test]
fn the_calendar_places_tasks_on_their_start_and_deadline() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    // One task that starts on the 10th and is due on the 20th appears twice:
    // once as "start here", once as "due here". That is the point of a planner.
    store
        .create_task(
            serde_json::from_value(serde_json::json!({
                "title": "Daňové přiznání",
                "start_on": "2026-03-10",
                "due_on": "2026-03-20"
            }))
            .unwrap(),
        )
        .unwrap();

    let march = store
        .calendar_range(d("2026-03-01"), d("2026-03-31"), false)
        .unwrap();
    let on = |day: &str| {
        march
            .iter()
            .find(|c| c.date == d(day))
            .map(|c| c.tasks.len())
            .unwrap()
    };
    assert_eq!(on("2026-03-10"), 1, "start date");
    assert_eq!(on("2026-03-20"), 1, "deadline");
    assert_eq!(on("2026-03-15"), 0, "nothing in between");
}

#[test]
fn the_calendar_can_include_or_hide_completed_tasks() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    let id = quick_task(store, "Hotová věc", Some("2026-03-10"));
    store
        .set_task_status(&id, TaskStatus::Completed, d("2026-03-10"))
        .unwrap();

    let hidden = store
        .calendar_range(d("2026-03-01"), d("2026-03-31"), false)
        .unwrap();
    assert!(hidden.iter().all(|day| day.tasks.is_empty()));

    let shown = store
        .calendar_range(d("2026-03-01"), d("2026-03-31"), true)
        .unwrap();
    let day = shown.iter().find(|c| c.date == d("2026-03-10")).unwrap();
    assert_eq!(day.tasks.len(), 1);
    assert_eq!(day.completed, 1);
}

#[test]
fn the_calendar_refuses_an_absurd_range_and_shrugs_at_a_backwards_one() {
    let f = Fixture::new();
    assert!(f
        .store
        .calendar_range(d("2026-01-01"), d("2030-01-01"), false)
        .is_err());
    assert!(f
        .store
        .calendar_range(d("2026-03-31"), d("2026-03-01"), false)
        .unwrap()
        .is_empty());
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

#[test]
fn the_dashboard_adds_everything_up() {
    let mut f = Fixture::new();
    let store = &mut f.store;
    let today = d("2026-09-07");

    quick_task(store, "Dnešní úkol", Some("2026-09-07"));
    quick_task(store, "Zítřejší úkol", Some("2026-09-08"));
    store
        .create_task(
            serde_json::from_value(serde_json::json!({
                "title": "Propadlý termín",
                "due_on": "2026-09-01"
            }))
            .unwrap(),
        )
        .unwrap();
    quick_task(store, "Nezařazený nápad", None);

    let done = quick_task(store, "Hotovo dnes", Some("2026-09-07"));
    store
        .set_task_status(&done, TaskStatus::Completed, today)
        .unwrap();

    let area = store.create_area("Domov").unwrap();
    let project = store.create_project("Rekonstrukce", Some(&area.id), "").unwrap();
    let step = store
        .create_task(
            serde_json::from_value(
                serde_json::json!({ "title": "Vybrat dlažbu", "project_id": project.id }),
            )
            .unwrap(),
        )
        .unwrap();
    store
        .create_task(
            serde_json::from_value(
                serde_json::json!({ "title": "Objednat řemeslníka", "project_id": project.id }),
            )
            .unwrap(),
        )
        .unwrap();
    store
        .set_task_status(&step.task.id, TaskStatus::Completed, today)
        .unwrap();

    store
        .create_occasion("Vánoce", OccasionKind::Christmas, d("2026-09-20"), true, today)
        .unwrap();
    let note = store.create_note("Připnutá poznámka", "text").unwrap();
    store
        .update_note(
            &note.note.id,
            serde_json::from_value(serde_json::json!({ "pinned": true })).unwrap(),
        )
        .unwrap();

    let dash = store.dashboard(today).unwrap();

    assert_eq!(dash.today, today);
    // The unfiled idea, plus the overdue one: giving a task a deadline says
    // when it must be done, not where it belongs, so it stays in the Inbox
    // until it is actually filed.
    assert_eq!(dash.counts.inbox, 2);
    assert_eq!(dash.completed_today, 2);
    assert_eq!(dash.completed_week, 2);

    let today_titles: Vec<&str> = dash.today_tasks.iter().map(|t| t.task.title.as_str()).collect();
    assert!(today_titles.contains(&"Dnešní úkol"));
    assert!(today_titles.contains(&"Propadlý termín"));
    assert!(!today_titles.contains(&"Zítřejší úkol"));

    assert_eq!(dash.overdue_tasks.len(), 1);
    assert_eq!(dash.overdue_tasks[0].task.title, "Propadlý termín");

    // Seven bars, starting today.
    assert_eq!(dash.week.len(), 7);
    assert_eq!(dash.week[0].date, today);
    assert_eq!(dash.week[1].scheduled, 1, "tomorrow's task");

    // Project progress: one of two done.
    let progress = dash
        .projects
        .iter()
        .find(|p| p.project.name == "Rekonstrukce")
        .unwrap();
    assert_eq!((progress.total, progress.done), (2, 1));
    assert!((progress.ratio - 0.5).abs() < f64::EPSILON);

    // The occasion is inside the default 21-day lead.
    assert_eq!(dash.occasions.len(), 1);
    assert_eq!(dash.occasions[0].days_until, 13);

    assert_eq!(dash.pinned_notes.len(), 1);
    assert_eq!(dash.activity.len(), 28);
    assert_eq!(dash.activity.last().unwrap().date, today);
    assert_eq!(dash.activity.last().unwrap().count, 2);
    assert_eq!(dash.streak_days, 1);
}

#[test]
fn an_empty_dashboard_is_all_zeroes_rather_than_an_error() {
    let f = Fixture::new();
    let dash = f.store.dashboard(d("2026-09-07")).unwrap();
    assert!(dash.today_tasks.is_empty());
    assert!(dash.overdue_tasks.is_empty());
    assert!(dash.projects.is_empty());
    assert!(dash.occasions.is_empty());
    assert_eq!(dash.completed_today, 0);
    assert_eq!(dash.streak_days, 0);
    assert_eq!(dash.best_streak_days, 0);
    assert_eq!(dash.week.len(), 7);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[test]
fn settings_round_trip_and_survive_a_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = Config {
        data_dir: dir.path().to_path_buf(),
        backup_keep: 20,
        backup_min_interval_minutes: 60,
        max_attachment_bytes: 64 * 1024 * 1024,
        debug: false,
    };

    {
        let store = Store::open(cfg.clone()).unwrap();
        assert_eq!(store.settings().unwrap().theme, Theme::System);

        let mut s = Settings::default();
        s.theme = Theme::Dark;
        s.accent = "#E5484D".into();
        s.font_scale = 1.15;
        s.currency = "EUR".into();
        s.backup_keep = Some(4);
        let saved = store.save_settings(s).unwrap();
        assert_eq!(saved.accent, "#e5484d", "normalised to lower case");
    }

    // A fresh handle on the same file sees them.
    let store = Store::open(cfg).unwrap();
    let s = store.settings().unwrap();
    assert_eq!(s.theme, Theme::Dark);
    assert_eq!(s.currency, "EUR");
    assert_eq!(s.font_scale, 1.15);

    let defaults = store.reset_settings().unwrap();
    assert_eq!(defaults.theme, Theme::System);
    assert_eq!(store.settings().unwrap().currency, "Kč");
}

#[test]
fn the_backup_setting_actually_changes_what_backups_do() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = Config {
        data_dir: dir.path().to_path_buf(),
        // .env says keep 20; the UI is about to say keep 2.
        backup_keep: 20,
        backup_min_interval_minutes: 0,
        max_attachment_bytes: 64 * 1024 * 1024,
        debug: false,
    };
    let store = Store::open(cfg).unwrap();

    let mut s = Settings::default();
    s.backup_keep = Some(2);
    store.save_settings(s).unwrap();

    for _ in 0..4 {
        store.backup_now().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
    }
    assert_eq!(
        store.list_backups().unwrap().len(),
        2,
        "the setting wins over the .env default"
    );
}

#[test]
fn turning_startup_backups_off_is_respected() {
    let f = Fixture::new();
    let mut s = Settings::default();
    s.backup_on_start = false;
    f.store.save_settings(s).unwrap();

    let outcome = f.store.backup_if_due().unwrap();
    assert!(
        matches!(outcome, notes_mj_lib::backup::BackupOutcome::Skipped { .. }),
        "no backup when the user switched it off"
    );
    // An explicit "back up now" still works - the setting is about automation.
    f.store.backup_now().unwrap();
    assert_eq!(f.store.list_backups().unwrap().len(), 1);
}

#[test]
fn the_attachment_limit_setting_is_enforced() {
    let mut f = Fixture::new();
    let mut s = Settings::default();
    s.max_attachment_mb = Some(1);
    f.store.save_settings(s).unwrap();

    let task = quick_task(&mut f.store, "Drží soubor", None);
    let big = f._dir.path().join("big.bin");
    std::fs::write(&big, vec![0u8; 2 * 1024 * 1024]).unwrap();

    let err = f.store.add_attachment(&task, &big).unwrap_err().to_string();
    assert!(err.contains("limit je 1 MB"), "got: {err}");
}

#[test]
fn corrupt_settings_fall_back_to_defaults_instead_of_bricking_the_app() {
    let f = Fixture::new();
    f.store.meta_set("settings", "{ this is not json").unwrap();
    let s = f.store.settings().unwrap();
    assert_eq!(s.theme, Theme::System, "opens with defaults, not an error");
}

// ---------------------------------------------------------------------------
// Export / import of the planner data (format version 2)
// ---------------------------------------------------------------------------

#[test]
fn notes_occasions_and_gifts_survive_an_export_round_trip() {
    let mut f = Fixture::new();
    let today = d("2026-11-01");

    // Something of everything.
    let note = f.store.create_note("Nákupní seznam", "mléko\nchleba").unwrap();
    f.store
        .update_note(
            &note.note.id,
            serde_json::from_value(serde_json::json!({
                "pinned": true,
                "tag_names": ["domov"]
            }))
            .unwrap(),
        )
        .unwrap();

    let christmas = f
        .store
        .create_occasion("Vánoce", OccasionKind::Christmas, d("2026-12-24"), true, today)
        .unwrap();
    f.store
        .update_occasion(
            &christmas.occasion.id,
            serde_json::from_value(serde_json::json!({ "budget_minor": 800_000 })).unwrap(),
            today,
        )
        .unwrap();
    let gift = f
        .store
        .create_gift(&christmas.occasion.id, "Sluchátka", "Petra")
        .unwrap();
    f.store
        .update_gift(
            &gift.id,
            serde_json::from_value(serde_json::json!({
                "price_minor": 349_900,
                "status": "bought",
                "url": "https://alza.cz/x"
            }))
            .unwrap(),
        )
        .unwrap();

    let export = serde_json::to_string(&f.store.build_export().unwrap()).unwrap();
    assert!(export.contains("\"version\":2"), "the format was bumped");

    // Into a clean database.
    let mut target = Fixture::new();
    let report = target.store.import_json(&export, ImportMode::Merge, false).unwrap();
    assert_eq!(report.notes, 1);
    assert_eq!(report.occasions, 1);
    assert_eq!(report.gifts, 1);
    assert!(report.warnings.is_empty(), "warnings: {:?}", report.warnings);

    let notes = target.store.list_notes(None).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].note.body, "mléko\nchleba");
    assert!(notes[0].note.pinned);
    assert_eq!(notes[0].tags.len(), 1, "the tag came across too");

    let restored = target.store.get_occasion(&christmas.occasion.id, today).unwrap();
    assert_eq!(restored.gift_count, 1);
    assert_eq!(restored.spent_minor, 349_900);
    assert_eq!(restored.remaining_minor, Some(450_100));
    assert_eq!(restored.gifts[0].url, "https://alza.cz/x");
    assert_eq!(restored.gifts[0].status, GiftStatus::Bought);

    // Re-importing the same file changes nothing.
    let again = target.store.import_json(&export, ImportMode::Merge, false).unwrap();
    assert_eq!((again.notes, again.occasions, again.gifts), (0, 0, 0));
    assert!(again.skipped_existing > 0);
}

#[test]
fn a_version_one_export_still_imports() {
    // Exactly what the previous build wrote: no notes, occasions or gifts.
    let old = serde_json::json!({
        "format": "notes_mj.export",
        "version": 1,
        "exported_at": "2026-09-07T00:00:00.000Z",
        "app_version": "1.0.0",
        "attachments_note": "",
        "areas": [],
        "projects": [],
        "tags": [],
        "tasks": [],
        "saved_filters": []
    })
    .to_string();

    let mut f = Fixture::new();
    let report = f.store.import_json(&old, ImportMode::Merge, false).unwrap();
    assert_eq!((report.notes, report.occasions, report.gifts), (0, 0, 0));
    assert!(report.warnings.is_empty());
}

#[test]
fn settings_are_only_restored_when_asked_for() {
    let f = Fixture::new();
    let mut s = Settings::default();
    s.theme = Theme::Dark;
    s.currency = "EUR".into();
    f.store.save_settings(s).unwrap();
    let export = serde_json::to_string(&f.store.build_export().unwrap()).unwrap();

    // By default an import leaves your own preferences alone.
    let mut target = Fixture::new();
    let report = target.store.import_json(&export, ImportMode::Merge, false).unwrap();
    assert!(!report.settings_applied);
    assert_eq!(target.store.settings().unwrap().theme, Theme::System);
    assert_eq!(target.store.settings().unwrap().currency, "Kč");

    // Asking for them brings them across.
    let mut other = Fixture::new();
    let report = other.store.import_json(&export, ImportMode::Merge, true).unwrap();
    assert!(report.settings_applied);
    assert_eq!(other.store.settings().unwrap().theme, Theme::Dark);
    assert_eq!(other.store.settings().unwrap().currency, "EUR");
}

#[test]
fn an_import_refuses_a_hostile_url_even_from_a_hand_edited_file() {
    let mut f = Fixture::new();
    let today = d("2026-11-01");
    let occasion = f
        .store
        .create_occasion("Vánoce", OccasionKind::Christmas, d("2026-12-24"), true, today)
        .unwrap();
    f.store.create_gift(&occasion.occasion.id, "Něco", "").unwrap();

    // Someone edits the JSON by hand and puts a script URL in it.
    let export = serde_json::to_string(&f.store.build_export().unwrap())
        .unwrap()
        .replace("\"url\":\"\"", "\"url\":\"javascript:alert(1)\"");

    let mut target = Fixture::new();
    target.store.import_json(&export, ImportMode::Merge, false).unwrap();
    let restored = target.store.get_occasion(&occasion.occasion.id, today).unwrap();
    assert_eq!(restored.gifts[0].url, "", "the URL was dropped, not stored");
}

#[test]
fn a_gift_whose_occasion_is_missing_is_reported_not_silently_dropped() {
    let orphan = serde_json::json!({
        "format": "notes_mj.export",
        "version": 2,
        "exported_at": "2026-09-07T00:00:00.000Z",
        "app_version": "1.0.0",
        "attachments_note": "",
        "areas": [], "projects": [], "tags": [], "tasks": [], "saved_filters": [],
        "notes": [], "occasions": [],
        "gifts": [{
            "id": "g1", "occasion_id": "nope", "recipient": "", "title": "Sirotek",
            "notes": "", "url": "", "price_minor": null, "status": "idea", "position": 0,
            "created_at": "2026-09-07T00:00:00.000Z",
            "updated_at": "2026-09-07T00:00:00.000Z"
        }]
    })
    .to_string();

    let mut f = Fixture::new();
    let report = f.store.import_json(&orphan, ImportMode::Merge, false).unwrap();
    assert_eq!(report.gifts, 0);
    assert!(report.warnings.iter().any(|w| w.contains("Sirotek")));
}
