//! WhatsApp message templates the owner writes in Settings. A template is plain text with
//! keywords such as `{employee_name}` that are filled in for each person when the chat opens.
//! Nothing here sends anything: the owner presses Send in WhatsApp.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const SUPPLIER_PAYMENT: &str = "SUPPLIER_PAYMENT";
pub const RENT_REMINDER: &str = "RENT_REMINDER";
pub const EMPLOYEE_PAY: &str = "EMPLOYEE_PAY";
pub const EMPLOYEE_PAY_SLIP: &str = "EMPLOYEE_PAY_SLIP";
pub const KINDS: [&str; 4] = [SUPPLIER_PAYMENT, RENT_REMINDER, EMPLOYEE_PAY, EMPLOYEE_PAY_SLIP];

/// Longest template the owner can save. WhatsApp links get unreliable much beyond this.
pub const MAX_LENGTH: usize = 2000;

/// One keyword the owner can put in a template: what it is called, what it means, and a sample
/// value for the Settings preview.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Keyword {
    pub key: String,
    pub label: String,
    pub sample: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessageTemplate {
    pub kind: String,
    pub title: String,
    /// Where the message is sent from, for the Settings card.
    pub used_for: String,
    pub template: String,
    pub default_template: String,
    pub keywords: Vec<Keyword>,
}

const SUPPLIER_KEYWORDS: &[(&str, &str, &str)] = &[
    ("supplier_name", "Supplier name", "Sri Steels"),
    ("payment_number", "Payment number", "SP/26-27/014"),
    ("payment_date", "Payment date", "17-10-2026"),
    ("amount_sent", "Amount sent", "₹25,000.00"),
    ("payment_method", "Payment method", "Bank transfer"),
    ("reference_number", "Reference / UTR number", "UTR 4521"),
    ("bills", "Bills paid (number, date and amount of each)", "Invoice No & Date : SS-221 / 02-10-2026\nAmount : ₹25,000.00"),
    ("bills_total", "Total of the bills", "₹25,000.00"),
    ("business_name", "Your business name", "MONONMANI WELDING WORKS"),
];

const RENT_KEYWORDS: &[(&str, &str, &str)] = &[
    ("tenant_name", "Tenant name", "Ravi"),
    ("month", "Rent month", "November 2026"),
    ("rent", "Monthly rent", "₹12,000"),
    ("place", "Place (shop / house)", "Flat 2B"),
    ("business_name", "Your business name", "MONONMANI WELDING WORKS"),
];

const EMPLOYEE_KEYWORDS: &[(&str, &str, &str)] = &[
    ("employee_name", "Employee name", "Murugan"),
    ("month", "Pay month", "October 2026"),
    ("days", "Days worked", "26"),
    ("daily_wage", "Daily wage", "₹800.00"),
    ("wages", "Wages (days × daily wage)", "₹20,800.00"),
    ("ot_hours", "OT hours", "4"),
    ("ot_rate", "OT rate per hour", "₹100.00"),
    ("ot_amount", "OT amount", "₹400.00"),
    ("bonus", "Bonus", "₹500.00"),
    ("incentives", "Incentives (each reason and amount)", "Night work : ₹300.00\nSite visit : ₹200.00"),
    ("incentives_total", "Incentives total", "₹500.00"),
    ("pay_details", "Pay details (only the lines that apply)", "Wages : 26 days × ₹800.00 = ₹20,800.00\nOT : 4 h × ₹100.00 = ₹400.00\nBonus : ₹500.00\nNight work : ₹300.00\nSite visit : ₹200.00"),
    ("earned", "Earned", "₹22,200.00"),
    ("paid", "Paid (advances and salary)", "₹20,000.00"),
    ("balance", "Still to pay", "₹2,200.00"),
    ("status", "Status (To pay / Paid / Overpaid)", "To pay ₹2,200.00"),
    ("business_name", "Your business name", "MONONMANI WELDING WORKS"),
];

/// The message each kind had before templates, so nothing changes until the owner edits it.
const SUPPLIER_DEFAULT: &str = "{bills}\nTotal amount : {bills_total}\nAmount sent : {amount_sent}";
const RENT_DEFAULT: &str =
    "Hello {tenant_name}, this is a reminder for your {month} rent of {rent} for {place}. Please pay at your earliest convenience. Thank you.";
