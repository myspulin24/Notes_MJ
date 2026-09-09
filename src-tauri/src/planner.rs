//! The notebook, occasions and the gift planner.
//!
//! These three belong together: an occasion (Christmas, a birthday) is a date
//! with a list of presents attached, and the notebook is where the thinking
//! that is not a task goes. None of it has a status to tick off, which is why
//! it lives outside `store.rs` rather than inside the task machinery.
//!
//! Money is stored in **minor units** (haléře) as an integer. Prices as floats
//! is how a list of three items at 899,99 adds up to 2699,9700000000003.

use chrono::{Datelike, NaiveDate, Utc};
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::Store;
use crate::error::{AppError, Result};
use crate::models::{double_option, fmt_date, fmt_ts, parse_date, parse_ts, Tag};

// -- types --------------------------------------------------------------------

/// A free-form note. The notebook is deliberately not a task list: no status,
/// no dates, nothing to complete. Somewhere to put a thought that is not work.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub pinned: bool,
    /// A hex accent colour, or empty for the default.
    pub color: String,
    pub position: f64,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDetail {
    #[serde(flatten)]
    pub note: Note,
    pub tags: Vec<Tag>,
}

/// What sort of occasion this is. Drives the icon and the default wording;
/// the planner treats them all the same.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OccasionKind {
    Christmas,
    Birthday,
    Anniversary,
    Nameday,
    Holiday,
    Other,
}

impl OccasionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            OccasionKind::Christmas => "christmas",
            OccasionKind::Birthday => "birthday",
            OccasionKind::Anniversary => "anniversary",
            OccasionKind::Nameday => "nameday",
            OccasionKind::Holiday => "holiday",
            OccasionKind::Other => "other",
        }
    }
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "christmas" => OccasionKind::Christmas,
            "birthday" => OccasionKind::Birthday,
            "anniversary" => OccasionKind::Anniversary,
            "nameday" => OccasionKind::Nameday,
            "holiday" => OccasionKind::Holiday,
            "other" => OccasionKind::Other,
            other => {
                return Err(AppError::Validation(format!(
                    "neznámý druh události: {other}"
                )))
            }
        })
    }
}

/// How far a gift has got. The planner sums money by status, so "koupeno"
/// counts as spent and "nápad" does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GiftStatus {
    /// Just an idea, not committed to.
    Idea,
    /// Decided on, not bought yet.
    Decided,
    Bought,
    Wrapped,
    Given,
}

impl GiftStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            GiftStatus::Idea => "idea",
            GiftStatus::Decided => "decided",
            GiftStatus::Bought => "bought",
            GiftStatus::Wrapped => "wrapped",
            GiftStatus::Given => "given",
        }
    }
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "idea" => GiftStatus::Idea,
            "decided" => GiftStatus::Decided,
            "bought" => GiftStatus::Bought,
            "wrapped" => GiftStatus::Wrapped,
            "given" => GiftStatus::Given,
            other => {
                return Err(AppError::Validation(format!(
                    "neznámý stav dárku: {other}"
                )))
            }
        })
    }

    /// Whether the money has actually left your pocket.
    pub fn is_spent(self) -> bool {
        matches!(
            self,
            GiftStatus::Bought | GiftStatus::Wrapped | GiftStatus::Given
        )
    }
}

/// Christmas, a birthday, an anniversary - a date with a list of presents to
/// think about.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Occasion {
    pub id: String,
    pub name: String,
    pub kind: OccasionKind,
    pub on_date: NaiveDate,
    /// Repeats on the same day every year - birthdays and Christmas do.
    pub yearly: bool,
    /// Optional budget in minor units.
    pub budget_minor: Option<i64>,
    pub notes: String,
    pub position: f64,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GiftIdea {
    pub id: String,
    pub occasion_id: String,
    /// Who it is for. Free text, so it works without a contacts list.
    pub recipient: String,
    pub title: String,
    pub notes: String,
    pub url: String,
    pub price_minor: Option<i64>,
    pub status: GiftStatus,
    pub position: f64,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

/// An occasion with its gifts and the money already worked out, so the UI
/// never adds up currency itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OccasionDetail {
    #[serde(flatten)]
    pub occasion: Occasion,
    pub gifts: Vec<GiftIdea>,
    /// The next time this occasion comes round, accounting for `yearly`.
    pub next_date: NaiveDate,
    pub days_until: i64,
    /// Everything on the list, whatever its status.
    pub planned_minor: i64,
    /// Only what has actually been bought.
    pub spent_minor: i64,
    /// `budget - spent`, or `None` when there is no budget.
    pub remaining_minor: Option<i64>,
    pub gift_count: usize,
    pub bought_count: usize,
}

