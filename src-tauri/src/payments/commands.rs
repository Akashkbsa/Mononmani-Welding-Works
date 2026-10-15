use super::models::{
    CustomerCredit, InvoicePaymentSummary, PaymentFilterInput, PaymentInput, PaymentListItem,
    PaymentWithAllocations, PaymentsKpiSummary, UnpaidInvoiceSummary,
};
use super::repository::PaymentRepository;
use crate::AppState;
use tauri::State;

#[tauri::command(async)]
pub fn list_payments(
    filter: Option<PaymentFilterInput>,
    state: State<'_, AppState>,
) -> Result<Vec<PaymentListItem>, String> {
    let conn = state.db.connection()?;
    PaymentRepository::list_payments(&conn, filter.unwrap_or_default())
}

#[tauri::command(async)]
pub fn get_payment(id: i64, state: State<'_, AppState>) -> Result<Option<PaymentWithAllocations>, String> {
    let conn = state.db.connection()?;
    PaymentRepository::get_payment_by_id(&conn, id)
}

#[tauri::command(async)]
pub fn create_payment(input: PaymentInput, state: State<'_, AppState>) -> Result<PaymentWithAllocations, String> {
    let conn = state.db.connection()?;
    PaymentRepository::create_payment(&conn, input)
}

#[tauri::command(async)]
pub fn update_payment(
    id: i64,
    input: PaymentInput,
    state: State<'_, AppState>,
) -> Result<PaymentWithAllocations, String> {
    let conn = state.db.connection()?;
    PaymentRepository::update_payment(&conn, id, input)
}

#[tauri::command(async)]
pub fn delete_payment(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    PaymentRepository::delete_payment(&conn, id)
}

#[tauri::command(async)]
pub fn get_next_payment_number(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.connection()?;
    PaymentRepository::get_next_payment_number(&conn)
}

#[tauri::command(async)]
pub fn get_unpaid_invoices_for_customer(
    customer_id: i64,
    exclude_payment_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<UnpaidInvoiceSummary>, String> {
    let conn = state.db.connection()?;
    PaymentRepository::get_unpaid_invoices_for_customer(&conn, customer_id, exclude_payment_id)
}

#[tauri::command(async)]
pub fn get_invoice_payment_summary(
    invoice_id: i64,
    state: State<'_, AppState>,
) -> Result<InvoicePaymentSummary, String> {
    let conn = state.db.connection()?;
    PaymentRepository::get_invoice_payment_summary(&conn, invoice_id)
}

#[tauri::command(async)]
pub fn get_payments_kpi_summary(state: State<'_, AppState>) -> Result<PaymentsKpiSummary, String> {
    let conn = state.db.connection()?;
    PaymentRepository::get_payments_kpi_summary(&conn)
}

#[tauri::command(async)]
pub fn get_customer_credits(
    customer_id: i64,
    exclude_payment_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<CustomerCredit>, String> {
    let conn = state.db.connection()?;
    PaymentRepository::get_customer_credits(&conn, customer_id, exclude_payment_id)
}
