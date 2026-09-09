//! The dashboard and the calendar.
//!
//! Both are read-only aggregations over what `store.rs` already holds. They
//! live here rather than in `store.rs` because they answer a different kind of
//! question: not "what is in this list" but "how is it going" and "what does
//! this month look like".
//!
//! Every figure is computed in SQL against the caller's local `today`, so the
//! numbers agree with what the lists show, including near midnight.

use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::params;
use serde::Serialize;

use crate::db::Store;
use crate::error::Result;
use crate::models::{Project, Task, TaskDetail};
use crate::planner::{NoteDetail, Occasion, OccasionDetail};
use crate::store::Counts;

/// How much of a project is done. Drives the progress bars on the dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectProgress {
    #[serde(flatten)]
    pub project: Project,
    pub total: i64,
    pub done: i64,
    /// 0.0 - 1.0. An empty project is 0, not a division by zero.
    pub ratio: f64,
    /// The soonest deadline still open inside the project.
    pub next_due: Option<NaiveDate>,
}

/// One bar in the "next seven days" strip.
#[derive(Debug, Clone, Serialize)]
pub struct DayLoad {
    pub date: NaiveDate,
    pub scheduled: i64,
    pub due: i64,
    pub occasions: i64,
}

/// Completions per day, for the little activity chart.
#[derive(Debug, Clone, Serialize)]
pub struct DayCount {
    pub date: NaiveDate,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Dashboard {
    pub today: NaiveDate,
    pub counts: Counts,
    /// Open tasks that have come due, soonest deadline first.
    pub today_tasks: Vec<TaskDetail>,
    pub overdue_tasks: Vec<TaskDetail>,
    pub week: Vec<DayLoad>,
    pub completed_today: i64,
    pub completed_week: i64,
    pub completed_month: i64,
    pub created_week: i64,
    /// Consecutive days up to today with at least one completion.
    pub streak_days: i64,
    /// The best streak ever reached, so the number has something to beat.
    pub best_streak_days: i64,
    pub activity: Vec<DayCount>,
    pub projects: Vec<ProjectProgress>,
    pub occasions: Vec<OccasionDetail>,
    pub pinned_notes: Vec<NoteDetail>,
}

/// One cell of the calendar grid.
#[derive(Debug, Clone, Serialize)]
pub struct CalendarDay {
    pub date: NaiveDate,
    /// Tasks that start on this day or are due on it.
    pub tasks: Vec<TaskDetail>,
    pub occasions: Vec<Occasion>,
    /// How many of `tasks` are already finished.
    pub completed: i64,
}

impl Store {
    // -- dashboard -----------------------------------------------------------

    pub fn dashboard(&self, today: NaiveDate) -> Result<Dashboard> {
        let t = today.format("%Y-%m-%d").to_string();
        let settings = self.settings()?;

        let today_tasks = self.tasks_by_sql(
            "SELECT * FROM tasks
             WHERE status = 'open' AND parent_id IS NULL
               AND ((start_on IS NOT NULL AND start_on <= ?1)
                 OR (due_on IS NOT NULL AND due_on <= ?1))
             ORDER BY (due_on IS NULL), due_on, priority DESC, position
             LIMIT 50",
            &[&t],
        )?;

        let overdue_tasks = self.tasks_by_sql(
            "SELECT * FROM tasks
             WHERE status = 'open' AND parent_id IS NULL
               AND due_on IS NOT NULL AND due_on < ?1
             ORDER BY due_on, priority DESC
             LIMIT 50",
            &[&t],
        )?;

        // -- the coming week's load -----------------------------------------
        let mut week = Vec::with_capacity(7);
        for offset in 0..7 {
            let day = today + Duration::days(offset);
            let ds = day.format("%Y-%m-%d").to_string();
            let scheduled: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM tasks
                 WHERE status = 'open' AND parent_id IS NULL AND start_on = ?1",
                params![ds],
                |r| r.get(0),
            )?;
            let due: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM tasks
                 WHERE status = 'open' AND parent_id IS NULL AND due_on = ?1",
                params![ds],
                |r| r.get(0),
            )?;
            let occasions = self.occasions_on(day)?;
            week.push(DayLoad {
                date: day,
                scheduled,
                due,
                occasions: occasions as i64,
            });
        }