// -- patches ------------------------------------------------------------------

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct NotePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub pinned: Option<bool>,
    pub color: Option<String>,
    pub position: Option<f64>,
    pub tag_names: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct OccasionPatch {
    pub name: Option<String>,
    pub kind: Option<OccasionKind>,
    pub on_date: Option<NaiveDate>,
    pub yearly: Option<bool>,
    #[serde(deserialize_with = "double_option")]
    pub budget_minor: Option<Option<i64>>,
    pub notes: Option<String>,
    pub position: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct GiftPatch {
    pub recipient: Option<String>,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub url: Option<String>,
    #[serde(deserialize_with = "double_option")]
    pub price_minor: Option<Option<i64>>,
    pub status: Option<GiftStatus>,
    pub position: Option<f64>,
}

// -- row mapping --------------------------------------------------------------

impl Note {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Note> {
        let map = |e: AppError| rusqlite::Error::InvalidColumnName(e.to_string());
        Ok(Note {
            id: row.get("id")?,
            title: row.get("title")?,
            body: row.get("body")?,
            pinned: row.get::<_, i64>("pinned")? != 0,
            color: row.get("color")?,
            position: row.get("position")?,
            created_at: parse_ts(&row.get::<_, String>("created_at")?).map_err(map)?,
            updated_at: parse_ts(&row.get::<_, String>("updated_at")?).map_err(map)?,
        })
    }
}

impl Occasion {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Occasion> {
        let map = |e: AppError| rusqlite::Error::InvalidColumnName(e.to_string());
        let on_date = parse_date(row.get("on_date")?)
            .map_err(map)?
            .ok_or_else(|| rusqlite::Error::InvalidColumnName("on_date".into()))?;
        Ok(Occasion {
            id: row.get("id")?,
            name: row.get("name")?,
            kind: OccasionKind::parse(&row.get::<_, String>("kind")?).map_err(map)?,
            on_date,
            yearly: row.get::<_, i64>("yearly")? != 0,
            budget_minor: row.get("budget_minor")?,
            notes: row.get("notes")?,
            position: row.get("position")?,
            created_at: parse_ts(&row.get::<_, String>("created_at")?).map_err(map)?,
            updated_at: parse_ts(&row.get::<_, String>("updated_at")?).map_err(map)?,
        })
    }
}

impl GiftIdea {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<GiftIdea> {
        let map = |e: AppError| rusqlite::Error::InvalidColumnName(e.to_string());
        Ok(GiftIdea {
            id: row.get("id")?,
            occasion_id: row.get("occasion_id")?,
            recipient: row.get("recipient")?,
            title: row.get("title")?,
            notes: row.get("notes")?,
            url: row.get("url")?,
            price_minor: row.get("price_minor")?,
            status: GiftStatus::parse(&row.get::<_, String>("status")?).map_err(map)?,
            position: row.get("position")?,
            created_at: parse_ts(&row.get::<_, String>("created_at")?).map_err(map)?,
            updated_at: parse_ts(&row.get::<_, String>("updated_at")?).map_err(map)?,
        })
    }
}

// -- the recurring-date kernel ------------------------------------------------

/// When this occasion next falls, on or after `today`.
///
/// A yearly occasion rolls to next year once it has passed. 29 February clamps
/// to 28 February in a common year, exactly as the task recurrence engine does,
/// so a leap-day birthday still shows up every year.
pub fn next_occurrence(on_date: NaiveDate, yearly: bool, today: NaiveDate) -> NaiveDate {
    if !yearly {
        return on_date;
    }
    for year in [today.year(), today.year() + 1] {
        if let Some(candidate) = clamp_to_year(on_date, year) {
            if candidate >= today {
                return candidate;
            }
        }
    }
    on_date
}

fn clamp_to_year(date: NaiveDate, year: i32) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(year, date.month(), date.day()).or_else(|| {
        // 29 February in a common year.
        NaiveDate::from_ymd_opt(year, date.month(), date.day().saturating_sub(1))
    })
}

