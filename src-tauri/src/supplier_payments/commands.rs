use super::models::{
    SupplierPaymentFilter, SupplierPaymentInput, SupplierPaymentListItem, SupplierPaymentMessage, SupplierPaymentWithAllocations,
    SupplierPaymentsSummary, UnpaidBill,
};
use super::repository::SupplierPaymentRepository;
use crate::util::today;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn list_supplier_payments(
    filter: Option<SupplierPaymentFilter>,
    state: State<'_, AppState>,
) -> Result<Vec<SupplierPaymentListItem>, String> {
    let conn = state.db.get_connection()?;
    SupplierPaymentRepository::list(&conn, filter.unwrap_or_default())
}

#[tauri::command]
pub fn get_supplier_payment(id: i64, state: State<'_, AppState>) -> Result<Option<SupplierPaymentWithAllocations>, String> {
    let conn = state.db.get_connection()?;
    SupplierPaymentRepository::get(&conn, id)
}

#[tauri::command]
pub fn create_supplier_payment(
    input: SupplierPaymentInput,
    state: State<'_, AppState>,
) -> Result<SupplierPaymentWithAllocations, String> {
    let conn = state.db.get_connection()?;
    SupplierPaymentRepository::create(&conn, input)
}

#[tauri::command]
pub fn update_supplier_payment(
    id: i64,
    input: SupplierPaymentInput,
    state: State<'_, AppState>,
) -> Result<SupplierPaymentWithAllocations, String> {
    let conn = state.db.get_connection()?;
    SupplierPaymentRepository::update(&conn, id, input)
}

#[tauri::command]
pub fn delete_supplier_payment(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection()?;
    SupplierPaymentRepository::delete(&conn, id)
}

#[tauri::command]
pub fn get_next_supplier_payment_number(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection()?;
    SupplierPaymentRepository::next_payment_number(&conn)
}

/// The supplier's bills a payment can be applied to. When editing, pass the payment's id.
#[tauri::command]
pub fn get_unpaid_bills_for_supplier(
    supplier_id: i64,
    exclude_payment_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<UnpaidBill>, String> {
    let conn = state.db.get_connection()?;
    SupplierPaymentRepository::unpaid_bills_for_supplier(&conn, supplier_id, exclude_payment_id)
}

#[tauri::command]
pub fn get_supplier_payments_summary(state: State<'_, AppState>) -> Result<SupplierPaymentsSummary, String> {
    let conn = state.db.get_connection()?;
    SupplierPaymentRepository::summary(&conn)
}

/// The WhatsApp message for a payment, for showing or copying. Nothing is opened or marked.
#[tauri::command]
pub fn get_supplier_payment_message(id: i64, state: State<'_, AppState>) -> Result<SupplierPaymentMessage, String> {
    let conn = state.db.get_connection()?;
    SupplierPaymentRepository::whatsapp_message(&conn, id)
}

/// Opens the supplier's WhatsApp chat with the payment message typed in and marks it sent today.
/// The owner presses Send in WhatsApp; nothing is sent from here.
#[tauri::command]
pub fn open_supplier_payment_whatsapp(id: i64, state: State<'_, AppState>) -> Result<SupplierPaymentMessage, String> {
    let conn = state.db.get_connection()?;
    let mut msg = SupplierPaymentRepository::whatsapp_message(&conn, id)?;
    // Only a WhatsApp chat link is ever opened.
    if !msg.link.starts_with("https://wa.me/") {
        return Err("The message link is not a WhatsApp link.".to_string());
    }
    tauri_plugin_opener::open_url(&msg.link, None::<&str>)
        .map_err(|e| format!("Could not open WhatsApp: {}. Use Copy message instead.", e))?;
    let date = today().format("%Y-%m-%d").to_string();
    SupplierPaymentRepository::stamp_whatsapp_sent(&conn, id, &date)?;
    msg.whatsapp_sent_on = Some(date);
    Ok(msg)
}
