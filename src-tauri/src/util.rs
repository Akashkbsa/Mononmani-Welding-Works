use chrono::{Datelike, Local, NaiveDate};

/// Round a rupee amount to paise.
pub fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// 2268000.5 -> "22,68,000.50" (Indian digit grouping).
pub fn indian_number(value: f64) -> String {
    let fixed = format!("{:.2}", value.abs());
    let (int_part, frac) = fixed.split_once('.').unwrap_or((&fixed, "00"));
    let digits: Vec<char> = int_part.chars().collect();
    let mut grouped = String::new();
    let len = digits.len();
    for (i, c) in digits.iter().enumerate() {
        let from_end = len - i;
        if i > 0 && (from_end == 3 || (from_end > 3 && (from_end - 3) % 2 == 0)) {
            grouped.push(',');
        }
        grouped.push(*c);
    }
    format!("{}{}.{}", if value < 0.0 { "-" } else { "" }, grouped, frac)
}

/// Amount for messages, e.g. "₹2,900.00".
pub fn rupees(value: f64) -> String {
    format!("₹{}", indian_number(value))
}

/// Parse a date given as YYYY-MM-DD or DD-MM-YYYY.
pub fn parse_date(value: &str) -> Option<NaiveDate> {
    let clean = value.trim();
    NaiveDate::parse_from_str(clean, "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(clean, "%d-%m-%Y"))
        .ok()
}

/// Validate a date and return it in the stored YYYY-MM-DD form.
pub fn normalize_date(value: &str, field: &str) -> Result<String, String> {
    parse_date(value)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .ok_or_else(|| format!("{} is not a valid date.", field))
}

/// Format a stored date as DD-MM-YYYY for printing. Unparseable text is returned as-is.
pub fn display_date(value: &str) -> String {
    parse_date(value)
        .map(|d| d.format("%d-%m-%Y").to_string())
        .unwrap_or_else(|| value.trim().to_string())
}

pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

pub fn is_past(date: &str) -> bool {
    parse_date(date).map(|d| today() > d).unwrap_or(false)
}

/// Indian financial year label for today, e.g. "26-27" (April to March).
pub fn financial_year_label() -> String {
    let now = today();
    let start = if now.month() >= 4 { now.year() } else { now.year() - 1 };
    format!("{:02}-{:02}", start % 100, (start + 1) % 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_both_date_formats() {
        assert_eq!(normalize_date("21-09-2024", "Date").unwrap(), "2024-09-21");
        assert_eq!(normalize_date("2024-09-21", "Date").unwrap(), "2024-09-21");
        assert!(normalize_date("31-02-2024", "Date").is_err());
        assert_eq!(display_date("2024-09-21"), "21-09-2024");
    }

    #[test]
    fn indian_grouping() {
        assert_eq!(indian_number(180.0), "180.00");
        assert_eq!(indian_number(21600.0), "21,600.00");
        assert_eq!(indian_number(2268000.5), "22,68,000.50");
        assert_eq!(indian_number(-1234.5), "-1,234.50");
    }
}
