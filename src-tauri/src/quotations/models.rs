use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quotation {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub quotation_number: String,
    pub quotation_date: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotationListItem {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub quotation_number: String,
    pub quotation_date: String,
    pub file_count: i64,
    pub order_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotationFileInfo {
    pub id: i64,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
}

/// A purchase order as shown under a quotation, or in the list of orders that can still be attached.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedOrder {
    pub id: i64,
    pub po_number: String,
    pub po_date: Option<String>,
    pub status: String,
    pub invoice_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotationDetail {
    pub quotation: Quotation,
    pub files: Vec<QuotationFileInfo>,
    pub orders: Vec<LinkedOrder>,
}

/// `purchase_order_ids` are orders to attach when saving. Unlinking is a separate action
/// (`QuotationRepository::set_purchase_order_link` with `None`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotationInput {
    pub customer_id: i64,
    pub quotation_number: String,
    pub quotation_date: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub purchase_order_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QuotationFilter {
    pub query: Option<String>,
    pub customer_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateQuotationCheck {
    pub has_duplicate: bool,
    pub existing_id: Option<i64>,
    pub existing_customer_name: Option<String>,
}
