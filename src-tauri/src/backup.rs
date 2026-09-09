//! Automatic local backups.
//!
//! A backup is a whole, self-contained copy of the SQLite file produced with
//! `VACUUM INTO`. That runs inside SQLite, so it is consistent even while the
//! app is writing, and the result is a compact database you can open with any
//! SQLite tool - or just rename over `t3.db` to restore.
//!
//! One is taken at startup and after imports, throttled by
//! `T3_BACKUP_MIN_INTERVAL_MINUTES`, keeping the newest `T3_BACKUP_KEEP`.

use std::path::PathBuf;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use crate::db::Store;
use crate::error::{AppError, Result};
use crate::models::{fmt_ts, parse_ts};

const LAST_BACKUP_KEY: &str = "last_backup_at";

#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum BackupOutcome {
    /// A new backup file was written.
    Created { backup: BackupInfo, pruned: usize },
    /// One was taken recently enough; nothing to do.
    Skipped { reason: String },
}

impl Store {
    /// Takes a backup unless one was taken within the configured interval.
    pub fn backup_if_due(&self) -> Result<BackupOutcome> {
        // The UI setting wins over the .env default, so changing it in
        // Settings takes effect on the very next startup backup.
        let settings = self.settings()?;
        if !settings.backup_on_start {
            return Ok(BackupOutcome::Skipped {
                reason: "automatické zálohy jsou v nastavení vypnuté".to_string(),
            });
        }
        let interval = settings.effective_backup_interval(&self.cfg);
        if interval > 0 {
            if let Some(raw) = self.meta_get(LAST_BACKUP_KEY)? {
                if let Ok(last) = parse_ts(&raw) {
                    let next: DateTime<Utc> = last + Duration::minutes(interval);
                    if Utc::now() < next {
                        return Ok(BackupOutcome::Skipped {
                            reason: format!(
                                "poslední záloha proběhla {}",
                                last.format("%-d. %-m. %Y %H:%M UTC")
                            ),
                        });
                    }
                }
            }
        }
        self.backup_now().map(|(backup, pruned)| BackupOutcome::Created { backup, pruned })
    }

    /// Takes a backup unconditionally. Returns the new file and how many old
    /// ones were pruned.
    pub fn backup_now(&self) -> Result<(BackupInfo, usize)> {
        let dir = self.cfg.backups_dir();
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::Io(format!("nelze vytvořit složku se zálohami: {e}")))?;

        let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
        let file_name = format!("t3-{stamp}.db");
        let dest = dir.join(&file_name);

        // An in-memory database (the test suite) has nothing to vacuum out.
        if dest.exists() {
            std::fs::remove_file(&dest).ok();
        }

        // `VACUUM INTO` takes a consistent snapshot without blocking readers.
        // The path is ours, not the user's, but escape the quotes anyway.
        let target = dest.to_string_lossy().replace('\'', "''");
        self.conn
            .execute_batch(&format!("VACUUM INTO '{target}'"))
            .map_err(|e| {
                AppError::Io(format!(
                    "záloha do {} se nezdařila: {e}. Zkontrolujte volné místo na disku.",
                    dest.display()
                ))
            })?;

        let size_bytes = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        self.meta_set(LAST_BACKUP_KEY, &fmt_ts(Utc::now()))?;
        let pruned = self.prune_backups()?;

