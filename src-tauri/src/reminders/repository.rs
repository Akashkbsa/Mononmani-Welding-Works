use super::models::{Reminder, ReminderInput};
use super::schedule::{days_away, next_date, state, Repeat};
use crate::util::normalize_date;
use chrono::{Datelike, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};

const NOT_FOUND: &str = "Reminder not found.";
const SNOOZE_RANGE: &str = "Snooze can be 1 to 365 days.";
/// `app_settings` key holding the banner's snooze choices in days, e.g. "1,3,7".
const SNOOZE_KEY: &str = "reminder_snooze_days";

/// The record kinds a reminder can link to, with the table that holds them.
const LINK_TABLES: [(&str, &str); 9] = [
    ("INVOICE", "invoices"),
    ("QUOTATION", "quotations"),
    ("PURCHASE_ORDER", "purchase_orders"),
    ("PAYMENT", "payments"),
    ("SUPPLIER_BILL", "supplier_bills"),
    ("SUPPLIER_PAYMENT", "supplier_payments"),
    ("COMPANY", "customers"),
    ("TENANT", "rental_tenants"),
    ("PLACE", "rental_places"),
];

/// The linked record's number or name; NULL when it no longer exists.
const LINK_LABEL_SQL: &str = "CASE r.link_kind
        WHEN 'INVOICE' THEN (SELECT invoice_number FROM invoices WHERE id = r.link_id)
        WHEN 'QUOTATION' THEN (SELECT quotation_number FROM quotations WHERE id = r.link_id)
        WHEN 'PURCHASE_ORDER' THEN (SELECT po_number FROM purchase_orders WHERE id = r.link_id)
        WHEN 'PAYMENT' THEN (SELECT payment_number FROM payments WHERE id = r.link_id)
        WHEN 'SUPPLIER_BILL' THEN (SELECT bill_number FROM supplier_bills WHERE id = r.link_id)
        WHEN 'SUPPLIER_PAYMENT' THEN (SELECT payment_number FROM supplier_payments WHERE id = r.link_id)
        WHEN 'COMPANY' THEN (SELECT name FROM customers WHERE id = r.link_id)
        WHEN 'TENANT' THEN (SELECT name FROM rental_tenants WHERE id = r.link_id)
        WHEN 'PLACE' THEN (SELECT name FROM rental_places WHERE id = r.link_id)
    END";

pub struct ReminderRepository;

/// A checked input, ready to store.
struct Clean {
    title: String,
    note: Option<String>,
    due_date: String,
    remind_days: i64,
    repeat: Repeat,
    month_end: bool,
    repeat_day: u32,
    link_kind: Option<String>,
    link_id: Option<i64>,
}

fn parse_day(text: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(|_| format!("Stored reminder date {} is not valid.", text))
}

impl ReminderRepository {
    fn clean(conn: &Connection, input: &ReminderInput) -> Result<Clean, String> {
        let title = input.title.trim().to_string();
        if title.is_empty() {
            return Err("Enter what the reminder is for.".to_string());
        }
        let due_date = normalize_date(&input.due_date, "Date")?;
        if !(0..=365).contains(&input.remind_days) {
            return Err("Remind me can be 0 to 365 days before.".to_string());
        }
        let repeat = Repeat::parse(&input.repeat)?;
        let month_end = repeat == Repeat::Monthly && input.month_end;
        let day = parse_day(&due_date)?.day();
        let repeat_day = if month_end { 31 } else { day };

        let kind = input.link_kind.as_deref().map(|k| k.trim().to_ascii_uppercase()).filter(|k| !k.is_empty());
        let (link_kind, link_id) = match (kind, input.link_id) {
            (None, None) => (None, None),
            (Some(kind), Some(id)) => {
                let table = LINK_TABLES
                    .iter()
                    .find(|(k, _)| *k == kind)
                    .map(|(_, t)| *t)
                    .ok_or_else(|| "That record type can't have a reminder.".to_string())?;
                let found: i64 = conn
                    .query_row(&format!("SELECT COUNT(*) FROM {} WHERE id = ?1", table), params![id], |r| r.get(0))
                    .map_err(|e| format!("Failed to check the linked record: {}", e))?;
                if found == 0 {
                    return Err("That record no longer exists.".to_string());
                }
                (Some(kind), Some(id))
            }
            _ => return Err("Choose the record to link.".to_string()),
        };
        let note = input.note.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        Ok(Clean { title, note, due_date, remind_days: input.remind_days, repeat, month_end, repeat_day, link_kind, link_id })
    }

