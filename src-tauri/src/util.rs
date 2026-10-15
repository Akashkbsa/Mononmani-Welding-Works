use chrono::{Datelike, Local, NaiveDate};

/// Round a rupee amount to paise as a calculator does: half a paisa goes up (away from zero).
/// The paise are first read to 15 significant digits, so a stored 1.005 (really 1.00499999…)
/// still rounds to 1.01. `round2` in src/lib/format.ts does exactly the same, so the screen and
/// the saved figures always agree.
pub fn round2(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    let raw = value * 100.0;
    // Reading the paise to 15 digits moves them by far less than this margin, so it can only change
    // the result for a value right at half a paisa. Every other value is rounded directly, which
    // gives the same answer without the slow text round trip (lists round thousands of amounts).
    let margin = raw.abs() * 1e-13 + 1e-13;
    let paise = if ((raw - raw.floor()) - 0.5).abs() > margin {
        raw
    } else {
        format!("{:.14e}", raw).parse().unwrap_or(raw)
    };
    let rounded = paise.round() / 100.0;
    // No "-0.00" for a tiny negative amount.
    if rounded == 0.0 { 0.0 } else { rounded }
}

/// Largest amount or quantity accepted anywhere: ₹1 lakh crore. Anything bigger is a typing
/// mistake, and well below it every amount stays exact to the paisa.
pub const MAX_AMOUNT: f64 = 1e12;

