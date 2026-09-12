//! Every read and write the UI can perform, expressed as plain methods on
//! [`Store`]. The Tauri commands in `commands.rs` are thin wrappers around
//! these, which is what lets the end-to-end test drive the real application
//! logic without a window.

use chrono::{Datelike, NaiveDate, Utc};
use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::{Recorder, Store};
use crate::error::{AppError, Result};
use crate::models::*;
use crate::recur::RecurrenceState;

const MAX_TITLE: usize = 500;
const MAX_NOTES: usize = 100_000;
const MAX_TAG_NAME: usize = 60;
const MAX_NAME: usize = 200;
const MAX_QUERY: usize = 500;
/// The archive can get long; the UI pages through it.
const ARCHIVE_PAGE: i64 = 200;

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn now_str() -> String {
    fmt_ts(Utc::now())
}

// -- input validation ---------------------------------------------------------

/// Trims and length-checks a required, user-visible name.
fn clean_title(raw: &str) -> Result<String> {
    let t = raw.trim();
    if t.is_empty() {
        return Err(AppError::Validation("název je povinný".into()));
    }
    if t.chars().count() > MAX_TITLE {
        return Err(AppError::Validation(format!(
            "název může mít nejvýše {MAX_TITLE} znaků"
        )));
    }
    // Strip control characters so a pasted blob cannot break the list layout.
    Ok(t.chars().filter(|c| !c.is_control() || *c == '\n').collect())
}

fn clean_name(raw: &str, what: &str) -> Result<String> {
    let t = raw.trim();
    if t.is_empty() {
        return Err(AppError::Validation(format!("název {what} je povinný")));
    }
    if t.chars().count() > MAX_NAME {
        return Err(AppError::Validation(format!(
            "název {what} může mít nejvýše {MAX_NAME} znaků"
        )));
    }
    Ok(t.chars().filter(|c| !c.is_control()).collect())
}

fn clean_notes(raw: &str) -> Result<String> {
    if raw.chars().count() > MAX_NOTES {
        return Err(AppError::Validation(
            "poznámky jsou příliš dlouhé - vejděte se do 100 000 znaků".into(),
        ));
    }
    Ok(raw.replace('\r', ""))
}

pub(crate) fn clean_tag_name(raw: &str) -> Result<String> {
    let t = raw.trim().trim_start_matches('#').trim();
    if t.is_empty() {
        return Err(AppError::Validation("štítek musí mít název".into()));
    }
    if t.chars().count() > MAX_TAG_NAME {
        return Err(AppError::Validation(format!(
            "název štítku může mít nejvýše {MAX_TAG_NAME} znaků"
        )));
    }
    Ok(t.chars().filter(|c| !c.is_control()).collect())
}

fn check_priority(p: i64) -> Result<i64> {
    if (0..=3).contains(&p) {
        Ok(p)
    } else {
        Err(AppError::Validation("priorita musí být 0, 1, 2 nebo 3".into()))
    }
}

/// Keeps obviously-wrong dates (a typo'd year, a date arithmetic bug) out of
/// the database, where they would poison every "upcoming" query.
fn check_date(d: Option<NaiveDate>, what: &str) -> Result<Option<NaiveDate>> {
    if let Some(d) = d {
        if !(1900..=2200).contains(&d.year()) {
            return Err(AppError::Validation(format!(
                "{what} musí být mezi roky 1900 a 2200"
            )));
        }
    }
    Ok(d)
}

fn check_color(raw: &str) -> Result<String> {
    let c = raw.trim();
    let ok = c.len() == 7
        && c.starts_with('#')
        && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if ok {
        Ok(c.to_lowercase())
    } else {
        Err(AppError::Validation("barva se zadává ve tvaru #4f7cff".into()))
    }
}

// -- search -------------------------------------------------------------------

/// A structured search request. The UI parses the typed query string into this
/// shape (see `src/lib/query.ts`) so the backend never has to do text parsing.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct SearchFilter {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub area_id: Option<String>,
    #[serde(default)]
    pub list: Option<TaskList>,
    /// `None` means "open tasks only"; use `Some(vec![])` for everything.
    #[serde(default)]
    pub statuses: Option<Vec<TaskStatus>>,
    #[serde(default)]
    pub min_priority: Option<i64>,
    #[serde(default)]
    pub due_before: Option<NaiveDate>,
    #[serde(default)]
    pub due_after: Option<NaiveDate>,
    #[serde(default)]
    pub start_before: Option<NaiveDate>,
    #[serde(default)]
    pub has_deadline: Option<bool>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// The payload every list view returns: rows plus the counts the sidebar needs.
#[derive(Debug, Clone, Serialize)]
pub struct ViewPayload {
    pub view: View,
    pub tasks: Vec<TaskDetail>,
    /// Only meaningful for the archive: whether older rows remain.
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Counts {
    pub inbox: i64,
    pub today: i64,
    pub upcoming: i64,
    pub anytime: i64,
    pub someday: i64,
    pub completed: i64,
    /// Open tasks whose deadline has already passed.
    pub overdue: i64,
}

impl Store {
    // -- areas ---------------------------------------------------------------

    pub fn list_areas(&self) -> Result<Vec<Area>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM areas WHERE archived = 0 ORDER BY position, name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], Area::from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn create_area(&mut self, name: &str) -> Result<Area> {
        let name = clean_name(name, "oblasti")?;
        let id = new_id();
        let now = now_str();
        self.write("přidání oblasti", |tx, rec| {
            rec.touch(tx, "areas", &id)?;
            let position: f64 = next_position(tx, "areas", "1=1", &[])?;
            tx.execute(
                "INSERT INTO areas(id, name, position, archived, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 0, ?4, ?4)",
                params![id, name, position, now],
            )?;
            Ok(())
        })?;
        self.get_area(&id)
    }

    pub fn get_area(&self, id: &str) -> Result<Area> {
        self.conn
            .query_row("SELECT * FROM areas WHERE id = ?1", params![id], Area::from_row)
            .map_err(|_| AppError::NotFound("tato oblast už neexistuje".into()))
    }

    pub fn rename_area(&mut self, id: &str, name: &str) -> Result<Area> {
        let name = clean_name(name, "oblasti")?;
        let now = now_str();
        self.write("přejmenování oblasti", |tx, rec| {
            rec.touch(tx, "areas", id)?;
            let n = tx.execute(
                "UPDATE areas SET name = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, name, now],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("tato oblast už neexistuje".into()));
            }
            Ok(())
        })?;
        self.get_area(id)
    }

