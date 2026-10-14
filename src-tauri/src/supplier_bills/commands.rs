use super::models::{
    DuplicateBillCheck, SupplierBillDetail, SupplierBillFileInfo, SupplierBillFilter, SupplierBillInput,
    SupplierBillListItem, SupplierBillsSummary,
};
use super::repository::SupplierBillRepository;
use crate::attachments::{decode_upload, image_data_url, prepare_temp_copy};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn list_supplier_bills(
    filter: Option<SupplierBillFilter>,
    state: State<'_, AppState>,
) -> Result<Vec<SupplierBillListItem>, String> {
    let conn = state.db.get_connection()?;
    SupplierBillRepository::list(&conn, filter.unwrap_or_default())
}

#[tauri::command]
pub fn get_supplier_bill(id: i64, state: State<'_, AppState>) -> Result<Option<SupplierBillDetail>, String> {
    let conn = state.db.get_connection()?;
    SupplierBillRepository::get(&conn, id)
}

#[tauri::command]
pub fn create_supplier_bill(input: SupplierBillInput, state: State<'_, AppState>) -> Result<SupplierBillDetail, String> {
    let conn = state.db.get_connection()?;
    SupplierBillRepository::create(&conn, input)
}

#[tauri::command]
pub fn update_supplier_bill(
    id: i64,
    input: SupplierBillInput,
    state: State<'_, AppState>,
) -> Result<SupplierBillDetail, String> {
    let conn = state.db.get_connection()?;
    SupplierBillRepository::update(&conn, id, input)
}

#[tauri::command]
pub fn delete_supplier_bill(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection()?;
    SupplierBillRepository::delete(&conn, id)
}

/// A warning only: this supplier already has a bill with this number.
#[tauri::command]
pub fn check_duplicate_supplier_bill_number(
    supplier_id: i64,
    bill_number: String,
    exclude_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<DuplicateBillCheck, String> {
    let conn = state.db.get_connection()?;
    SupplierBillRepository::check_duplicate(&conn, supplier_id, &bill_number, exclude_id)
}

/// `data_base64` is the file's bytes as base64 text, without a `data:` prefix.
#[tauri::command]
pub fn add_supplier_bill_file(
    bill_id: i64,
    file_name: String,
    data_base64: String,
    state: State<'_, AppState>,
) -> Result<SupplierBillFileInfo, String> {
    let bytes = decode_upload(&data_base64)?;
    let conn = state.db.get_connection()?;
    SupplierBillRepository::add_file(&conn, bill_id, &file_name, &bytes)
}

#[tauri::command]
pub fn remove_supplier_bill_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection()?;
    SupplierBillRepository::remove_file(&conn, file_id)
}

/// A photo as a `data:` URL for showing inside the app. PDF and Word files have no preview.
#[tauri::command]
pub fn get_supplier_bill_file_preview(file_id: i64, state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.get_connection()?;
    let (_, mime, bytes) = SupplierBillRepository::read_file(&conn, file_id)?;
    image_data_url(&mime, &bytes)
}

/// Write a copy of the file into the app's Temp folder and open it in the default program.
#[tauri::command]
pub fn open_supplier_bill_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection()?;
    let (name, _, bytes) = SupplierBillRepository::read_file(&conn, file_id)?;
    // Only a file inside our own Temp folder is ever opened (checked inside prepare_temp_copy).
    let file = prepare_temp_copy(&state.storage.get_temp_dir(), "supplier_bill", file_id, &name, &bytes)?;
    tauri_plugin_opener::open_path(file, None::<&str>)
        .map_err(|e| format!("Could not open the file: {}. Check that a program for this file type is installed.", e))
}

#[tauri::command]
pub fn get_supplier_bills_summary(state: State<'_, AppState>) -> Result<SupplierBillsSummary, String> {
    let conn = state.db.get_connection()?;
    SupplierBillRepository::summary(&conn)
}
