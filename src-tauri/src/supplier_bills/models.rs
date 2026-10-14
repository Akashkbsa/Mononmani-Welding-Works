use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierBill {
    pub id: i64,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub bill_number: String,
    pub bill_date: String,
    pub total_amount: f64,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// `status` is "NOT_PAID", "PARTIAL" or "PAID", worked out from the payments allocated to the bill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierBillListItem {
    pub id: i64,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub bill_number: String,
    pub bill_date: String,
    pub total_amount: f64,
    pub settled_amount: f64,
    pub outstanding_amount: f64,
    pub status: String,
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierBillFileInfo {
    pub id: i64,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
}

/// A supplier payment as shown under the bill it settles.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillPayment {
    pub payment_id: i64,
    pub payment_number: String,
    pub payment_date: String,
    pub payment_method: String,
    pub reference_number: Option<String>,
    /// What this payment settled on this bill (including any written-off part).
    pub amount_settled: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierBillDetail {
    pub bill: SupplierBill,
    pub settled_amount: f64,
    pub outstanding_amount: f64,
    pub status: String,
    pub files: Vec<SupplierBillFileInfo>,
    pub payments: Vec<BillPayment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierBillInput {
    pub supplier_id: i64,
    pub bill_number: String,
    /// YYYY-MM-DD or DD-MM-YYYY
    pub bill_date: String,
    pub total_amount: f64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SupplierBillFilter {
    /// Matches the bill number or the supplier's name.
    pub query: Option<String>,
    pub supplier_id: Option<i64>,
    /// "ALL", "NOT_PAID", "PARTIAL" or "PAID".
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateBillCheck {
    pub has_duplicate: bool,
    pub existing_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierBillsSummary {
    /// What is still owed on all bills.
    pub total_outstanding: f64,
    pub open_bills_count: i64,
}