// -- store methods ------------------------------------------------------------

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn now_str() -> String {
    fmt_ts(Utc::now())
}

const MAX_TITLE: usize = 500;
const MAX_BODY: usize = 200_000;
const MAX_URL: usize = 2000;
/// Ten million crowns, in haléře. Past this it is a typo, not a present.
const MAX_MINOR: i64 = 1_000_000_000;

fn clean_title(raw: &str, what: &str) -> Result<String> {
    let t = raw.trim();
    if t.is_empty() {
        return Err(AppError::Validation(format!("{what} musí mít název")));
    }
    if t.chars().count() > MAX_TITLE {
        return Err(AppError::Validation(format!(
            "název může mít nejvýše {MAX_TITLE} znaků"
        )));
    }
    Ok(t.chars().filter(|c| !c.is_control()).collect())
}

fn clean_body(raw: &str) -> Result<String> {
    if raw.chars().count() > MAX_BODY {
        return Err(AppError::Validation(
            "text je příliš dlouhý - vejděte se do 200 000 znaků".into(),
        ));
    }
    Ok(raw.replace('\r', ""))
}

fn clean_line(raw: &str, max: usize, what: &str) -> Result<String> {
    let t = raw.trim();
    if t.chars().count() > max {
        return Err(AppError::Validation(format!(
            "{what} může mít nejvýše {max} znaků"
        )));
    }
    Ok(t.chars().filter(|c| !c.is_control()).collect())
}

/// Rejects anything that is not a plain http(s) link, so a stored `javascript:`
/// URL can never be handed to the opener.
fn clean_url(raw: &str) -> Result<String> {
    let t = raw.trim();
    if t.is_empty() {
        return Ok(String::new());
    }
    if t.chars().count() > MAX_URL {
        return Err(AppError::Validation("odkaz je příliš dlouhý".into()));
    }
    let lower = t.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AppError::Validation(
            "odkaz musí začínat na http:// nebo https://".into(),
        ));
    }
    Ok(t.chars().filter(|c| !c.is_control()).collect())
}

fn check_minor(value: Option<i64>) -> Result<Option<i64>> {
    if let Some(v) = value {
        if v < 0 {
            return Err(AppError::Validation("částka nemůže být záporná".into()));
        }
        if v > MAX_MINOR {
            return Err(AppError::Validation(
                "částka je nesmyslně vysoká - zkontrolujte, jestli nemáte navíc nulu".into(),
            ));
        }
    }
    Ok(value)
}

fn check_date(d: Option<NaiveDate>) -> Result<Option<NaiveDate>> {
    if let Some(d) = d {
        if !(1900..=2200).contains(&d.year()) {
            return Err(AppError::Validation(
                "datum musí být mezi roky 1900 a 2200".into(),
            ));
        }
    }
    Ok(d)
}

impl Store {
    // -- notebook ------------------------------------------------------------

