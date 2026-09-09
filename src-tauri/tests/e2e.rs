//! End-to-end coverage of the core loop, driven through the same `Store`
//! methods the Tauri commands call.
//!
//! `happy_path_capture_to_archive` is the one full walk-through: capture a task
//! into an area and a project with tags and a deadline, schedule it, see it in
//! Today, work it in the focus view, complete it, watch the repeat roll over,
//! find it in the archive, undo, search, export and re-import.
//!
//! The other tests pin down behaviour that the happy path passes over.

use chrono::NaiveDate;
use notes_mj_lib::db::Store;
use notes_mj_lib::models::*;
use notes_mj_lib::paths::Config;
use notes_mj_lib::recur::{Anchor, Ends, Freq, MonthlyMode, RecurrenceRule};

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
            // No throttle: tests take a backup whenever they ask for one.
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

fn titles(tasks: &[TaskDetail]) -> Vec<String> {
    tasks.iter().map(|t| t.task.title.clone()).collect()
}

fn view_titles(store: &Store, view: View, today: NaiveDate) -> Vec<String> {
    titles(&store.list_view(view, today, 0).unwrap().tasks)
}

fn quick_capture(store: &mut Store, title: &str) -> TaskDetail {
    store
        .create_task(serde_json::from_value(serde_json::json!({ "title": title })).unwrap())
        .unwrap()
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

#[test]
fn happy_path_capture_to_archive() {
    let mut f = Fixture::new();
    let store = &mut f.store;
    let today = d("2026-09-07"); // a Monday

    // -- 1. Capture ---------------------------------------------------------
    // Everything starts as a one-line thought in the Inbox.
    let captured = quick_capture(store, "Renew the car insurance");
    assert_eq!(captured.task.list, TaskList::Inbox);
    assert_eq!(captured.task.status, TaskStatus::Open);
    assert_eq!(view_titles(store, View::Inbox, today), vec!["Renew the car insurance"]);
    assert_eq!(store.counts(today).unwrap().inbox, 1);

    // -- 2. Organise --------------------------------------------------------
    let area = store.create_area("Personal").unwrap();
    let project = store
        .create_project("Car admin", Some(&area.id), "Everything the car needs.")
        .unwrap();

    let organised = store
        .update_task(
            &captured.task.id,
            serde_json::from_value(serde_json::json!({
                "project_id": project.id,
                "due_on": "2026-09-20",
                "priority": 2,
                "tag_names": ["errand", "money"],
                "notes": "Compare at least three quotes."
            }))
            .unwrap(),
        )
        .unwrap();

    assert_eq!(organised.task.project_id.as_deref(), Some(project.id.as_str()));
    assert_eq!(organised.task.list, TaskList::Anytime, "filing empties the inbox");
    assert_eq!(organised.task.due_on, Some(d("2026-09-20")));
    assert_eq!(organised.task.priority, 2);
    assert_eq!(
        organised.tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        vec!["errand", "money"]
    );
    assert_eq!(organised.project_name.as_deref(), Some("Car admin"));
    assert!(view_titles(store, View::Inbox, today).is_empty());

    // Subtasks: a checklist, not another project.
    for step in ["Find the current policy", "Get three quotes"] {
        store
            .create_task(
                serde_json::from_value(serde_json::json!({
                    "title": step,
                    "parent_id": organised.task.id
                }))
                .unwrap(),
            )
            .unwrap();
    }
    let with_checklist = store.task_detail(&organised.task.id).unwrap();
    assert_eq!(
        titles(&[]).len() + with_checklist.subtasks.len(),
        2,
        "both checklist items are attached"
    );
    assert!(
        !view_titles(store, View::Anytime, today).contains(&"Get three quotes".to_string()),
        "subtasks never show up as their own row in a list"
    );

    // An attachment: the quote PDF, copied into the data directory.
    // (The source name is deliberately awkward - spaces, punctuation, non-ASCII
    // - but still legal on Windows, since it has to exist to be attached.
    // `paths::safe_filename` is unit-tested against the hostile cases.)
    let source = f._dir.path().join("Nabídka (Acme s.r.o.) #1.pdf");
    std::fs::write(&source, b"%PDF-1.4 pretend").unwrap();
    let attachment = store.add_attachment(&organised.task.id, &source).unwrap();
    assert_eq!(
        attachment.display_name, "Nabídka (Acme s.r.o.) #1.pdf",
        "the UI still shows the name the user recognises"
    );
    assert_ne!(
        attachment.stored_name, attachment.display_name,
        "the on-disk name is prefixed so two files never collide"
    );
    assert!(attachment.stored_name.ends_with(".pdf"));
    let stored = store.attachment_path(&attachment.id).unwrap();
    assert!(stored.exists());
    // `attachment_path` returns a canonicalised path (on Windows that means the
    // `\\?\` verbatim form), so compare it against the canonical directory.
    let attachments_dir = f._dir.path().join("attachments").canonicalize().unwrap();
    assert!(
        stored.starts_with(&attachments_dir),
        "attachments never land outside the data directory: {stored:?} vs {attachments_dir:?}"
    );
    assert_eq!(std::fs::read(&stored).unwrap(), b"%PDF-1.4 pretend");

    // -- 3. Schedule --------------------------------------------------------
    // Not today: start on Thursday. It leaves Today and appears in Upcoming.
    store
        .update_task(
            &organised.task.id,
            serde_json::from_value(serde_json::json!({ "start_on": "2026-09-10" })).unwrap(),
        )
        .unwrap();
    assert_eq!(
        view_titles(store, View::Upcoming, today),
        vec!["Renew the car insurance"]
    );
    assert!(view_titles(store, View::Today, today).is_empty());

    // Come Thursday it is waiting in Today, with nothing to reschedule.
    let thursday = d("2026-09-10");
    assert_eq!(
        view_titles(store, View::Today, thursday),
        vec!["Renew the car insurance"]
    );

    // -- 4. A repeating task ------------------------------------------------
    // The weekly review: every Monday, forever.
    let review = store
        .create_task(
            serde_json::from_value(serde_json::json!({
                "title": "Weekly review",
                "area_id": area.id,
                "tag_names": ["ritual"],
                "recurrence": {
                    "freq": "weekly",
                    "interval": 1,
                    "weekdays": [0],
                    "anchor": "fixed_schedule",
                    "starts_on": "2026-09-07",
                    "ends": { "type": "never" }
                }
            }))
            .unwrap(),
        )
        .unwrap();
    assert_eq!(review.task.start_on, Some(today), "first occurrence is today");
    assert_eq!(
        review.recurrence.as_ref().unwrap().rule.describe(),
        "Každý týden v po"
    );

    // -- 5. Work from Today -------------------------------------------------
    let mut in_today = view_titles(store, View::Today, today);
    in_today.sort();
    assert_eq!(in_today, vec!["Weekly review"]);

    // The focus view loads exactly one task and works on it.
    let focused = store.task_detail(&review.task.id).unwrap();
    assert_eq!(focused.task.title, "Weekly review");
    assert_eq!(focused.task.status, TaskStatus::Open);

    // -- 6. Complete, and roll the series forward ---------------------------
    let next = store
        .set_task_status(&review.task.id, TaskStatus::Completed, today)
        .unwrap();

    // The completed occurrence stays put, as history.
    let done = store.get_task(&review.task.id).unwrap();
    assert_eq!(done.status, TaskStatus::Completed);
    assert!(done.completed_at.is_some());
    assert!(done.recurrence_id.is_none(), "the live rule moved on");

    // The next occurrence is a new task, next Monday, with the tags carried over.
    assert_ne!(next.task.id, review.task.id);
    assert_eq!(next.task.start_on, Some(d("2026-09-14")));
    assert_eq!(next.task.status, TaskStatus::Open);
    assert_eq!(
        next.tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        vec!["ritual"]
    );
    assert_eq!(
        next.task.series_id, done.series_id,
        "both occurrences belong to one series"
    );
    assert!(view_titles(store, View::Today, today).is_empty(), "Today is clear");

    // A week on, the review is back - alongside the insurance task, whose own
    // start date passed on the 10th.
    let mut next_monday = view_titles(store, View::Today, d("2026-09-14"));
    next_monday.sort();
    assert_eq!(next_monday, vec!["Renew the car insurance", "Weekly review"]);

    // -- 7. The archive -----------------------------------------------------
    let archive = store.list_view(View::Completed, today, 0).unwrap();
    assert_eq!(titles(&archive.tasks), vec!["Weekly review"]);
    assert!(!archive.has_more);
    assert_eq!(store.counts(today).unwrap().completed, 1);

    // -- 8. Undo ------------------------------------------------------------
    // Ticking something off by accident is the classic case for undo.
    assert_eq!(store.undo_state().unwrap().0.as_deref(), Some("dokončení úkolu"));
    assert_eq!(store.undo().unwrap().as_deref(), Some("dokončení úkolu"));

    let reopened = store.get_task(&review.task.id).unwrap();
    assert_eq!(reopened.status, TaskStatus::Open);
    assert!(reopened.recurrence_id.is_some(), "the rule came back with it");
    assert!(
        store.get_task(&next.task.id).is_err(),
        "the occurrence that had not happened yet is gone again"
    );
    assert!(store.list_view(View::Completed, today, 0).unwrap().tasks.is_empty());

    // Redo puts it all back.
    assert_eq!(store.redo().unwrap().as_deref(), Some("dokončení úkolu"));
    assert_eq!(store.get_task(&review.task.id).unwrap().status, TaskStatus::Completed);
    assert!(store.get_task(&next.task.id).is_ok());

    // -- 9. Search ----------------------------------------------------------
    let hits = store
        .search(&serde_json::from_value(serde_json::json!({ "text": "insurance" })).unwrap())
        .unwrap();
    assert_eq!(titles(&hits), vec!["Renew the car insurance"]);

    let by_tag = store
        .search(&serde_json::from_value(serde_json::json!({ "tags": ["money"] })).unwrap())
        .unwrap();
    assert_eq!(titles(&by_tag), vec!["Renew the car insurance"]);

    let saved = store.save_filter("Money matters", "tag:money").unwrap();
    assert_eq!(store.list_saved_filters().unwrap().len(), 1);
    assert_eq!(saved.query, "tag:money");

    // -- 10. Export, then import into an empty database ---------------------
    let export_path = f._dir.path().join("t3-export.json");
    let bytes = store.export_to_file(&export_path).unwrap();
    assert!(bytes > 0);
    let json = std::fs::read_to_string(&export_path).unwrap();
    assert!(json.contains("\"format\": \"t3.export\""));

    let (backup, _) = store.backup_now().unwrap();
    assert!(std::path::Path::new(&backup.path).exists());

    let mut fresh = Fixture::new();
    let report = fresh.store.import_json(&json, ImportMode::Merge, false).unwrap();
    assert_eq!(report.areas, 1);
    assert_eq!(report.projects, 1);
    assert!(report.warnings.is_empty(), "warnings: {:?}", report.warnings);

    // The restored copy behaves like the original, right down to which tasks
    // land in Today on a given day.
    let mut restored_today = view_titles(&fresh.store, View::Today, d("2026-09-14"));
    restored_today.sort();
    assert_eq!(restored_today, vec!["Renew the car insurance", "Weekly review"]);
    let restored = fresh
        .store
        .search(&serde_json::from_value(serde_json::json!({ "text": "insurance" })).unwrap())
        .unwrap();
    assert_eq!(titles(&restored), vec!["Renew the car insurance"]);
    assert_eq!(restored[0].tags.len(), 2);
    assert_eq!(restored[0].subtasks.len(), 2);
    assert_eq!(restored[0].attachments.len(), 1);
    assert_eq!(
        fresh.store.list_view(View::Completed, today, 0).unwrap().tasks.len(),
        1,
        "history survives the round trip"
    );

    // Importing the same file again changes nothing.
    let again = fresh.store.import_json(&json, ImportMode::Merge, false).unwrap();
    assert_eq!(again.tasks, 0);
    assert!(again.skipped_existing > 0);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

#[test]
fn each_view_shows_only_what_belongs_in_it() {
    let mut f = Fixture::new();
    let store = &mut f.store;
    let today = d("2026-09-07");

    quick_capture(store, "Unfiled thought");

    let area = store.create_area("Work").unwrap();
    store
        .create_task(
            serde_json::from_value(serde_json::json!({ "title": "Anytime job", "area_id": area.id }))
                .unwrap(),
        )
        .unwrap();
    store
        .create_task(
            serde_json::from_value(serde_json::json!({ "title": "Due today", "start_on": "2026-09-07" }))
                .unwrap(),
        )
        .unwrap();
    store
        .create_task(
            serde_json::from_value(serde_json::json!({ "title": "Next week", "start_on": "2026-09-14" }))
                .unwrap(),
        )
        .unwrap();
    store
        .create_task(
            serde_json::from_value(serde_json::json!({ "title": "One day", "list": "someday" }))
                .unwrap(),
        )
        .unwrap();

    assert_eq!(view_titles(store, View::Inbox, today), vec!["Unfiled thought"]);
    assert_eq!(view_titles(store, View::Today, today), vec!["Due today"]);
    assert_eq!(view_titles(store, View::Upcoming, today), vec!["Next week"]);
    assert_eq!(view_titles(store, View::Anytime, today), vec!["Anytime job"]);
    assert_eq!(view_titles(store, View::Someday, today), vec!["One day"]);
    assert!(view_titles(store, View::Completed, today).is_empty());

    let counts = store.counts(today).unwrap();
    assert_eq!((counts.inbox, counts.today, counts.upcoming), (1, 1, 1));
    assert_eq!((counts.anytime, counts.someday, counts.overdue), (1, 1, 0));
}

#[test]
fn an_overdue_deadline_surfaces_in_today_wherever_the_task_lives() {
    let mut f = Fixture::new();
    let store = &mut f.store;
    let today = d("2026-09-07");

    // Parked in Someday, but the deadline has passed. It must not stay hidden.
    let task = store
        .create_task(
            serde_json::from_value(serde_json::json!({
                "title": "Passport renewal",
                "list": "someday",
                "due_on": "2026-09-01"
            }))
            .unwrap(),
        )
        .unwrap();
    assert_eq!(view_titles(store, View::Today, today), vec!["Passport renewal"]);
    assert_eq!(store.counts(today).unwrap().overdue, 1);

    // With the deadline still ahead it waits in Upcoming instead.
    store
        .update_task(
            &task.task.id,
            serde_json::from_value(serde_json::json!({ "due_on": "2026-10-01" })).unwrap(),
        )
        .unwrap();
    assert!(view_titles(store, View::Today, today).is_empty());
    assert_eq!(view_titles(store, View::Upcoming, today), vec!["Passport renewal"]);
}

#[test]
fn a_start_date_in_the_past_still_lands_in_today() {
    let mut f = Fixture::new();
    let store = &mut f.store;
    store
        .create_task(
            serde_json::from_value(serde_json::json!({ "title": "Was due Friday", "start_on": "2026-09-04" }))
                .unwrap(),
        )
        .unwrap();
    assert_eq!(
        view_titles(store, View::Today, d("2026-09-07")),
        vec!["Was due Friday"],
        "nothing silently falls off the end of the calendar"
    );
}

#[test]
fn parking_a_task_in_someday_clears_its_schedule() {
    let mut f = Fixture::new();
    let store = &mut f.store;
    let task = store
        .create_task(
            serde_json::from_value(serde_json::json!({ "title": "Learn the piano", "start_on": "2026-09-07" }))
                .unwrap(),
        )
        .unwrap();
    let parked = store
        .update_task(
            &task.task.id,
            serde_json::from_value(serde_json::json!({ "list": "someday" })).unwrap(),
        )
        .unwrap();
    assert_eq!(parked.task.start_on, None);
    assert!(view_titles(store, View::Today, d("2026-09-07")).is_empty());
    assert_eq!(view_titles(store, View::Someday, d("2026-09-07")), vec!["Learn the piano"]);
}

// ---------------------------------------------------------------------------
// Repeats through the store
// ---------------------------------------------------------------------------

#[test]
fn a_monthly_repeat_keeps_the_gap_between_start_and_deadline() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    // Start on the 1st, due on the 5th: four days of slack, every month.
    let task = store
        .create_task(
            serde_json::from_value(serde_json::json!({
                "title": "Pay the rent",
                "start_on": "2026-09-01",
                "due_on": "2026-09-05",
                "recurrence": {
                    "freq": "monthly",
                    "interval": 1,
                    "monthly": { "type": "day_of_month", "day": 1 },
                    "anchor": "fixed_schedule",
                    "starts_on": "2026-09-01",
                    "ends": { "type": "never" }
                }
            }))
            .unwrap(),
        )
        .unwrap();

    let next = store
        .set_task_status(&task.task.id, TaskStatus::Completed, d("2026-09-03"))
        .unwrap();
    assert_eq!(next.task.start_on, Some(d("2026-10-01")));
    assert_eq!(next.task.due_on, Some(d("2026-10-05")), "the four days come along");
}

#[test]
fn a_repeat_that_ends_leaves_history_and_no_next_task() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    let rule = RecurrenceRule {
        freq: Freq::Daily,
        interval: 1,
        weekdays: vec![],
        monthly: None,
        month: None,
        anchor: Anchor::FixedSchedule,
        starts_on: d("2026-09-07"),
        ends: Ends::AfterOccurrences { count: 2 },
    };
    let mut current = store
        .create_task(NewTask {
            title: "Take the antibiotics".into(),
            notes: String::new(),
            project_id: None,
            area_id: None,
            parent_id: None,
            list: None,
            start_on: Some(d("2026-09-07")),
            due_on: None,
            priority: None,
            tag_names: vec![],
            recurrence: Some(rule),
        })
        .unwrap();

    // Day one rolls over to day two.
    current = store
        .set_task_status(&current.task.id, TaskStatus::Completed, d("2026-09-07"))
        .unwrap();
    assert_eq!(current.task.start_on, Some(d("2026-09-08")));

    // Day two is the last: completing it produces nothing new.
    let last_id = current.task.id.clone();
    let after = store
        .set_task_status(&last_id, TaskStatus::Completed, d("2026-09-08"))
        .unwrap();
    assert_eq!(after.task.id, last_id, "no further occurrence was created");
    assert_eq!(after.task.status, TaskStatus::Completed);

    let archive = store.list_view(View::Completed, d("2026-09-08"), 0).unwrap();
    assert_eq!(archive.tasks.len(), 2, "both doses are in the archive");
    assert!(view_titles(store, View::Today, d("2026-09-09")).is_empty());
}

