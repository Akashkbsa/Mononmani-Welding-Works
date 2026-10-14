use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderInput {
    pub title: String,
    pub note: Option<String>,
    /// YYYY-MM-DD or DD-MM-YYYY.
    pub due_date: String,
    /// Start showing it this many days before the date (0 to 365).
    pub remind_days: i64,
    /// NONE, WEEKLY, MONTHLY or YEARLY.
    pub repeat: String,
    /// Monthly only: on the last day of every month.
    #[serde(default)]
    pub month_end: bool,
    /// INVOICE, QUOTATION, PURCHASE_ORDER, PAYMENT, SUPPLIER_BILL, SUPPLIER_PAYMENT, COMPANY, TENANT or PLACE.
    pub link_kind: Option<String>,
    pub link_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: i64,
    pub title: String,
    pub note: Option<String>,
    /// YYYY-MM-DD: the next (or only) date.
    pub due_date: String,
    pub remind_days: i64,
    pub repeat: String,
    pub month_end: bool,
    pub link_kind: Option<String>,
    pub link_id: Option<i64>,
    /// The linked record's number or name.
    pub link_label: Option<String>,
    /// The linked record was deleted.
    pub link_missing: bool,
    /// Taken off the banner by the owner; still not done.
    pub dismissed: bool,
    /// When a one-time reminder was finished.
    pub done_on: Option<String>,
    /// When a repeating reminder was last marked done.
    pub last_done_on: Option<String>,
    /// WAITING, COMING_UP, DUE_TODAY, OVERDUE, or DONE for a finished one-time reminder.
    pub state: String,
    /// Days from today to the date; negative when late.
    pub days_away: i64,
    pub created_at: String,
    pub updated_at: String,
}
