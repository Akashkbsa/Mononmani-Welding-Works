use super::models::{
    DuplicateQuotationCheck, LinkedOrder, QuotationDetail, QuotationFileInfo, QuotationFilter, QuotationInput,
    QuotationListItem,
};
use super::repository::QuotationRepository;
use crate::attachments::{decode_upload, image_data_url, prepare_temp_copy};
use crate::AppState;
use tauri::State;

#[tauri::command(async)]
pub fn list_quotations(filter: Option<QuotationFilter>, state: State<'_, AppState>) -> Result<Vec<QuotationListItem>, String> {
    let conn = state.db.connection()?;
    QuotationRepository::list(&conn, filter.unwrap_or_default())
}

#[tauri::command(async)]
pub fn get_quotation(id: i64, state: State<'_, AppState>) -> Result<Option<QuotationDetail>, String> {
    let conn = state.db.connection()?;
    QuotationRepository::get(&conn, id)
}

#[tauri::command(async)]
pub fn create_quotation(input: QuotationInput, state: State<'_, AppState>) -> Result<QuotationDetail, String> {
    let conn = state.db.connection()?;
    QuotationRepository::create(&conn, input)
}

#[tauri::command(async)]
pub fn update_quotation(id: i64, input: QuotationInput, state: State<'_, AppState>) -> Result<QuotationDetail, String> {
    let conn = state.db.connection()?;
    QuotationRepository::update(&conn, id, input)
}

#[tauri::command(async)]
pub fn delete_quotation(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    QuotationRepository::delete(&conn, id)
}

/// A warning only: any customer already has a quotation with this number.
#[tauri::command(async)]
pub fn check_duplicate_quotation_number(
    quotation_number: String,
    exclude_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<DuplicateQuotationCheck, String> {
    let conn = state.db.connection()?;
    QuotationRepository::check_duplicate(&conn, &quotation_number, exclude_id)
}

/// `data_base64` is the file's bytes as base64 text, without a `data:` prefix.
#[tauri::command(async)]
pub fn add_quotation_file(
    quotation_id: i64,
    file_name: String,
    data_base64: String,
    state: State<'_, AppState>,
) -> Result<QuotationFileInfo, String> {
    let bytes = decode_upload(&data_base64)?;
    let conn = state.db.connection()?;
    QuotationRepository::add_file(&conn, quotation_id, &file_name, &bytes)
}

#[tauri::command(async)]
pub fn remove_quotation_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    QuotationRepository::remove_file(&conn, file_id)
}

/// A photo as a `data:` URL for showing inside the app. PDF and Word files have no preview.
#[tauri::command(async)]
pub fn get_quotation_file_preview(file_id: i64, state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.connection()?;
    let (_, mime, bytes) = QuotationRepository::read_file(&conn, file_id)?;
    image_data_url(&mime, &bytes)
}

/// Write a copy of the file into the app's Temp folder and open it in the default program.
#[tauri::command(async)]
pub fn open_quotation_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    let (name, _, bytes) = QuotationRepository::read_file(&conn, file_id)?;
    // Only a file inside our own Temp folder is ever opened (checked inside prepare_temp_copy).
    let file = prepare_temp_copy(&state.storage.get_temp_dir(), "quotation", file_id, &name, &bytes)?;
    tauri_plugin_opener::open_path(file, None::<&str>)
        .map_err(|e| format!("Could not open the file: {}. Check that a program for this file type is installed.", e))
}

/// The customer's purchase orders that have no quotation yet.
#[tauri::command(async)]
pub fn list_unlinked_purchase_orders_for_customer(
    customer_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<LinkedOrder>, String> {
    let conn = state.db.connection()?;
    QuotationRepository::unlinked_orders_for_customer(&conn, customer_id)
}

/// Link a purchase order to a quotation, or unlink it with `quotation_id = null`.
#[tauri::command(async)]
pub fn set_purchase_order_quotation(
    purchase_order_id: i64,
    quotation_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.connection()?;
    QuotationRepository::set_purchase_order_link(&conn, purchase_order_id, quotation_id)
}
