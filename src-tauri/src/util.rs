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

/// Indian financial year label for today, e.g. "26-27" (April to March).
pub fn financial_year_label() -> String {
    let now = today();
    let start = if now.month() >= 4 { now.year() } else { now.year() - 1 };
    format!("{:02}-{:02}", start % 100, (start + 1) % 100)
}

/// Two amounts closer than this (half a paisa) are the same amount.
pub const MONEY_EPS: f64 = 0.005;

/// Document number as printed: prefix, financial year, running number, e.g. "MWW/26-27/009".
pub fn doc_number(prefix: &str, seq: i64, fy: &str) -> String {
    format!("{}/{}/{:03}", prefix, fy, seq)
}

/// The running number inside a document number of the given prefix and financial year.
/// Reads the current "MWW/26-27/009" form and the "MWW/009/26-27" form that was issued for
/// a while, so numbering carries on from whatever was issued before.
pub fn doc_sequence(number: &str, prefix: &str, fy: &str) -> Option<i64> {
    let parts: Vec<&str> = number.trim().split('/').map(str::trim).collect();
    if parts.len() != 3 || !parts[0].eq_ignore_ascii_case(prefix) {
        return None;
    }
    if parts[2] == fy {
        parts[1].parse().ok()
    } else if parts[1] == fy {
        parts[2].parse().ok()
    } else {
        None
    }
}

/// Checks an Indian vehicle registration number and returns it in the usual written form:
/// "TN 09 AB 1234", "PY 01 CK 2064", "DL 1C AB 1234", or Bharat series "22 BH 1234 AA".
/// Spaces, hyphens and lower case in the input are accepted.
pub fn normalize_vehicle_number(raw: &str) -> Result<String, String> {
    let invalid = || {
        format!(
            "\"{}\" is not a valid Indian vehicle number. Use a format like TN 09 AB 1234.",
            raw.trim()
        )
    };
    if raw.chars().any(|c| !(c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '.')) {
        return Err(invalid());
    }
    let s: Vec<char> = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    let text = |from: usize, to: usize| s[from..to].iter().collect::<String>();
    let all = |from: usize, to: usize, f: fn(&char) -> bool| s[from..to].iter().all(f);
    let digit: fn(&char) -> bool = |c| c.is_ascii_digit();
    let letter: fn(&char) -> bool = |c| c.is_ascii_alphabetic();

    // Bharat series: 22 BH 1234 AA
    if (10..=11).contains(&s.len())
        && all(0, 2, digit)
        && text(2, 4) == "BH"
        && all(4, 8, digit)
        && all(8, s.len(), letter)
    {
        return Ok(format!("{} BH {} {}", text(0, 2), text(4, 8), text(8, s.len())));
    }

    // State, RTO number, optional series letters, four-digit number.
    if s.len() < 7 || !all(0, 2, letter) || !all(s.len() - 4, s.len(), digit) {
        return Err(invalid());
    }
    let state = text(0, 2);
    let middle = &s[2..s.len() - 4];
    let rto_len = middle.iter().take_while(|c| c.is_ascii_digit()).count();
    let series: String = middle[rto_len..].iter().collect();
    if !(1..=2).contains(&rto_len) || series.len() > 3 || !series.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err(invalid());
    }
    let mut rto: String = middle[..rto_len].iter().collect();
    let mut series = series;
    // Delhi-style single-digit RTO carries a letter: DL 1C AB 1234.
    if rto_len == 1 && series.len() == 3 {
        rto.push_str(&series[..1]);
        series = series[1..].to_string();
    }
    let number = text(s.len() - 4, s.len());
    Ok(if series.is_empty() {
        format!("{} {} {}", state, rto, number)
    } else {
        format!("{} {} {} {}", state, rto, series, number)
    })
}

