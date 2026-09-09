//! Export and import of the documented JSON interchange format.
//!
//! The format is deliberately boring: one flat array per entity, ids preserved,
//! dates as `YYYY-MM-DD`, timestamps as RFC 3339. It round-trips exactly, and
//! it is readable enough to edit by hand or process with `jq`.
//!
//! See `docs/EXPORT-FORMAT.md` for the field-by-field reference.

use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::Store;
use crate::error::{AppError, Result};
use crate::models::*;
use crate::paths::safe_filename;
use crate::planner::{GiftIdea, Note, Occasion};
use crate::recur::{RecurrenceRule, RecurrenceState};
use crate::settings::Settings;

/// Bumped only for a breaking change. Importers must refuse a higher version
/// than they understand rather than guess.
pub const FORMAT: &str = "t3.export";
/// Version 2 added the notebook, occasions, gifts and settings. A version 1
/// file still imports: every new array carries `#[serde(default)]`, so an
/// older export simply has none of them.
pub const FORMAT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportFile {
    /// Always `"t3.export"`. Guards against importing an unrelated JSON file.
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub app_version: String,
    /// Present for information only; importing never touches these files.
    pub attachments_note: String,
    pub areas: Vec<Area>,
    pub projects: Vec<Project>,
    pub tags: Vec<Tag>,
    pub tasks: Vec<ExportTask>,
    pub saved_filters: Vec<SavedFilter>,

    // -- added in format version 2 -----------------------------------------
    #[serde(default)]
    pub notes: Vec<ExportNote>,
    #[serde(default)]
    pub occasions: Vec<Occasion>,
    #[serde(default)]
    pub gifts: Vec<GiftIdea>,
    /// The user's preferences. Restored only by an explicit choice in the UI,
    /// because importing someone else's theme is rarely what you meant.
    #[serde(default)]
    pub settings: Option<Settings>,
}

/// A note with its tag names denormalised, matching how tasks are exported.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportNote {
    #[serde(flatten)]
    pub note: Note,
    #[serde(default)]
    pub tag_names: Vec<String>,
}

/// A task with its relationships denormalised, so one array is enough.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportTask {
    #[serde(flatten)]
    pub task: Task,
    #[serde(default)]
    pub tag_names: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    /// The repeat rule, inlined. Only the open occurrence of a series has one.
    #[serde(default)]
    pub recurrence_rule: Option<RecurrenceRule>,
    #[serde(default)]
    pub recurrence_state: Option<RecurrenceState>,
}

/// What to do about rows that are already in the database.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    /// Keep what is here; add anything whose id is new. The safe default.
    Merge,
    /// Wipe everything first. Requires an explicit confirmation in the UI.
    Replace,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ImportReport {
    pub areas: usize,
    pub projects: usize,
    pub tags: usize,
    pub tasks: usize,
    pub saved_filters: usize,
    pub notes: usize,
    pub occasions: usize,
    pub gifts: usize,
    pub skipped_existing: usize,
    /// Whether the exported preferences were applied.
    pub settings_applied: bool,
    /// Problems that did not stop the import, phrased for a human.
    pub warnings: Vec<String>,
}

