//! Connection setup, schema migrations, and the undo/redo journal.
//!
//! ## Undo
//!
//! Rather than writing an inverse operation by hand for every command (easy to
//! get wrong, and every new command is a new chance to get it wrong), Notes_MJ
//! snapshots the affected rows. A command declares which rows it is about to
//! touch; the journal records each row before and after the transaction, as
//! JSON. Undo writes the "before" values back, redo writes the "after" values.
//!
//! That makes undo uniform: it works for edits, deletes, tag changes, bulk
//! reschedules and the multi-row rollover of a repeating task, without any of
//! them knowing that undo exists.
//!
//! Foreign keys are deferred while a journal entry is applied, so rows can be
//! restored in any order (a task and its tag links, for instance).

use std::collections::HashSet;

use chrono::Utc;
use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use crate::error::{AppError, Result};
use crate::models::fmt_ts;
use crate::paths::Config;

/// Tables the journal is allowed to snapshot. Table names are interpolated into
/// SQL, so this list is the guard that keeps that safe - nothing user-supplied
/// ever reaches it.
pub const UNDOABLE_TABLES: &[&str] = &[
    "tasks",
    "projects",
    "areas",
    "tags",
    "task_tags",
    "attachments",
    "recurrences",
    "saved_filters",
    "notes",
    "note_tags",
    "occasions",
    "gift_ideas",
];

const SCHEMA_VERSION: i64 = 2;

/// How many journal entries to keep. Older ones are pruned; they are only for
/// undo, never the source of truth.
const UNDO_HISTORY_LIMIT: i64 = 200;

pub struct Store {
    pub conn: Connection,
    pub cfg: Config,
}

impl Store {
    /// Opens (creating if needed) the database at `cfg.db_path()`.
    pub fn open(cfg: Config) -> Result<Store> {
        cfg.ensure_dirs()?;
        let conn = Connection::open(cfg.db_path()).map_err(|e| {
            AppError::Io(format!(
                "nepodařilo se otevřít {}: {e}. Neběží už jiná kopie Notes_MJ, nebo není složka jen pro čtení?",
                cfg.db_path().display()
            ))
        })?;
        Self::from_connection(conn, cfg)
    }

    /// In-memory store, used by the test suite.
    pub fn open_in_memory(cfg: Config) -> Result<Store> {
        let conn = Connection::open_in_memory()?;
        Self::from_connection(conn, cfg)
    }