/// An invoice line description may carry a little formatting: bold, italic, a size from 1 (smallest)
/// to 7 and line breaks. Only these tags survive, as `<b>`, `<i>`, `<font size="N">` and `<br>`;
/// every other `<` becomes `&lt;` and a typed new line becomes `<br>`. Plain text from older
/// invoices passes through unchanged (apart from those two rules).
pub fn sanitize_rich_text(input: &str) -> String {
    let text = input.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::with_capacity(text.len());
    let mut rest = text.as_str();
    while let Some(pos) = rest.find(|c| c == '<' || c == '\n') {
        out.push_str(&rest[..pos]);
        rest = &rest[pos..];
        if rest.starts_with('\n') {
            out.push_str("<br>");
            rest = &rest[1..];
            continue;
        }
        match allowed_tag(rest) {
            Some((tag, len)) => {
                out.push_str(&tag);
                rest = &rest[len..];
            }
            None => {
                out.push_str("&lt;");
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    let mut cleaned = out.as_str();
    while let Some(stripped) = cleaned.strip_suffix("<br>") {
        cleaned = stripped;
    }
    cleaned.trim().to_string()
}

/// The tag at the start of `s` if it is one of the allowed ones, with its normal form and length.
fn allowed_tag(s: &str) -> Option<(String, usize)> {
    let end = s.find('>')? + 1;
    let inner = s[1..end - 1].trim().to_ascii_lowercase();
    let tag = match inner.as_str() {
        "b" | "strong" => "<b>".to_string(),
        "/b" | "/strong" => "</b>".to_string(),
        "i" | "em" => "<i>".to_string(),
        "/i" | "/em" => "</i>".to_string(),
        "br" | "br/" | "br /" => "<br>".to_string(),
        "/font" => "</font>".to_string(),
        other => {
            let size = other.strip_prefix("font")?.trim().strip_prefix("size")?.trim().strip_prefix('=')?;
            let size = size.trim().trim_matches(|c| c == '"' || c == '\'');
            match size.parse::<u8>() {
                Ok(n) if (1..=7).contains(&n) => format!("<font size=\"{}\">", n),
                _ => return None,
            }
        }
    };
    Some((tag, end))
}

/// The text of a (sanitized) description without its formatting, for checks like "is it empty".
pub fn rich_text_to_plain(input: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in sanitize_rich_text(input).chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&lt;", "<").replace("&nbsp;", " ").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_numbers_put_the_year_before_the_running_number() {
        assert_eq!(doc_number("MWW", 9, "26-27"), "MWW/26-27/009");
        assert_eq!(doc_number("PAY", 4, "26-27"), "PAY/26-27/004");
        assert_eq!(doc_sequence("MWW/26-27/009", "MWW", "26-27"), Some(9));
        // Numbers issued in the swapped form still count, so numbering continues.
        assert_eq!(doc_sequence("MWW/008/26-27", "MWW", "26-27"), Some(8));
        assert_eq!(doc_sequence("MWW/008/26-27", "MWW", "27-28"), None);
        assert_eq!(doc_sequence("PAY/26-27/004", "MWW", "26-27"), None);
        assert_eq!(doc_sequence("T/1", "MWW", "26-27"), None);
    }

    #[test]
    fn vehicle_numbers_are_checked_and_written_in_the_standard_form() {
        assert_eq!(normalize_vehicle_number("tn09ab1234").unwrap(), "TN 09 AB 1234");
        assert_eq!(normalize_vehicle_number("PY-01-CK-2064").unwrap(), "PY 01 CK 2064");
        assert_eq!(normalize_vehicle_number(" py 01 ck 2064 ").unwrap(), "PY 01 CK 2064");
        assert_eq!(normalize_vehicle_number("DL1CAB1234").unwrap(), "DL 1C AB 1234");
        assert_eq!(normalize_vehicle_number("KA05M1234").unwrap(), "KA 05 M 1234");
        assert_eq!(normalize_vehicle_number("22BH1234AA").unwrap(), "22 BH 1234 AA");
        assert_eq!(normalize_vehicle_number("TN091234").unwrap(), "TN 09 1234");
        for bad in ["PY087945632", "1234", "ABCD", "TN 09 AB 12", "TN 09 AB 12345", "T9 09 AB 1234", "TN/09/AB/1234"] {
            assert!(normalize_vehicle_number(bad).is_err(), "{bad} should be rejected");
        }
    }

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

    #[test]
    fn rich_text_keeps_only_the_four_formats() {
        assert_eq!(sanitize_rich_text("Plain line"), "Plain line");
        assert_eq!(sanitize_rich_text("Line one\nLine two\r\nLine three"), "Line one<br>Line two<br>Line three");
        assert_eq!(sanitize_rich_text("<B>Bold</B> and <em>italic</em>"), "<b>Bold</b> and <i>italic</i>");
        assert_eq!(sanitize_rich_text("<font size=\"5\">Big</font> <font size='1'>tiny</font>"), "<font size=\"5\">Big</font> <font size=\"1\">tiny</font>");
        assert_eq!(sanitize_rich_text("a<br/>b<br />c"), "a<br>b<br>c");
        // Anything else is shown as text, never run.
        assert_eq!(sanitize_rich_text("<script>alert(1)</script>"), "&lt;script>alert(1)&lt;/script>");
        assert_eq!(sanitize_rich_text("<font size=\"9\" onclick=\"x\">no</font>"), "&lt;font size=\"9\" onclick=\"x\">no</font>");
        assert_eq!(sanitize_rich_text("<img src=x onerror=y>"), "&lt;img src=x onerror=y>");
        assert_eq!(sanitize_rich_text("5 < 6 and R&D"), "5 &lt; 6 and R&D");
        // Trailing line breaks and spaces go; an old description is not changed otherwise.
        assert_eq!(sanitize_rich_text("  text<br><br>\n"), "text");
        assert_eq!(sanitize_rich_text("தமிழ் ₹100"), "தமிழ் ₹100");
    }

    #[test]
    fn rich_text_to_plain_ignores_formatting() {
        assert_eq!(rich_text_to_plain("<b></b><br>"), "");
        assert_eq!(rich_text_to_plain("<b>Weld</b><br><i>plate</i>"), "Weldplate");
        assert_eq!(rich_text_to_plain("5 < 6"), "5 < 6");
    }
}