    pub fn create(conn: &Connection, input: ReminderInput) -> Result<Reminder, String> {
        let c = Self::clean(conn, &input)?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO reminders (title, note, due_date, remind_days, repeat, repeat_day, month_end, link_kind, link_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![c.title, c.note, c.due_date, c.remind_days, c.repeat.as_str(), c.repeat_day, c.month_end, c.link_kind, c.link_id, now],
        )
        .map_err(|e| format!("Failed to save the reminder: {}", e))?;
        Self::reload(conn, conn.last_insert_rowid())
    }

    /// Saving an edit puts a dismissed reminder back on the banner.
    pub fn update(conn: &Connection, id: i64, input: ReminderInput) -> Result<Reminder, String> {
        Self::require(conn, id)?;
        let c = Self::clean(conn, &input)?;
        conn.execute(
            "UPDATE reminders SET title = ?1, note = ?2, due_date = ?3, remind_days = ?4, repeat = ?5, repeat_day = ?6, month_end = ?7,
                    link_kind = ?8, link_id = ?9, dismissed = 0, snoozed_until = NULL, updated_at = ?10 WHERE id = ?11",
            params![c.title, c.note, c.due_date, c.remind_days, c.repeat.as_str(), c.repeat_day, c.month_end, c.link_kind, c.link_id, Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to save the reminder: {}", e))?;
        Self::reload(conn, id)
    }

    pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
        Self::require(conn, id)?;
        conn.execute("DELETE FROM reminders WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete the reminder: {}", e))?;
        Ok(())
    }

    fn require(conn: &Connection, id: i64) -> Result<(), String> {
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM reminders WHERE id = ?1", params![id], |r| r.get(0))
            .map_err(|e| format!("Failed to load the reminder: {}", e))?;
        if n == 0 {
            return Err(NOT_FOUND.to_string());
        }
        Ok(())
    }

    fn reload(conn: &Connection, id: i64) -> Result<Reminder, String> {
        Self::get(conn, id, crate::util::today())?.ok_or_else(|| NOT_FOUND.to_string())
    }

    /// Reminders matching `filter` (SQL on `r`), with their state worked out for `today`.
    fn load(conn: &Connection, filter: &str, args: &[&dyn rusqlite::ToSql], today: NaiveDate) -> Result<Vec<Reminder>, String> {
        let sql = format!(
            "SELECT r.id, r.title, r.note, r.due_date, r.remind_days, r.repeat, r.month_end, r.link_kind, r.link_id, {},
                    r.dismissed, r.done_on, r.last_done_on, r.created_at, r.updated_at, r.snoozed_until
             FROM reminders r WHERE {} ORDER BY r.due_date, r.id",
            LINK_LABEL_SQL, filter
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| format!("Failed to load reminders: {}", e))?;
        let rows = stmt
            .query_map(args, |r| {
                let link_kind: Option<String> = r.get(7)?;
                let link_label: Option<String> = r.get(9)?;
                Ok(Reminder {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    note: r.get(2)?,
                    due_date: r.get(3)?,
                    remind_days: r.get(4)?,
                    repeat: r.get(5)?,
                    month_end: r.get(6)?,
                    link_missing: link_kind.is_some() && link_label.is_none(),
                    link_kind,
                    link_id: r.get(8)?,
                    link_label,
                    dismissed: r.get(10)?,
                    snoozed_until: r.get(15)?,
                    done_on: r.get(11)?,
                    last_done_on: r.get(12)?,
                    state: String::new(),
                    days_away: 0,
                    created_at: r.get(13)?,
                    updated_at: r.get(14)?,
                })
            })
            .map_err(|e| format!("Failed to load reminders: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read reminders: {}", e))?;
        rows.into_iter()
            .map(|mut r| {
                let due = parse_day(&r.due_date)?;
                r.days_away = days_away(due, today);
                r.state = if r.done_on.is_some() { "DONE".to_string() } else { state(due, r.remind_days, today).as_str().to_string() };
                Ok(r)
            })
            .collect()
    }