/// `value` if it is a real number no bigger than `MAX_AMOUNT`, otherwise a message naming `what`.
pub fn check_amount(value: f64, what: &str) -> Result<f64, String> {
    if !value.is_finite() || value.abs() > MAX_AMOUNT {
        return Err(format!("{} is too large. Check the number.", what));
    }
    Ok(value)
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

/// Folder name for a date's financial year (1 April to 31 March), e.g. "2026-27".
pub fn financial_year_folder(date: NaiveDate) -> String {
    let start = if date.month() >= 4 { date.year() } else { date.year() - 1 };
    format!("{}-{:02}", start, (start + 1) % 100)
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

    // Bharat series: 22 BH 1234 AA, always two letters at the end (same rule as the UI).
    if s.len() == 10 && all(0, 2, digit) && text(2, 4) == "BH" && all(4, 8, digit) && all(8, 10, letter) {
        return Ok(format!("{} BH {} {}", text(0, 2), text(4, 8), text(8, 10)));
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
    fn invoice_folders_follow_the_financial_year() {
        let d = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        assert_eq!(financial_year_folder(d("2026-04-01")), "2026-27");
        assert_eq!(financial_year_folder(d("2027-03-31")), "2026-27");
        assert_eq!(financial_year_folder(d("2026-03-31")), "2025-26");
        assert_eq!(financial_year_folder(d("2099-12-31")), "2099-00");
    }

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
        assert_eq!(rich_text_to_plain("a&nbsp;b"), "a b");
        assert_eq!(rich_text_to_plain(""), "");
    }

    #[test]
    fn round2_matches_a_calculator_and_the_ui() {
        // The same cases as src/lib/format.test.ts; both sides must round alike.
        for (value, expected) in [
            (1.005, 1.01),
            (2.675, 2.68),
            (7.0 * 0.145, 1.02),
            (1.5 * 1.67, 2.51),
            (0.125, 0.13),
            (1000.005, 1000.01),
            (123456.785, 123456.79),
            (99999999.995, 100000000.0),
            (-1.005, -1.01),
            (-0.005, -0.01),
            (10.004, 10.0),
            (1e12, 1e12),
        ] {
            assert_eq!(round2(value), expected, "round2({value})");
        }
        // A tiny negative amount is plain zero, never "-0.00".
        assert!(round2(-0.001).is_sign_positive());
        assert_eq!(rupees(round2(-0.001)), "₹0.00");
        assert!(round2(f64::NAN).is_nan());
    }

    #[test]
    fn round2_rounds_to_paise() {
        assert_eq!(round2(10.0), 10.0);
        assert_eq!(round2(10.004), 10.0);
        assert_eq!(round2(10.006), 10.01);
        assert_eq!(round2(0.1 + 0.2), 0.3);
        assert_eq!(round2(2.505), 2.51);
        assert_eq!(round2(-3.14159), -3.14);
        assert_eq!(round2(0.0), 0.0);
    }

    #[test]
    fn indian_grouping_edges() {
        assert_eq!(indian_number(0.0), "0.00");
        assert_eq!(indian_number(999.0), "999.00");
        assert_eq!(indian_number(1000.0), "1,000.00");
        assert_eq!(indian_number(99999.99), "99,999.99");
        assert_eq!(indian_number(100000.0), "1,00,000.00");
        assert_eq!(indian_number(10000000.0), "1,00,00,000.00");
        assert_eq!(indian_number(123456789.12), "12,34,56,789.12");
        assert_eq!(indian_number(0.004), "0.00");
        assert_eq!(indian_number(1.999), "2.00");
        assert_eq!(rupees(2900.0), "₹2,900.00");
        assert_eq!(rupees(-50.5), "₹-50.50");
    }

    #[test]
    fn parse_date_accepts_two_forms_and_nothing_else() {
        let d = |y, m, day| NaiveDate::from_ymd_opt(y, m, day);
        assert_eq!(parse_date("2026-10-15"), d(2026, 10, 15));
        assert_eq!(parse_date("15-10-2026"), d(2026, 10, 15));
        assert_eq!(parse_date("  2026-10-15  "), d(2026, 10, 15));
        assert_eq!(parse_date("29-02-2024"), d(2024, 2, 29));
        assert_eq!(parse_date("29-02-2025"), None);
        assert_eq!(parse_date("2026-13-01"), None);
        assert_eq!(parse_date("15/10/2026"), None);
        assert_eq!(parse_date("10-15-2026"), None);
        assert_eq!(parse_date(""), None);
        assert_eq!(parse_date("today"), None);
    }

    #[test]
    fn normalize_date_names_the_field_in_its_error() {
        assert_eq!(normalize_date("  01-04-2026 ", "Invoice date").unwrap(), "2026-04-01");
        assert_eq!(normalize_date("", "Invoice date").unwrap_err(), "Invoice date is not a valid date.");
        assert_eq!(normalize_date("2026/04/01", "Due").unwrap_err(), "Due is not a valid date.");
    }

    #[test]
    fn display_date_shows_dd_mm_yyyy_or_the_text_as_is() {
        assert_eq!(display_date("2026-01-05"), "05-01-2026");
        assert_eq!(display_date("05-01-2026"), "05-01-2026");
        assert_eq!(display_date("  sometime  "), "sometime");
        assert_eq!(display_date(""), "");
    }

    #[test]
    fn financial_year_label_is_two_short_years() {
        let label = financial_year_label();
        let (a, b) = label.split_once('-').unwrap();
        assert_eq!((a.len(), b.len()), (2, 2));
        let (a, b): (u32, u32) = (a.parse().unwrap(), b.parse().unwrap());
        assert_eq!((a + 1) % 100, b);
        // It agrees with the folder name for today.
        assert!(financial_year_folder(today()).ends_with(&format!("-{:02}", b)));
        assert!(financial_year_folder(today()).starts_with(&format!("20{:02}", a)));
    }

    #[test]
    fn document_numbers_edges() {
        assert_eq!(doc_number("MWW", 1, "26-27"), "MWW/26-27/001");
        assert_eq!(doc_number("MWW", 1234, "26-27"), "MWW/26-27/1234");
        assert_eq!(doc_sequence("MWW/26-27/1234", "MWW", "26-27"), Some(1234));
        // Spaces and the prefix's case do not matter.
        assert_eq!(doc_sequence(" mww / 26-27 / 012 ", "MWW", "26-27"), Some(12));
        // Anything that is not a running number is not counted.
        assert_eq!(doc_sequence("MWW/26-27/A12", "MWW", "26-27"), None);
        assert_eq!(doc_sequence("MWW/26-27/", "MWW", "26-27"), None);
        assert_eq!(doc_sequence("MWW/26-27/009/x", "MWW", "26-27"), None);
        assert_eq!(doc_sequence("", "MWW", "26-27"), None);
        // A number from another year is not part of this year's numbering.
        assert_eq!(doc_sequence("MWW/25-26/050", "MWW", "26-27"), None);
    }

    #[test]
    fn vehicle_number_edges() {
        assert_eq!(normalize_vehicle_number("22bh1234ab").unwrap(), "22 BH 1234 AB");
        assert_eq!(normalize_vehicle_number("tn.09.ab.1234").unwrap(), "TN 09 AB 1234");
        assert_eq!(normalize_vehicle_number("TN9ABC1234").unwrap(), "TN 9A BC 1234");
        assert_eq!(normalize_vehicle_number("TN09ABC1234").unwrap(), "TN 09 ABC 1234");
        for bad in ["", "TN09ABCD1234", "TN123AB1234", "22BH1234", "22BH1234A", "22BH1234ABC", "TN09A1B1234", "TN 09 AB 1234!"] {
            assert!(normalize_vehicle_number(bad).is_err(), "{bad} should be rejected");
        }
        let err = normalize_vehicle_number("  bad  ").unwrap_err();
        assert!(err.starts_with("\"bad\" is not a valid Indian vehicle number."), "{err}");
    }

    #[test]
    fn rich_text_edges() {
        assert_eq!(sanitize_rich_text(""), "");
        assert_eq!(sanitize_rich_text("\n\n"), "");
        assert_eq!(sanitize_rich_text("x <"), "x &lt;");
        assert_eq!(sanitize_rich_text("<FONT SIZE = '7'>x</FONT>"), "<font size=\"7\">x</font>");
        assert_eq!(sanitize_rich_text("<font size=0>x</font>"), "&lt;font size=0>x</font>");
        assert_eq!(sanitize_rich_text("<strong>a</strong><BR>b"), "<b>a</b><br>b");
        assert_eq!(sanitize_rich_text("a\rb"), "a<br>b");
        // Running it again changes nothing.
        let once = sanitize_rich_text("<em>x</em>\n<font size=2>y</font> <z>");
        assert_eq!(sanitize_rich_text(&once), once);
    }

    #[test]
    fn rich_text_matches_the_ui_rules() {
        // The same inputs as src/lib/richText.test.ts; both sides must agree.
        for (input, expected) in [
            ("<b>bold</b> <i>it</i><br><font size=\"5\">big</font>", "<b>bold</b> <i>it</i><br><font size=\"5\">big</font>"),
            ("<strong>a</strong><em>b</em>c<br/>d<br />e<BR>f", "<b>a</b><i>b</i>c<br>d<br>e<br>f"),
            ("<B> x </ B>", "<b> x &lt;/ B>"),
            ("<font size=7>x</font>", "<font size=\"7\">x</font>"),
            ("<script>alert(1)</script>", "&lt;script>alert(1)&lt;/script>"),
            ("<font color=\"red\">x</font>", "&lt;font color=\"red\">x</font>"),
            ("a < b", "a &lt; b"),
            ("one\ntwo\r\nthree\rfour", "one<br>two<br>three<br>four"),
            ("  text\n\n", "text"),
        ] {
            assert_eq!(sanitize_rich_text(input), expected, "input: {input}");
        }
    }
}
