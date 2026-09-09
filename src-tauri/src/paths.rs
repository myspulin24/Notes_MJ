//! Where Notes_MJ keeps things on disk, and how it turns untrusted text into a name
//! that is safe to write there.
//!
//! Layout (Windows default, `%USERPROFILE%\.notes_mj\userdata`):
//!
//! ```text
//! userdata/
//!   t3.db              SQLite database - the single source of truth
//!   t3.db-wal          write-ahead log (transient)
//!   attachments/       one file per attachment, content-addressed prefix
//!   backups/           automatic snapshots, newest last
//!   the database file keeps its original name for backwards compatibility
//! ```

use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};

/// Resolved, validated configuration read once at startup.
#[derive(Debug, Clone)]
pub struct Config {
    pub data_dir: PathBuf,
    pub backup_keep: usize,
    pub backup_min_interval_minutes: i64,
    pub max_attachment_bytes: u64,
    pub debug: bool,
}

impl Config {
    /// Reads `.env` (if present) and the process environment.
    ///
    /// Every value falls back to a sane default, so a missing or malformed
    /// `.env` degrades to "works with defaults" rather than failing to start.
    pub fn load() -> Self {
        // `.env` is optional by design: Notes_MJ needs no credentials to run.
        let _ = dotenvy::dotenv();

        let data_dir = match std::env::var("T3_DATA_DIR") {
            Ok(v) if !v.trim().is_empty() => PathBuf::from(v.trim()),
            _ => default_data_dir(),
        };

        Config {
            data_dir,
            backup_keep: env_num("T3_BACKUP_KEEP", 20).clamp(1, 1000) as usize,
            backup_min_interval_minutes: env_num("T3_BACKUP_MIN_INTERVAL_MINUTES", 60).clamp(0, 60 * 24 * 30),
            max_attachment_bytes: env_num("T3_MAX_ATTACHMENT_MB", 64).clamp(1, 4096) as u64 * 1024 * 1024,
            debug: matches!(std::env::var("T3_DEBUG").as_deref(), Ok("1") | Ok("true")),
        }
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join(DB_FILE)
    }
    pub fn attachments_dir(&self) -> PathBuf {
        self.data_dir.join("attachments")
    }
    pub fn backups_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }

    /// Creates the directory tree. Called before the database is opened.
    pub fn ensure_dirs(&self) -> Result<()> {
        for dir in [&self.data_dir, &self.attachments_dir(), &self.backups_dir()] {
            std::fs::create_dir_all(dir).map_err(|e| {
                AppError::Io(format!("nepodařilo se vytvořit {}: {e}", dir.display()))
            })?;
        }
        Ok(())
    }
}

fn env_num(key: &str, default: i64) -> i64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(default)
}

/// The folder the app used before it was renamed to Notes_MJ.
const LEGACY_DIR: &str = ".t3";
const DATA_DIR: &str = ".notes_mj";
pub const DB_FILE: &str = "t3.db";

fn default_data_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    resolve_data_dir(&home)
}

/// Picks between the current folder and the pre-rename one.
///
/// A rename must never strand someone's data. If the old folder already holds
/// a database and the new one does not, the old one keeps being used - so
/// upgrading is invisible. A fresh install gets the new name.
///
/// Split out from [`default_data_dir`] so the decision is testable without
/// touching the real home directory.
fn resolve_data_dir(home: &Path) -> PathBuf {
    let current = home.join(DATA_DIR).join("userdata");
    let legacy = home.join(LEGACY_DIR).join("userdata");

    if !current.join(DB_FILE).exists() && legacy.join(DB_FILE).exists() {
        return legacy;
    }
    current
}

/// Characters Windows forbids in a file name, plus the path separators.
const FORBIDDEN: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Names Windows refuses regardless of extension.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Turns arbitrary user text into a single path segment that is safe to create
/// on Windows (and everywhere else).
///
/// Guarantees about the result:
/// * never empty,
/// * contains no path separator, so it cannot escape its directory,
/// * no control characters or Windows-forbidden characters,
/// * not a reserved device name such as `CON` or `LPT1`,
/// * no trailing dot or space (Windows silently strips those),
/// * at most 120 bytes, with the extension preserved.
pub fn safe_filename(input: &str) -> String {
    // Take only the last segment: "..\..\evil.txt" must not stay a path.
    let base = input
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or(input);

    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || FORBIDDEN.contains(&c) {
                '_'
            } else {
                c
            }
        })
        .collect();

    // Split off the extension before truncating so we keep it.
    let (stem, ext) = match cleaned.rsplit_once('.') {
        // A leading dot means a dotfile, not an extension; and ".." has no
        // extension at all, only an empty tail.
        Some((s, e))
            if !s.is_empty()
                && !e.is_empty()
                && e.len() <= 16
                && e.chars().all(|c| c.is_alphanumeric()) =>
        {
            (s, Some(e))
        }
        _ => (cleaned.as_str(), None),
    };

    let mut stem = stem.trim().trim_matches('.').trim().to_string();

    if stem.is_empty() {
        stem = "untitled".to_string();
    }
    if RESERVED.iter().any(|r| stem.eq_ignore_ascii_case(r)) {
        stem = format!("_{stem}");
    }

    // Truncate on a char boundary, budgeting room for the extension.
    let ext_len = ext.map(|e| e.len() + 1).unwrap_or(0);
    let budget = 120usize.saturating_sub(ext_len).max(8);
    if stem.len() > budget {
        let mut end = budget;
        while end > 0 && !stem.is_char_boundary(end) {
            end -= 1;
        }
        stem.truncate(end);
        stem = stem.trim().trim_matches('.').trim().to_string();
        if stem.is_empty() {
            stem = "untitled".to_string();
        }
    }

    match ext {
        Some(e) => format!("{stem}.{e}"),
        None => stem,
    }
}

