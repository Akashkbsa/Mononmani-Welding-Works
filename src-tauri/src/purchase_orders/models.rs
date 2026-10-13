use serde::{Deserialize, Serialize};

pub const STATUSES: [&str; 3] = ["NOT_STARTED", "PARTIAL", "COMPLETED"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrder {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub po_number: String,
    pub po_date: Option<String>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrderListItem {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub po_number: String,
    pub po_date: Option<String>,
    pub status: String,
    pub file_count: i64,
    pub invoice_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrderFileInfo {
    pub id: i64,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
}

/// An invoice as shown under a purchase order, or in the list of invoices that can still be attached.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedInvoice {
    pub id: i64,
    pub invoice_number: String,
    pub invoice_date: String,
    pub total_amount: f64,
    pub status: String,
    pub payment_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrderDetail {
    pub order: PurchaseOrder,
    pub files: Vec<PurchaseOrderFileInfo>,
    pub invoices: Vec<LinkedInvoice>,
}

/// `invoice_ids` are invoices to attach when saving. Unlinking is a separate action
/// (`PurchaseOrderRepository::set_invoice_link` with `None`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrderInput {
    pub customer_id: i64,
    pub po_number: String,
    pub po_date: Option<String>,
    pub status: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub invoice_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PurchaseOrderFilter {
    pub query: Option<String>,
    pub status: Option<String>,
    pub customer_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicatePoCheck {
    pub has_duplicate: bool,
    pub existing_id: Option<i64>,
}
