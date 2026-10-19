use super::{models::AuditLogPage, repository::AuditRepository};
use crate::AppState;
use tauri::State;

#[tauri::command(async)]
pub fn list_audit_log(
    limit: Option<u32>,
    before_seq: Option<i64>,
    state: State<'_, AppState>,
) -> Result<AuditLogPage, String> {
    let conn = state.db.connection()?;
    AuditRepository::list(&conn, limit, before_seq)
}
