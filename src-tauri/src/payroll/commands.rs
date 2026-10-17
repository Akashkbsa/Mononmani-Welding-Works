use super::models::{
    EmployeeDetail, EmployeeFileInfo, EmployeeInput, EmployeePayMessage, IncentiveInput, EmployeeListItem, EmployeePayment, EmployeePaymentInput, PayMonthDetail, PayMonthInput,
    PayMonthSummary, PaySheet, PaySheetEntry,
};
use super::repository::PayrollRepository;
use crate::attachments::{decode_upload, image_data_url, prepare_temp_copy};
use crate::settings::models::BusinessSettings;
use crate::settings::repository::SettingsRepository;
use crate::util::today;
use crate::AppState;
use tauri::State;

fn today_text() -> String {
    today().format("%Y-%m-%d").to_string()
}

// ------------------------------------------------------------- employees

#[tauri::command(async)]
pub fn add_incentive(employee_id: i64, month: String, input: IncentiveInput, state: State<'_, AppState>) -> Result<PayMonthDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::add_incentive(&conn, employee_id, &month, input, &today_text())
}

#[tauri::command(async)]
pub fn update_incentive(id: i64, input: IncentiveInput, state: State<'_, AppState>) -> Result<PayMonthDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::update_incentive(&conn, id, input, &today_text())
}

#[tauri::command(async)]
pub fn delete_incentive(id: i64, state: State<'_, AppState>) -> Result<PayMonthDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::delete_incentive(&conn, id, &today_text())
}

/// The pay message for one month, filled from the owner's template, and the WhatsApp link.
#[tauri::command(async)]
pub fn get_employee_pay_message(employee_id: i64, month: String, state: State<'_, AppState>) -> Result<EmployeePayMessage, String> {
    let conn = state.db.connection()?;
    PayrollRepository::pay_message(&conn, employee_id, &month, &today_text())
}

/// Opens the employee's WhatsApp chat with the message typed in; the owner presses Send there.
#[tauri::command(async)]
pub fn open_employee_pay_whatsapp(employee_id: i64, month: String, state: State<'_, AppState>) -> Result<EmployeePayMessage, String> {
    let msg = {
        let conn = state.db.connection()?;
        PayrollRepository::pay_message(&conn, employee_id, &month, &today_text())?
    };
    // Only a WhatsApp chat link is ever opened.
    if !msg.link.starts_with("https://wa.me/") {
        return Err("The message link is not a WhatsApp link.".to_string());
    }
    tauri_plugin_opener::open_url(&msg.link, None::<&str>).map_err(|e| format!("Could not open WhatsApp: {}. Use Copy message instead.", e))?;
    Ok(msg)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaySlipsResult {
    pub path: String,
    pub count: usize,
}

/// Make the PDF for these months under `Pay slips\<month>\`. Slow (the browser prints), so it runs
/// off the command thread with no database connection held.
async fn make_pay_slips(details: Vec<PayMonthDetail>, seller: BusinessSettings, path: std::path::PathBuf) -> Result<String, String> {
    let generated_on = today().format("%d-%m-%Y").to_string();
    let html = crate::payroll::slip::pay_slips_html(&details, &seller, &generated_on)?;
    let done = tauri::async_runtime::spawn_blocking(move || crate::pdf::renderer::PdfRenderer::print_document(html, &path))
        .await
        .map_err(|e| format!("The pay slip stopped unexpectedly: {}", e))??;
    Ok(done.to_string_lossy().to_string())
}

/// One employee's pay slip for the month, opened in the PDF viewer (print it from there).
#[tauri::command]
pub async fn print_pay_slip(employee_id: i64, month: String, state: State<'_, AppState>) -> Result<String, String> {
    let (detail, seller) = {
        let conn = state.db.connection()?;
        (PayrollRepository::pay_slip_month(&conn, employee_id, &month, &today_text())?, SettingsRepository::get(&conn)?)
    };
    let path = state.storage.prepare_pay_slip_path(&month, &crate::payroll::slip::slip_file_name(&detail.employee.name, &month))?;
    let path = make_pay_slips(vec![detail], seller, path).await?;
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| format!("The pay slip was saved to {} but could not be opened: {}", path, e))?;
    Ok(path)
}

