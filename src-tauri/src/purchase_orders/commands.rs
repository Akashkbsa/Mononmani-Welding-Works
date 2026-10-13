use super::files::{clean_file_name, decode_upload, image_data_url, temp_copy_is_current, temp_open_path};
use super::models::{
    DuplicatePoCheck, LinkedInvoice, PurchaseOrderDetail, PurchaseOrderFileInfo, PurchaseOrderFilter, PurchaseOrderInput,
    PurchaseOrderListItem,
};
use super::repository::PurchaseOrderRepository;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn list_purchase_orders(
    filter: Option<PurchaseOrderFilter>,
    state: State<'_, AppState>,
) -> Result<Vec<PurchaseOrderListItem>, String> {
    let conn = state.db.get_connection()?;
    PurchaseOrderRepository::list(&conn, filter.unwrap_or_default())
}

#[tauri::command]
pub fn get_purchase_order(id: i64, state: State<'_, AppState>) -> Result<Option<PurchaseOrderDetail>, String> {
    let conn = state.db.get_connection()?;
    PurchaseOrderRepository::get(&conn, id)
}

#[tauri::command]
pub fn create_purchase_order(
    input: PurchaseOrderInput,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDetail, String> {
    let conn = state.db.get_connection()?;
    PurchaseOrderRepository::create(&conn, input)
}

#[tauri::command]
pub fn update_purchase_order(
    id: i64,
    input: PurchaseOrderInput,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDetail, String> {
    let conn = state.db.get_connection()?;
    PurchaseOrderRepository::update(&conn, id, input)
}

#[tauri::command]
pub fn delete_purchase_order(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection()?;
    PurchaseOrderRepository::delete(&conn, id)
}

#[tauri::command]
pub fn check_duplicate_po_number(
    customer_id: i64,
    po_number: String,
    exclude_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<DuplicatePoCheck, String> {
    let conn = state.db.get_connection()?;
    PurchaseOrderRepository::check_duplicate(&conn, customer_id, &po_number, exclude_id)
}

/// `data_base64` is the file's bytes as base64 text, without a `data:` prefix.
#[tauri::command]
pub fn add_purchase_order_file(
    purchase_order_id: i64,
    file_name: String,
    data_base64: String,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderFileInfo, String> {
    let bytes = decode_upload(&data_base64)?;
    let conn = state.db.get_connection()?;
    PurchaseOrderRepository::add_file(&conn, purchase_order_id, &file_name, &bytes)
}

#[tauri::command]
pub fn remove_purchase_order_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection()?;
    PurchaseOrderRepository::remove_file(&conn, file_id)
}

/// A photo as a `data:` URL for showing inside the app. PDF and Word files have no preview.
#[tauri::command]
pub fn get_purchase_order_file_preview(file_id: i64, state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection()?;
    let (_, mime, bytes) = PurchaseOrderRepository::read_file(&conn, file_id)?;
    image_data_url(&mime, &bytes)
}

/// Write a copy of the file into the app's Temp folder and open it in the default program.
#[tauri::command]
pub fn open_purchase_order_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection()?;
    let (name, _, bytes) = PurchaseOrderRepository::read_file(&conn, file_id)?;

    let temp_dir = state.storage.get_temp_dir();
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Could not prepare the Temp folder: {}", e))?;
    let path = temp_open_path(&temp_dir, file_id, &clean_file_name(&name));
    // Open the copy that is already there (it may still be open in Word or Acrobat, which locks it).
    if !temp_copy_is_current(&path, bytes.len()) {
        std::fs::write(&path, &bytes).map_err(|e| format!("Could not write the file to open it: {}", e))?;
    }

    // Same guard as opening invoice PDFs: only a file inside our own folder is ever opened.
    let file = path.canonicalize().map_err(|e| format!("Could not find the file to open: {}", e))?;
    let temp_dir = temp_dir.canonicalize().map_err(|e| format!("Temp folder is not available: {}", e))?;
    if !file.starts_with(&temp_dir) {
        return Err("Only files from purchase orders can be opened.".to_string());
    }
    tauri_plugin_opener::open_path(file, None::<&str>)
        .map_err(|e| format!("Could not open the file: {}. Check that a program for this file type is installed.", e))
}

/// The customer's invoices that have no purchase order yet.
#[tauri::command]
pub fn list_unlinked_invoices_for_customer(
    customer_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<LinkedInvoice>, String> {
    let conn = state.db.get_connection()?;
    PurchaseOrderRepository::unlinked_invoices_for_customer(&conn, customer_id)
}

/// Link an invoice to a purchase order, or unlink it with `purchase_order_id = null`.
#[tauri::command]
pub fn set_invoice_purchase_order(
    invoice_id: i64,
    purchase_order_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.get_connection()?;
    PurchaseOrderRepository::set_invoice_link(&conn, invoice_id, purchase_order_id)
}
