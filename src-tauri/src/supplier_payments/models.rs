use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierPayment {
    pub id: i64,
    pub payment_number: String,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub payment_date: String,
    pub payment_method: String,
    pub reference_number: Option<String>,
    pub bank_name: Option<String>,
    pub amount_paid: f64,
    /// Short amount the supplier accepted as full payment; counts towards settling the bills.
    pub writeoff_amount: f64,
    /// Money paid plus the written-off part.
    pub total_settled: f64,
    /// Part of this payment beyond the bills it covers (a round-off, counted as paid).
    pub excess_amount: f64,
    /// "ROUNDOFF" when there is an extra amount, otherwise "NONE".
    pub excess_action: String,
    pub remarks: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// YYYY-MM-DD the WhatsApp message was last opened for the supplier; None if never.
    pub whatsapp_sent_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierAllocationDetail {
    pub bill_id: i64,
    pub bill_number: String,
    pub bill_date: String,
    pub bill_total_amount: f64,
    pub allocated_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierPaymentWithAllocations {
    pub payment: SupplierPayment,
    pub allocations: Vec<SupplierAllocationDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierAllocationInput {
    pub bill_id: i64,
    pub allocated_amount: f64,
}

/// Used for both recording and editing a payment. On edit the supplier and number are fixed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierPaymentInput {
    pub payment_number: Option<String>,
    pub supplier_id: i64,
    pub payment_date: String,
    pub payment_method: Option<String>,
    pub reference_number: Option<String>,
    pub bank_name: Option<String>,
    pub amount_paid: f64,
    pub remarks: Option<String>,
    #[serde(default)]
    pub allocations: Vec<SupplierAllocationInput>,
    /// Short amount accepted as full payment. It cannot be more than what is actually short.
    #[serde(default)]
    pub writeoff_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierPaymentListItem {
    pub id: i64,
    pub payment_number: String,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub payment_date: String,
    pub payment_method: String,
    pub reference_number: Option<String>,
    pub amount_paid: f64,
    pub writeoff_amount: f64,
    pub total_settled: f64,
    pub excess_amount: f64,
    pub excess_action: String,
    pub bills_covered: Vec<String>,
    pub whatsapp_sent_on: Option<String>,
}

/// The WhatsApp message for one payment and the link that opens the supplier's chat with it typed in.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierPaymentMessage {
    pub message: String,
    /// `+` and digits, e.g. +919876543210.
    pub number: String,
    pub link: String,
    pub whatsapp_sent_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SupplierPaymentFilter {
    /// Matches the payment number, supplier, reference, remarks or a bill number.
    pub query: Option<String>,
    pub supplier_id: Option<i64>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub payment_method: Option<String>,
}

/// A bill a payment to this supplier can be applied to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnpaidBill {
    pub bill_id: i64,
    pub bill_number: String,
    pub bill_date: String,
    pub total_amount: f64,
    /// Already settled by other payments.
    pub total_settled: f64,
    pub outstanding_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierPaymentsSummary {
    pub total_paid: f64,
    pub paid_this_month: f64,
}