    pub fn get(conn: &Connection, id: i64, today: NaiveDate) -> Result<Option<Reminder>, String> {
        Ok(Self::load(conn, "r.id = ?1", &[&id], today)?.into_iter().next())
    }

    /// DUE: coming up, due today or overdue (dismissed ones included), overdue first.
    /// UPCOMING: not yet in their "remind me" window. DONE: finished one-time reminders, newest first.
    pub fn list(conn: &Connection, tab: &str, today: NaiveDate) -> Result<Vec<Reminder>, String> {
        match tab {
            "DUE" => {
                let mut list: Vec<Reminder> =
                    Self::load(conn, "r.done_on IS NULL", &[], today)?.into_iter().filter(|r| r.state != "WAITING").collect();
                let rank = |s: &str| match s {
                    "OVERDUE" => 0,
                    "DUE_TODAY" => 1,
                    _ => 2,
                };
                list.sort_by(|a, b| rank(&a.state).cmp(&rank(&b.state)).then(a.due_date.cmp(&b.due_date)).then(a.id.cmp(&b.id)));
                Ok(list)
            }
            "UPCOMING" => Ok(Self::load(conn, "r.done_on IS NULL", &[], today)?.into_iter().filter(|r| r.state == "WAITING").collect()),
            "DONE" => {
                let mut list = Self::load(conn, "r.done_on IS NOT NULL", &[], today)?;
                list.sort_by(|a, b| b.done_on.cmp(&a.done_on).then(b.id.cmp(&a.id)));
                Ok(list)
            }
            _ => Err("Choose Due now, Upcoming or Done.".to_string()),
        }
    }

    /// What the top banner shows: the Due list without the dismissed ones and those snoozed past today.
    pub fn banner(conn: &Connection, today: NaiveDate) -> Result<Vec<Reminder>, String> {
        let today_text = today.format("%Y-%m-%d").to_string();
        Ok(Self::list(conn, "DUE", today)?
            .into_iter()
            .filter(|r| !r.dismissed && r.snoozed_until.as_deref().map_or(true, |until| until <= today_text.as_str()))
            .collect())
    }

    /// Open (not done) reminders linked to one record, by date.
    pub fn for_record(conn: &Connection, kind: &str, id: i64, today: NaiveDate) -> Result<Vec<Reminder>, String> {
        Self::load(conn, "r.done_on IS NULL AND r.link_kind = ?1 AND r.link_id = ?2", &[&kind, &id], today)
    }