const EMPLOYEE_DEFAULT: &str = "Hello {employee_name},\nYour pay for {month}:\n{pay_details}\nEarned : {earned}\nPaid : {paid}\nBalance : {balance}\n\n{business_name}";
const PAY_SLIP_DEFAULT: &str = "Hello {employee_name},\nHere is your pay slip for {month}.\nEarned : {earned}\nBalance : {balance}\n\n{business_name}";

fn keyword_table(kind: &str) -> &'static [(&'static str, &'static str, &'static str)] {
    match kind {
        SUPPLIER_PAYMENT => SUPPLIER_KEYWORDS,
        RENT_REMINDER => RENT_KEYWORDS,
        _ => EMPLOYEE_KEYWORDS,
    }
}

fn check_kind(kind: &str) -> Result<(), String> {
    if KINDS.contains(&kind) {
        Ok(())
    } else {
        Err("Unknown message kind.".to_string())
    }
}

pub fn default_template(kind: &str) -> &'static str {
    match kind {
        SUPPLIER_PAYMENT => SUPPLIER_DEFAULT,
        RENT_REMINDER => RENT_DEFAULT,
        EMPLOYEE_PAY_SLIP => PAY_SLIP_DEFAULT,
        _ => EMPLOYEE_DEFAULT,
    }
}

fn title(kind: &str) -> (&'static str, &'static str) {
    match kind {
        SUPPLIER_PAYMENT => ("Supplier payment", "Sent from a supplier payment: which bills the money covers."),
        RENT_REMINDER => ("Rent reminder", "Sent to tenants who have not paid the month's rent."),
        EMPLOYEE_PAY_SLIP => ("Pay slip", "Typed in with Send pay slip on WhatsApp; you drag the pay slip PDF into the chat."),
        _ => ("Employee pay", "Sent from an employee's month on the pay sheet."),
    }
}

fn setting_key(kind: &str) -> String {
    format!("whatsapp_template_{}", kind.to_lowercase())
}

/// The keywords written in a template, in order, without braces. `{` without a closing `}` (or
/// with spaces or other text inside) is plain text, not a keyword.
fn used_keywords(template: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        let after = &rest[open + 1..];
        match after.find('}') {
            Some(close) if close > 0 && after[..close].chars().all(|c| c.is_ascii_alphanumeric() || c == '_') => {
                out.push(&after[..close]);
                rest = &after[close + 1..];
            }
            _ => rest = after,
        }
    }
    out
}

