//! The recurrence engine.
//!
//! This is the core transformation in Notes_MJ: given a rule and what has already
//! happened, produce the next date the task should appear on. Everything else
//! in the app is storage and presentation around this function.
//!
//! Two scheduling modes, because they behave very differently in practice:
//!
//! * [`Anchor::FixedSchedule`] - "the rent is due on the 1st". The series is
//!   pinned to `starts_on` and does not drift, no matter when you tick things
//!   off. Completing March late does not move April.
//! * [`Anchor::AfterCompletion`] - "water the plants every 3 days". The next
//!   date is measured from the day you actually finished, so a task you skip
//!   for a week does not immediately fire six times.
//!
//! Weekdays are ISO-numbered: 0 = Monday .. 6 = Sunday.
//!
//! Month arithmetic clamps rather than skips: a rule on day 31 lands on 28 or
//! 29 February and then returns to 31 in March. This matches what people mean
//! by "the last-ish day of the month" and is what Things 3 does.

use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

/// How often the series repeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// Which day inside a month (or a month of a year) the series lands on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MonthlyMode {
    /// `day` is 1..=31, or -1 meaning "the last day of the month".
    /// Days past the end of a short month clamp to that month's last day.
    DayOfMonth { day: i32 },
    /// `nth` is 1..=5, or -1 meaning "the last one".
    /// A month without an nth such weekday is skipped, so "5th Friday"
    /// genuinely means "only in months that have one".
    NthWeekday { nth: i32, weekday: u32 },
}

/// What the next date is measured from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Anchor {
    FixedSchedule,
    AfterCompletion,
}

/// When the series stops.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Ends {
    Never,
    OnDate { date: NaiveDate },
    AfterOccurrences { count: u32 },
}

impl Default for Ends {
    fn default() -> Self {
        Ends::Never
    }
}

/// A complete repeat rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecurrenceRule {
    pub freq: Freq,
    /// Every `interval` days / weeks / months / years. Always >= 1.
    pub interval: u32,
    /// Weekly only. Empty means "the same weekday as `starts_on`".
    #[serde(default)]
    pub weekdays: Vec<u32>,
    /// Monthly and yearly. `None` means "the same day-of-month as `starts_on`".
    #[serde(default)]
    pub monthly: Option<MonthlyMode>,
    /// Yearly only. `None` means "the same month as `starts_on`".
    #[serde(default)]
    pub month: Option<u32>,
    pub anchor: Anchor,
    pub starts_on: NaiveDate,
    #[serde(default)]
    pub ends: Ends,
}

/// What the series has done so far. Stored alongside the rule.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct RecurrenceState {
    /// How many occurrences have been generated (used by `Ends::AfterOccurrences`).
    #[serde(default)]
    pub occurrences_done: u32,
    /// The date the currently-open occurrence is scheduled for.
    #[serde(default)]
    pub last_scheduled: Option<NaiveDate>,
    /// The day the user last ticked an occurrence off.
    #[serde(default)]
    pub last_completed: Option<NaiveDate>,
}

// Guard against a pathological rule (say, "31st of February") spinning forever.
const MAX_MONTH_PROBES: u32 = 480; // 40 years of monthly probes

impl RecurrenceRule {
    /// A plain "every day" rule starting today. Handy default for the UI.
    pub fn daily(starts_on: NaiveDate) -> Self {
        RecurrenceRule {
            freq: Freq::Daily,
            interval: 1,
            weekdays: vec![],
            monthly: None,
            month: None,
            anchor: Anchor::FixedSchedule,
            starts_on,
            ends: Ends::Never,
        }
    }

    /// Rejects rules that cannot produce dates, before they reach the database.
    pub fn validate(&self) -> Result<()> {
        let bad = |m: &str| AppError::Validation(m.to_string());

        if self.interval < 1 {
            return Err(bad("interval opakování musí být alespoň 1"));
        }
        if self.interval > 1000 {
            return Err(bad("interval opakování může být nejvýše 1000"));
        }
        if self.weekdays.iter().any(|d| *d > 6) {
            return Err(bad("dny v týdnu musí být 0 (pondělí) až 6 (neděle)"));
        }
        if self.freq == Freq::Weekly && self.weekdays.len() > 7 {
            return Err(bad("týdenní pravidlo nemůže mít víc než 7 dnů"));
        }
        match self.monthly {
            Some(MonthlyMode::DayOfMonth { day }) if !(day == -1 || (1..=31).contains(&day)) => {
                return Err(bad("den v měsíci musí být 1-31, nebo -1 pro poslední den"));
            }
            Some(MonthlyMode::NthWeekday { nth, weekday }) => {
                if !(nth == -1 || (1..=5).contains(&nth)) {
                    return Err(bad("pořadí dne musí být 1-5, nebo -1 pro poslední"));
                }
                if weekday > 6 {
                    return Err(bad("dny v týdnu musí být 0 (pondělí) až 6 (neděle)"));
                }
            }
            _ => {}
        }
        if let Some(m) = self.month {
            if !(1..=12).contains(&m) {
                return Err(bad("měsíc musí být 1-12"));
            }
        }
        if let Ends::OnDate { date } = self.ends {
            if date < self.starts_on {
                return Err(bad("opakování nemůže skončit dřív, než začne"));
            }
        }
        if let Ends::AfterOccurrences { count } = self.ends {
            if count == 0 {
                return Err(bad("opakování, které skončí po 0 výskytech, by nikdy neproběhlo"));
            }
        }
        // A rule that can never produce a date is a user error, not a crash.
        if self.first_on_or_after(self.starts_on).is_none() {
            return Err(bad("tahle kombinace nikdy nenastane - zkuste jiné nastavení"));
        }
        Ok(())
    }