    /// Deletes an area. Its projects and tasks survive and become unfiled,
    /// because losing tasks to a mis-click is unforgivable.
    pub fn delete_area(&mut self, id: &str) -> Result<()> {
        self.write("smazání oblasti", |tx, rec| {
            rec.touch(tx, "areas", id)?;
            rec.touch_children(tx, "projects", "area_id", id)?;
            rec.touch_children(tx, "tasks", "area_id", id)?;
            let n = tx.execute("DELETE FROM areas WHERE id = ?1", params![id])?;
            if n == 0 {
                return Err(AppError::NotFound("tato oblast už neexistuje".into()));
            }
            Ok(())
        })
    }

    // -- projects ------------------------------------------------------------

    pub fn list_projects(&self, include_done: bool) -> Result<Vec<Project>> {
        let sql = if include_done {
            "SELECT * FROM projects ORDER BY position, name COLLATE NOCASE"
        } else {
            "SELECT * FROM projects WHERE status = 'open' ORDER BY position, name COLLATE NOCASE"
        };
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([], Project::from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_project(&self, id: &str) -> Result<Project> {
        self.conn
            .query_row(
                "SELECT * FROM projects WHERE id = ?1",
                params![id],
                Project::from_row,
            )
            .map_err(|_| AppError::NotFound("tento projekt už neexistuje".into()))
    }

    pub fn create_project(
        &mut self,
        name: &str,
        area_id: Option<&str>,
        notes: &str,
    ) -> Result<Project> {
        let name = clean_name(name, "projektu")?;
        let notes = clean_notes(notes)?;
        let id = new_id();
        let now = now_str();
        let area = area_id.map(str::to_string);
        self.write("přidání projektu", |tx, rec| {
            if let Some(a) = &area {
                require_exists(tx, "areas", a, "tato oblast")?;
            }
            rec.touch(tx, "projects", &id)?;
            let position = next_position(tx, "projects", "1=1", &[])?;
            tx.execute(
                "INSERT INTO projects(id, name, notes, area_id, status, list, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'open', 'anytime', ?5, ?6, ?6)",
                params![id, name, notes, area, position, now],
            )?;
            Ok(())
        })?;
        self.get_project(&id)
    }

    pub fn update_project(&mut self, id: &str, patch: &TaskPatch) -> Result<Project> {
        let now = now_str();
        let name = patch.title.as_deref().map(|t| clean_name(t, "projektu")).transpose()?;
        let notes = patch.notes.as_deref().map(clean_notes).transpose()?;
        let start = check_date(patch.start_on.flatten(), "datum zahájení")?;
        let due = check_date(patch.due_on.flatten(), "termín")?;
        let patch_start = patch.start_on.is_some();
        let patch_due = patch.due_on.is_some();
        let area = patch.area_id.clone();
        let list = patch.list;

        self.write("úpravu projektu", |tx, rec| {
            rec.touch(tx, "projects", id)?;
            require_exists(tx, "projects", id, "tento projekt")?;
            if let Some(Some(a)) = &area {
                require_exists(tx, "areas", a, "tato oblast")?;
            }
            if let Some(v) = &name {
                tx.execute("UPDATE projects SET name = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = &notes {
                tx.execute("UPDATE projects SET notes = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = &area {
                tx.execute("UPDATE projects SET area_id = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = list {
                tx.execute(
                    "UPDATE projects SET list = ?2 WHERE id = ?1",
                    params![id, v.as_str()],
                )?;
            }
            if patch_start {
                tx.execute(
                    "UPDATE projects SET start_on = ?2 WHERE id = ?1",
                    params![id, fmt_date(start)],
                )?;
            }
            if patch_due {
                tx.execute(
                    "UPDATE projects SET due_on = ?2 WHERE id = ?1",
                    params![id, fmt_date(due)],
                )?;
            }
            tx.execute(
                "UPDATE projects SET updated_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
            Ok(())
        })?;
        self.get_project(id)
    }

    /// Marks a project done. Its remaining open tasks are completed with it,
    /// which is what "the project is finished" means in practice.
    pub fn set_project_status(&mut self, id: &str, status: TaskStatus) -> Result<Project> {
        let now = now_str();
        // Projects are completed from the sidebar, which has no local date to
        // send, so fall back to the UTC day here.
        let today_local = Utc::now().date_naive().format("%Y-%m-%d").to_string();
        let label = match status {
            TaskStatus::Open => "znovuotevření projektu",
            TaskStatus::Completed => "dokončení projektu",
            TaskStatus::Canceled => "zrušení projektu",
        };
        self.write(label, |tx, rec| {
            rec.touch(tx, "projects", id)?;
            require_exists(tx, "projects", id, "tento projekt")?;
            rec.touch_children(tx, "tasks", "project_id", id)?;

            let completed_at = if status == TaskStatus::Open { None } else { Some(now.clone()) };
            tx.execute(
                "UPDATE projects SET status = ?2, completed_at = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, status.as_str(), completed_at, now],
            )?;
            if status != TaskStatus::Open {
                tx.execute(
                    "UPDATE tasks SET status = ?2, completed_at = ?3, completed_on = ?4,
                                     updated_at = ?3
                     WHERE project_id = ?1 AND status = 'open'",
                    params![id, status.as_str(), now, today_local],
                )?;
            }
            Ok(())
        })?;
        self.get_project(id)
    }

    /// Deletes a project. Its tasks are kept and become unfiled.
    pub fn delete_project(&mut self, id: &str) -> Result<()> {
        self.write("smazání projektu", |tx, rec| {
            rec.touch(tx, "projects", id)?;
            rec.touch_children(tx, "tasks", "project_id", id)?;
            let n = tx.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
            if n == 0 {
                return Err(AppError::NotFound("tento projekt už neexistuje".into()));
            }
            Ok(())
        })
    }

    // -- tags ----------------------------------------------------------------

    pub fn list_tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM tags ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], Tag::from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn set_tag_color(&mut self, id: &str, color: &str) -> Result<Tag> {
        let color = check_color(color)?;
        self.write("změnu barvy štítku", |tx, rec| {
            rec.touch(tx, "tags", id)?;
            let n = tx.execute(
                "UPDATE tags SET color = ?2 WHERE id = ?1",
                params![id, color],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("tento štítek už neexistuje".into()));
            }
            Ok(())
        })?;
        self.conn
            .query_row("SELECT * FROM tags WHERE id = ?1", params![id], Tag::from_row)
            .map_err(Into::into)
    }

    pub fn delete_tag(&mut self, id: &str) -> Result<()> {
        self.write("smazání štítku", |tx, rec| {
            rec.touch(tx, "tags", id)?;
            rec.touch_children(tx, "task_tags", "tag_id", id)?;
            let n = tx.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
            if n == 0 {
                return Err(AppError::NotFound("tento štítek už neexistuje".into()));
            }
            Ok(())
        })
    }

    // -- tasks ---------------------------------------------------------------

    pub fn create_task(&mut self, input: NewTask) -> Result<TaskDetail> {
        let title = clean_title(&input.title)?;
        let notes = clean_notes(&input.notes)?;
        let priority = check_priority(input.priority.unwrap_or(0))?;
        let start_on = check_date(input.start_on, "datum zahájení")?;
        let due_on = check_date(input.due_on, "termín")?;
        if let Some(rule) = &input.recurrence {
            rule.validate()?;
        }
        let tag_names: Vec<String> = input
            .tag_names
            .iter()
            .map(|t| clean_tag_name(t))
            .collect::<Result<Vec<_>>>()?;

        // The Inbox is for things that have not been dealt with yet. Filing a
        // task somewhere, or deciding when to do it, is dealing with it - so
        // only a bare title stays behind.
        let list = input.list.unwrap_or({
            let decided = input.project_id.is_some()
                || input.area_id.is_some()
                || input.parent_id.is_some()
                || start_on.is_some()
                || input.recurrence.is_some();
            if decided {
                TaskList::Anytime
            } else {
                TaskList::Inbox
            }
        });

        let id = new_id();
        let now = now_str();
        let rule = input.recurrence.clone();

        self.write("přidání úkolu", |tx, rec| {
            if let Some(p) = &input.project_id {
                require_exists(tx, "projects", p, "tento projekt")?;
            }
            if let Some(a) = &input.area_id {
                require_exists(tx, "areas", a, "tato oblast")?;
            }
            if let Some(p) = &input.parent_id {
                require_exists(tx, "tasks", p, "tento úkol")?;
                // One level of subtasks only: a checklist, not a tree.
                let grandparent: Option<String> = tx
                    .query_row("SELECT parent_id FROM tasks WHERE id = ?1", params![p], |r| r.get(0))
                    .unwrap_or(None);
                if grandparent.is_some() {
                    return Err(AppError::Validation(
                        "podúkoly nemohou mít vlastní podúkoly".into(),
                    ));
                }
            }
            rec.touch(tx, "tasks", &id)?;

            let (recurrence_id, series_id, effective_start) = match &rule {
                None => (None, None, start_on),
                Some(rule) => {
                    let rid = new_id();
                    rec.touch(tx, "recurrences", &rid)?;
                    let first = rule
                        .first_on_or_after(start_on.unwrap_or(rule.starts_on))
                        .ok_or_else(|| {
                            AppError::Validation("tohle opakování nikdy nenastane".into())
                        })?;
                    let state = RecurrenceState {
                        occurrences_done: 0,
                        last_scheduled: Some(first),
                        last_completed: None,
                    };
                    tx.execute(
                        "INSERT INTO recurrences(id, rule, state) VALUES (?1, ?2, ?3)",
                        params![
                            rid,
                            serde_json::to_string(rule)?,
                            serde_json::to_string(&state)?
                        ],
                    )?;
                    (Some(rid.clone()), Some(rid), Some(first))
                }
            };

            let scope = match (&input.parent_id, &input.project_id) {
                (Some(p), _) => ("parent_id = ?1", p.clone()),
                (None, Some(p)) => ("project_id = ?1", p.clone()),
                _ => ("list = ?1", list.as_str().to_string()),
            };
            let position = next_position(tx, "tasks", scope.0, &[scope.1.into()])?;

            tx.execute(
                "INSERT INTO tasks(id, title, notes, project_id, area_id, parent_id, status, list,
                                   start_on, due_on, priority, position, recurrence_id, series_id,
                                   created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
                params![
                    id,
                    title,
                    notes,
                    input.project_id,
                    input.area_id,
                    input.parent_id,
                    list.as_str(),
                    fmt_date(effective_start),
                    fmt_date(due_on),
                    priority,
                    position,
                    recurrence_id,
                    series_id,
                    now
                ],
            )?;
            set_task_tags(tx, rec, &id, &tag_names, &now)?;
            Ok(())
        })?;

        self.task_detail(&id)
    }

    pub fn get_task(&self, id: &str) -> Result<Task> {
        self.conn
            .query_row("SELECT * FROM tasks WHERE id = ?1", params![id], Task::from_row)
            .map_err(|_| AppError::NotFound("tento úkol už neexistuje".into()))
    }

    pub fn update_task(&mut self, id: &str, patch: TaskPatch) -> Result<TaskDetail> {
        let title = patch.title.as_deref().map(clean_title).transpose()?;
        let notes = patch.notes.as_deref().map(clean_notes).transpose()?;
        let priority = patch.priority.map(check_priority).transpose()?;
        let start_on = check_date(patch.start_on.flatten(), "datum zahájení")?;
        let due_on = check_date(patch.due_on.flatten(), "termín")?;
        let tag_names = patch
            .tag_names
            .as_ref()
            .map(|names| names.iter().map(|t| clean_tag_name(t)).collect::<Result<Vec<_>>>())
            .transpose()?;
        if let Some(Some(rule)) = &patch.recurrence {
            rule.validate()?;
        }
        let now = now_str();

        self.write("úpravu úkolu", |tx, rec| {
            rec.touch(tx, "tasks", id)?;
            require_exists(tx, "tasks", id, "tento úkol")?;

            if let Some(v) = &title {
                tx.execute("UPDATE tasks SET title = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = &notes {
                tx.execute("UPDATE tasks SET notes = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = priority {
                tx.execute("UPDATE tasks SET priority = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = patch.position {
                tx.execute("UPDATE tasks SET position = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = &patch.project_id {
                if let Some(p) = v {
                    require_exists(tx, "projects", p, "tento projekt")?;
                }
                tx.execute("UPDATE tasks SET project_id = ?2 WHERE id = ?1", params![id, v])?;
                // Filing a task takes it out of the inbox.
                if v.is_some() {
                    tx.execute(
                        "UPDATE tasks SET list = 'anytime' WHERE id = ?1 AND list = 'inbox'",
                        params![id],
                    )?;
                }
            }
            if let Some(v) = &patch.area_id {
                if let Some(a) = v {
                    require_exists(tx, "areas", a, "tato oblast")?;
                }
                tx.execute("UPDATE tasks SET area_id = ?2 WHERE id = ?1", params![id, v])?;
                if v.is_some() {
                    tx.execute(
                        "UPDATE tasks SET list = 'anytime' WHERE id = ?1 AND list = 'inbox'",
                        params![id],
                    )?;
                }
            }
            if let Some(v) = patch.list {
                tx.execute(
                    "UPDATE tasks SET list = ?2 WHERE id = ?1",
                    params![id, v.as_str()],
                )?;
                // Parking something for "someday" should not leave it scheduled.
                if v == TaskList::Someday {
                    tx.execute("UPDATE tasks SET start_on = NULL WHERE id = ?1", params![id])?;
                }
            }
            if patch.start_on.is_some() {
                tx.execute(
                    "UPDATE tasks SET start_on = ?2 WHERE id = ?1",
                    params![id, fmt_date(start_on)],
                )?;
                // Deciding when to do something takes it out of the Inbox, and
                // un-parks it from Someday.
                if start_on.is_some() {
                    tx.execute(
                        "UPDATE tasks SET list = 'anytime' WHERE id = ?1",
                        params![id],
                    )?;
                }
            }
            if patch.due_on.is_some() {
                tx.execute(
                    "UPDATE tasks SET due_on = ?2 WHERE id = ?1",
                    params![id, fmt_date(due_on)],
                )?;
            }
            if let Some(names) = &tag_names {
                set_task_tags(tx, rec, id, names, &now)?;
            }
            if let Some(recurrence) = &patch.recurrence {
                let existing: Option<String> = tx.query_row(
                    "SELECT recurrence_id FROM tasks WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )?;
                if let Some(old) = &existing {
                    rec.touch(tx, "recurrences", old)?;
                    tx.execute("DELETE FROM recurrences WHERE id = ?1", params![old])?;
                }
                match recurrence {
                    None => {
                        tx.execute(
                            "UPDATE tasks SET recurrence_id = NULL WHERE id = ?1",
                            params![id],
                        )?;
                    }
                    Some(rule) => {
                        let rid = new_id();
                        rec.touch(tx, "recurrences", &rid)?;
                        let current_start: Option<String> = tx.query_row(
                            "SELECT start_on FROM tasks WHERE id = ?1",
                            params![id],
                            |r| r.get(0),
                        )?;
                        let anchor = parse_date(current_start)?.unwrap_or(rule.starts_on);
                        let first = rule.first_on_or_after(anchor).ok_or_else(|| {
                            AppError::Validation("tohle opakování nikdy nenastane".into())
                        })?;
                        let state = RecurrenceState {
                            occurrences_done: 0,
                            last_scheduled: Some(first),
                            last_completed: None,
                        };
                        tx.execute(
                            "INSERT INTO recurrences(id, rule, state) VALUES (?1, ?2, ?3)",
                            params![
                                rid,
                                serde_json::to_string(rule)?,
                                serde_json::to_string(&state)?
                            ],
                        )?;
                        tx.execute(
                            "UPDATE tasks SET recurrence_id = ?2, series_id = ?2, start_on = ?3
                             WHERE id = ?1",
                            params![id, rid, fmt_date(Some(first))],
                        )?;
                    }
                }
            }
            tx.execute(
                "UPDATE tasks SET updated_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
            Ok(())
        })?;
        self.task_detail(id)
    }

    /// Completes (or cancels) a task.
    ///
    /// The completed row stays in the archive forever. If the task repeats, the
    /// next occurrence is created as a *new* task, so every occurrence has its
    /// own history rather than one row being rewritten over and over.
    pub fn set_task_status(
        &mut self,
        id: &str,
        status: TaskStatus,
        on_date: NaiveDate,
    ) -> Result<TaskDetail> {
        let now = now_str();
        let label = match status {
            TaskStatus::Open => "znovuotevření úkolu",
            TaskStatus::Completed => "dokončení úkolu",
            TaskStatus::Canceled => "zrušení úkolu",
        };

        let next_id = self.write(label, |tx, rec| {
            rec.touch(tx, "tasks", id)?;
            let task = tx
                .query_row("SELECT * FROM tasks WHERE id = ?1", params![id], Task::from_row)
                .map_err(|_| AppError::NotFound("tento úkol už neexistuje".into()))?;

            let done = status != TaskStatus::Open;
            let completed_at = if done { Some(now.clone()) } else { None };
            // `on_date` is the caller's *local* today. Storing it alongside the
            // UTC instant is what makes "dokončeno dnes" agree with the user's
            // calendar rather than with Greenwich.
            let completed_on = if done { fmt_date(Some(on_date)) } else { None };

            tx.execute(
                "UPDATE tasks SET status = ?2, completed_at = ?3, completed_on = ?5,
                                 updated_at = ?4
                 WHERE id = ?1",
                params![id, status.as_str(), completed_at, now, completed_on],
            )?;

            // Ticking off a parent ticks off its checklist.
            rec.touch_children(tx, "tasks", "parent_id", id)?;
            tx.execute(
                "UPDATE tasks SET status = ?2, completed_at = ?3, completed_on = ?5,
                                 updated_at = ?4
                 WHERE parent_id = ?1",
                params![id, status.as_str(), completed_at, now, completed_on],
            )?;

            if status == TaskStatus::Open {
                return Ok(None);
            }
            let Some(recurrence_id) = task.recurrence_id.clone() else {
                return Ok(None);
            };

            // Hand the live rule over to the next occurrence.
            tx.execute(
                "UPDATE tasks SET recurrence_id = NULL WHERE id = ?1",
                params![id],
            )?;
            rec.touch(tx, "recurrences", &recurrence_id)?;
            let recurrence = tx.query_row(
                "SELECT * FROM recurrences WHERE id = ?1",
                params![recurrence_id],
                Recurrence::from_row,
            )?;

            let Some((next_state, next_date)) = recurrence.rule.advance(&recurrence.state, on_date)
            else {
                // The series has run its course; drop the rule, keep the history.
                tx.execute(
                    "DELETE FROM recurrences WHERE id = ?1",
                    params![recurrence_id],
                )?;
                return Ok(None);
            };

            tx.execute(
                "UPDATE recurrences SET state = ?2 WHERE id = ?1",
                params![recurrence_id, serde_json::to_string(&next_state)?],
            )?;

            // Keep the gap between "do it" and "it is due" when rolling over.
            let next_due = match (task.start_on, task.due_on) {
                (Some(start), Some(due)) => Some(next_date + (due - start)),
                (None, Some(due)) => Some(due),
                _ => None,
            };

            let clone_id = new_id();
            rec.touch(tx, "tasks", &clone_id)?;
            tx.execute(
                "INSERT INTO tasks(id, title, notes, project_id, area_id, parent_id, status, list,
                                   start_on, due_on, priority, position, recurrence_id, series_id,
                                   created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'open', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
                params![
                    clone_id,
                    task.title,
                    task.notes,
                    task.project_id,
                    task.area_id,
                    task.list.as_str(),
                    fmt_date(Some(next_date)),
                    fmt_date(next_due),
                    task.priority,
                    task.position,
                    recurrence_id,
                    task.series_id.clone().unwrap_or(recurrence_id.clone()),
                    now
                ],
            )?;

            // Carry the tags and a fresh copy of the checklist across.
            let tag_ids: Vec<String> = {
                let mut stmt = tx.prepare("SELECT tag_id FROM task_tags WHERE task_id = ?1")?;
                let rows = stmt.query_map(params![id], |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            for tag_id in tag_ids {
                let link_id = new_id();
                rec.touch(tx, "task_tags", &link_id)?;
                tx.execute(
                    "INSERT INTO task_tags(id, task_id, tag_id) VALUES (?1, ?2, ?3)",
                    params![link_id, clone_id, tag_id],
                )?;
            }

            let subtasks: Vec<(String, String, f64)> = {
                let mut stmt = tx.prepare(
                    "SELECT title, notes, position FROM tasks WHERE parent_id = ?1 ORDER BY position",
                )?;
                let rows = stmt.query_map(params![id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?))
                })?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            for (title, notes, position) in subtasks {
                let sub_id = new_id();
                rec.touch(tx, "tasks", &sub_id)?;
                tx.execute(
                    "INSERT INTO tasks(id, title, notes, parent_id, status, list, priority, position,
                                       created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, 'open', 'anytime', 0, ?5, ?6, ?6)",
                    params![sub_id, title, notes, clone_id, position, now],
                )?;
            }

            Ok(Some(clone_id))
        })?;

        // Show the caller the next occurrence when there is one; that is what
        // the user now cares about.
        self.task_detail(next_id.as_deref().unwrap_or(id))
    }

    pub fn delete_task(&mut self, id: &str) -> Result<()> {
        self.write("smazání úkolu", |tx, rec| {
            rec.touch(tx, "tasks", id)?;
            rec.touch_children(tx, "tasks", "parent_id", id)?;
            rec.touch_children(tx, "task_tags", "task_id", id)?;
            rec.touch_children(tx, "attachments", "task_id", id)?;
            let recurrence: Option<String> = tx
                .query_row(
                    "SELECT recurrence_id FROM tasks WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .map_err(|_| AppError::NotFound("tento úkol už neexistuje".into()))?;
            if let Some(rid) = &recurrence {
                rec.touch(tx, "recurrences", rid)?;
                tx.execute("DELETE FROM recurrences WHERE id = ?1", params![rid])?;
            }
            tx.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
            Ok(())
        })
    }

    /// Moves a task to a new spot in its list. Positions are floats so a drop
    /// between two rows never needs to renumber the whole list.
    pub fn reorder_task(&mut self, id: &str, position: f64) -> Result<()> {
        if !position.is_finite() {
            return Err(AppError::Validation("tato pozice není číslo".into()));
        }
        let now = now_str();
        self.write("přeřazení", |tx, rec| {
            rec.touch(tx, "tasks", id)?;
            let n = tx.execute(
                "UPDATE tasks SET position = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, position, now],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("tento úkol už neexistuje".into()));
            }
            Ok(())
        })
    }

    // -- reading views -------------------------------------------------------

    pub fn task_detail(&self, id: &str) -> Result<TaskDetail> {
        let task = self.get_task(id)?;
        Ok(self.hydrate(vec![task])?.remove(0))
    }

    /// Attaches tags, subtasks, attachments and repeat rules to a batch of
    /// tasks with a fixed number of queries, whatever the batch size.
    pub(crate) fn hydrate(&self, tasks: Vec<Task>) -> Result<Vec<TaskDetail>> {
        if tasks.is_empty() {
            return Ok(vec![]);
        }
        let ids: Vec<SqlValue> = tasks.iter().map(|t| SqlValue::Text(t.id.clone())).collect();
        let placeholders = placeholder_list(ids.len());

        let mut tags_by_task: std::collections::HashMap<String, Vec<Tag>> = Default::default();
        {
            let sql = format!(
                "SELECT tt.task_id AS task_id, t.* FROM task_tags tt
                 JOIN tags t ON t.id = tt.tag_id
                 WHERE tt.task_id IN ({placeholders})
                 ORDER BY t.name COLLATE NOCASE"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let rows = stmt.query_map(params_from_iter(ids.iter()), |row| {
                Ok((row.get::<_, String>("task_id")?, Tag::from_row(row)?))
            })?;
            for row in rows {
                let (task_id, tag) = row?;
                tags_by_task.entry(task_id).or_default().push(tag);
            }
        }

        let mut subs_by_parent: std::collections::HashMap<String, Vec<Task>> = Default::default();
        {
            let sql = format!(
                "SELECT * FROM tasks WHERE parent_id IN ({placeholders}) ORDER BY position, created_at"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let rows = stmt.query_map(params_from_iter(ids.iter()), Task::from_row)?;
            for row in rows {
                let task = row?;
                if let Some(parent) = task.parent_id.clone() {
                    subs_by_parent.entry(parent).or_default().push(task);
                }
            }
        }

        let mut files_by_task: std::collections::HashMap<String, Vec<Attachment>> = Default::default();
        {
            let sql = format!(
                "SELECT * FROM attachments WHERE task_id IN ({placeholders}) ORDER BY created_at"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let rows = stmt.query_map(params_from_iter(ids.iter()), Attachment::from_row)?;
            for row in rows {
                let a = row?;
                files_by_task.entry(a.task_id.clone()).or_default().push(a);
            }
        }

        let mut names: std::collections::HashMap<String, String> = Default::default();
        {
            let mut stmt = self.conn.prepare("SELECT id, name FROM projects")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (id, name) = row?;
                names.insert(id, name);
            }
            let mut stmt = self.conn.prepare("SELECT id, name FROM areas")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (id, name) = row?;
                names.insert(id, name);
            }
        }

        let mut recurrences: std::collections::HashMap<String, Recurrence> = Default::default();
        {
            let mut stmt = self.conn.prepare("SELECT * FROM recurrences")?;
            let rows = stmt.query_map([], Recurrence::from_row)?;
            for row in rows {
                let r = row?;
                recurrences.insert(r.id.clone(), r);
            }
        }

        Ok(tasks
            .into_iter()
            .map(|task| TaskDetail {
                tags: tags_by_task.remove(&task.id).unwrap_or_default(),
                subtasks: subs_by_parent.remove(&task.id).unwrap_or_default(),
                attachments: files_by_task.remove(&task.id).unwrap_or_default(),
                recurrence: task
                    .recurrence_id
                    .as_ref()
                    .and_then(|id| recurrences.get(id).cloned()),
                project_name: task.project_id.as_ref().and_then(|id| names.get(id).cloned()),
                area_name: task.area_id.as_ref().and_then(|id| names.get(id).cloned()),
                task,
            })
            .collect())
    }

    /// Loads one of the built-in views.
    ///
    /// `today` is passed in rather than read from the clock so the caller
    /// controls the day boundary (and so tests are deterministic).
    pub fn list_view(&self, view: View, today: NaiveDate, offset: i64) -> Result<ViewPayload> {
        let today_s = today.format("%Y-%m-%d").to_string();
        let limit = ARCHIVE_PAGE;

        let (sql, args): (String, Vec<SqlValue>) = match view {
            View::Inbox => (
                "SELECT * FROM tasks
                 WHERE status = 'open' AND parent_id IS NULL AND list = 'inbox'
                 ORDER BY position, created_at".into(),
                vec![],
            ),
            // Anything whose start date has arrived, plus anything already due,
            // wherever it lives. That is the whole point of Today.
            View::Today => (
                "SELECT * FROM tasks
                 WHERE status = 'open' AND parent_id IS NULL
                   AND ((start_on IS NOT NULL AND start_on <= ?1)
                     OR (due_on IS NOT NULL AND due_on <= ?1))
                 ORDER BY (due_on IS NULL), due_on, position, created_at".into(),
                vec![SqlValue::Text(today_s.clone())],
            ),
            View::Upcoming => (
                "SELECT * FROM tasks
                 WHERE status = 'open' AND parent_id IS NULL
                   AND ((start_on IS NOT NULL AND start_on > ?1)
                     OR (start_on IS NULL AND due_on IS NOT NULL AND due_on > ?1))
                 ORDER BY COALESCE(start_on, due_on), position, created_at".into(),
                vec![SqlValue::Text(today_s.clone())],
            ),
            View::Anytime => (
                "SELECT * FROM tasks
                 WHERE status = 'open' AND parent_id IS NULL AND list = 'anytime'
                   AND start_on IS NULL
                 ORDER BY position, created_at".into(),
                vec![],
            ),
            View::Someday => (
                "SELECT * FROM tasks
                 WHERE status = 'open' AND parent_id IS NULL AND list = 'someday'
                 ORDER BY position, created_at".into(),
                vec![],
            ),
            View::Completed => (
                "SELECT * FROM tasks
                 WHERE status IN ('completed', 'canceled') AND parent_id IS NULL
                 ORDER BY completed_on DESC, completed_at DESC, updated_at DESC
                 LIMIT ?1 OFFSET ?2".into(),
                vec![SqlValue::Integer(limit + 1), SqlValue::Integer(offset.max(0))],
            ),
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(args.iter()), Task::from_row)?;
        let mut tasks = rows.collect::<rusqlite::Result<Vec<_>>>()?;

        let has_more = view == View::Completed && tasks.len() as i64 > limit;
        if has_more {
            tasks.pop();
        }

        Ok(ViewPayload {
            view,
            tasks: self.hydrate(tasks)?,
            has_more,
        })
    }

    /// Tasks belonging to one project, open ones first.
    pub fn list_project_tasks(&self, project_id: &str) -> Result<Vec<TaskDetail>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM tasks WHERE project_id = ?1 AND parent_id IS NULL
             ORDER BY (status != 'open'), position, created_at",
        )?;
        let rows = stmt.query_map(params![project_id], Task::from_row)?;
        self.hydrate(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn list_area_tasks(&self, area_id: &str) -> Result<Vec<TaskDetail>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.* FROM tasks t
             LEFT JOIN projects p ON p.id = t.project_id
             WHERE t.parent_id IS NULL AND t.status = 'open'
               AND (t.area_id = ?1 OR p.area_id = ?1)
             ORDER BY t.position, t.created_at",
        )?;
        let rows = stmt.query_map(params![area_id], Task::from_row)?;
        self.hydrate(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Runs a structured search. Free text matches the title and the notes.
    pub fn search(&self, filter: &SearchFilter) -> Result<Vec<TaskDetail>> {
        if filter.text.chars().count() > MAX_QUERY {
            return Err(AppError::Validation("hledaný výraz je příliš dlouhý".into()));
        }

        let mut where_parts: Vec<String> = vec!["t.parent_id IS NULL".into()];
        let mut args: Vec<SqlValue> = vec![];

        match &filter.statuses {
            None => where_parts.push("t.status = 'open'".into()),
            Some(list) if list.is_empty() => {}
            Some(list) => {
                let ph = placeholder_list_from(args.len(), list.len());
                where_parts.push(format!("t.status IN ({ph})"));
                for s in list {
                    args.push(SqlValue::Text(s.as_str().to_string()));
                }
            }
        }

        let text = filter.text.trim();
        if !text.is_empty() {
            // Escape the LIKE wildcards so searching for "50%" finds "50%".
            let pattern = format!(
                "%{}%",
                text.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
            );
            where_parts.push(format!(
                "(t.title LIKE ?{n} ESCAPE '\\' OR t.notes LIKE ?{n} ESCAPE '\\')",
                n = args.len() + 1
            ));
            args.push(SqlValue::Text(pattern));
        }

        for tag in &filter.tags {
            let name = clean_tag_name(tag)?;
            where_parts.push(format!(
                "EXISTS (SELECT 1 FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
                         WHERE tt.task_id = t.id AND g.name = ?{} COLLATE NOCASE)",
                args.len() + 1
            ));
            args.push(SqlValue::Text(name));
        }

        let simple = |column: &str, value: Option<SqlValue>, parts: &mut Vec<String>, args: &mut Vec<SqlValue>| {
            if let Some(v) = value {
                parts.push(format!("{column} = ?{}", args.len() + 1));
                args.push(v);
            }
        };
        simple(
            "t.project_id",
            filter.project_id.clone().map(SqlValue::Text),
            &mut where_parts,
            &mut args,
        );
        simple(
            "t.area_id",
            filter.area_id.clone().map(SqlValue::Text),
            &mut where_parts,
            &mut args,
        );
        simple(
            "t.list",
            filter.list.map(|l| SqlValue::Text(l.as_str().to_string())),
            &mut where_parts,
            &mut args,
        );

        if let Some(p) = filter.min_priority {
            where_parts.push(format!("t.priority >= ?{}", args.len() + 1));
            args.push(SqlValue::Integer(check_priority(p)?));
        }
        if let Some(d) = check_date(filter.due_before, "termín")? {
            where_parts.push(format!(
                "(t.due_on IS NOT NULL AND t.due_on <= ?{})",
                args.len() + 1
            ));
            args.push(SqlValue::Text(d.format("%Y-%m-%d").to_string()));
        }
        if let Some(d) = check_date(filter.due_after, "termín")? {
            where_parts.push(format!(
                "(t.due_on IS NOT NULL AND t.due_on >= ?{})",
                args.len() + 1
            ));
            args.push(SqlValue::Text(d.format("%Y-%m-%d").to_string()));
        }
        if let Some(d) = check_date(filter.start_before, "datum zahájení")? {
            where_parts.push(format!(
                "(t.start_on IS NOT NULL AND t.start_on <= ?{})",
                args.len() + 1
            ));
            args.push(SqlValue::Text(d.format("%Y-%m-%d").to_string()));
        }
        if let Some(has) = filter.has_deadline {
            where_parts.push(if has {
                "t.due_on IS NOT NULL".into()
            } else {
                "t.due_on IS NULL".into()
            });
        }

        let limit = filter.limit.unwrap_or(300).clamp(1, 2000);
        let sql = format!(
            "SELECT t.* FROM tasks t WHERE {}
             ORDER BY (t.status != 'open'), (t.due_on IS NULL), t.due_on, t.position, t.created_at
             LIMIT {limit}",
            where_parts.join(" AND ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(args.iter()), Task::from_row)?;
        self.hydrate(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn counts(&self, today: NaiveDate) -> Result<Counts> {
        let t = today.format("%Y-%m-%d").to_string();
        let one = |sql: &str, args: &[&dyn rusqlite::ToSql]| -> Result<i64> {
            Ok(self.conn.query_row(sql, args, |r| r.get(0))?)
        };
        Ok(Counts {
            inbox: one(
                "SELECT COUNT(*) FROM tasks WHERE status='open' AND parent_id IS NULL AND list='inbox'",
                &[],
            )?,
            today: one(
                "SELECT COUNT(*) FROM tasks WHERE status='open' AND parent_id IS NULL
                 AND ((start_on IS NOT NULL AND start_on <= ?1) OR (due_on IS NOT NULL AND due_on <= ?1))",
                &[&t],
            )?,
            upcoming: one(
                "SELECT COUNT(*) FROM tasks WHERE status='open' AND parent_id IS NULL
                 AND ((start_on IS NOT NULL AND start_on > ?1)
                   OR (start_on IS NULL AND due_on IS NOT NULL AND due_on > ?1))",
                &[&t],
            )?,
            anytime: one(
                "SELECT COUNT(*) FROM tasks WHERE status='open' AND parent_id IS NULL
                 AND list='anytime' AND start_on IS NULL",
                &[],
            )?,
            someday: one(
                "SELECT COUNT(*) FROM tasks WHERE status='open' AND parent_id IS NULL AND list='someday'",
                &[],
            )?,
            completed: one(
                "SELECT COUNT(*) FROM tasks WHERE status IN ('completed','canceled') AND parent_id IS NULL",
                &[],
            )?,
            overdue: one(
                "SELECT COUNT(*) FROM tasks WHERE status='open' AND parent_id IS NULL
                 AND due_on IS NOT NULL AND due_on < ?1",
                &[&t],
            )?,
        })
    }

    // -- saved filters -------------------------------------------------------

    pub fn list_saved_filters(&self) -> Result<Vec<SavedFilter>> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM saved_filters ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], SavedFilter::from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn save_filter(&mut self, name: &str, query: &str) -> Result<SavedFilter> {
        let name = clean_name(name, "filtru")?;
        let query = query.trim().to_string();
        if query.is_empty() {
            return Err(AppError::Validation(
                "není co uložit - nejdřív něco vyhledejte".into(),
            ));
        }
        if query.chars().count() > MAX_QUERY {
            return Err(AppError::Validation("hledaný výraz je příliš dlouhý na uložení".into()));
        }
        let id = new_id();
        let now = now_str();
        self.write("uložení filtru", |tx, rec| {
            rec.touch(tx, "saved_filters", &id)?;
            tx.execute(
                "INSERT INTO saved_filters(id, name, query, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![id, name, query, now],
            )?;
            Ok(())
        })?;
        self.conn
            .query_row(
                "SELECT * FROM saved_filters WHERE id = ?1",
                params![id],
                SavedFilter::from_row,
            )
            .map_err(Into::into)
    }

    pub fn delete_saved_filter(&mut self, id: &str) -> Result<()> {
        self.write("smazání filtru", |tx, rec| {
            rec.touch(tx, "saved_filters", id)?;
            let n = tx.execute("DELETE FROM saved_filters WHERE id = ?1", params![id])?;
            if n == 0 {
                return Err(AppError::NotFound("tento filtr už neexistuje".into()));
            }
            Ok(())
        })
    }

    // -- attachments ---------------------------------------------------------

    /// Copies `source` into the attachments folder and links it to a task.
    ///
    /// The stored name is sanitised and prefixed with a short random id, so two
    /// files called `scan.pdf` never collide and no user-supplied text ever
    /// decides a path.
    pub fn add_attachment(&mut self, task_id: &str, source: &std::path::Path) -> Result<Attachment> {
        let meta = std::fs::metadata(source).map_err(|e| {
            AppError::Io(format!("nelze přečíst {}: {e}", source.display()))
        })?;
        if !meta.is_file() {
            return Err(AppError::Validation("přiložit lze pouze soubory".into()));
        }
        let limit = self.settings()?.effective_max_attachment_bytes(&self.cfg);
        if meta.len() > limit {
            return Err(AppError::Validation(format!(
                "soubor má {:.1} MB - limit je {} MB (zvyšte NOTES_MJ_MAX_ATTACHMENT_MB v .env)",
                meta.len() as f64 / 1_048_576.0,
                limit / 1_048_576
            )));
        }

        let display_name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "attachment".to_string());
        let id = new_id();
        let stored_name = format!("{}-{}", &id[..8], crate::paths::safe_filename(&display_name));

        let dest = self.cfg.attachments_dir().join(&stored_name);
        // Belt and braces: prove the destination really is inside the folder.
        let dest = crate::paths::ensure_within(&self.cfg.attachments_dir(), &dest)?;
        std::fs::copy(source, &dest)
            .map_err(|e| AppError::Io(format!("soubor se nepodařilo zkopírovat: {e}")))?;

        let size = meta.len() as i64;
        let now = now_str();
        let result = self.write("přiložení souboru", |tx, rec| {
            require_exists(tx, "tasks", task_id, "tento úkol")?;
            rec.touch(tx, "attachments", &id)?;
            tx.execute(
                "INSERT INTO attachments(id, task_id, stored_name, display_name, size_bytes, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, task_id, stored_name, display_name, size, now],
            )?;
            Ok(())
        });

        if result.is_err() {
            // Do not leave an orphan file behind if the row could not be written.
            let _ = std::fs::remove_file(&dest);
        }
        result?;

        self.conn
            .query_row(
                "SELECT * FROM attachments WHERE id = ?1",
                params![id],
                Attachment::from_row,
            )
            .map_err(Into::into)
    }

    /// Unlinks an attachment. The file itself is left on disk until undo is no
    /// longer possible - see `sweep_orphan_attachments`.
    pub fn remove_attachment(&mut self, id: &str) -> Result<()> {
        self.write("odebrání přílohy", |tx, rec| {
            rec.touch(tx, "attachments", id)?;
            let n = tx.execute("DELETE FROM attachments WHERE id = ?1", params![id])?;
            if n == 0 {
                return Err(AppError::NotFound("tato příloha už neexistuje".into()));
            }
            Ok(())
        })
    }

    pub fn attachment_path(&self, id: &str) -> Result<std::path::PathBuf> {
        let stored: String = self
            .conn
            .query_row(
                "SELECT stored_name FROM attachments WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .map_err(|_| AppError::NotFound("tato příloha už není v seznamu".into()))?;
        let path = self.cfg.attachments_dir().join(&stored);
        if !path.exists() {
            return Err(AppError::NotFound(format!(
                "{stored} je v seznamu, ale ve složce s přílohami chybí"
            )));
        }
        crate::paths::ensure_within(&self.cfg.attachments_dir(), &path)
    }

    /// Deletes attachment files that no row points at any more.
    ///
    /// Run on startup rather than on delete, so that undoing a delete during
    /// the session still finds its file.
    ///
    /// Only files that Notes_MJ itself wrote are ever considered. A stored name
    /// always begins with an eight-character hex id and a hyphen (see
    /// [`Store::add_attachment`]), so anything else in the folder was put there
    /// by the user or another program and is left strictly alone. A cleanup
    /// routine that deletes files it does not recognise is how people lose
    /// data.
    pub fn sweep_orphan_attachments(&self) -> Result<usize> {
        let dir = self.cfg.attachments_dir();
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Ok(0); // nothing to sweep, and nothing worth failing over
        };
        let known: std::collections::HashSet<String> = {
            let mut stmt = self.conn.prepare("SELECT stored_name FROM attachments")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?.into_iter().collect()
        };
        let mut removed = 0;
        for entry in entries.flatten() {
            if !entry.path().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if is_stored_attachment_name(&name)
                && !known.contains(&name)
                && std::fs::remove_file(entry.path()).is_ok()
            {
                removed += 1;
            }
        }
        Ok(removed)
    }
}

// -- shared SQL helpers -------------------------------------------------------

fn placeholder_list(n: usize) -> String {
    placeholder_list_from(0, n)
}

fn placeholder_list_from(offset: usize, n: usize) -> String {
    (1..=n)
        .map(|i| format!("?{}", i + offset))
        .collect::<Vec<_>>()
        .join(", ")
}

fn require_exists(tx: &Transaction<'_>, table: &str, id: &str, what: &str) -> Result<()> {
    let sql = match table {
        "tasks" => "SELECT 1 FROM tasks WHERE id = ?1",
        "projects" => "SELECT 1 FROM projects WHERE id = ?1",
        "areas" => "SELECT 1 FROM areas WHERE id = ?1",
        "tags" => "SELECT 1 FROM tags WHERE id = ?1",
        other => return Err(AppError::Internal(format!("neznámá tabulka '{other}'"))),
    };
    let found: Option<i64> = tx.query_row(sql, params![id], |r| r.get(0)).ok();
    if found.is_some() {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("{what} už neexistuje")))
    }
}

/// One past the highest position in a scope, so new rows land at the bottom.
fn next_position(
    tx: &Transaction<'_>,
    table: &str,
    scope: &str,
    args: &[SqlValue],
) -> Result<f64> {
    let sql = format!("SELECT COALESCE(MAX(position), 0) + 1 FROM {table} WHERE {scope}");
    let value: f64 = tx.query_row(&sql, params_from_iter(args.iter()), |r| r.get(0))?;
    Ok(value)
}

/// Replaces a task's tags, creating any tag that does not exist yet.
fn set_task_tags(
    tx: &Transaction<'_>,
    rec: &mut Recorder,
    task_id: &str,
    names: &[String],
    now: &str,
) -> Result<()> {
    set_owner_tags(tx, rec, "task_tags", "task_id", task_id, names, now)
}

/// Replaces the tag set of anything that has one, creating tags as needed.
///
/// Tasks and notes share the tag vocabulary but keep separate link tables, so
/// this takes the link table and its owner column rather than assuming tasks.
/// `link_table` and `owner_column` are compile-time constants in this crate;
/// they are checked anyway so a future caller cannot turn one into injection.
pub(crate) fn set_owner_tags(
    tx: &Transaction<'_>,
    rec: &mut Recorder,
    link_table: &str,
    owner_column: &str,
    owner_id: &str,
    names: &[String],
    now: &str,
) -> Result<()> {
    if !matches!(link_table, "task_tags" | "note_tags") {
        return Err(AppError::Internal(format!(
            "'{link_table}' není tabulka štítků"
        )));
    }
    if !owner_column
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(AppError::Internal("neplatný název sloupce".into()));
    }

    rec.touch_children(tx, link_table, owner_column, owner_id)?;
    tx.execute(
        &format!("DELETE FROM {link_table} WHERE {owner_column} = ?1"),
        params![owner_id],
    )?;

    let mut seen = std::collections::HashSet::new();
    for name in names {
        if !seen.insert(name.to_lowercase()) {
            continue;
        }
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                params![name],
                |r| r.get(0),
            )
            .ok();
        let tag_id = match existing {
            Some(id) => id,
            None => {
                let id = new_id();
                rec.touch(tx, "tags", &id)?;
                tx.execute(
                    "INSERT INTO tags(id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
                    params![id, name, default_tag_color(name), now],
                )?;
                id
            }
        };
        let link_id = new_id();
        rec.touch(tx, link_table, &link_id)?;
        tx.execute(
            &format!(
                "INSERT INTO {link_table}(id, {owner_column}, tag_id) VALUES (?1, ?2, ?3)"
            ),
            params![link_id, owner_id, tag_id],
        )?;
    }
    Ok(())
}

/// Gives each new tag a stable colour derived from its name, so the palette
/// looks deliberate without asking the user to pick one.
fn default_tag_color(name: &str) -> &'static str {
    const PALETTE: [&str; 8] = [
        "#4f7cff", "#12a594", "#e5484d", "#f76b15", "#8e4ec6", "#d6409f", "#0090ff", "#46a758",
    ];
    let sum: u32 = name.bytes().map(|b| b as u32).sum();
    PALETTE[(sum as usize) % PALETTE.len()]
}

/// Whether a file name has the shape Notes_MJ gives its stored attachments:
/// eight lowercase hex characters, a hyphen, then the sanitised name.
fn is_stored_attachment_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() > 9
        && bytes[8] == b'-'
        && bytes[..8].iter().all(|b| b.is_ascii_hexdigit())
}

/// Reads `PRAGMA integrity_check`, used by the health command in the UI.
pub fn integrity_check(conn: &Connection) -> Result<String> {
    Ok(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))?)
}