    /// Pinned notes first, then most recently changed.
    pub fn list_notes(&self, search: Option<&str>) -> Result<Vec<NoteDetail>> {
        let (sql, pattern) = match search.map(str::trim).filter(|s| !s.is_empty()) {
            None => (
                "SELECT * FROM notes ORDER BY pinned DESC, position, updated_at DESC".to_string(),
                None,
            ),
            Some(text) => {
                let escaped = text
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_");
                (
                    "SELECT * FROM notes
                     WHERE title LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\'
                     ORDER BY pinned DESC, position, updated_at DESC"
                        .to_string(),
                    Some(format!("%{escaped}%")),
                )
            }
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let notes: Vec<Note> = match &pattern {
            None => stmt
                .query_map([], Note::from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            Some(p) => stmt
                .query_map(params![p], Note::from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        };
        self.hydrate_notes(notes)
    }

    fn hydrate_notes(&self, notes: Vec<Note>) -> Result<Vec<NoteDetail>> {
        if notes.is_empty() {
            return Ok(vec![]);
        }
        let mut by_note: std::collections::HashMap<String, Vec<Tag>> = Default::default();
        {
            let mut stmt = self.conn.prepare(
                "SELECT nt.note_id AS note_id, t.* FROM note_tags nt
                 JOIN tags t ON t.id = nt.tag_id
                 ORDER BY t.name COLLATE NOCASE",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>("note_id")?, Tag::from_row(row)?))
            })?;
            for row in rows {
                let (note_id, tag) = row?;
                by_note.entry(note_id).or_default().push(tag);
            }
        }
        Ok(notes
            .into_iter()
            .map(|note| NoteDetail {
                tags: by_note.remove(&note.id).unwrap_or_default(),
                note,
            })
            .collect())
    }

    pub fn get_note(&self, id: &str) -> Result<NoteDetail> {
        let note = self
            .conn
            .query_row("SELECT * FROM notes WHERE id = ?1", params![id], Note::from_row)
            .map_err(|_| AppError::NotFound("tato poznámka už neexistuje".into()))?;
        Ok(self.hydrate_notes(vec![note])?.remove(0))
    }

    pub fn create_note(&mut self, title: &str, body: &str) -> Result<NoteDetail> {
        let title = clean_title(title, "poznámka")?;
        let body = clean_body(body)?;
        let id = new_id();
        let now = now_str();
        self.write("přidání poznámky", |tx, rec| {
            rec.touch(tx, "notes", &id)?;
            let position: f64 = tx.query_row(
                "SELECT COALESCE(MIN(position), 0) - 1 FROM notes",
                [],
                |r| r.get(0),
            )?;
            tx.execute(
                "INSERT INTO notes(id, title, body, pinned, color, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 0, '', ?4, ?5, ?5)",
                params![id, title, body, position, now],
            )?;
            Ok(())
        })?;
        self.get_note(&id)
    }

    pub fn update_note(&mut self, id: &str, patch: NotePatch) -> Result<NoteDetail> {
        let title = patch
            .title
            .as_deref()
            .map(|t| clean_title(t, "poznámka"))
            .transpose()?;
        let body = patch.body.as_deref().map(clean_body).transpose()?;
        let color = patch
            .color
            .as_deref()
            .map(|c| clean_line(c, 16, "barva"))
            .transpose()?;
        let tag_names = patch
            .tag_names
            .as_ref()
            .map(|names| {
                names
                    .iter()
                    .map(|t| crate::store::clean_tag_name(t))
                    .collect::<Result<Vec<_>>>()
            })
            .transpose()?;
        let now = now_str();

        self.write("úpravu poznámky", |tx, rec| {
            rec.touch(tx, "notes", id)?;
            let exists: Option<i64> = tx
                .query_row("SELECT 1 FROM notes WHERE id = ?1", params![id], |r| r.get(0))
                .ok();
            if exists.is_none() {
                return Err(AppError::NotFound("tato poznámka už neexistuje".into()));
            }
            if let Some(v) = &title {
                tx.execute("UPDATE notes SET title = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = &body {
                tx.execute("UPDATE notes SET body = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = patch.pinned {
                tx.execute(
                    "UPDATE notes SET pinned = ?2 WHERE id = ?1",
                    params![id, v as i64],
                )?;
            }
            if let Some(v) = &color {
                tx.execute("UPDATE notes SET color = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = patch.position {
                if !v.is_finite() {
                    return Err(AppError::Validation("tato pozice není číslo".into()));
                }
                tx.execute("UPDATE notes SET position = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(names) = &tag_names {
                crate::store::set_owner_tags(tx, rec, "note_tags", "note_id", id, names, &now)?;
            }
            tx.execute("UPDATE notes SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
            Ok(())
        })?;
        self.get_note(id)
    }

    pub fn delete_note(&mut self, id: &str) -> Result<()> {
        self.write("smazání poznámky", |tx, rec| {
            rec.touch(tx, "notes", id)?;
            rec.touch_children(tx, "note_tags", "note_id", id)?;
            let n = tx.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
            if n == 0 {
                return Err(AppError::NotFound("tato poznámka už neexistuje".into()));
            }
            Ok(())
        })
    }

    // -- occasions -----------------------------------------------------------

    /// Occasions in the order they are coming up.
    pub fn list_occasions(&self, today: NaiveDate) -> Result<Vec<OccasionDetail>> {
        let occasions: Vec<Occasion> = {
            let mut stmt = self.conn.prepare("SELECT * FROM occasions")?;
            let rows = stmt.query_map([], Occasion::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };

        let mut gifts_by_occasion: std::collections::HashMap<String, Vec<GiftIdea>> =
            Default::default();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT * FROM gift_ideas ORDER BY position, created_at")?;
            for row in stmt.query_map([], GiftIdea::from_row)? {
                let gift = row?;
                gifts_by_occasion
                    .entry(gift.occasion_id.clone())
                    .or_default()
                    .push(gift);
            }
        }

        let mut out: Vec<OccasionDetail> = occasions
            .into_iter()
            .map(|occasion| {
                let gifts = gifts_by_occasion.remove(&occasion.id).unwrap_or_default();
                detail_for(occasion, gifts, today)
            })
            .collect();

        // Soonest first; anything already past (a one-off) sinks to the bottom.
        out.sort_by_key(|d| (d.days_until < 0, d.days_until, d.occasion.name.clone()));
        Ok(out)
    }

    pub fn get_occasion(&self, id: &str, today: NaiveDate) -> Result<OccasionDetail> {
        let occasion = self
            .conn
            .query_row(
                "SELECT * FROM occasions WHERE id = ?1",
                params![id],
                Occasion::from_row,
            )
            .map_err(|_| AppError::NotFound("tato událost už neexistuje".into()))?;
        let gifts = {
            let mut stmt = self.conn.prepare(
                "SELECT * FROM gift_ideas WHERE occasion_id = ?1 ORDER BY position, created_at",
            )?;
            let rows = stmt.query_map(params![id], GiftIdea::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        Ok(detail_for(occasion, gifts, today))
    }

    pub fn create_occasion(
        &mut self,
        name: &str,
        kind: OccasionKind,
        on_date: NaiveDate,
        yearly: bool,
        today: NaiveDate,
    ) -> Result<OccasionDetail> {
        let name = clean_title(name, "událost")?;
        let on_date = check_date(Some(on_date))?.unwrap();
        let id = new_id();
        let now = now_str();
        self.write("přidání události", |tx, rec| {
            rec.touch(tx, "occasions", &id)?;
            let position: f64 = tx.query_row(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM occasions",
                [],
                |r| r.get(0),
            )?;
            tx.execute(
                "INSERT INTO occasions(id, name, kind, on_date, yearly, budget_minor, notes,
                                       position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, '', ?6, ?7, ?7)",
                params![
                    id,
                    name,
                    kind.as_str(),
                    fmt_date(Some(on_date)),
                    yearly as i64,
                    position,
                    now
                ],
            )?;
            Ok(())
        })?;
        self.get_occasion(&id, today)
    }

    pub fn update_occasion(
        &mut self,
        id: &str,
        patch: OccasionPatch,
        today: NaiveDate,
    ) -> Result<OccasionDetail> {
        let name = patch
            .name
            .as_deref()
            .map(|n| clean_title(n, "událost"))
            .transpose()?;
        let notes = patch.notes.as_deref().map(clean_body).transpose()?;
        let on_date = check_date(patch.on_date)?;
        let budget = match patch.budget_minor {
            None => None,
            Some(v) => Some(check_minor(v)?),
        };
        let now = now_str();

        self.write("úpravu události", |tx, rec| {
            rec.touch(tx, "occasions", id)?;
            let exists: Option<i64> = tx
                .query_row("SELECT 1 FROM occasions WHERE id = ?1", params![id], |r| {
                    r.get(0)
                })
                .ok();
            if exists.is_none() {
                return Err(AppError::NotFound("tato událost už neexistuje".into()));
            }
            if let Some(v) = &name {
                tx.execute("UPDATE occasions SET name = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = patch.kind {
                tx.execute(
                    "UPDATE occasions SET kind = ?2 WHERE id = ?1",
                    params![id, v.as_str()],
                )?;
            }
            if let Some(v) = on_date {
                tx.execute(
                    "UPDATE occasions SET on_date = ?2 WHERE id = ?1",
                    params![id, fmt_date(Some(v))],
                )?;
            }
            if let Some(v) = patch.yearly {
                tx.execute(
                    "UPDATE occasions SET yearly = ?2 WHERE id = ?1",
                    params![id, v as i64],
                )?;
            }
            if let Some(v) = budget {
                tx.execute(
                    "UPDATE occasions SET budget_minor = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
            }
            if let Some(v) = &notes {
                tx.execute("UPDATE occasions SET notes = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = patch.position {
                if !v.is_finite() {
                    return Err(AppError::Validation("tato pozice není číslo".into()));
                }
                tx.execute(
                    "UPDATE occasions SET position = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
            }
            tx.execute(
                "UPDATE occasions SET updated_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
            Ok(())
        })?;
        self.get_occasion(id, today)
    }

    /// Deletes an occasion **and its gift list** - the list has no meaning
    /// without the occasion. One undo step brings both back.
    pub fn delete_occasion(&mut self, id: &str) -> Result<()> {
        self.write("smazání události", |tx, rec| {
            rec.touch(tx, "occasions", id)?;
            rec.touch_children(tx, "gift_ideas", "occasion_id", id)?;
            let n = tx.execute("DELETE FROM occasions WHERE id = ?1", params![id])?;
            if n == 0 {
                return Err(AppError::NotFound("tato událost už neexistuje".into()));
            }
            Ok(())
        })
    }

    // -- gifts ---------------------------------------------------------------

    pub fn create_gift(
        &mut self,
        occasion_id: &str,
        title: &str,
        recipient: &str,
    ) -> Result<GiftIdea> {
        let title = clean_title(title, "dárek")?;
        let recipient = clean_line(recipient, 200, "jméno")?;
        let id = new_id();
        let now = now_str();
        self.write("přidání dárku", |tx, rec| {
            let exists: Option<i64> = tx
                .query_row(
                    "SELECT 1 FROM occasions WHERE id = ?1",
                    params![occasion_id],
                    |r| r.get(0),
                )
                .ok();
            if exists.is_none() {
                return Err(AppError::NotFound("tato událost už neexistuje".into()));
            }
            rec.touch(tx, "gift_ideas", &id)?;
            let position: f64 = tx.query_row(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM gift_ideas WHERE occasion_id = ?1",
                params![occasion_id],
                |r| r.get(0),
            )?;
            tx.execute(
                "INSERT INTO gift_ideas(id, occasion_id, recipient, title, notes, url,
                                        price_minor, status, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, '', '', NULL, 'idea', ?5, ?6, ?6)",
                params![id, occasion_id, recipient, title, position, now],
            )?;
            Ok(())
        })?;
        self.get_gift(&id)
    }

    pub fn get_gift(&self, id: &str) -> Result<GiftIdea> {
        self.conn
            .query_row(
                "SELECT * FROM gift_ideas WHERE id = ?1",
                params![id],
                GiftIdea::from_row,
            )
            .map_err(|_| AppError::NotFound("tento dárek už neexistuje".into()))
    }

    pub fn update_gift(&mut self, id: &str, patch: GiftPatch) -> Result<GiftIdea> {
        let title = patch
            .title
            .as_deref()
            .map(|t| clean_title(t, "dárek"))
            .transpose()?;
        let recipient = patch
            .recipient
            .as_deref()
            .map(|r| clean_line(r, 200, "jméno"))
            .transpose()?;
        let notes = patch.notes.as_deref().map(clean_body).transpose()?;
        let url = patch.url.as_deref().map(clean_url).transpose()?;
        let price = match patch.price_minor {
            None => None,
            Some(v) => Some(check_minor(v)?),
        };
        let now = now_str();

        self.write("úpravu dárku", |tx, rec| {
            rec.touch(tx, "gift_ideas", id)?;
            let exists: Option<i64> = tx
                .query_row("SELECT 1 FROM gift_ideas WHERE id = ?1", params![id], |r| {
                    r.get(0)
                })
                .ok();
            if exists.is_none() {
                return Err(AppError::NotFound("tento dárek už neexistuje".into()));
            }
            if let Some(v) = &title {
                tx.execute("UPDATE gift_ideas SET title = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = &recipient {
                tx.execute(
                    "UPDATE gift_ideas SET recipient = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
            }
            if let Some(v) = &notes {
                tx.execute("UPDATE gift_ideas SET notes = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = &url {
                tx.execute("UPDATE gift_ideas SET url = ?2 WHERE id = ?1", params![id, v])?;
            }
            if let Some(v) = price {
                tx.execute(
                    "UPDATE gift_ideas SET price_minor = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
            }
            if let Some(v) = patch.status {
                tx.execute(
                    "UPDATE gift_ideas SET status = ?2 WHERE id = ?1",
                    params![id, v.as_str()],
                )?;
            }
            if let Some(v) = patch.position {
                if !v.is_finite() {
                    return Err(AppError::Validation("tato pozice není číslo".into()));
                }
                tx.execute(
                    "UPDATE gift_ideas SET position = ?2 WHERE id = ?1",
                    params![id, v],
                )?;
            }
            tx.execute(
                "UPDATE gift_ideas SET updated_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
            Ok(())
        })?;
        self.get_gift(id)
    }

    pub fn delete_gift(&mut self, id: &str) -> Result<()> {
        self.write("smazání dárku", |tx, rec| {
            rec.touch(tx, "gift_ideas", id)?;
            let n = tx.execute("DELETE FROM gift_ideas WHERE id = ?1", params![id])?;
            if n == 0 {
                return Err(AppError::NotFound("tento dárek už neexistuje".into()));
            }
            Ok(())
        })
    }
}

fn detail_for(occasion: Occasion, gifts: Vec<GiftIdea>, today: NaiveDate) -> OccasionDetail {
    let next_date = next_occurrence(occasion.on_date, occasion.yearly, today);
    let planned_minor = gifts.iter().filter_map(|g| g.price_minor).sum();
    let spent_minor = gifts
        .iter()
        .filter(|g| g.status.is_spent())
        .filter_map(|g| g.price_minor)
        .sum();
    OccasionDetail {
        days_until: (next_date - today).num_days(),
        next_date,
        planned_minor,
        spent_minor,
        remaining_minor: occasion.budget_minor.map(|b| b - spent_minor),
        gift_count: gifts.len(),
        bought_count: gifts.iter().filter(|g| g.status.is_spent()).count(),
        occasion,
        gifts,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn a_yearly_occasion_rolls_to_next_year_once_it_has_passed() {
        let christmas = d("2026-12-24");
        assert_eq!(
            next_occurrence(christmas, true, d("2026-09-07")),
            d("2026-12-24"),
            "still ahead this year"
        );
        assert_eq!(
            next_occurrence(christmas, true, d("2026-12-24")),
            d("2026-12-24"),
            "the day itself counts"
        );
        assert_eq!(
            next_occurrence(christmas, true, d("2026-12-25")),
            d("2027-12-24"),
            "rolls over once past"
        );
    }

    #[test]
    fn a_one_off_occasion_stays_where_it_is() {
        let wedding = d("2026-06-13");
        assert_eq!(next_occurrence(wedding, false, d("2026-01-01")), wedding);
        assert_eq!(
            next_occurrence(wedding, false, d("2027-01-01")),
            wedding,
            "a one-off in the past stays in the past"
        );
    }

    #[test]
    fn a_birthday_from_years_ago_finds_this_years_date() {
        // Birthdays are stored with the year of birth.
        let born = d("1988-03-15");
        assert_eq!(next_occurrence(born, true, d("2026-01-01")), d("2026-03-15"));
        assert_eq!(next_occurrence(born, true, d("2026-06-01")), d("2027-03-15"));
    }

    #[test]
    fn a_leap_day_birthday_clamps_in_a_common_year() {
        let born = d("2000-02-29");
        assert_eq!(
            next_occurrence(born, true, d("2026-01-01")),
            d("2026-02-28"),
            "2026 is not a leap year"
        );
        assert_eq!(
            next_occurrence(born, true, d("2028-01-01")),
            d("2028-02-29"),
            "and the real date returns in a leap year"
        );
    }

    #[test]
    fn urls_must_be_plain_web_links() {
        assert_eq!(clean_url("").unwrap(), "");
        assert_eq!(
            clean_url(" https://alza.cz/neco ").unwrap(),
            "https://alza.cz/neco"
        );
        assert!(clean_url("javascript:alert(1)").is_err());
        assert!(clean_url("file:///C:/Windows").is_err());
        assert!(clean_url("alza.cz").is_err(), "no scheme is ambiguous");
    }

    #[test]
    fn money_is_checked_for_sanity() {
        assert_eq!(check_minor(None).unwrap(), None);
        assert_eq!(check_minor(Some(0)).unwrap(), Some(0));
        assert_eq!(check_minor(Some(89_900)).unwrap(), Some(89_900));
        assert!(check_minor(Some(-1)).is_err());
        assert!(check_minor(Some(MAX_MINOR + 1)).is_err());
    }

    #[test]
    fn only_bought_gifts_count_as_spent() {
        assert!(!GiftStatus::Idea.is_spent());
        assert!(!GiftStatus::Decided.is_spent());
        assert!(GiftStatus::Bought.is_spent());
        assert!(GiftStatus::Wrapped.is_spent());
        assert!(GiftStatus::Given.is_spent());
    }
}
