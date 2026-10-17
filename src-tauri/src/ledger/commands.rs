use super::models::{Ledger, OpeningBalance, OpeningBalanceInput};
use super::repository::LedgerRepository;
use crate::customers::repository::CustomerRepository;
use crate::settings::repository::SettingsRepository;
use crate::util::today;
use crate::AppState;
use tauri::State;

/// The company's ledger for the period (YYYY-MM-DD dates; None for no limit).
#[tauri::command(async)]
pub fn get_ledger(company_id: i64, from: Option<String>, to: Option<String>, state: State<'_, AppState>) -> Result<Ledger, String> {
    let conn = state.db.connection()?;
    LedgerRepository::ledger(&conn, company_id, from.as_deref(), to.as_deref())
}

#[tauri::command(async)]
pub fn set_opening_balance(company_id: i64, input: OpeningBalanceInput, state: State<'_, AppState>) -> Result<OpeningBalance, String> {
    let conn = state.db.connection()?;
    LedgerRepository::set_opening_balance(&conn, company_id, input)
}

/// The ledger as a PDF in the Ledgers folder, opened in the PDF viewer (print it from there).
/// Returns its path.
#[tauri::command]
pub async fn print_ledger(company_id: i64, from: Option<String>, to: Option<String>, state: State<'_, AppState>) -> Result<String, String> {
    let (ledger, company, seller) = {
        let conn = state.db.connection()?;
        let ledger = LedgerRepository::ledger(&conn, company_id, from.as_deref(), to.as_deref())?;
        let company = CustomerRepository::find_by_id(&conn, company_id)?.ok_or_else(|| "Company not found.".to_string())?;
        (ledger, company, SettingsRepository::get(&conn)?)
    };
    let name = super::print::ledger_file_name(&company.name, ledger.from.as_deref(), ledger.to.as_deref());
    let path = state.storage.prepare_ledger_path(&name)?;
    let printed_on = today().format("%d-%m-%Y").to_string();
    let html = super::print::ledger_html(&ledger, &company, &seller, &printed_on);
    let done = tauri::async_runtime::spawn_blocking(move || crate::pdf::renderer::PdfRenderer::print_document(html, &path))
        .await
        .map_err(|e| format!("The ledger stopped unexpectedly: {}", e))??;
    let path = done.to_string_lossy().to_string();
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| format!("The ledger was saved to {} but could not be opened: {}", path, e))?;
    Ok(path)
}