    /// One-time: finished today. Repeating: moves one step to its next date and shows again then.
    pub fn mark_done(conn: &Connection, id: i64, today: NaiveDate) -> Result<Reminder, String> {
        let row: Option<(String, String, Option<u32>, bool)> = conn
            .query_row("SELECT due_date, repeat, repeat_day, month_end FROM reminders WHERE id = ?1", params![id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .optional()
            .map_err(|e| format!("Failed to load the reminder: {}", e))?;
        let (due, repeat, repeat_day, month_end) = row.ok_or_else(|| NOT_FOUND.to_string())?;
        let due = parse_day(&due)?;
        let repeat = Repeat::parse(&repeat)?;
        let today_text = today.format("%Y-%m-%d").to_string();
        let now = Utc::now().to_rfc3339();
        match next_date(due, repeat, repeat_day.unwrap_or(due.day()), month_end) {
            None => conn.execute(
                "UPDATE reminders SET done_on = ?1, snoozed_until = NULL, updated_at = ?2 WHERE id = ?3",
                params![today_text, now, id],
            ),
            Some(next) => conn.execute(
                "UPDATE reminders SET due_date = ?1, last_done_on = ?2, dismissed = 0, snoozed_until = NULL, updated_at = ?3 WHERE id = ?4",
                params![next.format("%Y-%m-%d").to_string(), today_text, now, id],
            ),
        }
        .map_err(|e| format!("Failed to save the reminder: {}", e))?;
        Self::get(conn, id, today)?.ok_or_else(|| NOT_FOUND.to_string())
    }

    /// Bring a finished one-time reminder back.
    pub fn mark_not_done(conn: &Connection, id: i64) -> Result<Reminder, String> {
        Self::require(conn, id)?;
        conn.execute("UPDATE reminders SET done_on = NULL, updated_at = ?1 WHERE id = ?2", params![Utc::now().to_rfc3339(), id])
            .map_err(|e| format!("Failed to save the reminder: {}", e))?;
        Self::reload(conn, id)
    }

    /// Keep a reminder off the banner for `days` days from today (it stays on the Reminders page).
    /// 0 days takes the snooze off.
    pub fn snooze(conn: &Connection, id: i64, days: i64, today: NaiveDate) -> Result<Reminder, String> {
        if !(0..=365).contains(&days) {
            return Err(SNOOZE_RANGE.to_string());
        }
        Self::require(conn, id)?;
        let until = (days > 0).then(|| (today + chrono::Duration::days(days)).format("%Y-%m-%d").to_string());
        conn.execute(
            "UPDATE reminders SET snoozed_until = ?1, updated_at = ?2 WHERE id = ?3",
            params![until, Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to save the reminder: {}", e))?;
        Self::get(conn, id, today)?.ok_or_else(|| NOT_FOUND.to_string())
    }

    /// The snooze lengths the banner offers, in days, shortest first. Tomorrow only until changed.
    pub fn snooze_choices(conn: &Connection) -> Result<Vec<i64>, String> {
        let value: Option<String> = conn
            .query_row("SELECT value FROM app_settings WHERE key = ?1", params![SNOOZE_KEY], |r| r.get(0))
            .optional()
            .map_err(|e| format!("Failed to load the snooze choices: {}", e))?;
        let mut days: Vec<i64> = value
            .unwrap_or_default()
            .split(',')
            .filter_map(|d| d.trim().parse().ok())
            .filter(|d| (1..=365).contains(d))
            .collect();
        days.sort_unstable();
        days.dedup();
        Ok(if days.is_empty() { vec![1] } else { days })
    }

    pub fn save_snooze_choices(conn: &Connection, days: Vec<i64>) -> Result<Vec<i64>, String> {
        let mut days = days;
        days.sort_unstable();
        days.dedup();
        if days.is_empty() {
            return Err("Keep at least one snooze choice.".to_string());
        }
        if days.iter().any(|d| !(1..=365).contains(d)) {
            return Err(SNOOZE_RANGE.to_string());
        }
        if days.len() > 5 {
            return Err("Up to 5 snooze choices.".to_string());
        }
        let text = days.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(",");
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![SNOOZE_KEY, text, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Failed to save the snooze choices: {}", e))?;
        Ok(days)
    }

    /// Take a reminder off the banner (it stays on the Reminders page), or put it back.
    pub fn set_dismissed(conn: &Connection, id: i64, dismissed: bool) -> Result<Reminder, String> {
        Self::require(conn, id)?;
        conn.execute(
            "UPDATE reminders SET dismissed = ?1, updated_at = ?2 WHERE id = ?3",
            params![dismissed, Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to save the reminder: {}", e))?;
        Self::reload(conn, id)
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;
    use crate::reminders::models::*;
    use chrono::NaiveDate;
    use rusqlite::Connection;

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("t.db")).unwrap();
        let conn = db.get_connection().unwrap();
        (dir, conn)
    }

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn input(title: &str, due: &str, days: i64, repeat: &str) -> ReminderInput {
        ReminderInput {
            title: title.to_string(),
            note: None,
            due_date: due.to_string(),
            remind_days: days,
            repeat: repeat.to_string(),
            month_end: false,
            link_kind: None,
            link_id: None,
        }
    }

    fn add(conn: &Connection, title: &str, due: &str, days: i64, repeat: &str) -> i64 {
        ReminderRepository::create(conn, input(title, due, days, repeat)).unwrap().id
    }

    fn titles(list: &[Reminder]) -> Vec<&str> {
        list.iter().map(|r| r.title.as_str()).collect()
    }

    fn get(conn: &Connection, id: i64, today: &str) -> Reminder {
        ReminderRepository::get(conn, id, d(today)).unwrap().unwrap()
    }

    #[test]
    fn create_checks_every_field() {
        let (_d, conn) = setup();
        let err = |i: ReminderInput| ReminderRepository::create(&conn, i).unwrap_err();
        assert_eq!(err(input("  ", "2026-10-31", 0, "NONE")), "Enter what the reminder is for.");
        assert_eq!(err(input("GST", "31-13-2026", 0, "NONE")), "Date is not a valid date.");
        assert_eq!(err(input("GST", "2026-10-31", 400, "NONE")), "Remind me can be 0 to 365 days before.");
        assert_eq!(err(input("GST", "2026-10-31", -1, "NONE")), "Remind me can be 0 to 365 days before.");
        assert_eq!(err(input("GST", "2026-10-31", 0, "DAILY")), "Choose how often it repeats.");
        let mut bad = input("GST", "2026-10-31", 0, "NONE");
        bad.link_kind = Some("CAR".to_string());
        bad.link_id = Some(1);
        assert_eq!(err(bad), "That record type can't have a reminder.");
        let mut half = input("GST", "2026-10-31", 0, "NONE");
        half.link_kind = Some("TENANT".to_string());
        assert_eq!(err(half.clone()), "Choose the record to link.");
        half.link_kind = None;
        half.link_id = Some(1);
        assert_eq!(err(half), "Choose the record to link.");
        let mut gone = input("GST", "2026-10-31", 0, "NONE");
        gone.link_kind = Some("TENANT".to_string());
        gone.link_id = Some(999);
        assert_eq!(err(gone), "That record no longer exists.");

        let mut ok = input(" Pay GST ", "31-10-2026", 3, "monthly");
        ok.note = Some(" from the current account ".to_string());
        let saved = ReminderRepository::create(&conn, ok).unwrap();
        assert_eq!(
            (saved.title.as_str(), saved.note.as_deref(), saved.due_date.as_str(), saved.repeat.as_str(), saved.remind_days),
            ("Pay GST", Some("from the current account"), "2026-10-31", "MONTHLY", 3)
        );
        let mut blank_note = input("GST", "2026-10-31", 0, "NONE");
        blank_note.note = Some("   ".to_string());
        assert_eq!(ReminderRepository::create(&conn, blank_note).unwrap().note, None);

        assert_eq!(ReminderRepository::update(&conn, 9999, input("GST", "2026-10-31", 0, "NONE")).unwrap_err(), "Reminder not found.");
        assert_eq!(ReminderRepository::delete(&conn, 9999).unwrap_err(), "Reminder not found.");
        ReminderRepository::delete(&conn, saved.id).unwrap();
        assert!(ReminderRepository::get(&conn, saved.id, d("2026-10-01")).unwrap().is_none());
    }

    #[test]
    fn states_and_tabs() {
        let (_d, conn) = setup();
        let today = d("2026-11-10");
        add(&conn, "Waiting", "2026-11-20", 2, "NONE");
        add(&conn, "Coming up", "2026-11-12", 2, "NONE");
        add(&conn, "Due today", "2026-11-10", 0, "NONE");
        add(&conn, "Overdue", "2026-11-05", 0, "NONE");

        let due = ReminderRepository::list(&conn, "DUE", today).unwrap();
        assert_eq!(titles(&due), vec!["Overdue", "Due today", "Coming up"]);
        assert_eq!(
            due.iter().map(|r| (r.state.as_str(), r.days_away)).collect::<Vec<_>>(),
            vec![("OVERDUE", -5), ("DUE_TODAY", 0), ("COMING_UP", 2)]
        );
        assert_eq!(titles(&ReminderRepository::list(&conn, "UPCOMING", today).unwrap()), vec!["Waiting"]);
        assert_eq!(titles(&ReminderRepository::banner(&conn, today).unwrap()), vec!["Overdue", "Due today", "Coming up"]);
        assert!(ReminderRepository::list(&conn, "DONE", today).unwrap().is_empty());
        assert!(ReminderRepository::list(&conn, "SOON", today).is_err());
    }

    #[test]
    fn done_finishes_a_one_time_reminder_and_undo_brings_it_back() {
        let (_d, conn) = setup();
        let today = d("2026-11-10");
        let id = add(&conn, "Pay GST", "2026-11-10", 0, "NONE");
        let done = ReminderRepository::mark_done(&conn, id, today).unwrap();
        assert_eq!((done.state.as_str(), done.done_on.as_deref()), ("DONE", Some("2026-11-10")));
        assert!(ReminderRepository::banner(&conn, today).unwrap().is_empty());
        assert_eq!(titles(&ReminderRepository::list(&conn, "DONE", today).unwrap()), vec!["Pay GST"]);
        ReminderRepository::mark_not_done(&conn, id).unwrap();
        assert_eq!(get(&conn, id, "2026-11-10").state, "DUE_TODAY");
        assert_eq!(titles(&ReminderRepository::banner(&conn, today).unwrap()), vec!["Pay GST"]);
    }

    #[test]
    fn done_moves_a_repeating_reminder_one_step() {
        let (_d, conn) = setup();
        let today = d("2026-10-20");
        let id = add(&conn, "Collect rent", "2026-09-06", 2, "MONTHLY");
        let r = ReminderRepository::mark_done(&conn, id, today).unwrap();
        assert_eq!((r.due_date.as_str(), r.state.as_str(), r.last_done_on.as_deref()), ("2026-10-06", "OVERDUE", Some("2026-10-20")));
        assert_eq!(r.done_on, None);
        let r = ReminderRepository::mark_done(&conn, id, today).unwrap();
        assert_eq!((r.due_date.as_str(), r.state.as_str()), ("2026-11-06", "WAITING"));
        assert!(ReminderRepository::list(&conn, "DONE", today).unwrap().is_empty(), "a repeating reminder is never finished");

        // The day it was set for comes back after a short month.
        let gst = add(&conn, "Rent on the 31st", "2027-01-31", 0, "MONTHLY");
        assert_eq!(ReminderRepository::mark_done(&conn, gst, today).unwrap().due_date, "2027-02-28");
        assert_eq!(ReminderRepository::mark_done(&conn, gst, today).unwrap().due_date, "2027-03-31");
        let mut month_end = input("Pay GST", "2026-04-30", 3, "MONTHLY");
        month_end.month_end = true;
        let gst = ReminderRepository::create(&conn, month_end).unwrap().id;
        assert_eq!(ReminderRepository::mark_done(&conn, gst, today).unwrap().due_date, "2026-05-31");
    }

    #[test]
    fn dismiss_hides_from_the_banner_only() {
        let (_d, conn) = setup();
        let today = d("2026-11-10");
        let id = add(&conn, "Collect rent", "2026-11-06", 2, "MONTHLY");
        ReminderRepository::set_dismissed(&conn, id, true).unwrap();
        assert!(ReminderRepository::banner(&conn, today).unwrap().is_empty());
        let due = ReminderRepository::list(&conn, "DUE", today).unwrap();
        assert_eq!((due.len(), due[0].dismissed), (1, true));
        ReminderRepository::set_dismissed(&conn, id, false).unwrap();
        assert_eq!(ReminderRepository::banner(&conn, today).unwrap().len(), 1);

        ReminderRepository::set_dismissed(&conn, id, true).unwrap();
        let next = ReminderRepository::mark_done(&conn, id, today).unwrap();
        assert!(!next.dismissed, "the next date shows again");
        assert_eq!(next.due_date, "2026-12-06");
        assert_eq!(ReminderRepository::set_dismissed(&conn, 9999, true).unwrap_err(), "Reminder not found.");
    }

    #[test]
    fn links_show_a_label_and_survive_deletion() {
        let (_d, conn) = setup();
        let today = d("2026-11-10");
        conn.execute("INSERT INTO customers (name, party_type, created_at, updated_at) VALUES ('Steel Co', 'SUPPLIER', 'x', 'x')", []).unwrap();
        let supplier = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO supplier_bills (supplier_id, bill_number, bill_date, total_amount, created_at, updated_at) VALUES (?1, 'B-77', '2026-11-01', 100, 'x', 'x')",
            [supplier],
        )
        .unwrap();
        let bill = conn.last_insert_rowid();
        conn.execute("INSERT INTO rental_places (name, monthly_rent, created_at, updated_at) VALUES ('Flat 2B', 5000, 'x', 'x')", []).unwrap();
        let place = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO rental_tenants (place_id, name, whatsapp_number, monthly_rent, created_at, updated_at) VALUES (?1, 'Ravi', '+919876543210', 5000, 'x', 'x')",
            [place],
        )
        .unwrap();
        let tenant = conn.last_insert_rowid();

        let linked = |kind: &str, id: i64, title: &str| {
            let mut i = input(title, "2026-11-10", 0, "NONE");
            i.link_kind = Some(kind.to_string());
            i.link_id = Some(id);
            ReminderRepository::create(&conn, i).unwrap()
        };
        let pay = linked("SUPPLIER_BILL", bill, "Pay the steel bill");
        assert_eq!((pay.link_label.as_deref(), pay.link_missing), (Some("B-77"), false));
        let rent = linked("TENANT", tenant, "Collect rent from Ravi");
        assert_eq!(rent.link_label.as_deref(), Some("Ravi"));
        assert_eq!(linked("COMPANY", supplier, "Call").link_label.as_deref(), Some("Steel Co"));
        assert_eq!(linked("PLACE", place, "Paint").link_label.as_deref(), Some("Flat 2B"));

        assert_eq!(titles(&ReminderRepository::for_record(&conn, "SUPPLIER_BILL", bill, today).unwrap()), vec!["Pay the steel bill"]);
        ReminderRepository::mark_done(&conn, pay.id, today).unwrap();
        assert!(ReminderRepository::for_record(&conn, "SUPPLIER_BILL", bill, today).unwrap().is_empty(), "only open reminders");

        conn.execute("DELETE FROM rental_tenants WHERE id = ?1", [tenant]).unwrap();
        let after = get(&conn, rent.id, "2026-11-10");
        assert_eq!((after.link_label, after.link_missing), (None, true));
        assert_eq!(ReminderRepository::banner(&conn, today).unwrap().len(), 3, "the banner still loads");
    }

    #[test]
    fn month_end_only_for_monthly() {
        let (_d, conn) = setup();
        let mut yearly = input("Renew licence", "2026-04-30", 7, "YEARLY");
        yearly.month_end = true;
        assert!(!ReminderRepository::create(&conn, yearly).unwrap().month_end);
        let mut monthly = input("Pay GST", "2026-04-30", 3, "MONTHLY");
        monthly.month_end = true;
        assert!(ReminderRepository::create(&conn, monthly).unwrap().month_end);
    }

    #[test]
    fn snooze_hides_from_the_banner_until_the_day() {
        let (_d, conn) = setup();
        let id = add(&conn, "Pay GST", "2026-11-05", 0, "NONE");
        let r = ReminderRepository::snooze(&conn, id, 1, d("2026-11-10")).unwrap();
        assert_eq!(r.snoozed_until.as_deref(), Some("2026-11-11"));
        assert!(ReminderRepository::banner(&conn, d("2026-11-10")).unwrap().is_empty(), "hidden today");
        assert_eq!(ReminderRepository::list(&conn, "DUE", d("2026-11-10")).unwrap().len(), 1, "still on the Reminders page");
        assert_eq!(titles(&ReminderRepository::banner(&conn, d("2026-11-11")).unwrap()), vec!["Pay GST"], "back the next day");
        ReminderRepository::snooze(&conn, id, 7, d("2026-11-10")).unwrap();
        assert!(ReminderRepository::banner(&conn, d("2026-11-16")).unwrap().is_empty());
        let r = ReminderRepository::snooze(&conn, id, 0, d("2026-11-10")).unwrap();
        assert_eq!(r.snoozed_until, None, "0 days un-snoozes");
        assert_eq!(ReminderRepository::banner(&conn, d("2026-11-10")).unwrap().len(), 1);
        assert_eq!(ReminderRepository::snooze(&conn, id, 366, d("2026-11-10")).unwrap_err(), "Snooze can be 1 to 365 days.");
        assert_eq!(ReminderRepository::snooze(&conn, 9999, 1, d("2026-11-10")).unwrap_err(), "Reminder not found.");
    }

    #[test]
    fn done_and_editing_clear_a_snooze() {
        let (_d, conn) = setup();
        let today = d("2026-11-10");
        let id = add(&conn, "Collect rent", "2026-11-06", 2, "MONTHLY");
        ReminderRepository::snooze(&conn, id, 30, today).unwrap();
        assert_eq!(ReminderRepository::mark_done(&conn, id, today).unwrap().snoozed_until, None, "the next date is not snoozed");
        ReminderRepository::snooze(&conn, id, 30, today).unwrap();
        let r = ReminderRepository::update(&conn, id, input("Collect rent", "2026-11-06", 2, "MONTHLY")).unwrap();
        assert_eq!(r.snoozed_until, None);
    }

    #[test]
    fn snooze_choices_default_to_one_day_and_can_be_changed() {
        let (_d, conn) = setup();
        assert_eq!(ReminderRepository::snooze_choices(&conn).unwrap(), vec![1]);
        assert_eq!(ReminderRepository::save_snooze_choices(&conn, vec![7, 1, 3, 3]).unwrap(), vec![1, 3, 7], "sorted, no repeats");
        assert_eq!(ReminderRepository::snooze_choices(&conn).unwrap(), vec![1, 3, 7]);
        assert_eq!(ReminderRepository::save_snooze_choices(&conn, vec![]).unwrap_err(), "Keep at least one snooze choice.");
        assert_eq!(ReminderRepository::save_snooze_choices(&conn, vec![0]).unwrap_err(), "Snooze can be 1 to 365 days.");
        assert_eq!(ReminderRepository::save_snooze_choices(&conn, vec![1, 2, 3, 4, 5, 6]).unwrap_err(), "Up to 5 snooze choices.");
        assert_eq!(ReminderRepository::snooze_choices(&conn).unwrap(), vec![1, 3, 7], "a refused save changes nothing");
    }
}