    fn from_connection(conn: Connection, cfg: Config) -> Result<Store> {
        // WAL keeps reads fast while a write is in flight; NORMAL sync is the
        // right trade for a single-user desktop app that also takes backups.
        let _: String = conn
            .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
            .unwrap_or_else(|_| "memory".to_string());
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;",
        )?;
        let mut store = Store { conn, cfg };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<()> {
        let version: i64 = self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 1 {
            self.conn.execute_batch(SCHEMA_V1)?;
        }
        if version < 2 {
            // Existing databases need the column added. A fresh one already
            // has it from SCHEMA_V1, so a duplicate-column error here is the
            // expected outcome, not a failure.
            match self
                .conn
                .execute_batch("ALTER TABLE tasks ADD COLUMN completed_on TEXT")
            {
                Ok(()) => {}
                Err(e) if e.to_string().contains("duplicate column") => {}
                Err(e) => return Err(e.into()),
            }
            self.conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS tasks_completed_on ON tasks(completed_on)",
            )?;
            // Notebook, occasions and the gift planner. Every statement is
            // `IF NOT EXISTS`, so re-running it on a partly-migrated database
            // is harmless.
            self.conn.execute_batch(SCHEMA_V2)?;
        }
        if version != SCHEMA_VERSION {
            // Future migrations slot in above, each guarded by its own version.
            self.conn
                .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))?;
        }
        Ok(())
    }

    pub fn meta_get(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM meta WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        Ok(match rows.next()? {
            Some(row) => Some(row.get(0)?),
            None => None,
        })
    }

    pub fn meta_set(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Runs `f` inside a transaction, recording an undo entry labelled `label`.
    ///
    /// `f` must call [`Recorder::touch`] for every row it creates, changes or
    /// deletes, *before* changing it. Anything it forgets to declare simply
    /// will not be undone - it never corrupts the journal.
    pub fn write<T>(
        &mut self,
        label: &str,
        f: impl FnOnce(&Transaction<'_>, &mut Recorder) -> Result<T>,
    ) -> Result<T> {
        let tx = self.conn.transaction()?;
        let mut rec = Recorder::default();
        let out = f(&tx, &mut rec)?;

        if !rec.entries.is_empty() {
            let changes = rec.finish(&tx)?;
            // Only journal something that actually changed a row.
            if changes.iter().any(|c| c.before != c.after) {
                // A new action invalidates the redo branch, the same as every
                // other editor.
                tx.execute("DELETE FROM undo_log WHERE undone = 1", [])?;
                tx.execute(
                    "INSERT INTO undo_log(label, created_at, changes, undone) VALUES (?1, ?2, ?3, 0)",
                    params![label, fmt_ts(Utc::now()), serde_json::to_string(&changes)?],
                )?;
                tx.execute(
                    "DELETE FROM undo_log WHERE seq <= (
                         SELECT COALESCE(MAX(seq), 0) - ?1 FROM undo_log
                     )",
                    params![UNDO_HISTORY_LIMIT],
                )?;
            }
        }

        tx.commit()?;
        Ok(out)
    }

    /// Reverts the most recent journalled action. Returns its label.
    pub fn undo(&mut self) -> Result<Option<String>> {
        let tx = self.conn.transaction()?;
        let found = tx
            .query_row(
                "SELECT seq, label, changes FROM undo_log WHERE undone = 0 ORDER BY seq DESC LIMIT 1",
                [],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .ok();

        let Some((seq, label, changes_json)) = found else {
            tx.rollback()?;
            return Ok(None);
        };

        let changes: Vec<Change> = serde_json::from_str(&changes_json)?;
        apply_changes(&tx, &changes, Direction::Backward)?;
        tx.execute("UPDATE undo_log SET undone = 1 WHERE seq = ?1", params![seq])?;
        tx.commit()?;
        Ok(Some(label))
    }

    /// Re-applies the most recently undone action. Returns its label.
    pub fn redo(&mut self) -> Result<Option<String>> {
        let tx = self.conn.transaction()?;
        let found = tx
            .query_row(
                "SELECT seq, label, changes FROM undo_log WHERE undone = 1 ORDER BY seq ASC LIMIT 1",
                [],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .ok();

        let Some((seq, label, changes_json)) = found else {
            tx.rollback()?;
            return Ok(None);
        };

        let changes: Vec<Change> = serde_json::from_str(&changes_json)?;
        apply_changes(&tx, &changes, Direction::Forward)?;
        tx.execute("UPDATE undo_log SET undone = 0 WHERE seq = ?1", params![seq])?;
        tx.commit()?;
        Ok(Some(label))
    }

    /// Labels for the undo and redo buttons, so the UI can say
    /// "Undo Complete task" rather than just "Undo".
    pub fn undo_state(&self) -> Result<(Option<String>, Option<String>)> {
        let undo = self
            .conn
            .query_row(
                "SELECT label FROM undo_log WHERE undone = 0 ORDER BY seq DESC LIMIT 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok();
        let redo = self
            .conn
            .query_row(
                "SELECT label FROM undo_log WHERE undone = 1 ORDER BY seq ASC LIMIT 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok();
        Ok((undo, redo))
    }
}

// -- the journal --------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Change {
    table: String,
    id: String,
    before: Option<Json>,
    after: Option<Json>,
}

#[derive(Clone, Copy)]
enum Direction {
    Backward,
    Forward,
}

/// Collects the "before" snapshot of every row a command declares.
#[derive(Default)]
pub struct Recorder {
    entries: Vec<(String, String, Option<Json>)>,
    seen: HashSet<(String, String)>,
}

impl Recorder {
    /// Snapshots `table`.`id` as it is right now. Call this *before* the write.
    /// Calling it twice for the same row is harmless - the first snapshot wins.
    pub fn touch(&mut self, tx: &Transaction<'_>, table: &str, id: &str) -> Result<()> {
        let key = (table.to_string(), id.to_string());
        if !self.seen.insert(key) {
            return Ok(());
        }
        let before = read_row(tx, table, id)?;
        self.entries
            .push((table.to_string(), id.to_string(), before));
        Ok(())
    }

    /// Snapshots every row of `table` whose `column` equals `value`.
    /// Used for the tag links and subtasks that hang off a task.
    pub fn touch_children(
        &mut self,
        tx: &Transaction<'_>,
        table: &str,
        column: &str,
        value: &str,
    ) -> Result<()> {
        ensure_table(table)?;
        ensure_identifier(column)?;
        let sql = format!("SELECT id FROM {table} WHERE {column} = ?1");
        let ids: Vec<String> = {
            let mut stmt = tx.prepare(&sql)?;
            let rows = stmt.query_map(params![value], |r| r.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for id in ids {
            self.touch(tx, table, &id)?;
        }
        Ok(())
    }

    /// Snapshots every row in `table`. Used by a `Replace` import, which is the
    /// only operation that wipes a whole table - and the one people most want
    /// to be able to take back.
    pub fn touch_all(&mut self, tx: &Transaction<'_>, table: &str) -> Result<()> {
        ensure_table(table)?;
        let ids: Vec<String> = {
            let mut stmt = tx.prepare(&format!("SELECT id FROM {table}"))?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for id in ids {
            self.touch(tx, table, &id)?;
        }
        Ok(())
    }

    fn finish(self, tx: &Transaction<'_>) -> Result<Vec<Change>> {
        let mut out = Vec::with_capacity(self.entries.len());
        for (table, id, before) in self.entries {
            let after = read_row(tx, &table, &id)?;
            out.push(Change {
                table,
                id,
                before,
                after,
            });
        }
        Ok(out)
    }
}

fn ensure_table(table: &str) -> Result<()> {
    if UNDOABLE_TABLES.contains(&table) {
        Ok(())
    } else {
        Err(AppError::Internal(format!(
            "tabulku '{table}' nelze vrátit zpět"
        )))
    }
}

/// Column names are compile-time constants in this crate, but check anyway so a
/// future refactor cannot turn one into an injection point.
fn ensure_identifier(name: &str) -> Result<()> {
    if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        Ok(())
    } else {
        Err(AppError::Internal(format!("neplatný název sloupce '{name}'")))
    }
}

/// Reads one row as a JSON object, or `None` if it does not exist.
fn read_row(tx: &Transaction<'_>, table: &str, id: &str) -> Result<Option<Json>> {
    ensure_table(table)?;
    let sql = format!("SELECT * FROM {table} WHERE id = ?1");
    let mut stmt = tx.prepare(&sql)?;
    let mut rows = stmt.query(params![id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let names: Vec<String> = row
        .as_ref()
        .column_names()
        .into_iter()
        .map(|s| s.to_string())
        .collect();
    let mut map = serde_json::Map::with_capacity(names.len());
    for (i, name) in names.iter().enumerate() {
        map.insert(name.clone(), sql_to_json(row.get::<_, SqlValue>(i)?));
    }
    Ok(Some(Json::Object(map)))
}

fn apply_changes(tx: &Transaction<'_>, changes: &[Change], dir: Direction) -> Result<()> {
    // Restoring a task and its tag links in one go means the intermediate state
    // can violate a foreign key. Deferring the check to commit makes order
    // irrelevant while still catching genuine corruption.
    tx.execute_batch("PRAGMA defer_foreign_keys = ON")?;
    for change in changes {
        let target = match dir {
            Direction::Backward => &change.before,
            Direction::Forward => &change.after,
        };
        write_row(tx, &change.table, &change.id, target.as_ref())?;
    }
    Ok(())
}

fn write_row(tx: &Transaction<'_>, table: &str, id: &str, value: Option<&Json>) -> Result<()> {
    ensure_table(table)?;
    match value {
        None => {
            tx.execute(&format!("DELETE FROM {table} WHERE id = ?1"), params![id])?;
        }
        Some(Json::Object(map)) => {
            let cols: Vec<&str> = map.keys().map(|k| k.as_str()).collect();
            for c in &cols {
                ensure_identifier(c)?;
            }
            let placeholders: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();

            // Upsert, *not* `INSERT OR REPLACE`. REPLACE deletes the conflicting
            // row before re-inserting it, and that delete fires foreign-key
            // actions: restoring a `recurrences` row would null out the
            // `tasks.recurrence_id` that undo had just put back. `DO UPDATE`
            // rewrites the row in place and touches nothing else.
            let assignments: Vec<String> = cols
                .iter()
                .filter(|c| **c != "id")
                .map(|c| format!("{c} = excluded.{c}"))
                .collect();
            let conflict = if assignments.is_empty() {
                "ON CONFLICT(id) DO NOTHING".to_string()
            } else {
                format!("ON CONFLICT(id) DO UPDATE SET {}", assignments.join(", "))
            };
            let sql = format!(
                "INSERT INTO {table} ({}) VALUES ({}) {conflict}",
                cols.join(", "),
                placeholders.join(", ")
            );
            let values: Vec<SqlValue> = cols.iter().map(|c| json_to_sql(&map[*c])).collect();
            tx.execute(&sql, params_from_iter(values))?;
        }
        Some(_) => {
            return Err(AppError::Internal(
                "záznam v žurnálu zpět není objekt".into(),
            ))
        }
    }
    Ok(())
}

fn sql_to_json(v: SqlValue) -> Json {
    match v {
        SqlValue::Null => Json::Null,
        SqlValue::Integer(i) => Json::from(i),
        SqlValue::Real(f) => serde_json::Number::from_f64(f)
            .map(Json::Number)
            .unwrap_or(Json::Null),
        SqlValue::Text(s) => Json::String(s),
        // No column in the schema is a blob; keep the arm total anyway.
        SqlValue::Blob(b) => Json::String(String::from_utf8_lossy(&b).into_owned()),
    }
}

fn json_to_sql(v: &Json) -> SqlValue {
    match v {
        Json::Null => SqlValue::Null,
        Json::Bool(b) => SqlValue::Integer(*b as i64),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Json::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS areas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    position    REAL NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS areas_name_unique ON areas(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    area_id     TEXT REFERENCES areas(id) ON DELETE SET NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    list        TEXT NOT NULL DEFAULT 'anytime',
    start_on    TEXT,
    due_on      TEXT,
    position    REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS projects_area ON projects(area_id);
CREATE INDEX IF NOT EXISTS projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS recurrences (
    id      TEXT PRIMARY KEY,
    rule    TEXT NOT NULL,
    state   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
    area_id     TEXT REFERENCES areas(id) ON DELETE SET NULL,
    parent_id   TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'open',
    list        TEXT NOT NULL DEFAULT 'inbox',
    start_on    TEXT,
    due_on      TEXT,
    priority    INTEGER NOT NULL DEFAULT 0,
    position    REAL NOT NULL DEFAULT 0,
    recurrence_id TEXT REFERENCES recurrences(id) ON DELETE SET NULL,
    series_id   TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    completed_at TEXT,
    completed_on TEXT
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_start ON tasks(start_on);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(due_on);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS tasks_area ON tasks(area_id);
CREATE INDEX IF NOT EXISTS tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS tasks_series ON tasks(series_id);
CREATE INDEX IF NOT EXISTS tasks_completed ON tasks(completed_at);

CREATE TABLE IF NOT EXISTS tags (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#8a8a8f',
    created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_unique ON tags(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS task_tags (
    id      TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS task_tags_pair ON task_tags(task_id, tag_id);
CREATE INDEX IF NOT EXISTS task_tags_tag ON task_tags(tag_id);

CREATE TABLE IF NOT EXISTS attachments (
    id           TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    stored_name  TEXT NOT NULL,
    display_name TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_task ON attachments(task_id);

CREATE TABLE IF NOT EXISTS saved_filters (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    query       TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS saved_filters_name_unique ON saved_filters(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS undo_log (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    changes     TEXT NOT NULL,
    undone      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::Config;
    use std::path::PathBuf;

    fn test_cfg() -> Config {
        Config {
            data_dir: PathBuf::from("."),
            backup_keep: 3,
            backup_min_interval_minutes: 0,
            max_attachment_bytes: 1024,
            debug: false,
        }
    }

    fn store() -> Store {
        Store::open_in_memory(test_cfg()).unwrap()
    }

    fn insert_area(s: &mut Store, id: &str, name: &str) {
        let now = fmt_ts(Utc::now());
        s.write("přidání oblasti", |tx, rec| {
            rec.touch(tx, "areas", id)?;
            tx.execute(
                "INSERT INTO areas(id, name, position, archived, created_at, updated_at)
                 VALUES (?1, ?2, 0, 0, ?3, ?3)",
                params![id, name, now],
            )?;
            Ok(())
        })
        .unwrap();
    }

    fn area_names(s: &Store) -> Vec<String> {
        let mut stmt = s.conn.prepare("SELECT name FROM areas ORDER BY name").unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    #[test]
    fn schema_applies_and_is_idempotent() {
        let mut s = store();
        s.migrate().unwrap();
        let version: i64 = s.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn undo_reverts_an_insert_and_redo_restores_it() {
        let mut s = store();
        insert_area(&mut s, "a1", "Home");
        assert_eq!(area_names(&s), vec!["Home"]);

        assert_eq!(s.undo().unwrap().as_deref(), Some("přidání oblasti"));
        assert!(area_names(&s).is_empty());

        assert_eq!(s.redo().unwrap().as_deref(), Some("přidání oblasti"));
        assert_eq!(area_names(&s), vec!["Home"]);
    }

    #[test]
    fn undo_reverts_an_update_to_the_previous_values() {
        let mut s = store();
        insert_area(&mut s, "a1", "Home");
        s.write("Rename area", |tx, rec| {
            rec.touch(tx, "areas", "a1")?;
            tx.execute("UPDATE areas SET name = 'House' WHERE id = 'a1'", [])?;
            Ok(())
        })
        .unwrap();
        assert_eq!(area_names(&s), vec!["House"]);

        s.undo().unwrap();
        assert_eq!(area_names(&s), vec!["Home"]);
        s.redo().unwrap();
        assert_eq!(area_names(&s), vec!["House"]);
    }

    #[test]
    fn undo_reverts_a_delete() {
        let mut s = store();
        insert_area(&mut s, "a1", "Home");
        s.write("Delete area", |tx, rec| {
            rec.touch(tx, "areas", "a1")?;
            tx.execute("DELETE FROM areas WHERE id = 'a1'", [])?;
            Ok(())
        })
        .unwrap();
        assert!(area_names(&s).is_empty());
        s.undo().unwrap();
        assert_eq!(area_names(&s), vec!["Home"]);
    }

    #[test]
    fn undo_stack_walks_back_several_steps() {
        let mut s = store();
        insert_area(&mut s, "a1", "One");
        insert_area(&mut s, "a2", "Two");
        insert_area(&mut s, "a3", "Three");
        assert_eq!(area_names(&s).len(), 3);

        s.undo().unwrap();
        s.undo().unwrap();
        assert_eq!(area_names(&s), vec!["One"]);

        s.redo().unwrap();
        assert_eq!(area_names(&s).len(), 2);
    }

    #[test]
    fn a_new_action_clears_the_redo_branch() {
        let mut s = store();
        insert_area(&mut s, "a1", "One");
        insert_area(&mut s, "a2", "Two");
        s.undo().unwrap();
        assert_eq!(area_names(&s), vec!["One"]);

        insert_area(&mut s, "a3", "Three");
        assert_eq!(s.redo().unwrap(), None, "redo branch is gone");
        assert_eq!(area_names(&s), vec!["One", "Three"]);
    }

    #[test]
    fn undo_on_an_empty_stack_is_a_no_op() {
        let mut s = store();
        assert_eq!(s.undo().unwrap(), None);
        assert_eq!(s.redo().unwrap(), None);
    }

    #[test]
    fn a_write_that_changes_nothing_is_not_journalled() {
        let mut s = store();
        insert_area(&mut s, "a1", "Home");
        s.write("No-op", |tx, rec| {
            rec.touch(tx, "areas", "a1")?;
            Ok(())
        })
        .unwrap();
        // The undo stack still points at the insert, not the no-op.
        assert_eq!(s.undo_state().unwrap().0.as_deref(), Some("přidání oblasti"));
    }

    #[test]
    fn undo_restores_rows_that_reference_each_other() {
        let mut s = store();
        let now = fmt_ts(Utc::now());
        s.write("Add task with tag", |tx, rec| {
            rec.touch(tx, "tasks", "t1")?;
            rec.touch(tx, "tags", "g1")?;
            rec.touch(tx, "task_tags", "tt1")?;
            tx.execute(
                "INSERT INTO tasks(id, title, notes, status, list, priority, position, created_at, updated_at)
                 VALUES ('t1', 'Write it down', '', 'open', 'inbox', 0, 0, ?1, ?1)",
                params![now],
            )?;
            tx.execute(
                "INSERT INTO tags(id, name, color, created_at) VALUES ('g1', 'home', '#fff', ?1)",
                params![now],
            )?;
            tx.execute(
                "INSERT INTO task_tags(id, task_id, tag_id) VALUES ('tt1', 't1', 'g1')",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        s.undo().unwrap();
        let n: i64 = s
            .conn
            .query_row("SELECT COUNT(*) FROM task_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);

        // Redo must re-create the link even though the task row is restored in
        // the same statement batch - this is what deferred FKs buy us.
        s.redo().unwrap();
        let n: i64 = s
            .conn
            .query_row("SELECT COUNT(*) FROM task_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn a_failed_write_leaves_no_trace() {
        let mut s = store();
        insert_area(&mut s, "a1", "Home");
        let err = s.write("Bad write", |tx, rec| {
            rec.touch(tx, "areas", "a2")?;
            tx.execute("INSERT INTO areas(id, name) VALUES ('a2', 'Nope')", [])?;
            Err::<(), _>(AppError::Validation("changed my mind".into()))
        });
        assert!(err.is_err());
        assert_eq!(area_names(&s), vec!["Home"], "rolled back");
        assert_eq!(s.undo_state().unwrap().0.as_deref(), Some("přidání oblasti"));
    }

    #[test]
    fn restoring_a_referenced_row_does_not_null_out_the_reference() {
        // Regression: the journal used to restore rows with INSERT OR REPLACE,
        // which deletes before inserting. That delete fired
        // `tasks.recurrence_id REFERENCES recurrences(id) ON DELETE SET NULL`
        // and wiped the pointer undo had just restored one statement earlier.
        let mut s = store();
        let now = fmt_ts(Utc::now());
        s.write("Add repeating task", |tx, rec| {
            rec.touch(tx, "recurrences", "r1")?;
            rec.touch(tx, "tasks", "t1")?;
            tx.execute(
                "INSERT INTO recurrences(id, rule, state) VALUES ('r1', '{}', '{\"v\":1}')",
                [],
            )?;
            tx.execute(
                "INSERT INTO tasks(id, title, notes, status, list, priority, position,
                                   recurrence_id, created_at, updated_at)
                 VALUES ('t1', 'Weekly review', '', 'open', 'anytime', 0, 0, 'r1', ?1, ?1)",
                params![now],
            )?;
            Ok(())
        })
        .unwrap();

        // Complete it: the rule's state advances and the task lets go of it.
        s.write("Complete task", |tx, rec| {
            rec.touch(tx, "tasks", "t1")?;
            rec.touch(tx, "recurrences", "r1")?;
            tx.execute("UPDATE tasks SET recurrence_id = NULL WHERE id = 't1'", [])?;
            tx.execute(
                "UPDATE recurrences SET state = '{\"v\":2}' WHERE id = 'r1'",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        s.undo().unwrap();

        let recurrence_id: Option<String> = s
            .conn
            .query_row("SELECT recurrence_id FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(recurrence_id.as_deref(), Some("r1"), "the link came back");

        let state: String = s
            .conn
            .query_row("SELECT state FROM recurrences WHERE id = 'r1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(state, "{\"v\":1}", "and so did the rule's state");
    }

    #[test]
    fn journal_refuses_unknown_tables() {
        let mut s = store();
        let r = s.write("Sneaky", |tx, rec| rec.touch(tx, "undo_log", "1"));
        assert!(r.is_err());
        let r = s.write("Sneakier", |tx, rec| {
            rec.touch(tx, "tasks; DROP TABLE tasks", "1")
        });
        assert!(r.is_err());
    }

    #[test]
    fn meta_round_trips() {
        let s = store();
        assert_eq!(s.meta_get("nope").unwrap(), None);
        s.meta_set("last_backup", "2026-09-06").unwrap();
        assert_eq!(s.meta_get("last_backup").unwrap().as_deref(), Some("2026-09-06"));
        s.meta_set("last_backup", "2026-09-07").unwrap();
        assert_eq!(s.meta_get("last_backup").unwrap().as_deref(), Some("2026-09-07"));
    }
}

/// Schema v2: the notebook, occasions (Christmas, birthdays) and the gift
/// planner that hangs off them.
///
/// Money is stored in minor units (haléře) as an INTEGER. Storing prices as a
/// float is how you end up with a 899.99 that adds up to 2699.9700000000003.
const SCHEMA_V2: &str = r#"
CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    pinned      INTEGER NOT NULL DEFAULT 0,
    color       TEXT NOT NULL DEFAULT '',
    position    REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_pinned ON notes(pinned);
CREATE INDEX IF NOT EXISTS notes_updated ON notes(updated_at);

CREATE TABLE IF NOT EXISTS note_tags (
    id      TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS note_tags_pair ON note_tags(note_id, tag_id);
CREATE INDEX IF NOT EXISTS note_tags_tag ON note_tags(tag_id);

CREATE TABLE IF NOT EXISTS occasions (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'other',
    on_date      TEXT NOT NULL,
    yearly       INTEGER NOT NULL DEFAULT 1,
    budget_minor INTEGER,
    notes        TEXT NOT NULL DEFAULT '',
    position     REAL NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS occasions_date ON occasions(on_date);

CREATE TABLE IF NOT EXISTS gift_ideas (
    id          TEXT PRIMARY KEY,
    occasion_id TEXT NOT NULL REFERENCES occasions(id) ON DELETE CASCADE,
    recipient   TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    url         TEXT NOT NULL DEFAULT '',
    price_minor INTEGER,
    status      TEXT NOT NULL DEFAULT 'idea',
    position    REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gift_ideas_occasion ON gift_ideas(occasion_id);
CREATE INDEX IF NOT EXISTS gift_ideas_status ON gift_ideas(status);
"#;
