//! The domain types, and how they map to and from SQLite rows.
//!
//! Dates are `NaiveDate` and serialise as `YYYY-MM-DD`; timestamps are UTC and
//! serialise as RFC 3339. Both are stored as TEXT so the database file stays
//! readable in any SQLite browser - part of "your data stays yours".

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::Row;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::recur::{RecurrenceRule, RecurrenceState};

/// Where an unscheduled task rests. Orthogonal to `start_on`: a task with a
/// `start_on` is "scheduled" regardless of its list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskList {
    /// Freshly captured, not filed anywhere yet.
    Inbox,
    /// Filed into a project or area, do it whenever.
    Anytime,
    /// Parked. Deliberately out of sight until you go looking.
    Someday,
}

impl TaskList {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskList::Inbox => "inbox",
            TaskList::Anytime => "anytime",
            TaskList::Someday => "someday",
        }
    }
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "inbox" => TaskList::Inbox,
            "anytime" => TaskList::Anytime,
            "someday" => TaskList::Someday,
            other => return Err(AppError::Validation(format!("neznámý seznam '{other}'"))),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Open,
    Completed,
    /// Dropped without doing it. Kept in the archive, greyed out.
    Canceled,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskStatus::Open => "open",
            TaskStatus::Completed => "completed",
            TaskStatus::Canceled => "canceled",
        }
    }
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "open" => TaskStatus::Open,
            "completed" => TaskStatus::Completed,
            "canceled" => TaskStatus::Canceled,
            other => return Err(AppError::Validation(format!("neznámý stav '{other}'"))),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Area {
    pub id: String,
    pub name: String,
    pub position: f64,
    pub archived: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub area_id: Option<String>,
    pub status: TaskStatus,
    pub list: TaskList,
    pub start_on: Option<NaiveDate>,
    pub due_on: Option<NaiveDate>,
    pub position: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    /// A hex colour like `#8a7fff`, chosen in the UI.
    pub color: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    /// The on-disk name inside `userdata/attachments`. Always sanitised.
    pub stored_name: String,
    /// What the user called it. Shown in the UI, never used as a path.
    pub display_name: String,
    pub size_bytes: i64,
    pub created_at: DateTime<Utc>,
}

/// A repeat rule plus how far the series has got.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recurrence {
    pub id: String,
    pub rule: RecurrenceRule,
    pub state: RecurrenceState,
    /// The rule as a sentence, computed on read. Sent to the UI so that the
    /// phrasing has one home rather than being reimplemented in TypeScript.
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub project_id: Option<String>,
    pub area_id: Option<String>,
    /// Set when this task is a subtask (a checklist item) of another task.
    pub parent_id: Option<String>,
    pub status: TaskStatus,
    pub list: TaskList,
    /// The day the task should start showing up in Today. Things calls this "When".
    pub start_on: Option<NaiveDate>,
    /// The hard deadline. Independent of `start_on`.
    pub due_on: Option<NaiveDate>,
    /// 0 none, 1 low, 2 medium, 3 high.
    pub priority: i64,
    pub position: f64,
    /// Points at the live repeat rule. Only the open occurrence has one.
    pub recurrence_id: Option<String>,
    /// Kept on every occurrence, including completed ones, so the archive can
    /// group a series back together.
    pub series_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    /// The user's *local* calendar day the task was finished on.
    ///
    ///  is a UTC instant, so deriving a day from it puts an
    /// early-morning completion in CET on the previous date. The dashboard and
    /// the archive group by this instead.
    pub completed_on: Option<NaiveDate>,
}

/// A task with everything the UI needs to draw a row, in one round trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDetail {
    #[serde(flatten)]
    pub task: Task,
    pub tags: Vec<Tag>,
    pub subtasks: Vec<Task>,
    pub attachments: Vec<Attachment>,
    pub recurrence: Option<Recurrence>,
    pub project_name: Option<String>,
    pub area_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedFilter {
    pub id: String,
    pub name: String,
    /// The raw search query, e.g. `tag:home due:overdue admin`.
    pub query: String,
    pub created_at: DateTime<Utc>,
}

// -- row mapping --------------------------------------------------------------

pub fn parse_date(s: Option<String>) -> Result<Option<NaiveDate>> {
    match s.as_deref() {
        None | Some("") => Ok(None),
        Some(v) => NaiveDate::parse_from_str(v, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| AppError::Validation(format!("'{v}' není datum (očekáváno RRRR-MM-DD)"))),
    }
}

pub fn parse_ts(s: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|_| AppError::Internal(format!("poškozené časové razítko '{s}' v databázi")))
}

fn parse_ts_opt(s: Option<String>) -> Result<Option<DateTime<Utc>>> {
    match s.as_deref() {
        None | Some("") => Ok(None),
        Some(v) => parse_ts(v).map(Some),
    }
}

pub fn fmt_date(d: Option<NaiveDate>) -> Option<String> {
    d.map(|d| d.format("%Y-%m-%d").to_string())
}

