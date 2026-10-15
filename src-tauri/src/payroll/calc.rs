//! Pay maths and month rules. No SQL.

use super::models::{MonthFigures, PayRow};
use crate::rentals::reminder::month_label;
use crate::util::round2;
use chrono::NaiveDate;

/// A month must be `YYYY-MM` with a real month number.
pub fn check_month(month: &str) -> Result<(), String> {
    month_label(month).map(|_| ())
}

fn year_and_month(month: &str) -> Result<(i32, u32), String> {
    check_month(month)?;
    Ok((month[..4].parse().unwrap_or(0), month[5..].parse().unwrap_or(1)))
}

/// "2026-12" -> "2027-01".
pub fn next_month(month: &str) -> Result<String, String> {
    let (y, m) = year_and_month(month)?;
    Ok(if m == 12 { format!("{:04}-01", y + 1) } else { format!("{:04}-{:02}", y, m + 1) })
}

pub fn days_in_month(month: &str) -> Result<u32, String> {
    let (y, m) = year_and_month(month)?;
    let first = NaiveDate::from_ymd_opt(y, m, 1).ok_or_else(|| "Month must look like 2026-11.".to_string())?;
    let next = if m == 12 { NaiveDate::from_ymd_opt(y + 1, 1, 1) } else { NaiveDate::from_ymd_opt(y, m + 1, 1) };
    Ok(next.map(|n| (n - first).num_days() as u32).unwrap_or(31))
}

/// Days the employee was employed in the month: from the joining day when it falls inside the
/// month (otherwise day 1, also for a month before joining kept by records) to the leaving day when
/// it falls inside the month (otherwise the month's end).
pub fn employed_days(month: &str, joined_on: &str, left_on: Option<&str>) -> Result<u32, String> {
    let last = days_in_month(month)?;
    let day_in = |date: &str| -> Option<u32> {
        if date.get(..7) == Some(month) {
            date.get(8..10).and_then(|d| d.parse().ok())
        } else {
            None
        }
    };
    let start = day_in(joined_on).unwrap_or(1);
    let end = left_on.and_then(day_in).unwrap_or(last);
    Ok(if end >= start { end - start + 1 } else { 0 })
}

/// From the joining month to the leaving month (no end while working), never past `current_month`.
pub fn in_window(month: &str, joined_on: &str, left_on: Option<&str>, current_month: &str) -> bool {
    let joined = joined_on.get(..7).unwrap_or(joined_on);
    let left_ok = left_on.and_then(|d| d.get(..7)).map_or(true, |left| month <= left);
    joined <= month && left_ok && month <= current_month
}

pub fn check_days(days: f64, max_days: u32) -> Result<f64, String> {
    if !days.is_finite() || days < 0.0 || days > max_days as f64 {
        return Err(format!("Days must be between 0 and {}.", max_days));
    }
    if ((days * 2.0).round() - days * 2.0).abs() > 1e-9 {
        return Err("Days must be in steps of half a day.".to_string());
    }
    Ok(round2(days))
}

pub fn check_ot_hours(hours: f64, month_days: u32) -> Result<f64, String> {
    let cap = 24 * month_days;
    if !hours.is_finite() || hours < 0.0 || hours > cap as f64 {
        return Err(format!("OT hours must be between 0 and {}.", cap));
    }
    if ((hours * 100.0).round() - hours * 100.0).abs() > 1e-6 {
        return Err("OT hours can have at most two decimals.".to_string());
    }
    Ok(round2(hours))
}

/// Each line is rounded to the paisa before adding, and the totals are rounded again so float
/// dust never leaves a settled month a fraction of a paisa open.
pub fn figures(row: Option<&PayRow>, given: f64, cleared: f64, rounded_off: f64) -> MonthFigures {
    let (wages, ot_amount, bonus) = match row {
        Some(r) => (round2(r.days_worked * r.daily_wage), round2(r.ot_hours * r.ot_rate), round2(r.bonus_amount)),
        None => (0.0, 0.0, 0.0),
    };
    let earned = round2(wages + ot_amount + bonus);
    let (given, cleared, rounded_off) = (round2(given), round2(cleared), round2(rounded_off));
    let balance = round2(earned - given + cleared - rounded_off);
    // -0.0 shows as "-0.00"; keep a plain zero.
    let balance = if balance == 0.0 { 0.0 } else { balance };
    MonthFigures { wages, ot_amount, bonus, earned, given, cleared, rounded_off, balance }
}

