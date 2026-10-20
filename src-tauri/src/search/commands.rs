use super::{models::SearchResult, repository::SearchRepository};
use crate::AppState;
use tauri::State;

#[tauri::command(async)]
pub fn search_all(query: String, state: State<'_, AppState>) -> Result<Vec<SearchResult>, String> {
    let query = query.trim().to_string();
    if query.len() < 2 {
        return Ok(vec![]);
    }
    let conn = state.db.connection()?;
    SearchRepository::search(&conn, &query)
}