#[test]
fn a_repeating_task_carries_its_checklist_forward_unticked() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    let task = store
        .create_task(
            serde_json::from_value(serde_json::json!({
                "title": "Bin day",
                "start_on": "2026-09-07",
                "recurrence": {
                    "freq": "weekly", "interval": 1, "weekdays": [0],
                    "anchor": "fixed_schedule", "starts_on": "2026-09-07",
                    "ends": { "type": "never" }
                }
            }))
            .unwrap(),
        )
        .unwrap();
    for step in ["Recycling", "Garden waste"] {
        store
            .create_task(
                serde_json::from_value(serde_json::json!({ "title": step, "parent_id": task.task.id }))
                    .unwrap(),
            )
            .unwrap();
    }

    let next = store
        .set_task_status(&task.task.id, TaskStatus::Completed, d("2026-09-07"))
        .unwrap();

    assert_eq!(next.subtasks.len(), 2);
    assert!(
        next.subtasks.iter().all(|s| s.status == TaskStatus::Open),
        "next week's checklist starts fresh"
    );
    // Last week's checklist is ticked off with its parent, as history.
    let done = store.task_detail(&task.task.id).unwrap();
    assert!(done.subtasks.iter().all(|s| s.status == TaskStatus::Completed));
}

#[test]
fn an_after_completion_repeat_measures_from_the_day_it_was_done() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    let rule = RecurrenceRule {
        freq: Freq::Daily,
        interval: 3,
        weekdays: vec![],
        monthly: None,
        month: None,
        anchor: Anchor::AfterCompletion,
        starts_on: d("2026-09-07"),
        ends: Ends::Never,
    };
    let task = store
        .create_task(NewTask {
            title: "Water the plants".into(),
            notes: String::new(),
            project_id: None,
            area_id: None,
            parent_id: None,
            list: None,
            start_on: Some(d("2026-09-07")),
            due_on: None,
            priority: None,
            tag_names: vec![],
            recurrence: Some(rule),
        })
        .unwrap();

    // Four days late. The next one is three days from *now*, not from the plan.
    let next = store
        .set_task_status(&task.task.id, TaskStatus::Completed, d("2026-09-11"))
        .unwrap();
    assert_eq!(next.task.start_on, Some(d("2026-09-14")));
}

