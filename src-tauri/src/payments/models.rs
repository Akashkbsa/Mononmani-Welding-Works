use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payment {
    pub id: i64,
    pub payment_number: String,
    pub customer_id: Option<i64>,
    pub customer_name: String,
    pub payment_date: String,
    pub payment_method: String,
    pub reference_number: Option<String>,
    pub bank_name: Option<String>,
    pub amount_received: f64,
    pub tds_amount: f64,
    /// Whether the TDS counts towards the invoices.
    pub tds_recognized: bool,
    /// Money received plus recognized TDS.
    pub total_settled: f64,
    /// Earlier advances used by this payment.
    pub credit_applied: f64,
    /// Part of this payment not allocated to invoices.
    pub excess_amount: f64,
    /// "CREDIT" (kept as advance), "REFUND" (returned), "ROUNDOFF" (kept, nothing owed back) or "NONE".
    pub excess_action: String,
    /// Short amount accepted as full payment; counts towards settling the invoices.
    pub writeoff_amount: f64,
    /// How much of this payment's advance later payments have already used.
    pub advance_used: f64,
    pub is_verified: bool,
    pub remarks: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentAllocationDetail {
    pub invoice_id: i64,
    pub invoice_number: String,
    pub invoice_date: String,
    pub invoice_total_amount: f64,
    pub allocated_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentWithAllocations {
    pub payment: Payment,
    pub allocations: Vec<PaymentAllocationDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentListItem {
    pub id: i64,
    pub payment_number: String,
    pub customer_id: Option<i64>,
    pub customer_name: String,
    pub payment_date: String,
    pub payment_method: String,
    pub reference_number: Option<String>,
    pub amount_received: f64,
    pub tds_amount: f64,
    pub tds_recognized: bool,
    pub total_settled: f64,
    pub credit_applied: f64,
    pub excess_amount: f64,
    pub excess_action: String,
    pub writeoff_amount: f64,
    pub is_verified: bool,
    pub invoices_covered: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentAllocationInput {
    pub invoice_id: i64,
    pub allocated_amount: f64,
}

/// Used for both recording and editing a payment. On edit the customer and number are fixed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentInput {
    pub payment_number: Option<String>,
    pub customer_id: i64,
    pub payment_date: String,
    pub payment_method: Option<String>,
    pub reference_number: Option<String>,
    pub bank_name: Option<String>,
    pub amount_received: f64,
    #[serde(default)]
    pub tds_amount: f64,
    #[serde(default = "default_true")]
    pub tds_recognized: bool,
    /// Most of the customer's advance this payment may use; only what the allocations need is taken.
    #[serde(default)]
    pub credit_to_apply: f64,
    #[serde(default)]
    pub is_verified: bool,
    pub remarks: Option<String>,
    #[serde(default)]
    pub allocations: Vec<PaymentAllocationInput>,
    /// "CREDIT", "REFUND" or "ROUNDOFF" for any amount left unallocated.
    pub excess_action: Option<String>,
    /// Short amount the owner accepts as full payment. Must equal what is still short after
    /// the money received, recognised TDS and any advance used.
    #[serde(default)]
    pub writeoff_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PaymentFilterInput {
    pub query: Option<String>,
    pub customer_id: Option<i64>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub payment_method: Option<String>,
    pub is_verified: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerCredit {
    pub id: i64,
    pub customer_id: i64,
    pub source_payment_id: Option<i64>,
    pub source_payment_number: Option<String>,
    pub original_amount: f64,
    pub remaining_amount: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnpaidInvoiceSummary {
    pub invoice_id: i64,
    pub invoice_number: String,
    pub invoice_date: String,
    pub total_amount: f64,
    /// Amount before GST (subtotal less discount); the usual base for TDS.
    pub taxable_amount: f64,
    /// Settled by other payments.
    pub total_settled: f64,
    pub outstanding_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoicePaymentItem {
    pub payment_id: i64,
    pub payment_number: String,
    pub payment_date: String,
    pub payment_method: String,
    pub reference_number: Option<String>,
    pub amount: f64,
    pub is_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoicePaymentSummary {
    pub invoice_id: i64,
    pub total_amount: f64,
    pub total_settled: f64,
    pub outstanding_amount: f64,
    pub payment_status: String,
    pub payments: Vec<InvoicePaymentItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentsKpiSummary {
    pub total_received: f64,
    pub total_tds: f64,
    pub total_outstanding: f64,
    pub unpaid_invoices_count: i64,
    pub unverified_count: i64,
    pub advances_held: f64,
    pub received_this_month: f64,
    pub invoiced_this_month: f64,
}

fn default_true() -> bool {
    true
}
