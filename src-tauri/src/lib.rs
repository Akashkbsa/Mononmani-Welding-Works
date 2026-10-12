mod backup;
mod customers;
mod db;
pub mod invoices;
pub mod payments;
mod pdf;
mod settings;
mod storage;
mod util;

use db::{DatabaseManager, DbStatusInfo};
use storage::{StorageInfo, StorageManager};
use tauri::{Manager, State};

/// Shared, read-only after startup. Each command opens its own SQLite connection.
pub struct AppState {
    pub storage: StorageManager,
    pub db: DatabaseManager,
}

#[tauri::command]
fn get_storage_info(state: State<'_, AppState>) -> StorageInfo {
    state.storage.get_storage_info()
}

#[tauri::command]
fn get_db_status(state: State<'_, AppState>) -> Result<DbStatusInfo, String> {
    state.db.get_status()
}

/// Open a generated invoice PDF in the default viewer. Only files inside the app's
/// Invoices folder can be opened.
#[tauri::command]
fn open_invoice_pdf(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let file = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|_| "The PDF file could not be found. Create it again.".to_string())?;
    let invoices_dir = state
        .storage
        .get_invoices_dir()
        .canonicalize()
        .map_err(|e| format!("Invoices folder is not available: {}", e))?;

    let is_pdf = file
        .extension()
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !file.starts_with(&invoices_dir) || !is_pdf {
        return Err("Only invoice PDFs can be opened.".to_string());
    }

    tauri_plugin_opener::open_path(file, None::<&str>).map_err(|e| format!("Could not open the PDF: {}", e))
}

/// Show the app's data folder (database, PDFs, backups) in the file explorer.
#[tauri::command]
fn open_data_folder(state: State<'_, AppState>) -> Result<(), String> {
    tauri_plugin_opener::open_path(state.storage.get_app_data_dir(), None::<&str>)
        .map_err(|e| format!("Could not open the folder: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let storage = StorageManager::new(app.handle())?;
            let db = DatabaseManager::new(storage.get_db_path())?;
            app.manage(AppState { storage, db });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_storage_info,
            get_db_status,
            open_invoice_pdf,
            open_data_folder,
            customers::list_customers,
            customers::search_customers,
            customers::get_customer,
            customers::check_duplicate_customer,
            customers::create_customer,
            customers::update_customer,
            customers::delete_customer,
            customers::toggle_customer_favorite,
            customers::touch_customer_last_used,
            invoices::list_invoices,
            invoices::get_invoice,
            invoices::get_next_invoice_number,
            invoices::check_duplicate_invoice_number,
            invoices::create_invoice,
            invoices::update_invoice,
            invoices::delete_invoice,
            invoices::generate_invoice_pdf_by_id,
            invoices::set_invoice_cancelled,
            invoices::generate_invoice_all_copies_pdf,
            invoices::generate_month_invoices_pdf,
            invoices::check_invoice_deletion_safety,
            payments::list_payments,
            payments::get_payment,
            payments::create_payment,
            payments::update_payment,
            payments::delete_payment,
            payments::get_next_payment_number,
            payments::get_unpaid_invoices_for_customer,
            payments::get_invoice_payment_summary,
            payments::get_payments_kpi_summary,
            payments::get_customer_credits,
            backup::backup_status,
            backup::connect_drive,
            backup::disconnect_drive,
            backup::run_backup,
            backup::list_drive_backups,
            backup::restore_drive_backup,
            settings::get_settings,
            settings::save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