pub fn status(has_row: bool, balance: f64) -> &'static str {
    let balance = round2(balance);
    if !has_row {
        "NOT_ENTERED"
    } else if balance > 0.0 {
        "TO_PAY"
    } else if balance < 0.0 {
        "OVERPAID"
    } else {
        "PAID"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(days: f64, wage: f64, hours: f64, rate: f64, bonus: f64) -> PayRow {
        PayRow { id: 1, employee_id: 1, month: "2026-10".into(), days_worked: days, daily_wage: wage, ot_hours: hours, ot_rate: rate, bonus_amount: bonus, bonus_note: None, note: None }
    }

    #[test]
    fn months_are_checked_and_stepped() {
        assert!(check_month("2026-10").is_ok());
        for bad in ["2026-13", "2026-1", "", "2026-00", "26-10", "2026/10"] {
            assert_eq!(check_month(bad).unwrap_err(), "Month must look like 2026-11.", "{}", bad);
        }
        assert_eq!(next_month("2026-12").unwrap(), "2027-01");
        assert_eq!(next_month("2026-10").unwrap(), "2026-11");
        assert_eq!(days_in_month("2026-02").unwrap(), 28);
        assert_eq!(days_in_month("2028-02").unwrap(), 29);
        assert_eq!(days_in_month("2026-04").unwrap(), 30);
        assert_eq!(days_in_month("2026-10").unwrap(), 31);
    }

    #[test]
    fn employed_days_follow_joining_and_leaving_inside_the_month() {
        assert_eq!(employed_days("2026-10", "2026-10-20", None).unwrap(), 12);
        assert_eq!(employed_days("2026-10", "2026-01-01", Some("2026-10-10")).unwrap(), 10);
        assert_eq!(employed_days("2026-10", "2026-10-05", Some("2026-10-05")).unwrap(), 1);
        assert_eq!(employed_days("2026-10", "2026-12-01", None).unwrap(), 31, "a month before the joining date kept by records");
        assert_eq!(employed_days("2026-10", "2025-06-01", None).unwrap(), 31);
    }

    #[test]
    fn the_window_runs_from_joining_to_leaving_and_never_past_this_month() {
        assert!(in_window("2026-10", "2026-10-20", None, "2026-11"));
        assert!(!in_window("2026-09", "2026-10-20", None, "2026-11"));
        assert!(!in_window("2026-12", "2026-10-20", None, "2026-11"));
        assert!(in_window("2026-10", "2026-01-01", Some("2026-10-10"), "2026-12"));
        assert!(!in_window("2026-11", "2026-01-01", Some("2026-10-10"), "2026-12"));
    }

    #[test]
    fn days_take_half_steps_up_to_the_limit() {
        assert_eq!(check_days(25.5, 31).unwrap(), 25.5);
        assert_eq!(check_days(0.0, 31).unwrap(), 0.0);
        assert_eq!(check_days(31.0, 31).unwrap(), 31.0);
        for bad in [31.5, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(check_days(bad, 31).unwrap_err(), "Days must be between 0 and 31.");
        }
        assert_eq!(check_days(25.25, 31).unwrap_err(), "Days must be in steps of half a day.");
    }

    #[test]
    fn ot_hours_allow_two_decimals_up_to_a_full_day_each_day() {
        assert_eq!(check_ot_hours(1.75, 31).unwrap(), 1.75);
        assert_eq!(check_ot_hours(744.0, 31).unwrap(), 744.0);
        for bad in [744.5, -0.5, f64::NAN] {
            assert_eq!(check_ot_hours(bad, 31).unwrap_err(), "OT hours must be between 0 and 744.");
        }
        assert_eq!(check_ot_hours(1.255, 31).unwrap_err(), "OT hours can have at most two decimals.");
    }

    #[test]
    fn figures_round_each_line_then_add() {
        let f = figures(Some(&row(25.5, 600.0, 12.0, 80.0, 500.0)), 3000.0, 0.0, 0.0);
        assert_eq!((f.wages, f.ot_amount, f.bonus, f.earned, f.given, f.balance), (15300.0, 960.0, 500.0, 16760.0, 3000.0, 13760.0));
        let f = figures(Some(&row(3.0, 433.33, 1.75, 66.67, 0.0)), 0.0, 0.0, 0.0);
        assert_eq!((f.wages, f.ot_amount, f.earned), (1299.99, 116.67, 1416.66));
        let f = figures(None, 500.0, 0.0, 0.0);
        assert_eq!((f.earned, f.balance), (0.0, -500.0));
        let f = figures(Some(&row(10.0, 400.0, 0.0, 0.0, 0.0)), 5000.0, 600.0, 0.0);
        assert_eq!(f.balance, -400.0, "cash returned or written off counts back towards zero");
        let f = figures(Some(&row(10.0, 400.0, 0.0, 0.0, 0.0)), 3990.0, 0.0, 10.0);
        assert_eq!(f.balance, 0.0, "a round-off finishes the month");
    }

    #[test]
    fn status_ignores_float_dust() {
        let f = figures(Some(&row(1.0, 0.3, 0.0, 0.0, 0.0)), 0.1 + 0.2, 0.0, 0.0);
        assert_eq!(f.balance, 0.0);
        assert_eq!(status(true, f.balance), "PAID");
        assert_eq!(status(true, 10.0), "TO_PAY");
        assert_eq!(status(true, -40.0), "OVERPAID");
        assert_eq!(status(false, -500.0), "NOT_ENTERED");
    }
}