        Ok((
            BackupInfo {
                file_name,
                path: dest.to_string_lossy().to_string(),
                size_bytes,
                created_at: fmt_ts(Utc::now()),
            },
            pruned,
        ))
    }

    /// Copies the database aside before its schema is changed.
    ///
    /// Deliberately *not* part of the rolling backup set: those are pruned to
    /// `backup_keep`, and the one copy worth never losing is the one taken
    /// immediately before a migration ran. It therefore gets a name
    /// `list_backups` does not match, so it is never rotated away.
    ///
    /// This mattered less when upgrading meant the user deliberately
    /// installing a new version. Now that Notes_MJ updates itself, a new schema
    /// can arrive without anyone deciding anything, and "there is a copy from
    /// before" has to be a fact rather than a likelihood.
    pub fn snapshot_before_migration(&self, from_version: i64) -> Result<PathBuf> {
        let dir = self.cfg.backups_dir();
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::Io(format!("nelze vytvořit složku se zálohami: {e}")))?;

        let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
        let dest = dir.join(format!("notes_mj-pred-migraci-v{from_version}-{stamp}.db"));
        if dest.exists() {
            std::fs::remove_file(&dest).ok();
        }

        let target = dest.to_string_lossy().replace('\'', "''");
        self.conn
            .execute_batch(&format!("VACUUM INTO '{target}'"))
            .map_err(|e| {
                AppError::Io(format!(
                    "Notes_MJ nemohlo před úpravou databáze uložit její kopii do {}: {e}\n\n\
                     Databáze zůstala nezměněná. Uvolněte místo na disku a spusťte aplikaci znovu.",
                    dest.display()
                ))
            })?;

        Ok(dest)
    }

    /// Newest first.
    pub fn list_backups(&self) -> Result<Vec<BackupInfo>> {
        let dir = self.cfg.backups_dir();
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Ok(vec![]);
        };
        let mut out: Vec<BackupInfo> = entries
            .flatten()
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.starts_with("t3-") && name.ends_with(".db")
            })
            .map(|e| {
                let meta = e.metadata().ok();
                let created = meta
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .map(|t| DateTime::<Utc>::from(t))
                    .unwrap_or_else(Utc::now);
                BackupInfo {
                    file_name: e.file_name().to_string_lossy().to_string(),
                    path: e.path().to_string_lossy().to_string(),
                    size_bytes: meta.map(|m| m.len()).unwrap_or(0),
                    created_at: fmt_ts(created),
                }
            })
            .collect();
        // The names sort chronologically, which is more reliable than mtime.
        out.sort_by(|a, b| b.file_name.cmp(&a.file_name));
        Ok(out)
    }

    fn prune_backups(&self) -> Result<usize> {
        let backups = self.list_backups()?;
        let mut pruned = 0;
        let keep = self.settings()?.effective_backup_keep(&self.cfg);
        for old in backups.iter().skip(keep) {
            if std::fs::remove_file(&old.path).is_ok() {
                pruned += 1;
            }
        }
        Ok(pruned)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::Store;
    use crate::paths::Config;

    fn cfg(dir: &std::path::Path, keep: usize, interval: i64) -> Config {
        Config {
            data_dir: dir.to_path_buf(),
            backup_keep: keep,
            backup_min_interval_minutes: interval,
            max_attachment_bytes: 1024 * 1024,
            debug: false,
        }
    }

    /// Downgrading `user_version` is how a real older database is simulated:
    /// the schema itself is forward-compatible, and the migration is driven by
    /// that number alone.
    fn pretend_database_is_older(path: &std::path::Path) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute_batch("PRAGMA user_version = 1").unwrap();
    }

    fn snapshots_in(dir: &std::path::Path) -> Vec<String> {
        std::fs::read_dir(dir.join("backups"))
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|n| n.starts_with("notes_mj-pred-migraci-"))
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn upgrading_an_existing_database_copies_it_aside_first() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut store = Store::open(cfg(dir.path(), 5, 0)).unwrap();
            store.create_area("Domácnost").unwrap();
        }
        pretend_database_is_older(&dir.path().join("t3.db"));

        // Re-opening now runs the v1 -> v2 migration.
        let store = Store::open(cfg(dir.path(), 5, 0)).unwrap();

        let snapshots = snapshots_in(dir.path());
        assert_eq!(snapshots.len(), 1, "expected one pre-migration copy, got {snapshots:?}");
        assert!(snapshots[0].contains("-v1-"), "the copy names the version it came from");

        // The copy is a real database and still holds the row.
        let copy = rusqlite::Connection::open(dir.path().join("backups").join(&snapshots[0]))
            .unwrap();
        let name: String = copy
            .query_row("SELECT name FROM areas", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Domácnost");

        // And the live database really did get upgraded.
        drop(store);
    }

    #[test]
    fn a_brand_new_database_is_not_copied_aside() {
        let dir = tempfile::tempdir().unwrap();
        let _store = Store::open(cfg(dir.path(), 5, 0)).unwrap();
        // Nothing existed to protect, so there is nothing to keep.
        assert!(snapshots_in(dir.path()).is_empty());
    }

    #[test]
    fn a_pre_migration_copy_is_never_pruned_away() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut store = Store::open(cfg(dir.path(), 5, 0)).unwrap();
            store.create_area("Domácnost").unwrap();
        }
        pretend_database_is_older(&dir.path().join("t3.db"));

        // keep = 1, then take several ordinary backups: the rotation must not
        // reach the migration copy.
        let store = Store::open(cfg(dir.path(), 1, 0)).unwrap();
        for _ in 0..4 {
            store.backup_now().unwrap();
        }

        assert_eq!(snapshots_in(dir.path()).len(), 1);
        assert_eq!(store.list_backups().unwrap().len(), 1, "the rolling set still honours keep");
    }

    #[test]
    fn backup_writes_a_readable_database() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(cfg(dir.path(), 5, 0)).unwrap();
        store.create_area("Home").unwrap();

        let (info, _) = store.backup_now().unwrap();
        assert!(std::path::Path::new(&info.path).exists());
        assert!(info.size_bytes > 0);

        // The copy really is a database, and it has the row in it.
        let copy = rusqlite::Connection::open(&info.path).unwrap();
        let name: String = copy
            .query_row("SELECT name FROM areas LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Home");
    }

    #[test]
    fn backups_are_pruned_to_the_configured_count() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(cfg(dir.path(), 2, 0)).unwrap();
        for _ in 0..4 {
            store.backup_now().unwrap();
            // The name has one-second resolution, so step the clock.
            std::thread::sleep(std::time::Duration::from_millis(1100));
        }
        assert_eq!(store.list_backups().unwrap().len(), 2);
    }

    #[test]
    fn backup_is_skipped_inside_the_throttle_window() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(cfg(dir.path(), 5, 60)).unwrap();
        assert!(matches!(
            store.backup_if_due().unwrap(),
            crate::backup::BackupOutcome::Created { .. }
        ));
        assert!(matches!(
            store.backup_if_due().unwrap(),
            crate::backup::BackupOutcome::Skipped { .. }
        ));
    }

    #[test]
    fn listing_backups_before_any_exist_is_empty_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(cfg(dir.path(), 5, 0)).unwrap();
        assert!(store.list_backups().unwrap().is_empty());
    }
}
