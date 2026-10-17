use serde::{Deserialize, Serialize};

/// What a company owed before its records in the app: + they owe us (Dr), − we owe them (Cr).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct OpeningBalance {
    pub amount: f64,
    /// YYYY-MM-DD the balance stood on; None when no opening balance is set.
    pub as_on: Option<String>,
}

/// One line of the ledger. Debit: they owe us more (our invoices, our payments to them).
/// Credit: they owe us less (their payments, their bills).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LedgerLine {
    /// YYYY-MM-DD
    pub date: String,
    /// "Opening balance", "Sales invoice", "Payment received", "Purchase bill", "Payment made", ...
    pub particulars: String,
    /// Invoice, bill or payment number; empty for the opening balance.
    pub number: String,
    /// Method and reference, or what a line is for; may be empty.
    pub detail: String,
    pub debit: f64,
    pub credit: f64,
    /// Running balance after this line: + Dr (they owe us), − Cr (we owe them).
    pub balance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ledger {
    pub company_id: i64,
    pub company_name: String,
    /// "CUSTOMER", "SUPPLIER" or "BOTH".
    pub party_type: String,
    /// YYYY-MM-DD, None for from the start / to the latest record.
    pub from: Option<String>,
    pub to: Option<String>,
    /// Balance carried in from before `from` (includes the opening balance when it is earlier).
    pub brought_forward: f64,
    pub lines: Vec<LedgerLine>,
    pub total_debit: f64,
    pub total_credit: f64,
    pub closing: f64,
    pub opening_balance: OpeningBalance,
    /// Every record date, for the period picker.
    pub dates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpeningBalanceInput {
    /// + they owe us, − we owe them; 0 removes it.
    pub amount: f64,
    pub as_on: Option<String>,
}