#[test]
fn the_nth_weekday_rule_survives_a_round_trip_through_the_database() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    let rule = RecurrenceRule {
        freq: Freq::Monthly,
        interval: 1,
        weekdays: vec![],
        monthly: Some(MonthlyMode::NthWeekday { nth: -1, weekday: 4 }),
        month: None,
        anchor: Anchor::FixedSchedule,
        starts_on: d("2026-09-01"),
        ends: Ends::Never,
    };
    let task = store
        .create_task(NewTask {
            title: "Month-end numbers".into(),
            notes: String::new(),
            project_id: None,
            area_id: None,
            parent_id: None,
            list: None,
            start_on: None,
            due_on: None,
            priority: None,
            tag_names: vec![],
            recurrence: Some(rule.clone()),
        })
        .unwrap();

    assert_eq!(task.task.start_on, Some(d("2026-09-25")), "last Friday in September");
    assert_eq!(task.recurrence.as_ref().unwrap().rule, rule);

    let next = store
        .set_task_status(&task.task.id, TaskStatus::Completed, d("2026-09-25"))
        .unwrap();
    assert_eq!(next.task.start_on, Some(d("2026-10-30")), "last Friday in October");
}

// ---------------------------------------------------------------------------
// Validation and error handling
// ---------------------------------------------------------------------------