    /// The first date in the series on or after `from`, ignoring `ends`.
    ///
    /// This is the pure kernel: no state, no completion, just the calendar.
    pub fn first_on_or_after(&self, from: NaiveDate) -> Option<NaiveDate> {
        let from = from.max(self.starts_on);
        match self.freq {
            Freq::Daily => self.daily_on_or_after(from),
            Freq::Weekly => self.weekly_on_or_after(from),
            Freq::Monthly => self.monthly_on_or_after(from),
            Freq::Yearly => self.yearly_on_or_after(from),
        }
    }

    /// The first date in the series strictly after `after`.
    pub fn first_after(&self, after: NaiveDate) -> Option<NaiveDate> {
        self.first_on_or_after(after.succ_opt()?)
    }

    // -- per-frequency kernels ------------------------------------------------

    fn daily_on_or_after(&self, from: NaiveDate) -> Option<NaiveDate> {
        let step = self.interval as i64;
        let elapsed = (from - self.starts_on).num_days();
        // Round up to the next multiple of `step`.
        let steps = (elapsed + step - 1) / step;
        self.starts_on.checked_add_signed(Duration::days(steps * step))
    }

    fn weekly_on_or_after(&self, from: NaiveDate) -> Option<NaiveDate> {
        let mut days = self.effective_weekdays();
        days.sort_unstable();
        days.dedup();

        // Weeks are counted from the Monday of the week `starts_on` falls in,
        // so "every other Tuesday" keeps the same parity forever.
        let anchor = monday_of(self.starts_on);
        let from_monday = monday_of(from);
        let weeks_elapsed = (from_monday - anchor).num_days() / 7;
        let interval = self.interval as i64;

        // The current week if it is on-cycle, otherwise the next on-cycle week.
        let mut week_index = if weeks_elapsed % interval == 0 {
            weeks_elapsed
        } else {
            (weeks_elapsed / interval + 1) * interval
        };

        // Two probes are enough: this week (a listed weekday may already have
        // passed) and the following on-cycle week.
        for _ in 0..2 {
            let week_start = anchor.checked_add_signed(Duration::days(week_index * 7))?;
            let candidate = days
                .iter()
                .filter_map(|d| week_start.checked_add_signed(Duration::days(*d as i64)))
                .filter(|d| *d >= from && *d >= self.starts_on)
                .min();
            if let Some(c) = candidate {
                return Some(c);
            }
            week_index += interval;
        }
        None
    }

    fn monthly_on_or_after(&self, from: NaiveDate) -> Option<NaiveDate> {
        let mode = self
            .monthly
            .unwrap_or(MonthlyMode::DayOfMonth { day: self.starts_on.day() as i32 });

        let start_index = month_index(self.starts_on);
        let from_index = month_index(from);
        let interval = self.interval as i64;

        // Jump straight to roughly the right month instead of walking there,
        // then probe forward for the first month that actually contains the day.
        let elapsed = (from_index - start_index).max(0);
        let mut k = elapsed / interval;

        for _ in 0..MAX_MONTH_PROBES {
            let index = start_index + k * interval;
            let (year, month) = month_from_index(index);
            if let Some(date) = resolve_in_month(year, month, mode) {
                if date >= from && date >= self.starts_on {
                    return Some(date);
                }
            }
            k += 1;
        }
        None
    }

    fn yearly_on_or_after(&self, from: NaiveDate) -> Option<NaiveDate> {
        let month = self.month.unwrap_or(self.starts_on.month());
        let mode = self
            .monthly
            .unwrap_or(MonthlyMode::DayOfMonth { day: self.starts_on.day() as i32 });

        let interval = self.interval as i32;
        let elapsed = (from.year() - self.starts_on.year()).max(0);
        let mut k = elapsed / interval;

        // 8 probes covers a "29 February every 4 years" style rule comfortably.
        for _ in 0..(MAX_MONTH_PROBES / 8) {
            let year = self.starts_on.year() + k * interval;
            if let Some(date) = resolve_in_month(year, month, mode) {
                if date >= from && date >= self.starts_on {
                    return Some(date);
                }
            }
            k += 1;
        }
        None
    }

    fn effective_weekdays(&self) -> Vec<u32> {
        if self.weekdays.is_empty() {
            vec![self.starts_on.weekday().num_days_from_monday()]
        } else {
            self.weekdays.iter().copied().filter(|d| *d <= 6).collect()
        }
    }

    // -- stateful API used by the app ----------------------------------------

