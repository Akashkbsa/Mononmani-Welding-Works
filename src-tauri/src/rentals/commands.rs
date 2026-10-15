use super::models::{
    MarkPaidInput, MonthOverview, PlaceDetail, PlaceInput, PlaceListItem, ReminderEntry, RentHistoryRow, RentReminder, RentalFileInfo, TenantDetail, TenantInput,
    TenantListItem,
};
use super::repository::RentalRepository;
use crate::attachments::{decode_upload, image_data_url, prepare_temp_copy};
use crate::util::today;
use crate::AppState;
use tauri::State;

// ---------------------------------------------------------------- places

#[tauri::command(async)]
pub fn list_rental_places(state: State<'_, AppState>) -> Result<Vec<PlaceListItem>, String> {
    let conn = state.db.connection()?;
    RentalRepository::list_places(&conn)
}

#[tauri::command(async)]
pub fn get_rental_place(id: i64, state: State<'_, AppState>) -> Result<Option<PlaceDetail>, String> {
    let conn = state.db.connection()?;
    RentalRepository::get_place(&conn, id)
}

#[tauri::command(async)]
pub fn create_rental_place(input: PlaceInput, state: State<'_, AppState>) -> Result<PlaceDetail, String> {
    let conn = state.db.connection()?;
    RentalRepository::create_place(&conn, input)
}

#[tauri::command(async)]
pub fn update_rental_place(id: i64, input: PlaceInput, state: State<'_, AppState>) -> Result<PlaceDetail, String> {
    let conn = state.db.connection()?;
    RentalRepository::update_place(&conn, id, input)
}

#[tauri::command(async)]
pub fn delete_rental_place(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    RentalRepository::delete_place(&conn, id)
}

// --------------------------------------------------------------- tenants

#[tauri::command(async)]
pub fn list_rental_tenants(include_moved_out: bool, state: State<'_, AppState>) -> Result<Vec<TenantListItem>, String> {
    let conn = state.db.connection()?;
    RentalRepository::list_tenants(&conn, include_moved_out)
}

#[tauri::command(async)]
pub fn get_rental_tenant(id: i64, state: State<'_, AppState>) -> Result<Option<TenantDetail>, String> {
    let conn = state.db.connection()?;
    RentalRepository::get_tenant(&conn, id)
}

#[tauri::command(async)]
pub fn create_rental_tenant(input: TenantInput, state: State<'_, AppState>) -> Result<TenantDetail, String> {
    let conn = state.db.connection()?;
    RentalRepository::create_tenant(&conn, input)
}

#[tauri::command(async)]
pub fn update_rental_tenant(id: i64, input: TenantInput, state: State<'_, AppState>) -> Result<TenantDetail, String> {
    let conn = state.db.connection()?;
    RentalRepository::update_tenant(&conn, id, input)
}

/// Mark a tenant as moved out on a date, or move them back in with `moved_out_date = null`.
#[tauri::command(async)]
pub fn set_rental_tenant_moved_out(
    id: i64,
    moved_out_date: Option<String>,
    state: State<'_, AppState>,
) -> Result<TenantDetail, String> {
    let conn = state.db.connection()?;
    RentalRepository::set_moved_out(&conn, id, moved_out_date.as_deref())
}

#[tauri::command(async)]
pub fn delete_rental_tenant(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    RentalRepository::delete_tenant(&conn, id)
}

// ------------------------------------------------------------ rent months

/// `month` is `YYYY-MM`.
#[tauri::command(async)]
pub fn get_rent_month_overview(month: String, state: State<'_, AppState>) -> Result<MonthOverview, String> {
    let conn = state.db.connection()?;
    RentalRepository::month_overview(&conn, &month)
}

#[tauri::command(async)]
pub fn mark_rent_paid(input: MarkPaidInput, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    RentalRepository::mark_paid(&conn, input)
}