#[test]
fn bad_input_is_refused_with_a_message_a_person_can_act_on() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    let blank = store.create_task(
        serde_json::from_value(serde_json::json!({ "title": "   " })).unwrap(),
    );
    assert!(blank.unwrap_err().to_string().contains("název je povinný"));

    let long = store.create_task(
        serde_json::from_value(serde_json::json!({ "title": "x".repeat(600) })).unwrap(),
    );
    assert!(long.unwrap_err().to_string().contains("500"));

    let task = quick_capture(store, "Fine");
    let bad_priority = store.update_task(
        &task.task.id,
        serde_json::from_value(serde_json::json!({ "priority": 9 })).unwrap(),
    );
    assert!(bad_priority.unwrap_err().to_string().contains("0, 1, 2 nebo 3"));

    let bad_year = store.update_task(
        &task.task.id,
        serde_json::from_value(serde_json::json!({ "due_on": "0202-01-01" })).unwrap(),
    );
    assert!(bad_year.unwrap_err().to_string().contains("1900"));

    let missing_project = store.update_task(
        &task.task.id,
        serde_json::from_value(serde_json::json!({ "project_id": "nope" })).unwrap(),
    );
    assert!(missing_project.unwrap_err().to_string().contains("už neexistuje"));

    // The task itself is untouched by any of the rejected edits.
    let after = store.get_task(&task.task.id).unwrap();
    assert_eq!(after.priority, 0);
    assert_eq!(after.due_on, None);
}