/// Everyone's pay slip for the month in one PDF (one page each), opened in the PDF viewer.
#[tauri::command]
pub async fn print_month_pay_slips(month: String, state: State<'_, AppState>) -> Result<PaySlipsResult, String> {
    let (details, seller) = {
        let conn = state.db.connection()?;
        (PayrollRepository::pay_slip_months(&conn, &month, &today_text())?, SettingsRepository::get(&conn)?)
    };
    let count = details.len();
    let label = crate::rentals::reminder::month_label(&month)?;
    let path = state.storage.prepare_pay_slip_path(&month, &format!("All pay slips {}.pdf", label))?;
    let path = make_pay_slips(details, seller, path).await?;
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| format!("The pay slips were saved to {} but could not be opened: {}", path, e))?;
    Ok(PaySlipsResult { path, count })
}

/// Saves the pay slip, shows it selected in its folder, and opens the employee's WhatsApp chat
/// with the Pay slip message typed in. The owner drags the PDF into the chat and presses Send:
/// a WhatsApp link can carry text only, and the app never sends anything by itself.
#[tauri::command]
pub async fn send_pay_slip_whatsapp(employee_id: i64, month: String, state: State<'_, AppState>) -> Result<EmployeePayMessage, String> {
    let (detail, seller, msg) = {
        let conn = state.db.connection()?;
        let msg = PayrollRepository::pay_slip_message(&conn, employee_id, &month, &today_text())?;
        (PayrollRepository::pay_slip_month(&conn, employee_id, &month, &today_text())?, SettingsRepository::get(&conn)?, msg)
    };
    if !msg.link.starts_with("https://wa.me/") {
        return Err("The message link is not a WhatsApp link.".to_string());
    }
    let path = state.storage.prepare_pay_slip_path(&month, &crate::payroll::slip::slip_file_name(&detail.employee.name, &month))?;
    let path = make_pay_slips(vec![detail], seller, path).await?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| format!("The pay slip was saved to {} but its folder could not be opened: {}", path, e))?;
    tauri_plugin_opener::open_url(&msg.link, None::<&str>).map_err(|e| format!("Could not open WhatsApp: {}. The pay slip is saved at {}.", e, path))?;
    Ok(msg)
}

/// Incentive reasons given before, most used first.
#[tauri::command(async)]
pub fn list_incentive_reasons(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.connection()?;
    PayrollRepository::incentive_reasons(&conn)
}

#[tauri::command(async)]
pub fn list_employees(state: State<'_, AppState>) -> Result<Vec<EmployeeListItem>, String> {
    let conn = state.db.connection()?;
    PayrollRepository::list_employees(&conn)
}

#[tauri::command(async)]
pub fn get_employee(id: i64, state: State<'_, AppState>) -> Result<Option<EmployeeDetail>, String> {
    let conn = state.db.connection()?;
    PayrollRepository::get_employee(&conn, id)
}

#[tauri::command(async)]
pub fn create_employee(input: EmployeeInput, state: State<'_, AppState>) -> Result<EmployeeDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::create_employee(&conn, input)
}

#[tauri::command(async)]
pub fn update_employee(id: i64, input: EmployeeInput, state: State<'_, AppState>) -> Result<EmployeeDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::update_employee(&conn, id, input)
}

#[tauri::command(async)]
pub fn delete_employee(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    PayrollRepository::delete_employee(&conn, id)
}

#[tauri::command(async)]
pub fn mark_employee_left(id: i64, left_on: String, state: State<'_, AppState>) -> Result<EmployeeDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::mark_left(&conn, id, &left_on)
}

#[tauri::command(async)]
pub fn rejoin_employee(id: i64, joined_on: String, state: State<'_, AppState>) -> Result<EmployeeDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::rejoin(&conn, id, &joined_on)
}

/// Other employees with the same name, for the "same name" warning. Nothing is refused.
#[tauri::command(async)]
pub fn find_employees_by_name(name: String, exclude_id: Option<i64>, state: State<'_, AppState>) -> Result<Vec<EmployeeListItem>, String> {
    let conn = state.db.connection()?;
    PayrollRepository::find_by_name(&conn, &name, exclude_id.unwrap_or(-1))
}