#[tauri::command(async)]
pub fn undo_rent_paid(tenant_id: i64, month: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    RentalRepository::undo_paid(&conn, tenant_id, &month)
}

/// The message and link for an unpaid tenant, without opening anything.
#[tauri::command(async)]
pub fn get_rent_reminder(tenant_id: i64, month: String, state: State<'_, AppState>) -> Result<RentReminder, String> {
    let conn = state.db.connection()?;
    RentalRepository::reminder_for(&conn, tenant_id, &month)
}

/// Open the tenant's WhatsApp chat with the reminder typed in, and remember today as the day it was
/// opened. The owner still presses Send in WhatsApp; nothing is sent from here.
#[tauri::command(async)]
pub fn open_rent_reminder(tenant_id: i64, month: String, state: State<'_, AppState>) -> Result<RentReminder, String> {
    let conn = state.db.connection()?;
    let reminder = RentalRepository::reminder_for(&conn, tenant_id, &month)?;
    // Only a WhatsApp chat link is ever opened.
    if !reminder.link.starts_with("https://wa.me/") {
        return Err("The reminder link is not a WhatsApp link.".to_string());
    }
    tauri_plugin_opener::open_url(&reminder.link, None::<&str>)
        .map_err(|e| format!("Could not open WhatsApp: {}. Use Copy message instead.", e))?;
    RentalRepository::stamp_reminded(&conn, tenant_id, &month, &today().format("%Y-%m-%d").to_string())?;
    Ok(reminder)
}

/// Every reminder for the tenant and month, numbered, with whether each was confirmed as sent.
#[tauri::command(async)]
pub fn get_rent_reminder_history(tenant_id: i64, month: String, state: State<'_, AppState>) -> Result<Vec<ReminderEntry>, String> {
    let conn = state.db.connection()?;
    RentalRepository::reminder_history(&conn, tenant_id, &month)
}

/// The tenant's last 12 months up to this month, newest first, paid or not.
#[tauri::command(async)]
pub fn get_tenant_rent_history(tenant_id: i64, state: State<'_, AppState>) -> Result<Vec<RentHistoryRow>, String> {
    let conn = state.db.connection()?;
    RentalRepository::rent_history(&conn, tenant_id, &today().format("%Y-%m").to_string(), 12)
}

// ------------------------------------------------------------------ files

/// `owner_kind` is `PLACE` or `TENANT`. `data_base64` is the file's bytes as base64 text, without a
/// `data:` prefix.
#[tauri::command(async)]
pub fn add_rental_file(
    owner_kind: String,
    owner_id: i64,
    file_name: String,
    data_base64: String,
    state: State<'_, AppState>,
) -> Result<RentalFileInfo, String> {
    let bytes = decode_upload(&data_base64)?;
    let conn = state.db.connection()?;
    RentalRepository::add_file(&conn, &owner_kind, owner_id, &file_name, &bytes)
}

#[tauri::command(async)]
pub fn remove_rental_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    RentalRepository::remove_file(&conn, file_id)
}

/// A photo as a `data:` URL for showing inside the app. PDF and Word files have no preview.
#[tauri::command(async)]
pub fn get_rental_file_preview(file_id: i64, state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.connection()?;
    let (_, mime, bytes) = RentalRepository::read_file(&conn, file_id)?;
    image_data_url(&mime, &bytes)
}

/// Write a copy of the file into the app's Temp folder and open it in the default program.
#[tauri::command(async)]
pub fn open_rental_file(file_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    let (name, _, bytes) = RentalRepository::read_file(&conn, file_id)?;
    // Only a file inside our own Temp folder is ever opened (checked inside prepare_temp_copy).
    let file = prepare_temp_copy(&state.storage.get_temp_dir(), "rental", file_id, &name, &bytes)?;
    tauri_plugin_opener::open_path(file, None::<&str>)
        .map_err(|e| format!("Could not open the file: {}. Check that a program for this file type is installed.", e))
}