#[test]
fn a_task_survives_the_project_and_area_it_was_filed_in() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    let area = store.create_area("Home").unwrap();
    let project = store.create_project("Kitchen", Some(&area.id), "").unwrap();
    let task = store
        .create_task(
            serde_json::from_value(serde_json::json!({ "title": "Fix the tap", "project_id": project.id }))
                .unwrap(),
        )
        .unwrap();

    store.delete_project(&project.id).unwrap();
    let orphan = store.get_task(&task.task.id).unwrap();
    assert_eq!(orphan.project_id, None, "unfiled, not deleted");
    assert_eq!(orphan.title, "Fix the tap");

    store.delete_area(&area.id).unwrap();
    assert!(store.get_task(&task.task.id).is_ok());

    // And undo puts the area back.
    store.undo().unwrap();
    assert_eq!(store.list_areas().unwrap().len(), 1);
}

#[test]
fn deleting_a_task_takes_its_checklist_and_undo_brings_both_back() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    let parent = quick_capture(store, "Plan the trip");
    store
        .create_task(
            serde_json::from_value(serde_json::json!({ "title": "Book flights", "parent_id": parent.task.id }))
                .unwrap(),
        )
        .unwrap();

    store.delete_task(&parent.task.id).unwrap();
    assert!(store.get_task(&parent.task.id).is_err());

    store.undo().unwrap();
    let restored = store.task_detail(&parent.task.id).unwrap();
    assert_eq!(restored.subtasks.len(), 1);
    assert_eq!(restored.subtasks[0].title, "Book flights");
}