    /// The date the *next* occurrence should be scheduled for, or `None` when
    /// the series has run out.
    ///
    /// `today` matters only for after-completion rules that have never run.
    pub fn next_occurrence(&self, state: &RecurrenceState, today: NaiveDate) -> Option<NaiveDate> {
        if let Ends::AfterOccurrences { count } = self.ends {
            if state.occurrences_done >= count {
                return None;
            }
        }

        let candidate = match self.anchor {
            Anchor::FixedSchedule => match state.last_scheduled {
                Some(last) => self.first_after(last)?,
                None => self.first_on_or_after(self.starts_on)?,
            },
            Anchor::AfterCompletion => match state.last_completed {
                // Measured from the day the user actually finished, so the
                // series never fires a backlog of missed occurrences.
                Some(done) => self.add_interval(done.max(self.starts_on))?,
                None => match state.last_scheduled {
                    Some(last) => self.add_interval(last)?,
                    None => self.first_on_or_after(self.starts_on.max(today).min(self.starts_on))?,
                },
            },
        };

        if let Ends::OnDate { date } = self.ends {
            if candidate > date {
                return None;
            }
        }
        Some(candidate)
    }

    /// Advances the state by one occurrence. Returns the new state and the date
    /// that was produced, or `None` when the series is finished.
    pub fn advance(
        &self,
        state: &RecurrenceState,
        completed_on: NaiveDate,
    ) -> Option<(RecurrenceState, NaiveDate)> {
        let mut next_state = *state;
        next_state.occurrences_done = state.occurrences_done.saturating_add(1);
        next_state.last_completed = Some(completed_on);

        let next = self.next_occurrence(&next_state, completed_on)?;
        next_state.last_scheduled = Some(next);
        Some((next_state, next))
    }

    /// One step of `interval` units from `date`, used by after-completion rules.
    /// Weekly rules with several weekdays step to the next listed weekday
    /// instead, which is what "every Mon/Thu after I finish" should mean.
    fn add_interval(&self, date: NaiveDate) -> Option<NaiveDate> {
        match self.freq {
            Freq::Daily => date.checked_add_signed(Duration::days(self.interval as i64)),
            Freq::Weekly => {
                let days = self.effective_weekdays();
                if days.len() > 1 {
                    // Next listed weekday strictly after `date`, honouring the
                    // week interval only when we wrap into a new week.
                    let current = date.weekday().num_days_from_monday() as i64;
                    let mut sorted: Vec<i64> = days.iter().map(|d| *d as i64).collect();
                    sorted.sort_unstable();
                    if let Some(next) = sorted.iter().find(|d| **d > current) {
                        return date.checked_add_signed(Duration::days(next - current));
                    }
                    let first = sorted[0];
                    let jump = (7 * self.interval as i64) - current + first;
                    date.checked_add_signed(Duration::days(jump))
                } else {
                    date.checked_add_signed(Duration::days(7 * self.interval as i64))
                }
            }
            Freq::Monthly => {
                let mode = self
                    .monthly
                    .unwrap_or(MonthlyMode::DayOfMonth { day: date.day() as i32 });
                let index = month_index(date) + self.interval as i64;
                let (y, m) = month_from_index(index);
                resolve_in_month(y, m, mode)
            }
            Freq::Yearly => {
                let month = self.month.unwrap_or(date.month());
                let mode = self
                    .monthly
                    .unwrap_or(MonthlyMode::DayOfMonth { day: date.day() as i32 });
                resolve_in_month(date.year() + self.interval as i32, month, mode)
            }
        }
    }

    /// Every occurrence in `[from, to]`, capped at `limit`. Used to preview a
    /// rule in the editor and to fill the Upcoming view.
    pub fn occurrences_between(
        &self,
        from: NaiveDate,
        to: NaiveDate,
        limit: usize,
    ) -> Vec<NaiveDate> {
        let mut out = Vec::new();
        // After-completion rules have no fixed calendar, so preview them as if
        // each occurrence were completed on its own due date.
        let mut cursor = from;
        while out.len() < limit {
            let next = match self.anchor {
                Anchor::FixedSchedule => self.first_on_or_after(cursor),
                Anchor::AfterCompletion => match out.last() {
                    None => self.first_on_or_after(cursor.max(self.starts_on)),
                    Some(prev) => self.add_interval(*prev),
                },
            };
            let Some(next) = next else { break };
            if next > to {
                break;
            }
            if let Ends::OnDate { date } = self.ends {
                if next > date {
                    break;
                }
            }
            if let Ends::AfterOccurrences { count } = self.ends {
                if out.len() as u32 >= count {
                    break;
                }
            }
            out.push(next);
            let Some(after) = next.succ_opt() else { break };
            cursor = after;
        }
        out
    }

