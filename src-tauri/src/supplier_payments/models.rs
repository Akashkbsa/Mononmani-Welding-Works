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
    /// Earlier advances used by this payment.
    pub credit_applied: f64,
    /// Part of this payment not applied to bills.
    pub excess_amount: f64,
    /// "CREDIT" (kept as advance), "ROUNDOFF" (counted as paid, nothing owed back) or "NONE".
    pub excess_action: String,
    /// How much of this payment's advance later payments have already used.
    pub advance_used: f64,
    pub remarks: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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
    /// Most of the supplier's advance this payment may use; only what the allocations need is taken.
    #[serde(default)]
    pub credit_to_apply: f64,
    pub remarks: Option<String>,
    #[serde(default)]
    pub allocations: Vec<SupplierAllocationInput>,
    /// "CREDIT" or "ROUNDOFF" for any amount left over (none means CREDIT).
    pub excess_action: Option<String>,
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
    pub credit_applied: f64,
    pub excess_amount: f64,
    pub excess_action: String,
    pub bills_covered: Vec<String>,
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

/// An advance paid to a supplier that later payments can use.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierCredit {
    pub id: i64,
    pub supplier_id: i64,
    pub source_payment_id: Option<i64>,
    pub source_payment_number: Option<String>,
    pub original_amount: f64,
    pub remaining_amount: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierPaymentsSummary {
    pub total_paid: f64,
    pub paid_this_month: f64,
    pub advances_held: f64,
}
