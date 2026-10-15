use super::models::{
    EmployeeDetail, EmployeeFileInfo, EmployeeInput, EmployeeListItem, EmployeePayment, EmployeePaymentInput, PayMonthDetail, PayMonthInput,
    PayMonthSummary, PaySheet, PaySheetEntry,
};
use super::repository::PayrollRepository;
use crate::attachments::{decode_upload, image_data_url, prepare_temp_copy};
use crate::util::today;
use crate::AppState;
use tauri::State;

fn today_text() -> String {
    today().format("%Y-%m-%d").to_string()
}

// ------------------------------------------------------------- employees

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
