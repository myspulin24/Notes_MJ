//! One error type for the whole backend.
//!
//! Every Tauri command returns `Result<T, AppError>`. `AppError` serialises to
//! a small tagged object so the UI can tell apart "you typed something wrong"
//! (recoverable, show it next to the field) from "the disk is gone"
//! (recoverable, show a retry banner) from a genuine bug.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// The user's input was rejected. Always safe to show verbatim.
    #[error("{0}")]
    Validation(String),

    /// The thing the user asked for is not in the database.
    #[error("{0}")]
    NotFound(String),

    /// Disk / filesystem trouble. Usually retryable.
    #[error("{0}")]
    Io(String),

    /// An optional platform API (notifications, file dialogs) is unavailable.
    /// The caller is expected to carry on without it.
    #[error("{0}")]
    Unavailable(String),

    /// Anything else: a SQL error, a bug, a corrupt file.
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::Validation(_) => "validation",
            AppError::NotFound(_) => "not_found",
            AppError::Io(_) => "io",
            AppError::Unavailable(_) => "unavailable",
            AppError::Internal(_) => "internal",
        }
    }

    /// Whether the UI should offer a retry button.
    fn retryable(&self) -> bool {
        matches!(self, AppError::Io(_) | AppError::Unavailable(_))
    }
}

/// The wire shape the frontend sees in a rejected `invoke`.
#[derive(Serialize)]
struct WireError<'a> {
    kind: &'a str,
    message: String,
    retryable: bool,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        WireError {
            kind: self.kind(),
            message: self.to_string(),
            retryable: self.retryable(),
        }
        .serialize(s)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("takový záznam neexistuje".into()),
            // A unique-index violation is nearly always the user re-using a name.
            rusqlite::Error::SqliteFailure(f, Some(msg))
                if f.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                AppError::Validation(friendly_constraint(&msg))
            }
            other => AppError::Internal(format!("chyba databáze: {other}")),
        }
    }
}

fn friendly_constraint(msg: &str) -> String {
    if msg.contains("tags.name") {
        "štítek s tímto názvem už existuje".into()
    } else if msg.contains("saved_filters.name") {
        "uložený filtr s tímto názvem už existuje".into()
    } else if msg.contains("areas.name") {
        "oblast s tímto názvem už existuje".into()
    } else {
        format!("tato změna koliduje s existujícími daty ({msg})")
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Validation(format!("poškozený JSON: {e}"))
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