#[test]
fn subtasks_cannot_nest_more_than_one_level() {
    let mut f = Fixture::new();
    let store = &mut f.store;
    let parent = quick_capture(store, "Top");
    let child = store
        .create_task(
            serde_json::from_value(serde_json::json!({ "title": "Middle", "parent_id": parent.task.id }))
                .unwrap(),
        )
        .unwrap();
    let grandchild = store.create_task(
        serde_json::from_value(serde_json::json!({ "title": "Bottom", "parent_id": child.task.id })).unwrap(),
    );
    assert!(grandchild.unwrap_err().to_string().contains("nemohou mít vlastní podúkoly"));
}

#[test]
fn an_attachment_that_is_too_big_is_refused_and_nothing_is_copied() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = Config {
        data_dir: dir.path().to_path_buf(),
        backup_keep: 2,
        backup_min_interval_minutes: 0,
        max_attachment_bytes: 16,
        debug: false,
    };
    let mut store = Store::open(cfg).unwrap();
    let task = quick_capture(&mut store, "Holds a file");

    let big = dir.path().join("big.bin");
    std::fs::write(&big, vec![0u8; 4096]).unwrap();

    let err = store.add_attachment(&task.task.id, &big).unwrap_err().to_string();
    assert!(err.contains("limit je"), "got: {err}");
    assert_eq!(
        std::fs::read_dir(dir.path().join("attachments")).unwrap().count(),
        0,
        "nothing was copied in"
    );
}

