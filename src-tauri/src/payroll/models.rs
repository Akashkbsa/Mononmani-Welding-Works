use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Employee {
    pub id: i64,
    pub name: String,
    pub role: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub joined_on: String,
    pub left_on: Option<String>,
    pub daily_wage: f64,
    /// Per hour; 0 means no overtime pay.
    pub ot_rate: f64,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmployeeInput {
    pub name: String,
    pub role: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub joined_on: String,
    pub daily_wage: f64,
    pub ot_rate: f64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmployeeListItem {
    pub id: i64,
    pub name: String,
    pub role: Option<String>,
    pub phone: Option<String>,
    pub daily_wage: f64,
    pub ot_rate: f64,
    pub joined_on: String,
    pub left_on: Option<String>,
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmployeeFileInfo {
    pub id: i64,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmployeeDetail {
    pub employee: Employee,
    pub files: Vec<EmployeeFileInfo>,
}

/// One employee's entered month: days, OT hours and the rates copied when it was first saved.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayRow {
    pub id: i64,
    pub employee_id: i64,
    /// YYYY-MM
    pub month: String,
    pub days_worked: f64,
    pub daily_wage: f64,
    pub ot_hours: f64,
    pub ot_rate: f64,
    pub bonus_amount: f64,
    pub bonus_note: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayMonthInput {
    pub days_worked: f64,
    pub ot_hours: f64,
    /// None copies the employee's on first save, otherwise keeps the row's.
    pub daily_wage: Option<f64>,
    pub ot_rate: Option<f64>,
    pub bonus_amount: f64,
    pub bonus_note: Option<String>,
    pub note: Option<String>,
}

/// A month's pay worked out from its row and entries. Never stored.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MonthFigures {
    pub wages: f64,
    pub ot_amount: f64,
    pub bonus: f64,
    pub earned: f64,
    /// Advances and salary, plus an advance carried in from the month before.
    pub given: f64,
    /// Cash returned, written off, or taken from next month.
    pub cleared: f64,
    /// + paid less and accepted, - paid more.
    pub rounded_off: f64,
    /// + still to pay, - overpaid.
    pub balance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmployeePayment {
    pub id: i64,
    pub employee_id: i64,
    pub month: String,
    /// ADVANCE, SALARY, RETURNED, WRITE_OFF or CARRIED.
    pub kind: String,
    pub entry_date: String,
    pub amount: f64,
    pub round_off: f64,
    /// CARRIED only: the month it counts as an advance on.
    pub carried_to: Option<String>,
    pub payment_method: Option<String>,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmployeePaymentInput {
    pub employee_id: i64,
    pub month: String,
    pub kind: String,
    pub entry_date: String,
    pub amount: f64,
    /// SALARY only: round off the difference and finish the month.
    #[serde(default)]
    pub finish: bool,
    pub payment_method: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayMonthDetail {
    pub employee: Employee,
    pub month: String,
    pub row: Option<PayRow>,
    pub figures: MonthFigures,
    /// NOT_ENTERED, TO_PAY, PAID or OVERPAID.
    pub status: String,
    /// False for a later month that only holds an advance carried into it.
    pub editable: bool,
    /// Entries counted against this month.
    pub entries: Vec<EmployeePayment>,
    /// Advances carried in from the month before.
    pub carried_in: Vec<EmployeePayment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaySheetRow {
    pub employee_id: i64,
    pub name: String,
    pub role: Option<String>,
    pub row: Option<PayRow>,
    pub figures: MonthFigures,
    pub status: String,
    pub current_wage: f64,
    pub current_ot_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaySheet {
    pub month: String,
    /// The range of months the picker offers.
    pub first_month: String,
    pub last_month: String,
    pub rows: Vec<PaySheetRow>,
    pub total_earned: f64,
    pub total_given: f64,
    pub total_to_pay: f64,
    pub not_entered: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaySheetEntry {
    pub employee_id: i64,
    pub days_worked: f64,
    pub ot_hours: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayMonthSummary {
    pub month: String,
    pub row: Option<PayRow>,
    pub figures: MonthFigures,
    pub status: String,
}