/// A template with each `{keyword}` replaced by its value. Words that are not keywords stay as typed.
pub fn fill(template: &str, values: &[(&str, String)]) -> String {
    let mut out = String::with_capacity(template.len() + 64);
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let value = after.find('}').and_then(|close| {
            let key = &after[..close];
            values.iter().find(|(k, _)| *k == key).map(|(_, v)| (v, close))
        });
        match value {
            Some((v, close)) => {
                out.push_str(v);
                rest = &after[close + 1..];
            }
            None => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// A template the owner typed, checked: not empty, not too long, and only known keywords.
pub fn check_template(kind: &str, template: &str) -> Result<String, String> {
    check_kind(kind)?;
    let text = template.replace("\r\n", "\n");
    let text = text.trim();
    if text.is_empty() {
        return Err("The message can't be empty.".to_string());
    }
    if text.chars().count() > MAX_LENGTH {
        return Err(format!("The message can be at most {} characters.", MAX_LENGTH));
    }
    let known = keyword_table(kind);
    if let Some(bad) = used_keywords(text).into_iter().find(|k| !known.iter().any(|(key, _, _)| key == k)) {
        return Err(format!("{{{}}} is not a keyword for this message. Pick one from the list.", bad));
    }
    Ok(text.to_string())
}

/// The saved template for a kind, or its default when none is saved.
pub fn template(conn: &Connection, kind: &str) -> Result<String, String> {
    check_kind(kind)?;
    let saved: Option<String> = conn
        .query_row("SELECT value FROM app_settings WHERE key = ?1", params![setting_key(kind)], |r| r.get(0))
        .optional()
        .map_err(|e| format!("Failed to load the message template: {}", e))?;
    Ok(saved.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| default_template(kind).to_string()))
}

pub fn describe(conn: &Connection, kind: &str) -> Result<MessageTemplate, String> {
    let (title, used_for) = title(kind);
    Ok(MessageTemplate {
        kind: kind.to_string(),
        title: title.to_string(),
        used_for: used_for.to_string(),
        template: template(conn, kind)?,
        default_template: default_template(kind).to_string(),
        keywords: keyword_table(kind)
            .iter()
            .map(|(key, label, sample)| Keyword { key: key.to_string(), label: label.to_string(), sample: sample.to_string() })
            .collect(),
    })
}

pub fn all(conn: &Connection) -> Result<Vec<MessageTemplate>, String> {
    KINDS.iter().map(|k| describe(conn, k)).collect()
}

/// Saves the template; the default itself is stored as no template, so later improvements to
/// the default reach it.
pub fn save(conn: &Connection, kind: &str, template: &str) -> Result<MessageTemplate, String> {
    let text = check_template(kind, template)?;
    if text == default_template(kind) {
        conn.execute("DELETE FROM app_settings WHERE key = ?1", params![setting_key(kind)])
            .map_err(|e| format!("Failed to save the message template: {}", e))?;
    } else {
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![setting_key(kind), text, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Failed to save the message template: {}", e))?;
    }
    describe(conn, kind)
}

/// The business name for `{business_name}`, as set in Settings.
pub fn business_name(conn: &Connection) -> String {
    crate::settings::repository::SettingsRepository::get(conn).map(|s| s.business_name).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("t.db")).unwrap();
        let conn = db.get_connection().unwrap();
        (dir, conn)
    }

    #[test]
    fn keywords_are_filled_and_other_braces_stay() {
        let values = [("name", "Ravi".to_string()), ("rent", "₹12,000".to_string())];
        assert_eq!(fill("Hi {name}, rent {rent}. {name}!", &values), "Hi Ravi, rent ₹12,000. Ravi!");
        assert_eq!(fill("{unknown} { name} {name", &values), "{unknown} { name} {name");
        assert_eq!(fill("{{name}}", &values), "{Ravi}");
        assert_eq!(fill("வணக்கம் {name}", &values), "வணக்கம் Ravi");
    }

    #[test]
    fn templates_are_checked() {
        assert_eq!(check_template(RENT_REMINDER, "  Hi {tenant_name}\r\n  ").unwrap(), "Hi {tenant_name}");
        assert_eq!(check_template(RENT_REMINDER, "   ").unwrap_err(), "The message can't be empty.");
        assert_eq!(
            check_template(RENT_REMINDER, "Hi {employee_name}").unwrap_err(),
            "{employee_name} is not a keyword for this message. Pick one from the list."
        );
        assert!(check_template(RENT_REMINDER, "Price {in rupees} {a b}").is_ok(), "braces around ordinary words are text");
        assert_eq!(check_template(RENT_REMINDER, &"x".repeat(2001)).unwrap_err(), "The message can be at most 2000 characters.");
        assert_eq!(check_template("LOAN", "x").unwrap_err(), "Unknown message kind.");
    }

    #[test]
    fn every_default_uses_only_its_own_keywords() {
        for kind in KINDS {
            assert!(check_template(kind, default_template(kind)).is_ok(), "{}", kind);
        }
    }

    #[test]
    fn saving_and_going_back_to_the_default() {
        let (_d, conn) = setup();
        assert_eq!(template(&conn, EMPLOYEE_PAY).unwrap(), EMPLOYEE_DEFAULT);
        let t = save(&conn, EMPLOYEE_PAY, "Hi {employee_name}, {balance} for {month}").unwrap();
        assert_eq!(t.template, "Hi {employee_name}, {balance} for {month}");
        assert_eq!(template(&conn, EMPLOYEE_PAY).unwrap(), "Hi {employee_name}, {balance} for {month}");
        assert_eq!(template(&conn, RENT_REMINDER).unwrap(), RENT_DEFAULT, "each kind is separate");
        save(&conn, EMPLOYEE_PAY, EMPLOYEE_DEFAULT).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM app_settings WHERE key LIKE 'whatsapp_template_%'", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0, "the default is kept as no template");
        assert!(save(&conn, EMPLOYEE_PAY, "Hi {tenant_name}").is_err());
        let all = all(&conn).unwrap();
        assert_eq!(all.iter().map(|t| t.kind.as_str()).collect::<Vec<_>>(), KINDS.to_vec());
        assert!(all[3].keywords.iter().any(|k| k.key == "employee_name"), "the pay slip message has the employee keywords");
        assert!(all[2].keywords.iter().any(|k| k.key == "employee_name"));
    }
}
