use super::models::{Reminder, ReminderInput};
use super::repository::ReminderRepository;
use crate::util::today;
use crate::AppState;
use tauri::State;

/// `tab` is DUE, UPCOMING or DONE.
#[tauri::command(async)]
pub fn list_reminders(tab: String, state: State<'_, AppState>) -> Result<Vec<Reminder>, String> {
    let conn = state.db.connection()?;
    ReminderRepository::list(&conn, &tab, today())
}

/// The reminders the top banner shows now.
#[tauri::command(async)]
pub fn get_reminder_banner(state: State<'_, AppState>) -> Result<Vec<Reminder>, String> {
    let conn = state.db.connection()?;
    ReminderRepository::banner(&conn, today())
}

#[tauri::command(async)]
pub fn get_reminders_for_record(link_kind: String, link_id: i64, state: State<'_, AppState>) -> Result<Vec<Reminder>, String> {
    let conn = state.db.connection()?;
    ReminderRepository::for_record(&conn, &link_kind, link_id, today())
}

#[tauri::command(async)]
pub fn create_reminder(input: ReminderInput, state: State<'_, AppState>) -> Result<Reminder, String> {
    let conn = state.db.connection()?;
    ReminderRepository::create(&conn, input)
}

#[tauri::command(async)]
pub fn update_reminder(id: i64, input: ReminderInput, state: State<'_, AppState>) -> Result<Reminder, String> {
    let conn = state.db.connection()?;
    ReminderRepository::update(&conn, id, input)
}

#[tauri::command(async)]
pub fn delete_reminder(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    ReminderRepository::delete(&conn, id)
}

#[tauri::command(async)]
pub fn mark_reminder_done(id: i64, state: State<'_, AppState>) -> Result<Reminder, String> {
    let conn = state.db.connection()?;
    ReminderRepository::mark_done(&conn, id, today())
}

#[tauri::command(async)]
pub fn mark_reminder_not_done(id: i64, state: State<'_, AppState>) -> Result<Reminder, String> {
    let conn = state.db.connection()?;
    ReminderRepository::mark_not_done(&conn, id)
}

/// Take a reminder off the banner (`dismissed = true`) or put it back.
#[tauri::command(async)]
pub fn set_reminder_dismissed(id: i64, dismissed: bool, state: State<'_, AppState>) -> Result<Reminder, String> {
    let conn = state.db.connection()?;
    ReminderRepository::set_dismissed(&conn, id, dismissed)
}

/// Keep a reminder off the banner for `days` days from today; 0 takes the snooze off.
#[tauri::command(async)]
pub fn snooze_reminder(id: i64, days: i64, state: State<'_, AppState>) -> Result<Reminder, String> {
    let conn = state.db.connection()?;
    ReminderRepository::snooze(&conn, id, days, today())
}

/// The snooze lengths the banner offers, in days.
#[tauri::command(async)]
pub fn get_snooze_choices(state: State<'_, AppState>) -> Result<Vec<i64>, String> {
    let conn = state.db.connection()?;
    ReminderRepository::snooze_choices(&conn)
}

#[tauri::command(async)]
pub fn save_snooze_choices(days: Vec<i64>, state: State<'_, AppState>) -> Result<Vec<i64>, String> {
    let conn = state.db.connection()?;
    ReminderRepository::save_snooze_choices(&conn, days)
}