    /// A short human sentence for the rule, shown on the task row.
    pub fn describe(&self) -> String {
        const NAMES: [&str; 7] = ["po", "út", "st", "čt", "pá", "so", "ne"];
        let n = self.interval;

        // Czech counts three forms: 1 den / 2-4 dny / 5+ dní. All four units
        // here are masculine, so the quantifier agrees the same way each time.
        let every = |one: &str, few: &str, many: &str| match n {
            1 => format!("Každý {one}"),
            2..=4 => format!("Každé {n} {few}"),
            _ => format!("Každých {n} {many}"),
        };

        let base = match self.freq {
            Freq::Daily => every("den", "dny", "dní"),
            Freq::Weekly => {
                let mut days = self.effective_weekdays();
                days.sort_unstable();
                days.dedup();
                let labels: Vec<&str> = days
                    .iter()
                    .filter_map(|d| NAMES.get(*d as usize).copied())
                    .collect();
                if labels.len() == 7 {
                    every("den", "dny", "dní")
                } else {
                    format!(
                        "{} v {}",
                        every("týden", "týdny", "týdnů"),
                        labels.join(", ")
                    )
                }
            }
            Freq::Monthly => match self
                .monthly
                .unwrap_or(MonthlyMode::DayOfMonth { day: self.starts_on.day() as i32 })
            {
                MonthlyMode::DayOfMonth { day: -1 } => {
                    format!("{} poslední den", every("měsíc", "měsíce", "měsíců"))
                }
                MonthlyMode::DayOfMonth { day } => {
                    format!("{} {day}. den", every("měsíc", "měsíce", "měsíců"))
                }
                MonthlyMode::NthWeekday { nth, weekday } => {
                    let name = NAMES.get(weekday as usize).copied().unwrap_or("po");
                    let ord = ordinal(nth);
                    format!("{} {ord} {name}", every("měsíc", "měsíce", "měsíců"))
                }
            },
            Freq::Yearly => every("rok", "roky", "let"),
        };

        let anchored = match self.anchor {
            Anchor::FixedSchedule => base,
            Anchor::AfterCompletion => format!("{base}, od dokončení"),
        };

        match self.ends {
            Ends::Never => anchored,
            Ends::OnDate { date } => format!("{anchored}, do {}", cz_date(date)),
            Ends::AfterOccurrences { count } => format!("{anchored}, {count}×"),
        }
    }
}

fn ordinal(nth: i32) -> String {
    match nth {
        -1 => "poslední".into(),
        other => format!("{other}."),
    }
}

/// `2026-09-07` as `7. 9. 2026`, the way a date is written in Czech.
pub fn cz_date(date: NaiveDate) -> String {
    format!("{}. {}. {}", date.day(), date.month(), date.year())
}

fn monday_of(date: NaiveDate) -> NaiveDate {
    date - Duration::days(date.weekday().num_days_from_monday() as i64)
}

/// Months since year 0, so month arithmetic is plain integer arithmetic.
fn month_index(date: NaiveDate) -> i64 {
    date.year() as i64 * 12 + (date.month() as i64 - 1)
}

fn month_from_index(index: i64) -> (i32, u32) {
    let year = index.div_euclid(12) as i32;
    let month = index.rem_euclid(12) as u32 + 1;
    (year, month)
}

pub fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    match (
        NaiveDate::from_ymd_opt(next_year, next_month, 1),
        NaiveDate::from_ymd_opt(year, month, 1),
    ) {
        (Some(next), Some(this)) => (next - this).num_days() as u32,
        _ => 30,
    }
}

/// Turns a [`MonthlyMode`] into a concrete date inside `(year, month)`.
///
/// Day-of-month clamps to the end of short months. Nth-weekday returns `None`
/// when the month has no such weekday, so the caller skips that month.
fn resolve_in_month(year: i32, month: u32, mode: MonthlyMode) -> Option<NaiveDate> {
    if !(1..=12).contains(&month) {
        return None;
    }
    let last = days_in_month(year, month);
    match mode {
        MonthlyMode::DayOfMonth { day } => {
            let day = if day == -1 { last } else { (day.max(1) as u32).min(last) };
            NaiveDate::from_ymd_opt(year, month, day)
        }
        MonthlyMode::NthWeekday { nth, weekday } => {
            let target = weekday_from_iso(weekday)?;
            let first = NaiveDate::from_ymd_opt(year, month, 1)?;
            let offset = (7 + target.num_days_from_monday() as i64
                - first.weekday().num_days_from_monday() as i64)
                % 7;
            if nth == -1 {
                // Walk from the last matching day backwards.
                let mut day = 1 + offset;
                let mut best = None;
                while day <= last as i64 {
                    best = Some(day);
                    day += 7;
                }
                best.and_then(|d| NaiveDate::from_ymd_opt(year, month, d as u32))
            } else {
                let day = 1 + offset + (nth as i64 - 1) * 7;
                if day > last as i64 {
                    None // e.g. no 5th Friday this month
                } else {
                    NaiveDate::from_ymd_opt(year, month, day as u32)
                }
            }
        }
    }
}

