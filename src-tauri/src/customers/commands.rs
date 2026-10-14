use super::models::{Customer, CustomerCreateInput, CustomerUpdateInput, DuplicateCheckResult};
use super::repository::CustomerRepository;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn list_customers(party: Option<String>, state: State<'_, AppState>) -> Result<Vec<Customer>, String> {
    let conn = state.db.get_connection()?;
    CustomerRepository::list_by_party(&conn, party.as_deref())
}

#[tauri::command]
pub fn search_customers(
    query: String,
    party: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Customer>, String> {
    let conn = state.db.get_connection()?;
    CustomerRepository::search_by_party(&conn, &query, party.as_deref())
}

#[tauri::command]
pub fn get_customer(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Option<Customer>, String> {
    let conn = state.db.get_connection()?;
    CustomerRepository::find_by_id(&conn, id)
}

#[tauri::command]
pub fn check_duplicate_customer(
    name: String,
    exclude_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<DuplicateCheckResult, String> {
    let conn = state.db.get_connection()?;
    CustomerRepository::check_duplicate(&conn, &name, exclude_id)
}

#[tauri::command]
pub fn create_customer(
    input: CustomerCreateInput,
    state: State<'_, AppState>,
) -> Result<Customer, String> {
    let conn = state.db.get_connection()?;
    CustomerRepository::create(&conn, input)
}

#[tauri::command]
pub fn update_customer(
    id: i64,
    input: CustomerUpdateInput,
    state: State<'_, AppState>,
) -> Result<Customer, String> {
    let conn = state.db.get_connection()?;
    CustomerRepository::update(&conn, id, input)
}

#[tauri::command]
pub fn delete_customer(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection()?;
    CustomerRepository::delete(&conn, id)
}

#[tauri::command]
pub fn toggle_customer_favorite(
    id: i64,
    is_favorite: bool,
    state: State<'_, AppState>,
) -> Result<Customer, String> {
    let conn = state.db.get_connection()?;
    CustomerRepository::toggle_favorite(&conn, id, is_favorite)
}

#[tauri::command]
pub fn touch_customer_last_used(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Customer, String> {
    let conn = state.db.get_connection()?;
    CustomerRepository::update_last_used(&conn, id)
}
