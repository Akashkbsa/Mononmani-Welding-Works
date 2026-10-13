use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    pub id: i64,
    pub invoice_number: String,
    pub invoice_date: String,
    pub due_date: Option<String>,
    pub payment_terms_days: i32,
    pub invoice_state: String,
    
    // Customer snapshot
    pub customer_id: Option<i64>,
    pub customer_name: String,
    pub customer_address: Option<String>,
    pub customer_phone: Option<String>,
    pub customer_gstin: Option<String>,
    pub customer_state: Option<String>,
    pub customer_state_code: Option<String>,
    
    // Reference & Delivery details
    pub po_number_and_date: Option<String>,
    pub vehicle_number: Option<String>,
    pub date_of_supply: Option<String>,
    pub place_of_supply: Option<String>,
    pub our_dc_number_and_date: Option<String>,
    pub your_dc_number_and_date: Option<String>,
    pub delivery_note: Option<String>,
    pub supplier_ref: Option<String>,
    pub buyer_ref: Option<String>,
    pub dispatch_doc_no: Option<String>,
    pub delivery_note_date: Option<String>,
    pub dispatch_through: Option<String>,
    pub destination: Option<String>,
    pub terms_of_delivery: Option<String>,
    
    // Tax & Totals calculation
    pub tax_type: String, // "CGST_SGST" or "IGST"
    pub subtotal: f64,
    pub discount: f64,
    pub cgst_rate: f64,
    pub cgst_amount: f64,
    pub sgst_rate: f64,
    pub sgst_amount: f64,
    pub igst_rate: f64,
    pub igst_amount: f64,
    pub round_off: f64,
    pub total_amount: f64,
    pub amount_in_words: String,
    
    // Bank details snapshot
    pub bank_name: String,
    pub bank_branch: String,
    pub bank_account_no: String,
    pub bank_ifsc: String,
    
    // Terms & Conditions
    pub terms_and_conditions: Option<String>,
    
    // Status & Notes
    pub status: String,
    pub notes: Option<String>,
    pub pdf_path: Option<String>,
    pub purchase_order_id: Option<i64>,
    pub purchase_order_number: Option<String>,
    
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceItem {
    pub id: i64,
    pub invoice_id: i64,
    pub sl_no: i32,
    pub description: String,
    pub hsn_sac: String,
    pub qum: String,
    pub quantity: f64,
    pub rate: f64,
    pub amount: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceWithItems {
    pub invoice: Invoice,
    pub items: Vec<InvoiceItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceListItem {
    pub id: i64,
    pub invoice_number: String,
    pub invoice_date: String,
    pub due_date: Option<String>,
    pub payment_terms_days: i32,
    pub customer_id: Option<i64>,
    pub customer_name: String,
    pub customer_gstin: Option<String>,
    pub total_amount: f64,
    pub tax_type: String,
    pub status: String,
    pub paid_amount: f64,
    pub tds_amount: f64,
    pub total_settled: f64,
    pub outstanding_amount: f64,
    pub payment_status: String,
    pub pdf_path: Option<String>,
    pub purchase_order_id: Option<i64>,
    pub purchase_order_number: Option<String>,
    pub items_count: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceItemInput {
    pub sl_no: Option<i32>,
    pub description: String,
    pub hsn_sac: Option<String>,
    pub qum: Option<String>,
    pub quantity: f64,
    pub rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceCreateInput {
    pub invoice_number: String,
    pub invoice_date: String,
    pub due_date: Option<String>,
    pub payment_terms_days: Option<i32>,
    pub invoice_state: Option<String>,
    
    // Customer snapshot (supplied from selected customer or manual entry)
    pub customer_id: Option<i64>,
    pub customer_name: String,
    pub customer_address: Option<String>,
    pub customer_phone: Option<String>,
    pub customer_gstin: Option<String>,
    pub customer_state: Option<String>,
    pub customer_state_code: Option<String>,
    
    // Reference & Delivery details
    pub po_number_and_date: Option<String>,
    pub vehicle_number: Option<String>,
    pub date_of_supply: Option<String>,
    pub place_of_supply: Option<String>,
    pub our_dc_number_and_date: Option<String>,
    pub your_dc_number_and_date: Option<String>,
    pub delivery_note: Option<String>,
    pub supplier_ref: Option<String>,
    pub buyer_ref: Option<String>,
    pub dispatch_doc_no: Option<String>,
    pub delivery_note_date: Option<String>,
    pub dispatch_through: Option<String>,
    pub destination: Option<String>,
    pub terms_of_delivery: Option<String>,
    
    // Tax details
    pub tax_type: String, // "CGST_SGST" or "IGST"
    pub discount: Option<f64>,
    pub cgst_rate: Option<f64>,
    pub sgst_rate: Option<f64>,
    pub igst_rate: Option<f64>,
    
    // Bank & Terms details
    pub bank_name: Option<String>,
    pub bank_branch: Option<String>,
    pub bank_account_no: Option<String>,
    pub bank_ifsc: Option<String>,
    pub terms_and_conditions: Option<String>,
    
    pub status: Option<String>,
    pub notes: Option<String>,
    /// The purchase order this invoice is raised against (same customer), or none.
    #[serde(default)]
    pub purchase_order_id: Option<i64>,
    
    // Line items
    pub items: Vec<InvoiceItemInput>,
}

/// Edits send the same fields as a new invoice.
pub type InvoiceUpdateInput = InvoiceCreateInput;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InvoiceFilterInput {
    pub query: Option<String>,
    pub status: Option<String>,
    pub customer_id: Option<i64>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateInvoiceCheckResult {
    pub has_duplicate: bool,
    pub existing_invoice_id: Option<i64>,
}
