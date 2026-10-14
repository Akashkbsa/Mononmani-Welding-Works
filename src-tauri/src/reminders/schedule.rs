//! Date rules for reminders: the next date of a repeating reminder and whether a reminder is waiting,
//! coming up, due today or overdue. No database here.

use chrono::{Datelike, Duration, NaiveDate};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Repeat {
    None,
    Weekly,
    Monthly,
    Yearly,
}

impl Repeat {
    pub fn parse(text: &str) -> Result<Repeat, String> {
        match text.trim().to_ascii_uppercase().as_str() {
            "NONE" | "" => Ok(Repeat::None),
            "WEEKLY" => Ok(Repeat::Weekly),
            "MONTHLY" => Ok(Repeat::Monthly),
            "YEARLY" => Ok(Repeat::Yearly),
            _ => Err("Choose how often it repeats.".to_string()),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Repeat::None => "NONE",
            Repeat::Weekly => "WEEKLY",
            Repeat::Monthly => "MONTHLY",
            Repeat::Yearly => "YEARLY",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// Not yet inside its "remind me" window.
    Waiting,
    ComingUp,
    DueToday,
    Overdue,
}

impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            State::Waiting => "WAITING",
            State::ComingUp => "COMING_UP",
            State::DueToday => "DUE_TODAY",
            State::Overdue => "OVERDUE",
        }
    }
}

fn last_day(year: i32, month: u32) -> u32 {
    let (y, m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    NaiveDate::from_ymd_opt(y, m, 1).and_then(|d| d.pred_opt()).map(|d| d.day()).unwrap_or(28)
}

/// The given day of a month, or the month's last day when the month is shorter.
fn day_in(year: i32, month: u32, day: u32, month_end: bool) -> Option<NaiveDate> {
    let last = last_day(year, month);
    NaiveDate::from_ymd_opt(year, month, if month_end { last } else { day.min(last) })
}

/// The date after `current` for a repeating reminder. `repeat_day` is the day of the month it was set
/// for (so a reminder on the 31st returns to the 31st after a short month); `month_end` means the last
/// day of every month.
pub fn next_date(current: NaiveDate, repeat: Repeat, repeat_day: u32, month_end: bool) -> Option<NaiveDate> {
    match repeat {
        Repeat::None => None,
        Repeat::Weekly => Some(current + Duration::days(7)),
        Repeat::Monthly => {
            let (y, m) = if current.month() == 12 { (current.year() + 1, 1) } else { (current.year(), current.month() + 1) };
            day_in(y, m, repeat_day, month_end)
        }
        Repeat::Yearly => day_in(current.year() + 1, current.month(), repeat_day, false),
    }
}

/// Where a reminder dated `due` that starts `remind_days` before stands on `today`.
pub fn state(due: NaiveDate, remind_days: i64, today: NaiveDate) -> State {
    if today > due {
        State::Overdue
    } else if today == due {
        State::DueToday
    } else if today >= due - Duration::days(remind_days) {
        State::ComingUp
    } else {
        State::Waiting
    }
}

/// Days from `today` to `due`; negative when the date has passed.
pub fn days_away(due: NaiveDate, today: NaiveDate) -> i64 {
    (due - today).num_days()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn steps(start: &str, repeat: Repeat, day: u32, month_end: bool, n: usize) -> Vec<String> {
        let mut out = Vec::new();
        let mut cur = d(start);
        for _ in 0..n {
            cur = next_date(cur, repeat, day, month_end).unwrap();
            out.push(cur.format("%Y-%m-%d").to_string());
        }
        out
    }

    #[test]
    fn monthly_keeps_its_day_and_caps_short_months() {
        assert_eq!(steps("2027-01-31", Repeat::Monthly, 31, false, 3), vec!["2027-02-28", "2027-03-31", "2027-04-30"]);
        assert_eq!(steps("2028-01-31", Repeat::Monthly, 31, false, 1), vec!["2028-02-29"]);
        assert_eq!(steps("2026-10-06", Repeat::Monthly, 6, false, 3), vec!["2026-11-06", "2026-12-06", "2027-01-06"]);
    }

    #[test]
    fn last_day_of_month_always_lands_on_the_last_day() {
        assert_eq!(steps("2026-04-30", Repeat::Monthly, 31, true, 3), vec!["2026-05-31", "2026-06-30", "2026-07-31"]);
        assert_eq!(steps("2026-12-31", Repeat::Monthly, 31, true, 2), vec!["2027-01-31", "2027-02-28"]);
    }

    #[test]
    fn weekly_and_yearly() {
        assert_eq!(steps("2026-10-28", Repeat::Weekly, 28, false, 1), vec!["2026-11-04"]);
        assert_eq!(steps("2028-02-29", Repeat::Yearly, 29, false, 4), vec!["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
        assert_eq!(steps("2026-04-06", Repeat::Yearly, 6, false, 1), vec!["2027-04-06"]);
    }

    #[test]
    fn no_repeat_has_no_next_date() {
        assert_eq!(next_date(d("2026-10-31"), Repeat::None, 31, false), None);
    }

    #[test]
    fn states_follow_the_table() {
        let due = d("2026-11-10");
        assert_eq!(state(due, 2, d("2026-11-07")), State::Waiting);
        assert_eq!(state(due, 2, d("2026-11-08")), State::ComingUp);
        assert_eq!(state(due, 2, d("2026-11-09")), State::ComingUp);
        assert_eq!(state(due, 2, d("2026-11-10")), State::DueToday);
        assert_eq!(state(due, 2, d("2026-11-11")), State::Overdue);
        assert_eq!(state(due, 0, d("2026-11-09")), State::Waiting);
        assert_eq!(state(due, 7, d("2026-11-08")), State::ComingUp, "a long warning on a near date shows at once");
        assert_eq!(State::Overdue.as_str(), "OVERDUE");
        assert_eq!(State::ComingUp.as_str(), "COMING_UP");
        assert_eq!(days_away(due, d("2026-11-08")), 2);
        assert_eq!(days_away(due, d("2026-11-13")), -3);
    }

    #[test]
    fn repeat_parse() {
        assert_eq!(Repeat::parse("monthly").unwrap(), Repeat::Monthly);
        assert_eq!(Repeat::parse(" NONE ").unwrap(), Repeat::None);
        assert_eq!(Repeat::Yearly.as_str(), "YEARLY");
        assert_eq!(Repeat::parse("DAILY").unwrap_err(), "Choose how often it repeats.");
    }
}