        // -- what has been finished -----------------------------------------
        // `completed_on` is the user's local calendar day, so these figures
        // agree with what the lists show even just after midnight.
        let completed_since = |from: NaiveDate| -> Result<i64> {
            Ok(self.conn.query_row(
                "SELECT COUNT(*) FROM tasks
                 WHERE status = 'completed' AND completed_on IS NOT NULL
                   AND completed_on >= ?1",
                params![from.format("%Y-%m-%d").to_string()],
                |r| r.get(0),
            )?)
        };
        let completed_today: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE status = 'completed' AND completed_on = ?1",
            params![t],
            |r| r.get(0),
        )?;
        let completed_week = completed_since(today - Duration::days(6))?;
        let completed_month = completed_since(today - Duration::days(29))?;
        let created_week: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE parent_id IS NULL AND substr(created_at, 1, 10) >= ?1",
            params![(today - Duration::days(6)).format("%Y-%m-%d").to_string()],
            |r| r.get(0),
        )?;

        // -- activity and streaks --------------------------------------------
        let activity_days: Vec<String> = {
            let mut stmt = self.conn.prepare(
                "SELECT DISTINCT completed_on AS day FROM tasks
                 WHERE status = 'completed' AND completed_on IS NOT NULL
                 ORDER BY day DESC",
            )?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let done_days: std::collections::HashSet<NaiveDate> = activity_days
            .iter()
            .filter_map(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
            .collect();

        let streak_days = current_streak(&done_days, today);
        let best_streak_days = best_streak(&done_days);

        let mut activity = Vec::with_capacity(28);
        for offset in (0..28).rev() {
            let day = today - Duration::days(offset);
            let count: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM tasks
                 WHERE status = 'completed' AND completed_on = ?1",
                params![day.format("%Y-%m-%d").to_string()],
                |r| r.get(0),
            )?;
            activity.push(DayCount { date: day, count });
        }

        // -- project progress -------------------------------------------------
        let projects: Vec<Project> = {
            let mut stmt = self
                .conn
                .prepare("SELECT * FROM projects WHERE status = 'open' ORDER BY position")?;
            let rows = stmt.query_map([], Project::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut progress = Vec::with_capacity(projects.len());
        for project in projects {
            let (total, done): (i64, i64) = self.conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(status != 'open'), 0) FROM tasks
                 WHERE project_id = ?1 AND parent_id IS NULL",
                params![project.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let next_due: Option<String> = self
                .conn
                .query_row(
                    "SELECT MIN(due_on) FROM tasks
                     WHERE project_id = ?1 AND status = 'open' AND due_on IS NOT NULL",
                    params![project.id],
                    |r| r.get(0),
                )
                .ok()
                .flatten();
            progress.push(ProjectProgress {
                project,
                total,
                done,
                ratio: if total == 0 { 0.0 } else { done as f64 / total as f64 },
                next_due: next_due.and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok()),
            });
        }
        // Nearly-finished projects first: those are the ones worth a last push.
        progress.sort_by(|a, b| {
            b.ratio
                .partial_cmp(&a.ratio)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        progress.truncate(8);

        // -- occasions coming up ---------------------------------------------
        let lead = settings.occasion_lead_days;
        let occasions: Vec<OccasionDetail> = self
            .list_occasions(today)?
            .into_iter()
            .filter(|o| o.days_until >= 0 && o.days_until <= lead)
            .take(6)
            .collect();

        let pinned_notes: Vec<NoteDetail> = self
            .list_notes(None)?
            .into_iter()
            .filter(|n| n.note.pinned)
            .take(6)
            .collect();

        Ok(Dashboard {
            today,
            counts: self.counts(today)?,
            today_tasks,
            overdue_tasks,
            week,
            completed_today,
            completed_week,
            completed_month,
            created_week,
            streak_days,
            best_streak_days,
            activity,
            projects: progress,
            occasions,
            pinned_notes,
        })
    }

    // -- calendar ------------------------------------------------------------

    /// Every day in `[from, to]`, with the tasks and occasions that land on it.
    ///
    /// The range comes from the UI because only the UI knows how big its grid
    /// is - six weeks for a month view, one row for a week view.
    pub fn calendar_range(
        &self,
        from: NaiveDate,
        to: NaiveDate,
        include_completed: bool,
    ) -> Result<Vec<CalendarDay>> {
        if to < from {
            return Ok(vec![]);
        }
        // A year of cells is far more than any view needs; refuse politely
        // rather than building a huge response.
        let span = (to - from).num_days();
        if span > 400 {
            return Err(crate::error::AppError::Validation(
                "kalendář umí zobrazit nejvýše rok najednou".into(),
            ));
        }

        let from_s = from.format("%Y-%m-%d").to_string();
        let to_s = to.format("%Y-%m-%d").to_string();

        let status_clause = if include_completed {
            ""
        } else {
            " AND status = 'open'"
        };
        let sql = format!(
            "SELECT * FROM tasks
             WHERE parent_id IS NULL{status_clause}
               AND ((start_on IS NOT NULL AND start_on BETWEEN ?1 AND ?2)
                 OR (due_on IS NOT NULL AND due_on BETWEEN ?1 AND ?2))
             ORDER BY (due_on IS NULL), due_on, priority DESC, position"
        );
        let tasks = self.tasks_by_sql(&sql, &[&from_s, &to_s])?;

        let occasions: Vec<Occasion> = {
            let mut stmt = self.conn.prepare("SELECT * FROM occasions")?;
            let rows = stmt.query_map([], Occasion::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };

        let mut days = Vec::with_capacity(span as usize + 1);
        let mut cursor = from;
        while cursor <= to {
            // A task belongs to a day if it starts there or is due there.
            let on_day: Vec<TaskDetail> = tasks
                .iter()
                .filter(|t| t.task.start_on == Some(cursor) || t.task.due_on == Some(cursor))
                .cloned()
                .collect();
            let completed = on_day
                .iter()
                .filter(|t| t.task.status != crate::models::TaskStatus::Open)
                .count() as i64;

            days.push(CalendarDay {
                date: cursor,
                occasions: occasions
                    .iter()
                    .filter(|o| falls_on(o, cursor))
                    .cloned()
                    .collect(),
                tasks: on_day,
                completed,
            });
            let Some(next) = cursor.succ_opt() else { break };
            cursor = next;
        }
        Ok(days)
    }

    fn occasions_on(&self, day: NaiveDate) -> Result<usize> {
        let occasions: Vec<Occasion> = {
            let mut stmt = self.conn.prepare("SELECT * FROM occasions")?;
            let rows = stmt.query_map([], Occasion::from_row)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        Ok(occasions.iter().filter(|o| falls_on(o, day)).count())
    }

    /// Runs a task query and hydrates the rows, so the calendar and dashboard
    /// return the same shape the lists do.
    fn tasks_by_sql(&self, sql: &str, args: &[&dyn rusqlite::ToSql]) -> Result<Vec<TaskDetail>> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map(args, Task::from_row)?;
        self.hydrate(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}

/// Whether a (possibly yearly) occasion lands on `day`.
fn falls_on(occasion: &Occasion, day: NaiveDate) -> bool {
    if occasion.yearly {
        // Match on month and day. 29 February shows on the 28th in a common
        // year, mirroring `planner::next_occurrence`.
        if occasion.on_date.month() == day.month() && occasion.on_date.day() == day.day() {
            return true;
        }
        let leap_day = occasion.on_date.month() == 2 && occasion.on_date.day() == 29;
        let is_feb_28 = day.month() == 2 && day.day() == 28;
        let common_year = NaiveDate::from_ymd_opt(day.year(), 2, 29).is_none();
        leap_day && is_feb_28 && common_year
    } else {
        occasion.on_date == day
    }
}

/// Consecutive days with at least one completion, ending today.
///
/// Today not being done yet must not break a streak, so a streak that ran up
/// to yesterday still counts - it is only broken once a whole day is missed.
fn current_streak(done_days: &std::collections::HashSet<NaiveDate>, today: NaiveDate) -> i64 {
    let start = if done_days.contains(&today) {
        today
    } else if done_days.contains(&(today - Duration::days(1))) {
        today - Duration::days(1)
    } else {
        return 0;
    };

    let mut streak = 0;
    let mut cursor = start;
    while done_days.contains(&cursor) {
        streak += 1;
        cursor -= Duration::days(1);
    }
    streak
}

fn best_streak(done_days: &std::collections::HashSet<NaiveDate>) -> i64 {
    let mut sorted: Vec<NaiveDate> = done_days.iter().copied().collect();
    sorted.sort_unstable();

    let mut best = 0;
    let mut run = 0;
    let mut previous: Option<NaiveDate> = None;
    for day in sorted {
        run = match previous {
            Some(p) if day == p + Duration::days(1) => run + 1,
            _ => 1,
        };
        best = best.max(run);
        previous = Some(day);
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn days(list: &[&str]) -> HashSet<NaiveDate> {
        list.iter().map(|s| d(s)).collect()
    }

    #[test]
    fn a_streak_counts_back_from_today() {
        let done = days(&["2026-09-07", "2026-09-06", "2026-09-05"]);
        assert_eq!(current_streak(&done, d("2026-09-07")), 3);
    }

    #[test]
    fn a_streak_survives_a_today_with_nothing_done_yet() {
        // It is early; you have not ticked anything off. Yesterday's streak
        // should still be showing, not zero.
        let done = days(&["2026-09-06", "2026-09-05"]);
        assert_eq!(current_streak(&done, d("2026-09-07")), 2);
    }

    #[test]
    fn a_streak_breaks_after_a_whole_missed_day() {
        let done = days(&["2026-09-05", "2026-09-04"]);
        assert_eq!(current_streak(&done, d("2026-09-07")), 0);
    }

    #[test]
    fn no_history_means_no_streak() {
        assert_eq!(current_streak(&HashSet::new(), d("2026-09-07")), 0);
    }

    #[test]
    fn the_best_streak_finds_the_longest_run_anywhere() {
        let done = days(&[
            "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", // run of 4
            "2026-02-01", "2026-02-02", // run of 2
        ]);
        assert_eq!(best_streak(&done), 4);
        assert_eq!(best_streak(&HashSet::new()), 0);
        assert_eq!(best_streak(&days(&["2026-05-05"])), 1);
    }

    #[test]
    fn a_yearly_occasion_falls_on_the_same_day_every_year() {
        let christmas = Occasion {
            id: "x".into(),
            name: "Vánoce".into(),
            kind: crate::planner::OccasionKind::Christmas,
            on_date: d("2020-12-24"),
            yearly: true,
            budget_minor: None,
            notes: String::new(),
            position: 0.0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        assert!(falls_on(&christmas, d("2026-12-24")));
        assert!(falls_on(&christmas, d("2030-12-24")));
        assert!(!falls_on(&christmas, d("2026-12-25")));
    }

    #[test]
    fn a_one_off_occasion_falls_only_on_its_own_date() {
        let wedding = Occasion {
            id: "x".into(),
            name: "Svatba".into(),
            kind: crate::planner::OccasionKind::Other,
            on_date: d("2026-06-13"),
            yearly: false,
            budget_minor: None,
            notes: String::new(),
            position: 0.0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        assert!(falls_on(&wedding, d("2026-06-13")));
        assert!(!falls_on(&wedding, d("2027-06-13")));
    }

    #[test]
    fn a_leap_day_occasion_shows_on_28_february_in_a_common_year() {
        let birthday = Occasion {
            id: "x".into(),
            name: "Narozeniny".into(),
            kind: crate::planner::OccasionKind::Birthday,
            on_date: d("2000-02-29"),
            yearly: true,
            budget_minor: None,
            notes: String::new(),
            position: 0.0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        assert!(falls_on(&birthday, d("2026-02-28")), "2026 is common");
        assert!(!falls_on(&birthday, d("2028-02-28")), "2028 has a real 29th");
        assert!(falls_on(&birthday, d("2028-02-29")));
    }
}
