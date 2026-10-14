use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RentalFileInfo {
    pub id: i64,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Place {
    pub id: i64,
    pub name: String,
    pub address: Option<String>,
    pub monthly_rent: f64,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceInput {
    pub name: String,
    pub address: Option<String>,
    pub monthly_rent: f64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceListItem {
    pub id: i64,
    pub name: String,
    pub address: Option<String>,
    pub monthly_rent: f64,
    /// The tenant living there now; none means the place is vacant.
    pub current_tenant: Option<String>,
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceDetail {
    pub place: Place,
    pub files: Vec<RentalFileInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tenant {
    pub id: i64,
    pub place_id: i64,
    pub place_name: String,
    pub name: String,
    /// `+` and digits, e.g. +919876543210.
    pub whatsapp_number: String,
    pub monthly_rent: f64,
    pub move_in_date: Option<String>,
    pub moved_out_date: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantInput {
    pub place_id: i64,
    pub name: String,
    pub whatsapp_number: String,
    pub monthly_rent: f64,
    pub move_in_date: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantListItem {
    pub id: i64,
    pub place_id: i64,
    pub place_name: String,
    pub name: String,
    pub whatsapp_number: String,
    pub monthly_rent: f64,
    pub move_in_date: Option<String>,
    pub moved_out_date: Option<String>,
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantDetail {
    pub tenant: Tenant,
    pub files: Vec<RentalFileInfo>,
}

/// One tenant on one month's list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthRow {
    pub tenant_id: i64,
    pub tenant_name: String,
    pub place_name: String,
    pub whatsapp_number: String,
    /// What was recorded for a paid month, else the tenant's current rent.
    pub rent_amount: f64,
    pub paid: bool,
    pub paid_on: Option<String>,
    pub paid_amount: Option<f64>,
    pub note: Option<String>,
    /// Reminders the owner confirmed as sent for this month.
    pub reminders_sent: i64,
    /// The day the latest confirmed reminder was sent.
    pub last_sent_on: Option<String>,
    /// The day a reminder was opened in WhatsApp but not yet confirmed as sent.
    pub opened_unconfirmed_on: Option<String>,
}

/// One reminder for a tenant and month. `number` is 1 for the first reminder, 2 for the second, and so on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderEntry {
    pub id: i64,
    pub number: i64,
    pub opened_on: String,
    /// Empty until the owner confirms the message was sent in WhatsApp.
    pub sent_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthSummary {
    pub paid_count: i64,
    pub total_count: i64,
    pub collected: f64,
    pub pending: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthOverview {
    /// `YYYY-MM`.
    pub month: String,
    pub rows: Vec<MonthRow>,
    pub summary: MonthSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkPaidInput {
    pub tenant_id: i64,
    /// `YYYY-MM`.
    pub month: String,
    pub paid_on: String,
    /// Blank means the tenant's rent.
    pub amount: Option<f64>,
    pub note: Option<String>,
}

/// The message for one unpaid tenant and the WhatsApp link that opens it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RentReminder {
    pub tenant_id: i64,
    pub tenant_name: String,
    pub number: String,
    /// Which reminder this would be: 1 when none was confirmed sent yet, 2 after one, and so on.
    pub reminder_number: i64,
    pub message: String,
    pub link: String,
}