/// The employee's last 12 months up to this month, newest first.
#[tauri::command(async)]
pub fn get_employee_pay_history(employee_id: i64, state: State<'_, AppState>) -> Result<Vec<PayMonthSummary>, String> {
    let conn = state.db.connection()?;
    PayrollRepository::pay_history(&conn, employee_id, &today_text(), 12)
}

// ------------------------------------------------------------------ files

/// `data_base64` is the file's bytes as base64 text, without a `data:` prefix.
#[tauri::command(async)]
pub fn add_employee_file(employee_id: i64, file_name: String, data_base64: String, state: State<'_, AppState>) -> Result<EmployeeFileInfo, String> {
    let bytes = decode_upload(&data_base64)?;
    let conn = state.db.connection()?;
    PayrollRepository::add_file(&conn, employee_id, &file_name, &bytes)
}

#[tauri::command(async)]
pub fn remove_employee_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    PayrollRepository::remove_file(&conn, file_id)
}

/// A photo as a `data:` URL for showing inside the app. PDF and Word files have no preview.
#[tauri::command(async)]
pub fn get_employee_file_preview(file_id: i64, state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.connection()?;
    let (_, mime, bytes) = PayrollRepository::read_file(&conn, file_id)?;
    image_data_url(&mime, &bytes)
}

/// Write a copy of the file into the app's Temp folder and open it in the default program.
#[tauri::command(async)]
pub fn open_employee_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    let (name, _, bytes) = PayrollRepository::read_file(&conn, file_id)?;
    // Only a file inside our own Temp folder is ever opened (checked inside prepare_temp_copy).
    let file = prepare_temp_copy(&state.storage.get_temp_dir(), "employee", file_id, &name, &bytes)?;
    tauri_plugin_opener::open_path(file, None::<&str>)
        .map_err(|e| format!("Could not open the file: {}. Check that a program for this file type is installed.", e))
}

// ------------------------------------------------------------- pay months

/// `month` is `YYYY-MM`.
#[tauri::command(async)]
pub fn get_pay_sheet(month: String, state: State<'_, AppState>) -> Result<PaySheet, String> {
    let conn = state.db.connection()?;
    PayrollRepository::pay_sheet(&conn, &month, &today_text())
}

/// Days and OT hours for several employees: all saved, or none.
#[tauri::command(async)]
pub fn save_pay_sheet(month: String, rows: Vec<PaySheetEntry>, state: State<'_, AppState>) -> Result<PaySheet, String> {
    let conn = state.db.connection()?;
    PayrollRepository::save_pay_sheet(&conn, &month, rows, &today_text())
}

#[tauri::command(async)]
pub fn get_pay_month(employee_id: i64, month: String, state: State<'_, AppState>) -> Result<PayMonthDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::pay_month(&conn, employee_id, &month, &today_text())
}

#[tauri::command(async)]
pub fn save_pay_month(employee_id: i64, month: String, input: PayMonthInput, state: State<'_, AppState>) -> Result<PayMonthDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::save_pay_month(&conn, employee_id, &month, input, &today_text())
}

#[tauri::command(async)]
pub fn delete_pay_month(employee_id: i64, month: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    PayrollRepository::delete_pay_month(&conn, employee_id, &month)
}

// --------------------------------------------------------------- entries

#[tauri::command(async)]
pub fn create_employee_payment(input: EmployeePaymentInput, state: State<'_, AppState>) -> Result<PayMonthDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::create_payment(&conn, input, &today_text())
}

#[tauri::command(async)]
pub fn update_employee_payment(id: i64, input: EmployeePaymentInput, state: State<'_, AppState>) -> Result<PayMonthDetail, String> {
    let conn = state.db.connection()?;
    PayrollRepository::update_payment(&conn, id, input, &today_text())
}

#[tauri::command(async)]
pub fn delete_employee_payment(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    PayrollRepository::delete_payment(&conn, id)
}

/// Advances and salary handed over between two dates (YYYY-MM-DD), for the dashboard.
#[tauri::command(async)]
pub fn list_wage_payments(from: String, to: String, state: State<'_, AppState>) -> Result<Vec<EmployeePayment>, String> {
    let conn = state.db.connection()?;
    PayrollRepository::list_wage_payments(&conn, &from, &to)
}
