use super::templates::{self, MessageTemplate};
use crate::AppState;
use tauri::State;

/// The WhatsApp message templates for Settings: supplier payment, rent reminder and employee pay.
#[tauri::command(async)]
pub fn get_message_templates(state: State<'_, AppState>) -> Result<Vec<MessageTemplate>, String> {
    let conn = state.db.connection()?;
    templates::all(&conn)
}

#[tauri::command(async)]
pub fn save_message_template(kind: String, template: String, state: State<'_, AppState>) -> Result<MessageTemplate, String> {
    let conn = state.db.connection()?;
    templates::save(&conn, &kind, &template)
}