/// Rejects a path that would escape `root` (symlinks, `..`, absolute paths).
///
/// Used before reading or deleting anything the UI names by path.
pub fn ensure_within(root: &Path, candidate: &Path) -> Result<PathBuf> {
    let root = root
        .canonicalize()
        .map_err(|e| AppError::Io(format!("složka s daty není dostupná: {e}")))?;
    // The file may not exist yet (a write target), so canonicalize the parent.
    let resolved = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|e| AppError::Io(format!("{}: {e}", candidate.display())))?
    } else {
        let parent = candidate.parent().unwrap_or(Path::new("."));
        let parent = parent
            .canonicalize()
            .map_err(|e| AppError::Io(format!("{}: {e}", parent.display())))?;
        parent.join(candidate.file_name().unwrap_or_default())
    };
    if resolved.starts_with(&root) {
        Ok(resolved)
    } else {
        Err(AppError::Validation(
            "tato cesta je mimo složku s daty Notes_MJ".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_path_traversal() {
        assert_eq!(safe_filename("../../etc/passwd"), "passwd");
        assert_eq!(safe_filename(r"..\..\Windows\System32\evil.dll"), "evil.dll");
        assert!(!safe_filename(r"a\b").contains('\\'));
        assert!(!safe_filename("a/b").contains('/'));
    }

    #[test]
    fn replaces_forbidden_and_control_characters() {
        assert_eq!(safe_filename("re:port<1>.txt"), "re_port_1_.txt");
        assert_eq!(safe_filename("bell\u{7}.txt"), "bell_.txt");
        assert_eq!(safe_filename("pipe|star*.md"), "pipe_star_.md");
    }

    #[test]
    fn never_returns_empty_or_dot_only() {
        assert_eq!(safe_filename(""), "untitled");
        assert_eq!(safe_filename("   "), "untitled");
        assert_eq!(safe_filename("..."), "untitled");
        assert_eq!(safe_filename("/"), "untitled");
    }

    #[test]
    fn escapes_windows_reserved_names() {
        assert_eq!(safe_filename("CON"), "_CON");
        assert_eq!(safe_filename("nul"), "_nul");
        assert_eq!(safe_filename("LPT1.txt"), "_LPT1.txt");
        // Not reserved once it is part of a longer name.
        assert_eq!(safe_filename("console.log"), "console.log");
    }

    #[test]
    fn trims_trailing_dots_and_spaces() {
        assert_eq!(safe_filename("report.  "), "report");
        assert_eq!(safe_filename(" notes "), "notes");
    }

    #[test]
    fn truncates_long_names_but_keeps_extension() {
        let long = format!("{}.pdf", "x".repeat(400));
        let out = safe_filename(&long);
        assert!(out.len() <= 120, "got {} bytes", out.len());
        assert!(out.ends_with(".pdf"));
    }

    #[test]
    fn truncates_on_char_boundary() {
        let long = format!("{}.txt", "\u{1f600}".repeat(200));
        let out = safe_filename(&long);
        assert!(out.len() <= 120);
        assert!(out.ends_with(".txt"));
    }

    #[test]
    fn keeps_ordinary_names_intact() {
        assert_eq!(safe_filename("Quarterly Review 2026.pdf"), "Quarterly Review 2026.pdf");
        assert_eq!(safe_filename("faktura-2026-09.pdf"), "faktura-2026-09.pdf");
    }
}

#[cfg(test)]
mod data_dir_tests {
    use super::*;

    #[test]
    fn a_fresh_machine_gets_the_new_folder() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve_data_dir(home.path()),
            home.path().join(".notes_mj").join("userdata")
        );
    }

    #[test]
    fn an_existing_database_in_the_old_folder_keeps_being_used() {
        // The upgrade path: someone who used the app before it was renamed
        // must not open it to an empty list.
        let home = tempfile::tempdir().unwrap();
        let legacy = home.path().join(".t3").join("userdata");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("t3.db"), b"pretend").unwrap();

        assert_eq!(resolve_data_dir(home.path()), legacy);
    }

    #[test]
    fn the_new_folder_wins_once_it_has_a_database_of_its_own() {
        let home = tempfile::tempdir().unwrap();
        for dir in [".t3", ".notes_mj"] {
            let path = home.path().join(dir).join("userdata");
            std::fs::create_dir_all(&path).unwrap();
            std::fs::write(path.join("t3.db"), b"pretend").unwrap();
        }
        assert_eq!(
            resolve_data_dir(home.path()),
            home.path().join(".notes_mj").join("userdata")
        );
    }

    #[test]
    fn an_empty_old_folder_does_not_win() {
        // A leftover directory with no database in it is not data.
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".t3").join("userdata")).unwrap();
        assert_eq!(
            resolve_data_dir(home.path()),
            home.path().join(".notes_mj").join("userdata")
        );
    }
}