impl Store {
    /// Builds the complete export document in memory.
    pub fn build_export(&self) -> Result<ExportFile> {
        let areas = {
            let mut stmt = self.conn.prepare("SELECT * FROM areas ORDER BY position")?;
            let rows = stmt.query_map([], Area::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let projects = {
            let mut stmt = self.conn.prepare("SELECT * FROM projects ORDER BY position")?;
            let rows = stmt.query_map([], Project::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let tags = {
            let mut stmt = self.conn.prepare("SELECT * FROM tags ORDER BY name")?;
            let rows = stmt.query_map([], Tag::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let saved_filters = self.list_saved_filters()?;

        let raw_tasks = {
            let mut stmt = self.conn.prepare("SELECT * FROM tasks ORDER BY created_at")?;
            let rows = stmt.query_map([], Task::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };

        let mut tasks = Vec::with_capacity(raw_tasks.len());
        for task in raw_tasks {
            let tag_names = {
                let mut stmt = self.conn.prepare(
                    "SELECT g.name FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
                     WHERE tt.task_id = ?1 ORDER BY g.name",
                )?;
                let rows = stmt.query_map(params![task.id], |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            let attachments = {
                let mut stmt = self
                    .conn
                    .prepare("SELECT * FROM attachments WHERE task_id = ?1 ORDER BY created_at")?;
                let rows = stmt.query_map(params![task.id], Attachment::from_row)?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            let recurrence = match &task.recurrence_id {
                None => None,
                Some(id) => self
                    .conn
                    .query_row(
                        "SELECT * FROM recurrences WHERE id = ?1",
                        params![id],
                        Recurrence::from_row,
                    )
                    .ok(),
            };
            tasks.push(ExportTask {
                tag_names,
                attachments,
                recurrence_rule: recurrence.as_ref().map(|r| r.rule.clone()),
                recurrence_state: recurrence.as_ref().map(|r| r.state),
                task,
            });
        }

        // -- notebook, occasions and gifts (format version 2) --------------
        let raw_notes: Vec<Note> = {
            let mut stmt = self.conn.prepare("SELECT * FROM notes ORDER BY position")?;
            let rows = stmt.query_map([], Note::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut notes = Vec::with_capacity(raw_notes.len());
        for note in raw_notes {
            let tag_names = {
                let mut stmt = self.conn.prepare(
                    "SELECT g.name FROM note_tags nt JOIN tags g ON g.id = nt.tag_id
                     WHERE nt.note_id = ?1 ORDER BY g.name",
                )?;
                let rows = stmt.query_map(params![note.id], |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            notes.push(ExportNote { note, tag_names });
        }

        let occasions: Vec<Occasion> = {
            let mut stmt = self.conn.prepare("SELECT * FROM occasions ORDER BY on_date")?;
            let rows = stmt.query_map([], Occasion::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let gifts: Vec<GiftIdea> = {
            let mut stmt = self
                .conn
                .prepare("SELECT * FROM gift_ideas ORDER BY occasion_id, position")?;
            let rows = stmt.query_map([], GiftIdea::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };

        Ok(ExportFile {
            notes,
            occasions,
            gifts,
            settings: Some(self.settings()?),
            format: FORMAT.to_string(),
            version: FORMAT_VERSION,
            exported_at: fmt_ts(Utc::now()),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            attachments_note:
                "Soubory příloh nejsou součástí exportu. Pokud si je chcete ponechat, zkopírujte \
                 vedle tohoto souboru i složku `attachments` ze složky s daty Notes_MJ."
                    .to_string(),
            areas,
            projects,
            tags,
            tasks,
            saved_filters,
        })
    }

    /// Writes the export as pretty-printed JSON.
    ///
    /// Written to a temporary file next to the target and renamed into place,
    /// so a crash halfway through cannot leave a truncated export where a good
    /// one used to be.
    pub fn export_to_file(&self, path: &std::path::Path) -> Result<u64> {
        let doc = self.build_export()?;
        let json = serde_json::to_string_pretty(&doc)
            .map_err(|e| AppError::Internal(format!("export se nepodařilo sestavit: {e}")))?;

        let parent = path.parent().unwrap_or(std::path::Path::new("."));
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Io(format!("nelze zapisovat do {}: {e}", parent.display())))?;

        let temp = path.with_extension("json.part");
        std::fs::write(&temp, json.as_bytes())
            .map_err(|e| AppError::Io(format!("nelze zapsat {}: {e}", temp.display())))?;
        std::fs::rename(&temp, path).map_err(|e| {
            let _ = std::fs::remove_file(&temp);
            AppError::Io(format!("nelze uložit {}: {e}", path.display()))
        })?;

        Ok(json.len() as u64)
    }

    /// Writes the JSON export *and* copies the attachment files next to it,
    /// so one folder is the whole archive.
    pub fn export_bundle(&self, dir: &std::path::Path) -> Result<String> {
        let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
        let folder = dir.join(safe_filename(&format!("t3-export-{stamp}")));
        std::fs::create_dir_all(&folder)
            .map_err(|e| AppError::Io(format!("nelze vytvořit {}: {e}", folder.display())))?;

        self.export_to_file(&folder.join("t3-export.json"))?;

        let src = self.cfg.attachments_dir();
        if let Ok(entries) = std::fs::read_dir(&src) {
            let dest = folder.join("attachments");
            std::fs::create_dir_all(&dest)?;
            for entry in entries.flatten() {
                if entry.path().is_file() {
                    // A missing or locked attachment should not sink the export.
                    let _ = std::fs::copy(entry.path(), dest.join(entry.file_name()));
                }
            }
        }
        Ok(folder.to_string_lossy().to_string())
    }

    /// Parses and validates a document without changing anything.
    pub fn inspect_import(json: &str) -> Result<ExportFile> {
        let doc: ExportFile = serde_json::from_str(json).map_err(|e| {
            AppError::Validation(format!(
                "tohle nevypadá jako export z Notes_MJ ({e}). Očekáván objekt JSON s polem \
                 \"format\" o hodnotě \"{FORMAT}\"."
            ))
        })?;
        if doc.format != FORMAT {
            return Err(AppError::Validation(format!(
                "tento soubor se hlásí jako '{}', ne jako export z Notes_MJ",
                doc.format
            )));
        }
        if doc.version > FORMAT_VERSION {
            return Err(AppError::Validation(format!(
                "tento export má verzi {}, ale tato kopie Notes_MJ rozumí nejvýše verzi {}. \
                 Aktualizujte Notes_MJ a zkuste to znovu.",
                doc.version, FORMAT_VERSION
            )));
        }
        Ok(doc)
    }

    /// Imports a document. The whole import is one transaction and one undo
    /// step: if anything is wrong, nothing changes.
    /// `with_settings` restores the exported preferences too. Off by default:
    /// importing someone else - or your own past self - theme and window
    /// choices is rarely what you meant by "import my tasks".
    pub fn import_json(
        &mut self,
        json: &str,
        mode: ImportMode,
        with_settings: bool,
    ) -> Result<ImportReport> {
        let doc = Self::inspect_import(json)?;

        // Take a backup first: `Replace` is the one genuinely destructive
        // action in the app, and a copy on disk beats any confirmation dialog.
        if mode == ImportMode::Replace {
            self.backup_now()?;
        }

        let mut report = ImportReport::default();
        let now = fmt_ts(Utc::now());

        self.write("import", |tx, rec| {
            if mode == ImportMode::Replace {
                for table in [
                    "task_tags", "attachments", "tasks", "projects", "areas", "tags",
                    "recurrences", "saved_filters", "note_tags", "notes", "occasions",
                    "gift_ideas",
                ] {
                    rec.touch_all(tx, table)?;
                }
                tx.execute_batch("PRAGMA defer_foreign_keys = ON")?;
                tx.execute_batch(
                    "DELETE FROM task_tags;
                     DELETE FROM attachments;
                     DELETE FROM tasks;
                     DELETE FROM projects;
                     DELETE FROM areas;
                     DELETE FROM tags;
                     DELETE FROM recurrences;
                     DELETE FROM saved_filters;
                     DELETE FROM note_tags;
                     DELETE FROM notes;
                     DELETE FROM gift_ideas;
                     DELETE FROM occasions;",
                )?;
            } else {
                // A merge can restore rows that reference each other in any
                // order; defer the checks until the whole batch is in.
                tx.execute_batch("PRAGMA defer_foreign_keys = ON")?;
            }

            for area in &doc.areas {
                if exists(tx, "areas", &area.id)? {
                    report.skipped_existing += 1;
                    continue;
                }
                rec.touch(tx, "areas", &area.id)?;
                let name = unique_name(tx, "areas", &area.name)?;
                tx.execute(
                    "INSERT INTO areas(id, name, position, archived, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        area.id,
                        name,
                        area.position,
                        area.archived as i64,
                        fmt_ts(area.created_at),
                        fmt_ts(area.updated_at)
                    ],
                )?;
                report.areas += 1;
            }

            for project in &doc.projects {
                if exists(tx, "projects", &project.id)? {
                    report.skipped_existing += 1;
                    continue;
                }
                let area_id = match &project.area_id {
                    Some(id) if !exists(tx, "areas", id)? => {
                        report.warnings.push(format!(
                            "projekt '{}' odkazoval na neexistující oblast, zůstal nezařazený",
                            project.name
                        ));
                        None
                    }
                    other => other.clone(),
                };
                rec.touch(tx, "projects", &project.id)?;
                tx.execute(
                    "INSERT INTO projects(id, name, notes, area_id, status, list, start_on, due_on,
                                          position, created_at, updated_at, completed_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        project.id,
                        project.name,
                        project.notes,
                        area_id,
                        project.status.as_str(),
                        project.list.as_str(),
                        fmt_date(project.start_on),
                        fmt_date(project.due_on),
                        project.position,
                        fmt_ts(project.created_at),
                        fmt_ts(project.updated_at),
                        project.completed_at.map(fmt_ts)
                    ],
                )?;
                report.projects += 1;
            }

            for tag in &doc.tags {
                // Tags are matched by name, not id: two exports of the same
                // "home" tag should merge into one, not fight over the index.
                let existing: Option<String> = tx
                    .query_row(
                        "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                        params![tag.name],
                        |r| r.get(0),
                    )
                    .ok();
                if existing.is_some() || exists(tx, "tags", &tag.id)? {
                    report.skipped_existing += 1;
                    continue;
                }
                rec.touch(tx, "tags", &tag.id)?;
                tx.execute(
                    "INSERT INTO tags(id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
                    params![tag.id, tag.name, tag.color, fmt_ts(tag.created_at)],
                )?;
                report.tags += 1;
            }

            for entry in &doc.tasks {
                let task = &entry.task;
                if exists(tx, "tasks", &task.id)? {
                    report.skipped_existing += 1;
                    continue;
                }
                if task.title.trim().is_empty() {
                    report.warnings.push("přeskočen úkol bez názvu".into());
                    continue;
                }

                let recurrence_id = match (&entry.recurrence_rule, &task.recurrence_id) {
                    (Some(rule), Some(rid)) => {
                        if let Err(e) = rule.validate() {
                            report.warnings.push(format!(
                                "'{}' měl nepoužitelné pravidlo opakování ({e}); importováno bez něj",
                                task.title
                            ));
                            None
                        } else if exists(tx, "recurrences", rid)? {
                            Some(rid.clone())
                        } else {
                            rec.touch(tx, "recurrences", rid)?;
                            let state = entry.recurrence_state.unwrap_or_default();
                            tx.execute(
                                "INSERT INTO recurrences(id, rule, state) VALUES (?1, ?2, ?3)",
                                params![
                                    rid,
                                    serde_json::to_string(rule)?,
                                    serde_json::to_string(&state)?
                                ],
                            )?;
                            Some(rid.clone())
                        }
                    }
                    _ => None,
                };

                let project_id = keep_if_present(tx, "projects", &task.project_id)?;
                let area_id = keep_if_present(tx, "areas", &task.area_id)?;

                rec.touch(tx, "tasks", &task.id)?;
                tx.execute(
                    "INSERT INTO tasks(id, title, notes, project_id, area_id, parent_id, status, list,
                                       start_on, due_on, priority, position, recurrence_id, series_id,
                                       created_at, updated_at, completed_at, completed_on)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                    params![
                        task.id,
                        task.title.trim(),
                        task.notes,
                        project_id,
                        area_id,
                        task.parent_id,
                        task.status.as_str(),
                        task.list.as_str(),
                        fmt_date(task.start_on),
                        fmt_date(task.due_on),
                        task.priority.clamp(0, 3),
                        task.position,
                        recurrence_id,
                        task.series_id,
                        fmt_ts(task.created_at),
                        fmt_ts(task.updated_at),
                        task.completed_at.map(fmt_ts),
                        fmt_date(task.completed_on)
                    ],
                )?;
                report.tasks += 1;

                for name in &entry.tag_names {
                    let name = name.trim();
                    if name.is_empty() {
                        continue;
                    }
                    let tag_id: String = match tx.query_row(
                        "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                        params![name],
                        |r| r.get(0),
                    ) {
                        Ok(id) => id,
                        Err(_) => {
                            let id = uuid::Uuid::new_v4().to_string();
                            rec.touch(tx, "tags", &id)?;
                            tx.execute(
                                "INSERT INTO tags(id, name, color, created_at)
                                 VALUES (?1, ?2, '#8a8a8f', ?3)",
                                params![id, name, now],
                            )?;
                            report.tags += 1;
                            id
                        }
                    };
                    let link = uuid::Uuid::new_v4().to_string();
                    rec.touch(tx, "task_tags", &link)?;
                    tx.execute(
                        "INSERT OR IGNORE INTO task_tags(id, task_id, tag_id) VALUES (?1, ?2, ?3)",
                        params![link, task.id, tag_id],
                    )?;
                }

                for file in &entry.attachments {
                    if exists(tx, "attachments", &file.id)? {
                        continue;
                    }
                    // Re-sanitise on the way in: the file may have been written
                    // by an older build, or edited by hand.
                    let stored = safe_filename(&file.stored_name);
                    rec.touch(tx, "attachments", &file.id)?;
                    tx.execute(
                        "INSERT INTO attachments(id, task_id, stored_name, display_name, size_bytes, created_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![
                            file.id,
                            task.id,
                            stored,
                            file.display_name,
                            file.size_bytes.max(0),
                            fmt_ts(file.created_at)
                        ],
                    )?;
                }
            }

            for filter in &doc.saved_filters {
                if exists(tx, "saved_filters", &filter.id)? {
                    report.skipped_existing += 1;
                    continue;
                }
                rec.touch(tx, "saved_filters", &filter.id)?;
                let name = unique_name(tx, "saved_filters", &filter.name)?;
                tx.execute(
                    "INSERT INTO saved_filters(id, name, query, created_at) VALUES (?1, ?2, ?3, ?4)",
                    params![filter.id, name, filter.query, fmt_ts(filter.created_at)],
                )?;
                report.saved_filters += 1;
            }

            // -- notebook ---------------------------------------------------
            for entry in &doc.notes {
                let note = &entry.note;
                if exists(tx, "notes", &note.id)? {
                    report.skipped_existing += 1;
                    continue;
                }
                if note.title.trim().is_empty() {
                    report.warnings.push("přeskočena poznámka bez názvu".into());
                    continue;
                }
                rec.touch(tx, "notes", &note.id)?;
                tx.execute(
                    "INSERT INTO notes(id, title, body, pinned, color, position,
                                       created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        note.id,
                        note.title.trim(),
                        note.body,
                        note.pinned as i64,
                        note.color,
                        note.position,
                        fmt_ts(note.created_at),
                        fmt_ts(note.updated_at)
                    ],
                )?;
                report.notes += 1;

                for name in &entry.tag_names {
                    let name = name.trim();
                    if name.is_empty() {
                        continue;
                    }
                    let tag_id = ensure_tag(tx, rec, name, &now, &mut report)?;
                    let link = uuid::Uuid::new_v4().to_string();
                    rec.touch(tx, "note_tags", &link)?;
                    tx.execute(
                        "INSERT OR IGNORE INTO note_tags(id, note_id, tag_id) VALUES (?1, ?2, ?3)",
                        params![link, note.id, tag_id],
                    )?;
                }
            }

            // -- occasions and their gifts ----------------------------------
            for occasion in &doc.occasions {
                if exists(tx, "occasions", &occasion.id)? {
                    report.skipped_existing += 1;
                    continue;
                }
                rec.touch(tx, "occasions", &occasion.id)?;
                tx.execute(
                    "INSERT INTO occasions(id, name, kind, on_date, yearly, budget_minor, notes,
                                           position, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        occasion.id,
                        occasion.name,
                        occasion.kind.as_str(),
                        fmt_date(Some(occasion.on_date)),
                        occasion.yearly as i64,
                        occasion.budget_minor.filter(|v| *v >= 0),
                        occasion.notes,
                        occasion.position,
                        fmt_ts(occasion.created_at),
                        fmt_ts(occasion.updated_at)
                    ],
                )?;
                report.occasions += 1;
            }

            for gift in &doc.gifts {
                if exists(tx, "gift_ideas", &gift.id)? {
                    report.skipped_existing += 1;
                    continue;
                }
                // A gift without its occasion has nowhere to live.
                if !exists(tx, "occasions", &gift.occasion_id)? {
                    report.warnings.push(format!(
                        "dárek '{}' patřil k neexistující události a byl přeskočen",
                        gift.title
                    ));
                    continue;
                }
                rec.touch(tx, "gift_ideas", &gift.id)?;
                tx.execute(
                    "INSERT INTO gift_ideas(id, occasion_id, recipient, title, notes, url,
                                            price_minor, status, position, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        gift.id,
                        gift.occasion_id,
                        gift.recipient,
                        gift.title,
                        gift.notes,
                        // Re-validate: an edited file could carry a hostile URL.
                        if gift.url.starts_with("http://") || gift.url.starts_with("https://") {
                            gift.url.clone()
                        } else {
                            String::new()
                        },
                        gift.price_minor.filter(|v| *v >= 0),
                        gift.status.as_str(),
                        gift.position,
                        fmt_ts(gift.created_at),
                        fmt_ts(gift.updated_at)
                    ],
                )?;
                report.gifts += 1;
            }

            // A subtask whose parent did not come along would be invisible
            // forever; promote it instead of losing it.
            let orphaned = tx.execute(
                "UPDATE tasks SET parent_id = NULL
                 WHERE parent_id IS NOT NULL
                   AND parent_id NOT IN (SELECT id FROM tasks)",
                [],
            )?;
            if orphaned > 0 {
                report
                    .warnings
                    .push(format!("{orphaned} podúkolů nemělo nadřazený úkol, staly se z nich samostatné úkoly"));
            }

            Ok(())
        })?;

        // Settings live in `meta`, outside the undo journal, so they are
        // applied after the transaction has committed.
        if with_settings {
            if let Some(settings) = doc.settings.clone() {
                self.save_settings(settings)?;
                report.settings_applied = true;
            } else {
                report
                    .warnings
                    .push("soubor neobsahoval nastavení, použilo se stávající".into());
            }
        }

        Ok(report)
    }
}

/// Finds a tag by name, creating it if it is new. Shared by tasks and notes.
fn ensure_tag(
    tx: &rusqlite::Transaction<'_>,
    rec: &mut crate::db::Recorder,
    name: &str,
    now: &str,
    report: &mut ImportReport,
) -> Result<String> {
    if let Ok(id) = tx.query_row(
        "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
        params![name],
        |r| r.get::<_, String>(0),
    ) {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    rec.touch(tx, "tags", &id)?;
    tx.execute(
        "INSERT INTO tags(id, name, color, created_at) VALUES (?1, ?2, '#8a8a8f', ?3)",
        params![id, name, now],
    )?;
    report.tags += 1;
    Ok(id)
}

fn exists(tx: &rusqlite::Transaction<'_>, table: &str, id: &str) -> Result<bool> {
    if !crate::db::UNDOABLE_TABLES.contains(&table) {
        return Err(AppError::Internal(format!("neznámá tabulka '{table}'")));
    }
    let sql = format!("SELECT 1 FROM {table} WHERE id = ?1");
    Ok(tx.query_row(&sql, params![id], |r| r.get::<_, i64>(0)).is_ok())
}

fn keep_if_present(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    id: &Option<String>,
) -> Result<Option<String>> {
    match id {
        Some(v) if exists(tx, table, v)? => Ok(Some(v.clone())),
        _ => Ok(None),
    }
}

/// Areas and saved filters have unique names. On a merge the incoming name may
/// already be taken by a different row, so suffix it rather than fail.
fn unique_name(tx: &rusqlite::Transaction<'_>, table: &str, name: &str) -> Result<String> {
    if !crate::db::UNDOABLE_TABLES.contains(&table) {
        return Err(AppError::Internal(format!("neznámá tabulka '{table}'")));
    }
    let sql = format!("SELECT 1 FROM {table} WHERE name = ?1 COLLATE NOCASE");
    let taken = |candidate: &str| tx.query_row(&sql, params![candidate], |r| r.get::<_, i64>(0)).is_ok();
    if !taken(name) {
        return Ok(name.to_string());
    }
    for n in 2..1000 {
        let candidate = format!("{name} ({n})");
        if !taken(&candidate) {
            return Ok(candidate);
        }
    }
    Err(AppError::Validation(format!(
        "nepodařilo se najít volný název pro '{name}'"
    )))
}