pub fn fmt_ts(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl Task {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Task> {
        let map = |e: AppError| rusqlite::Error::InvalidColumnName(e.to_string());
        Ok(Task {
            id: row.get("id")?,
            title: row.get("title")?,
            notes: row.get("notes")?,
            project_id: row.get("project_id")?,
            area_id: row.get("area_id")?,
            parent_id: row.get("parent_id")?,
            status: TaskStatus::parse(&row.get::<_, String>("status")?).map_err(map)?,
            list: TaskList::parse(&row.get::<_, String>("list")?).map_err(map)?,
            start_on: parse_date(row.get("start_on")?).map_err(map)?,
            due_on: parse_date(row.get("due_on")?).map_err(map)?,
            priority: row.get("priority")?,
            position: row.get("position")?,
            recurrence_id: row.get("recurrence_id")?,
            series_id: row.get("series_id")?,
            created_at: parse_ts(&row.get::<_, String>("created_at")?).map_err(map)?,
            updated_at: parse_ts(&row.get::<_, String>("updated_at")?).map_err(map)?,
            completed_at: parse_ts_opt(row.get("completed_at")?).map_err(map)?,
            completed_on: parse_date(row.get("completed_on")?).map_err(map)?,
        })
    }
}

impl Project {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Project> {
        let map = |e: AppError| rusqlite::Error::InvalidColumnName(e.to_string());
        Ok(Project {
            id: row.get("id")?,
            name: row.get("name")?,
            notes: row.get("notes")?,
            area_id: row.get("area_id")?,
            status: TaskStatus::parse(&row.get::<_, String>("status")?).map_err(map)?,
            list: TaskList::parse(&row.get::<_, String>("list")?).map_err(map)?,
            start_on: parse_date(row.get("start_on")?).map_err(map)?,
            due_on: parse_date(row.get("due_on")?).map_err(map)?,
            position: row.get("position")?,
            created_at: parse_ts(&row.get::<_, String>("created_at")?).map_err(map)?,
            updated_at: parse_ts(&row.get::<_, String>("updated_at")?).map_err(map)?,
            completed_at: parse_ts_opt(row.get("completed_at")?).map_err(map)?,
        })
    }
}

impl Area {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Area> {
        let map = |e: AppError| rusqlite::Error::InvalidColumnName(e.to_string());
        Ok(Area {
            id: row.get("id")?,
            name: row.get("name")?,
            position: row.get("position")?,
            archived: row.get::<_, i64>("archived")? != 0,
            created_at: parse_ts(&row.get::<_, String>("created_at")?).map_err(map)?,
            updated_at: parse_ts(&row.get::<_, String>("updated_at")?).map_err(map)?,
        })
    }
}

impl Tag {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Tag> {
        let map = |e: AppError| rusqlite::Error::InvalidColumnName(e.to_string());
        Ok(Tag {
            id: row.get("id")?,
            name: row.get("name")?,
            color: row.get("color")?,
            created_at: parse_ts(&row.get::<_, String>("created_at")?).map_err(map)?,
        })
    }
}

impl Attachment {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Attachment> {
        let map = |e: AppError| rusqlite::Error::InvalidColumnName(e.to_string());
        Ok(Attachment {
            id: row.get("id")?,
            task_id: row.get("task_id")?,
            stored_name: row.get("stored_name")?,
            display_name: row.get("display_name")?,
            size_bytes: row.get("size_bytes")?,
            created_at: parse_ts(&row.get::<_, String>("created_at")?).map_err(map)?,
        })
    }
}

impl SavedFilter {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<SavedFilter> {
        let map = |e: AppError| rusqlite::Error::InvalidColumnName(e.to_string());
        Ok(SavedFilter {
            id: row.get("id")?,
            name: row.get("name")?,
            query: row.get("query")?,
            created_at: parse_ts(&row.get::<_, String>("created_at")?).map_err(map)?,
        })
    }
}

impl Recurrence {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Recurrence> {
        let rule_json: String = row.get("rule")?;
        let state_json: String = row.get("state")?;
        let to_err = |e: serde_json::Error| rusqlite::Error::InvalidColumnName(e.to_string());
        let rule: RecurrenceRule = serde_json::from_str(&rule_json).map_err(to_err)?;
        Ok(Recurrence {
            id: row.get("id")?,
            description: rule.describe(),
            rule,
            state: serde_json::from_str(&state_json).map_err(to_err)?,
        })
    }
}

// -- input payloads -----------------------------------------------------------

/// Everything the UI can set on a task. Absent fields are left alone, which is
/// what makes a partial edit (just the title, say) a one-field payload.
///
/// The nested-option fields distinguish the three cases the UI needs: field
/// absent (leave it), field present and `null` (clear it), field present with a
/// value (set it). Plain `Option<Option<T>>` collapses `null` to `None` in
/// serde, so those fields go through [`double_option`].
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TaskPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    /// `Some(None)` clears the project; `None` leaves it as is.
    #[serde(deserialize_with = "double_option")]
    pub project_id: Option<Option<String>>,
    #[serde(deserialize_with = "double_option")]
    pub area_id: Option<Option<String>>,
    pub list: Option<TaskList>,
    #[serde(deserialize_with = "double_option")]
    pub start_on: Option<Option<NaiveDate>>,
    #[serde(deserialize_with = "double_option")]
    pub due_on: Option<Option<NaiveDate>>,
    pub priority: Option<i64>,
    pub position: Option<f64>,
    /// Replaces the whole tag set when present.
    pub tag_names: Option<Vec<String>>,
    /// `Some(None)` removes the repeat.
    #[serde(deserialize_with = "double_option")]
    pub recurrence: Option<Option<RecurrenceRule>>,
}

/// Turns a present-but-null JSON field into `Some(None)` rather than `None`,
/// which is what lets a patch mean "clear this".
pub(crate) fn double_option<'de, T, D>(de: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(de).map(Some)
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewTask {
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub area_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub list: Option<TaskList>,
    #[serde(default)]
    pub start_on: Option<NaiveDate>,
    #[serde(default)]
    pub due_on: Option<NaiveDate>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub tag_names: Vec<String>,
    #[serde(default)]
    pub recurrence: Option<RecurrenceRule>,
}

/// Which list the UI is asking for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum View {
    Inbox,
    Today,
    Upcoming,
    Anytime,
    Someday,
    /// The archive: everything completed or cancelled, newest first.
    Completed,
}