#[test]
fn the_orphan_sweep_only_touches_files_t3_wrote() {
    let mut f = Fixture::new();
    let attachments = f._dir.path().join("attachments");

    // A real attachment, then its row is removed - the file becomes an orphan.
    let task = quick_capture(&mut f.store, "Has a file");
    let source = f._dir.path().join("receipt.pdf");
    std::fs::write(&source, b"pdf").unwrap();
    let attachment = f.store.add_attachment(&task.task.id, &source).unwrap();
    f.store.remove_attachment(&attachment.id).unwrap();

    // Something that is not ours, sitting in the same folder.
    let stranger = attachments.join("someone-elses-notes.txt");
    std::fs::write(&stranger, b"do not delete me").unwrap();

    let removed = f.store.sweep_orphan_attachments().unwrap();
    assert_eq!(removed, 1, "the orphan went");
    assert!(!attachments.join(&attachment.stored_name).exists());
    assert!(stranger.exists(), "an unrecognised file is never deleted");
}

#[test]
fn the_orphan_sweep_keeps_files_that_are_still_referenced() {
    let mut f = Fixture::new();
    let task = quick_capture(&mut f.store, "Has a file");
    let source = f._dir.path().join("receipt.pdf");
    std::fs::write(&source, b"pdf").unwrap();
    let attachment = f.store.add_attachment(&task.task.id, &source).unwrap();

    assert_eq!(f.store.sweep_orphan_attachments().unwrap(), 0);
    assert!(f.store.attachment_path(&attachment.id).unwrap().exists());
}

#[test]
fn attaching_a_file_that_is_not_there_reports_it_rather_than_panicking() {
    let mut f = Fixture::new();
    let store = &mut f.store;
    let task = quick_capture(store, "Holds a file");
    let err = store
        .add_attachment(&task.task.id, &f._dir.path().join("ghost.pdf"))
        .unwrap_err()
        .to_string();
    assert!(err.contains("nelze přečíst"), "got: {err}");
}

// ---------------------------------------------------------------------------
// Search and saved filters
// ---------------------------------------------------------------------------

#[test]
fn search_matches_notes_escapes_wildcards_and_can_include_the_archive() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    store
        .create_task(
            serde_json::from_value(serde_json::json!({
                "title": "Renegotiate the contract",
                "notes": "They asked for a 50% discount."
            }))
            .unwrap(),
        )
        .unwrap();
    let done = quick_capture(store, "Old business");
    store
        .set_task_status(&done.task.id, TaskStatus::Completed, d("2026-09-07"))
        .unwrap();

    // Notes are searched too.
    let hits = store
        .search(&serde_json::from_value(serde_json::json!({ "text": "discount" })).unwrap())
        .unwrap();
    assert_eq!(titles(&hits), vec!["Renegotiate the contract"]);

    // `%` is a literal, not a wildcard.
    let literal = store
        .search(&serde_json::from_value(serde_json::json!({ "text": "50%" })).unwrap())
        .unwrap();
    assert_eq!(literal.len(), 1);
    let no_match = store
        .search(&serde_json::from_value(serde_json::json!({ "text": "9%" })).unwrap())
        .unwrap();
    assert!(no_match.is_empty(), "a bare % must not match everything");

    // Completed tasks are excluded unless asked for.
    let open_only: Vec<String> = titles(
        &store
            .search(&serde_json::from_value(serde_json::json!({ "text": "business" })).unwrap())
            .unwrap(),
    );
    assert!(open_only.is_empty());
    let everything = store
        .search(
            &serde_json::from_value(serde_json::json!({
                "text": "business",
                "statuses": ["open", "completed", "canceled"]
            }))
            .unwrap(),
        )
        .unwrap();
    assert_eq!(titles(&everything), vec!["Old business"]);
}

