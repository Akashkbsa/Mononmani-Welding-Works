use super::models::BusinessSettings;
use super::repository::SettingsRepository;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<BusinessSettings, String> {
    let conn = state.db.get_connection()?;
    SettingsRepository::get(&conn)
}

#[tauri::command]
pub fn save_settings(settings: BusinessSettings, state: State<'_, AppState>) -> Result<BusinessSettings, String> {
    let conn = state.db.get_connection()?;
    SettingsRepository::save(&conn, settings)
}
