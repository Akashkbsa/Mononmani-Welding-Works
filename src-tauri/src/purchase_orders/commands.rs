use crate::attachments::{decode_upload, image_data_url, prepare_temp_copy};
use super::models::{
    DuplicatePoCheck, LinkedInvoice, PurchaseOrderDetail, PurchaseOrderFileInfo, PurchaseOrderFilter, PurchaseOrderInput,
    PurchaseOrderListItem,
};
use super::repository::PurchaseOrderRepository;
use crate::AppState;
use tauri::State;

#[tauri::command(async)]
pub fn list_purchase_orders(
    filter: Option<PurchaseOrderFilter>,
    state: State<'_, AppState>,
) -> Result<Vec<PurchaseOrderListItem>, String> {
    let conn = state.db.connection()?;
    PurchaseOrderRepository::list(&conn, filter.unwrap_or_default())
}

#[tauri::command(async)]
pub fn get_purchase_order(id: i64, state: State<'_, AppState>) -> Result<Option<PurchaseOrderDetail>, String> {
    let conn = state.db.connection()?;
    PurchaseOrderRepository::get(&conn, id)
}

#[tauri::command(async)]
pub fn create_purchase_order(
    input: PurchaseOrderInput,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDetail, String> {
    let conn = state.db.connection()?;
    PurchaseOrderRepository::create(&conn, input)
}

#[tauri::command(async)]
pub fn update_purchase_order(
    id: i64,
    input: PurchaseOrderInput,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDetail, String> {
    let conn = state.db.connection()?;
    PurchaseOrderRepository::update(&conn, id, input)
}

#[tauri::command(async)]
pub fn delete_purchase_order(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    PurchaseOrderRepository::delete(&conn, id)
}

#[tauri::command(async)]
pub fn check_duplicate_po_number(
    customer_id: i64,
    po_number: String,
    exclude_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<DuplicatePoCheck, String> {
    let conn = state.db.connection()?;
    PurchaseOrderRepository::check_duplicate(&conn, customer_id, &po_number, exclude_id)
}

/// `data_base64` is the file's bytes as base64 text, without a `data:` prefix.
#[tauri::command(async)]
pub fn add_purchase_order_file(
    purchase_order_id: i64,
    file_name: String,
    data_base64: String,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderFileInfo, String> {
    let bytes = decode_upload(&data_base64)?;
    let conn = state.db.connection()?;
    PurchaseOrderRepository::add_file(&conn, purchase_order_id, &file_name, &bytes)
}

#[tauri::command(async)]
pub fn remove_purchase_order_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    PurchaseOrderRepository::remove_file(&conn, file_id)
}

/// A photo as a `data:` URL for showing inside the app. PDF and Word files have no preview.
#[tauri::command(async)]
pub fn get_purchase_order_file_preview(file_id: i64, state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.connection()?;
    let (_, mime, bytes) = PurchaseOrderRepository::read_file(&conn, file_id)?;
    image_data_url(&mime, &bytes)
}

/// Write a copy of the file into the app's Temp folder and open it in the default program.
#[tauri::command(async)]
pub fn open_purchase_order_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    let (name, _, bytes) = PurchaseOrderRepository::read_file(&conn, file_id)?;
    // Only a file inside our own Temp folder is ever opened (checked inside prepare_temp_copy).
    let file = prepare_temp_copy(&state.storage.get_temp_dir(), "po", file_id, &name, &bytes)?;
    tauri_plugin_opener::open_path(file, None::<&str>)
        .map_err(|e| format!("Could not open the file: {}. Check that a program for this file type is installed.", e))
}

/// The customer's invoices that have no purchase order yet.
#[tauri::command(async)]
pub fn list_unlinked_invoices_for_customer(
    customer_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<LinkedInvoice>, String> {
    let conn = state.db.connection()?;
    PurchaseOrderRepository::unlinked_invoices_for_customer(&conn, customer_id)
}

/// Link an invoice to a purchase order, or unlink it with `purchase_order_id = null`.
#[tauri::command(async)]
pub fn set_invoice_purchase_order(
    invoice_id: i64,
    purchase_order_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.connection()?;
    PurchaseOrderRepository::set_invoice_link(&conn, invoice_id, purchase_order_id)
}