fn weekday_from_iso(d: u32) -> Option<Weekday> {
    Some(match d {
        0 => Weekday::Mon,
        1 => Weekday::Tue,
        2 => Weekday::Wed,
        3 => Weekday::Thu,
        4 => Weekday::Fri,
        5 => Weekday::Sat,
        6 => Weekday::Sun,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn rule(freq: Freq, interval: u32, starts_on: &str) -> RecurrenceRule {
        RecurrenceRule {
            freq,
            interval,
            weekdays: vec![],
            monthly: None,
            month: None,
            anchor: Anchor::FixedSchedule,
            starts_on: d(starts_on),
            ends: Ends::Never,
        }
    }

    // -- daily ---------------------------------------------------------------

    #[test]
    fn daily_every_day() {
        let r = rule(Freq::Daily, 1, "2026-09-06");
        assert_eq!(r.first_on_or_after(d("2026-09-06")), Some(d("2026-09-06")));
        assert_eq!(r.first_after(d("2026-09-06")), Some(d("2026-09-07")));
        assert_eq!(r.first_after(d("2026-09-30")), Some(d("2026-10-01")));
    }

    #[test]
    fn daily_every_third_day_keeps_parity() {
        let r = rule(Freq::Daily, 3, "2026-01-01");
        assert_eq!(r.first_on_or_after(d("2026-01-01")), Some(d("2026-01-01")));
        assert_eq!(r.first_on_or_after(d("2026-01-02")), Some(d("2026-01-04")));
        assert_eq!(r.first_on_or_after(d("2026-01-04")), Some(d("2026-01-04")));
        assert_eq!(r.first_on_or_after(d("2026-01-05")), Some(d("2026-01-07")));
    }

    #[test]
    fn daily_before_start_returns_start() {
        let r = rule(Freq::Daily, 5, "2026-06-01");
        assert_eq!(r.first_on_or_after(d("2020-01-01")), Some(d("2026-06-01")));
    }

    #[test]
    fn daily_crosses_leap_day() {
        let r = rule(Freq::Daily, 1, "2028-02-28");
        assert_eq!(r.first_after(d("2028-02-28")), Some(d("2028-02-29")));
        assert_eq!(r.first_after(d("2028-02-29")), Some(d("2028-03-01")));
    }

    // -- weekly --------------------------------------------------------------

    #[test]
    fn weekly_defaults_to_start_weekday() {
        // 2026-09-06 is a Sunday.
        let r = rule(Freq::Weekly, 1, "2026-09-06");
        assert_eq!(d("2026-09-06").weekday(), Weekday::Sun);
        assert_eq!(r.first_after(d("2026-09-06")), Some(d("2026-09-13")));
    }

    #[test]
    fn weekly_multiple_weekdays() {
        // Mon(0), Wed(2), Fri(4) starting Monday 2026-09-07.
        let mut r = rule(Freq::Weekly, 1, "2026-09-07");
        r.weekdays = vec![0, 2, 4];
        assert_eq!(r.first_on_or_after(d("2026-09-07")), Some(d("2026-09-07")));
        assert_eq!(r.first_after(d("2026-09-07")), Some(d("2026-09-09")));
        assert_eq!(r.first_after(d("2026-09-09")), Some(d("2026-09-11")));
        // Wraps into the next week.
        assert_eq!(r.first_after(d("2026-09-11")), Some(d("2026-09-14")));
    }

    #[test]
    fn weekly_every_other_week_keeps_parity() {
        // Every 2 weeks on Tuesday, starting Tue 2026-09-08.
        let mut r = rule(Freq::Weekly, 2, "2026-09-08");
        r.weekdays = vec![1];
        assert_eq!(r.first_on_or_after(d("2026-09-08")), Some(d("2026-09-08")));
        assert_eq!(r.first_after(d("2026-09-08")), Some(d("2026-09-22")));
        assert_eq!(r.first_after(d("2026-09-22")), Some(d("2026-10-06")));
        // A date inside the skipped week jumps to the next on-cycle week.
        assert_eq!(r.first_on_or_after(d("2026-09-16")), Some(d("2026-09-22")));
    }

    #[test]
    fn weekly_every_other_week_with_two_days() {
        // Every 2 weeks on Mon and Thu, starting Mon 2026-09-07.
        let mut r = rule(Freq::Weekly, 2, "2026-09-07");
        r.weekdays = vec![0, 3];
        assert_eq!(r.first_on_or_after(d("2026-09-07")), Some(d("2026-09-07")));
        assert_eq!(r.first_after(d("2026-09-07")), Some(d("2026-09-10")));
        // Week of the 14th is off-cycle, so skip to the week of the 21st.
        assert_eq!(r.first_after(d("2026-09-10")), Some(d("2026-09-21")));
        assert_eq!(r.first_after(d("2026-09-21")), Some(d("2026-09-24")));
    }

    #[test]
    fn weekly_start_mid_week_does_not_emit_earlier_weekday() {
        // Starts Wednesday but the rule lists Monday: the Monday of the start
        // week is before `starts_on`, so the first hit is the following Monday.
        let mut r = rule(Freq::Weekly, 1, "2026-09-09");
        r.weekdays = vec![0];
        assert_eq!(d("2026-09-09").weekday(), Weekday::Wed);
        assert_eq!(r.first_on_or_after(d("2026-09-09")), Some(d("2026-09-14")));
    }

    #[test]
    fn weekly_weekdays_only_rule() {
        // The classic "every weekday" rule.
        let mut r = rule(Freq::Weekly, 1, "2026-09-07");
        r.weekdays = vec![0, 1, 2, 3, 4];
        let got = r.occurrences_between(d("2026-09-07"), d("2026-09-20"), 20);
        assert_eq!(
            got,
            vec![
                d("2026-09-07"), d("2026-09-08"), d("2026-09-09"), d("2026-09-10"), d("2026-09-11"),
                d("2026-09-14"), d("2026-09-15"), d("2026-09-16"), d("2026-09-17"), d("2026-09-18"),
            ]
        );
    }

    // -- monthly -------------------------------------------------------------

    #[test]
    fn monthly_defaults_to_start_day() {
        let r = rule(Freq::Monthly, 1, "2026-03-15");
        assert_eq!(r.first_after(d("2026-03-15")), Some(d("2026-04-15")));
        assert_eq!(r.first_after(d("2026-12-15")), Some(d("2027-01-15")));
    }

    #[test]
    fn monthly_day_31_clamps_to_short_months_then_recovers() {
        let mut r = rule(Freq::Monthly, 1, "2026-01-31");
        r.monthly = Some(MonthlyMode::DayOfMonth { day: 31 });
        assert_eq!(r.first_on_or_after(d("2026-01-31")), Some(d("2026-01-31")));
        // 2026 is not a leap year.
        assert_eq!(r.first_after(d("2026-01-31")), Some(d("2026-02-28")));
        assert_eq!(r.first_after(d("2026-02-28")), Some(d("2026-03-31")));
        assert_eq!(r.first_after(d("2026-03-31")), Some(d("2026-04-30")));
        assert_eq!(r.first_after(d("2026-04-30")), Some(d("2026-05-31")));
    }

    #[test]
    fn monthly_day_31_clamps_to_leap_february() {
        let mut r = rule(Freq::Monthly, 1, "2028-01-31");
        r.monthly = Some(MonthlyMode::DayOfMonth { day: 31 });
        assert_eq!(r.first_after(d("2028-01-31")), Some(d("2028-02-29")));
    }

    #[test]
    fn monthly_last_day_of_month() {
        let mut r = rule(Freq::Monthly, 1, "2026-01-31");
        r.monthly = Some(MonthlyMode::DayOfMonth { day: -1 });
        let got = r.occurrences_between(d("2026-01-01"), d("2026-06-30"), 12);
        assert_eq!(
            got,
            vec![
                d("2026-01-31"), d("2026-02-28"), d("2026-03-31"),
                d("2026-04-30"), d("2026-05-31"), d("2026-06-30"),
            ]
        );
    }

    #[test]
    fn monthly_every_second_month() {
        let mut r = rule(Freq::Monthly, 2, "2026-01-10");
        r.monthly = Some(MonthlyMode::DayOfMonth { day: 10 });
        let got = r.occurrences_between(d("2026-01-01"), d("2026-12-31"), 12);
        assert_eq!(
            got,
            vec![
                d("2026-01-10"), d("2026-03-10"), d("2026-05-10"),
                d("2026-07-10"), d("2026-09-10"), d("2026-11-10"),
            ]
        );
    }

    #[test]
    fn monthly_third_monday() {
        let mut r = rule(Freq::Monthly, 1, "2026-01-01");
        r.monthly = Some(MonthlyMode::NthWeekday { nth: 3, weekday: 0 });
        let got = r.occurrences_between(d("2026-01-01"), d("2026-04-30"), 6);
        assert_eq!(
            got,
            vec![d("2026-01-19"), d("2026-02-16"), d("2026-03-16"), d("2026-04-20")]
        );
        for date in got {
            assert_eq!(date.weekday(), Weekday::Mon);
            assert!((15..=21).contains(&date.day()), "3rd Monday must fall in 15..21");
        }
    }

    #[test]
    fn monthly_last_friday() {
        let mut r = rule(Freq::Monthly, 1, "2026-01-01");
        r.monthly = Some(MonthlyMode::NthWeekday { nth: -1, weekday: 4 });
        let got = r.occurrences_between(d("2026-01-01"), d("2026-04-30"), 6);
        assert_eq!(
            got,
            vec![d("2026-01-30"), d("2026-02-27"), d("2026-03-27"), d("2026-04-24")]
        );
        for date in got {
            assert_eq!(date.weekday(), Weekday::Fri);
            // Nothing later in the month can be a Friday.
            assert!(date.day() + 7 > days_in_month(date.year(), date.month()));
        }
    }

    #[test]
    fn monthly_fifth_friday_skips_months_without_one() {
        let mut r = rule(Freq::Monthly, 1, "2026-01-01");
        r.monthly = Some(MonthlyMode::NthWeekday { nth: 5, weekday: 4 });
        let got = r.occurrences_between(d("2026-01-01"), d("2026-12-31"), 12);
        // Only months with five Fridays qualify.
        assert_eq!(
            got,
            vec![d("2026-01-30"), d("2026-05-29"), d("2026-07-31"), d("2026-10-30")]
        );
    }

    #[test]
    fn monthly_first_day_of_month_rent() {
        let mut r = rule(Freq::Monthly, 1, "2026-09-01");
        r.monthly = Some(MonthlyMode::DayOfMonth { day: 1 });
        assert_eq!(r.first_after(d("2026-09-01")), Some(d("2026-10-01")));
        assert_eq!(r.first_after(d("2026-12-01")), Some(d("2027-01-01")));
    }

    // -- yearly --------------------------------------------------------------

    #[test]
    fn yearly_defaults_to_start_month_and_day() {
        let r = rule(Freq::Yearly, 1, "2026-05-04");
        assert_eq!(r.first_after(d("2026-05-04")), Some(d("2027-05-04")));
        assert_eq!(r.first_after(d("2027-05-04")), Some(d("2028-05-04")));
    }

    #[test]
    fn yearly_leap_day_clamps_in_common_years() {
        let r = rule(Freq::Yearly, 1, "2028-02-29");
        assert_eq!(r.first_after(d("2028-02-29")), Some(d("2029-02-28")));
        assert_eq!(r.first_after(d("2029-02-28")), Some(d("2030-02-28")));
        // Recovers on the next leap year.
        assert_eq!(r.first_on_or_after(d("2032-02-01")), Some(d("2032-02-29")));
    }

    #[test]
    fn yearly_every_four_years() {
        let r = rule(Freq::Yearly, 4, "2026-06-01");
        let got = r.occurrences_between(d("2026-01-01"), d("2040-01-01"), 5);
        assert_eq!(got, vec![d("2026-06-01"), d("2030-06-01"), d("2034-06-01"), d("2038-06-01")]);
    }

    // -- ends ----------------------------------------------------------------

    #[test]
    fn ends_after_n_occurrences() {
        let mut r = rule(Freq::Daily, 1, "2026-09-06");
        r.ends = Ends::AfterOccurrences { count: 3 };
        let mut state = RecurrenceState {
            occurrences_done: 0,
            last_scheduled: Some(d("2026-09-06")),
            last_completed: None,
        };
        let mut produced = vec![d("2026-09-06")];
        for _ in 0..5 {
            match r.advance(&state, state.last_scheduled.unwrap()) {
                Some((next_state, date)) => {
                    produced.push(date);
                    state = next_state;
                }
                None => break,
            }
        }
        assert_eq!(produced, vec![d("2026-09-06"), d("2026-09-07"), d("2026-09-08")]);
    }

    #[test]
    fn ends_on_date() {
        let mut r = rule(Freq::Weekly, 1, "2026-09-07");
        r.weekdays = vec![0];
        r.ends = Ends::OnDate { date: d("2026-09-21") };
        let got = r.occurrences_between(d("2026-09-01"), d("2026-12-31"), 20);
        assert_eq!(got, vec![d("2026-09-07"), d("2026-09-14"), d("2026-09-21")]);

        let state = RecurrenceState {
            occurrences_done: 3,
            last_scheduled: Some(d("2026-09-21")),
            last_completed: None,
        };
        assert_eq!(r.next_occurrence(&state, d("2026-09-21")), None);
    }

    // -- anchoring -----------------------------------------------------------

    #[test]
    fn fixed_schedule_does_not_drift_when_completed_late() {
        // Rent on the 1st. The user pays March on the 9th; April is still the 1st.
        let mut r = rule(Freq::Monthly, 1, "2026-03-01");
        r.monthly = Some(MonthlyMode::DayOfMonth { day: 1 });
        let state = RecurrenceState {
            occurrences_done: 1,
            last_scheduled: Some(d("2026-03-01")),
            last_completed: None,
        };
        let (_, next) = r.advance(&state, d("2026-03-09")).unwrap();
        assert_eq!(next, d("2026-04-01"));
    }

    #[test]
    fn after_completion_measures_from_the_completion_day() {
        // Water the plants every 3 days. Completed 5 days late -> 3 days later.
        let mut r = rule(Freq::Daily, 3, "2026-03-01");
        r.anchor = Anchor::AfterCompletion;
        let state = RecurrenceState {
            occurrences_done: 1,
            last_scheduled: Some(d("2026-03-01")),
            last_completed: None,
        };
        let (_, next) = r.advance(&state, d("2026-03-06")).unwrap();
        assert_eq!(next, d("2026-03-09"));
    }

    #[test]
    fn after_completion_never_produces_a_backlog() {
        // A daily after-completion chore ignored for a month yields exactly one
        // next date, not thirty.
        let mut r = rule(Freq::Daily, 1, "2026-01-01");
        r.anchor = Anchor::AfterCompletion;
        let state = RecurrenceState {
            occurrences_done: 1,
            last_scheduled: Some(d("2026-01-01")),
            last_completed: None,
        };
        let (next_state, next) = r.advance(&state, d("2026-02-01")).unwrap();
        assert_eq!(next, d("2026-02-02"));
        assert_eq!(next_state.occurrences_done, 2);
    }

    #[test]
    fn after_completion_weekly_multi_day_steps_to_next_listed_day() {
        // Gym on Mon/Thu, after completion. Finished Monday -> Thursday.
        let mut r = rule(Freq::Weekly, 1, "2026-09-07");
        r.weekdays = vec![0, 3];
        r.anchor = Anchor::AfterCompletion;
        let state = RecurrenceState {
            occurrences_done: 1,
            last_scheduled: Some(d("2026-09-07")),
            last_completed: None,
        };
        let (state2, next) = r.advance(&state, d("2026-09-07")).unwrap();
        assert_eq!(next, d("2026-09-10"));
        // Finished Thursday -> the following Monday.
        let (_, next2) = r.advance(&state2, d("2026-09-10")).unwrap();
        assert_eq!(next2, d("2026-09-14"));
    }

    #[test]
    fn after_completion_monthly_steps_a_month_from_completion() {
        let mut r = rule(Freq::Monthly, 1, "2026-01-15");
        r.anchor = Anchor::AfterCompletion;
        let state = RecurrenceState {
            occurrences_done: 1,
            last_scheduled: Some(d("2026-01-15")),
            last_completed: None,
        };
        let (_, next) = r.advance(&state, d("2026-01-31")).unwrap();
        assert_eq!(next, d("2026-02-28"), "clamps into February");
    }

    // -- validation ----------------------------------------------------------

    #[test]
    fn validation_rejects_impossible_rules() {
        let mut r = rule(Freq::Daily, 0, "2026-01-01");
        assert!(r.validate().is_err(), "interval 0");

        r = rule(Freq::Weekly, 1, "2026-01-01");
        r.weekdays = vec![9];
        assert!(r.validate().is_err(), "weekday 9");

        r = rule(Freq::Monthly, 1, "2026-01-01");
        r.monthly = Some(MonthlyMode::DayOfMonth { day: 40 });
        assert!(r.validate().is_err(), "day 40");

        r = rule(Freq::Monthly, 1, "2026-01-01");
        r.monthly = Some(MonthlyMode::NthWeekday { nth: 6, weekday: 0 });
        assert!(r.validate().is_err(), "6th weekday");

        r = rule(Freq::Daily, 1, "2026-01-01");
        r.ends = Ends::OnDate { date: d("2025-01-01") };
        assert!(r.validate().is_err(), "ends before it starts");

        r = rule(Freq::Daily, 1, "2026-01-01");
        r.ends = Ends::AfterOccurrences { count: 0 };
        assert!(r.validate().is_err(), "zero occurrences");
    }

    #[test]
    fn validation_accepts_reasonable_rules() {
        let mut r = rule(Freq::Weekly, 2, "2026-09-07");
        r.weekdays = vec![0, 4];
        r.ends = Ends::AfterOccurrences { count: 10 };
        assert!(r.validate().is_ok());

        let mut m = rule(Freq::Monthly, 3, "2026-09-07");
        m.monthly = Some(MonthlyMode::NthWeekday { nth: -1, weekday: 4 });
        assert!(m.validate().is_ok());

        let mut y = rule(Freq::Yearly, 1, "2028-02-29");
        y.month = Some(2);
        y.monthly = Some(MonthlyMode::DayOfMonth { day: 29 });
        assert!(y.validate().is_ok());
    }

    // -- helpers -------------------------------------------------------------

    #[test]
    fn days_in_month_is_right_including_leap_years() {
        assert_eq!(days_in_month(2026, 1), 31);
        assert_eq!(days_in_month(2026, 2), 28);
        assert_eq!(days_in_month(2028, 2), 29);
        assert_eq!(days_in_month(2000, 2), 29, "divisible by 400");
        assert_eq!(days_in_month(1900, 2), 28, "divisible by 100 but not 400");
        assert_eq!(days_in_month(2026, 4), 30);
        assert_eq!(days_in_month(2026, 12), 31);
    }

    #[test]
    fn occurrences_between_respects_limit() {
        let r = rule(Freq::Daily, 1, "2026-01-01");
        assert_eq!(r.occurrences_between(d("2026-01-01"), d("2030-01-01"), 5).len(), 5);
    }

    #[test]
    fn occurrences_between_is_empty_before_the_series_starts() {
        let r = rule(Freq::Daily, 1, "2027-01-01");
        assert!(r.occurrences_between(d("2026-01-01"), d("2026-12-31"), 10).is_empty());
    }

    #[test]
    fn describe_reads_like_a_sentence() {
        let mut r = rule(Freq::Weekly, 2, "2026-09-07");
        r.weekdays = vec![0, 4];
        assert_eq!(r.describe(), "Každé 2 týdny v po, pá");

        let mut m = rule(Freq::Monthly, 1, "2026-09-07");
        m.monthly = Some(MonthlyMode::NthWeekday { nth: -1, weekday: 4 });
        assert_eq!(m.describe(), "Každý měsíc poslední pá");

        let mut a = rule(Freq::Daily, 3, "2026-09-07");
        a.anchor = Anchor::AfterCompletion;
        a.ends = Ends::AfterOccurrences { count: 5 };
        assert_eq!(a.describe(), "Každé 3 dny, od dokončení, 5×");
    }

    #[test]
    fn json_round_trip_preserves_the_rule() {
        let mut r = rule(Freq::Monthly, 2, "2026-09-07");
        r.monthly = Some(MonthlyMode::NthWeekday { nth: 3, weekday: 2 });
        r.ends = Ends::OnDate { date: d("2027-09-07") };
        let json = serde_json::to_string(&r).unwrap();
        let back: RecurrenceRule = serde_json::from_str(&json).unwrap();
        assert_eq!(r, back);
    }
}