#[test]
fn saved_filters_reject_duplicates_and_empty_queries() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    store.save_filter("Errands", "tag:errand").unwrap();
    let dup = store.save_filter("errands", "tag:errand");
    assert!(dup.unwrap_err().to_string().contains("už existuje"));

    let empty = store.save_filter("Nothing", "   ");
    assert!(empty.unwrap_err().to_string().contains("nejdřív něco vyhledejte"));

    let filters = store.list_saved_filters().unwrap();
    assert_eq!(filters.len(), 1);
    store.delete_saved_filter(&filters[0].id).unwrap();
    assert!(store.list_saved_filters().unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// Import behaviour
// ---------------------------------------------------------------------------

#[test]
fn importing_a_file_that_is_not_an_export_says_so_clearly() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    let err = store.import_json("{\"hello\": 1}", ImportMode::Merge, false).unwrap_err().to_string();
    assert!(err.contains("nevypadá jako export z Notes_MJ"), "got: {err}");

    let err = store.import_json("not json at all", ImportMode::Merge, false).unwrap_err().to_string();
    assert!(err.contains("nevypadá jako export z Notes_MJ"), "got: {err}");

    let future = serde_json::json!({
        "format": "t3.export", "version": 99, "exported_at": "2026-09-07T00:00:00Z",
        "app_version": "9.0.0", "attachments_note": "",
        "areas": [], "projects": [], "tags": [], "tasks": [], "saved_filters": []
    })
    .to_string();
    let err = store.import_json(&future, ImportMode::Merge, false).unwrap_err().to_string();
    assert!(err.contains("verzi 99"), "got: {err}");
}

#[test]
fn a_replace_import_wipes_first_and_is_still_one_undo_step() {
    let mut f = Fixture::new();
    let store = &mut f.store;

    quick_capture(store, "Something old");
    let export = serde_json::to_string(&store.build_export().unwrap()).unwrap();

    let mut target = Fixture::new();
    quick_capture(&mut target.store, "Will be replaced");
    let report = target.store.import_json(&export, ImportMode::Replace, false).unwrap();
    assert_eq!(report.tasks, 1);
    assert_eq!(
        view_titles(&target.store, View::Inbox, d("2026-09-07")),
        vec!["Something old"]
    );

    // One Ctrl+Z restores the whole previous database.
    target.store.undo().unwrap();
    assert_eq!(
        view_titles(&target.store, View::Inbox, d("2026-09-07")),
        vec!["Will be replaced"]
    );
}

#[test]
fn a_merge_import_renames_a_clashing_area_instead_of_failing() {
    let mut f = Fixture::new();
    f.store.create_area("Personal").unwrap();
    let export = serde_json::to_string(&f.store.build_export().unwrap()).unwrap();

    // A second, unrelated database that happens to use the same area name.
    let mut other = Fixture::new();
    other.store.create_area("Personal").unwrap();
    let report = other.store.import_json(&export, ImportMode::Merge, false).unwrap();
    assert_eq!(report.areas, 1);

    let names: Vec<String> = other
        .store
        .list_areas()
        .unwrap()
        .into_iter()
        .map(|a| a.name)
        .collect();
    assert_eq!(names, vec!["Personal", "Personal (2)"]);
}

#[test]
fn an_export_of_an_empty_database_imports_cleanly() {
    let f = Fixture::new();
    let export = serde_json::to_string(&f.store.build_export().unwrap()).unwrap();
    let mut target = Fixture::new();
    let report = target.store.import_json(&export, ImportMode::Merge, false).unwrap();
    assert_eq!(report.tasks, 0);
    assert!(report.warnings.is_empty());
}
