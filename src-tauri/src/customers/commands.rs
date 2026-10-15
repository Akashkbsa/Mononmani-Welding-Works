use super::models::{Customer, CustomerCreateInput, CustomerUpdateInput, DuplicateCheckResult};
use super::repository::CustomerRepository;
use crate::AppState;
use tauri::State;

#[tauri::command(async)]
pub fn list_customers(party: Option<String>, state: State<'_, AppState>) -> Result<Vec<Customer>, String> {
    let conn = state.db.connection()?;
    CustomerRepository::list_by_party(&conn, party.as_deref())
}

#[tauri::command(async)]
pub fn search_customers(
    query: String,
    party: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Customer>, String> {
    let conn = state.db.connection()?;
    CustomerRepository::search_by_party(&conn, &query, party.as_deref())
}

#[tauri::command(async)]
pub fn check_duplicate_customer(
    name: String,
    exclude_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<DuplicateCheckResult, String> {
    let conn = state.db.connection()?;
    CustomerRepository::check_duplicate(&conn, &name, exclude_id)
}

#[tauri::command(async)]
pub fn create_customer(
    input: CustomerCreateInput,
    state: State<'_, AppState>,
) -> Result<Customer, String> {
    let conn = state.db.connection()?;
    CustomerRepository::create(&conn, input)
}

#[tauri::command(async)]
pub fn update_customer(
    id: i64,
    input: CustomerUpdateInput,
    state: State<'_, AppState>,
) -> Result<Customer, String> {
    let conn = state.db.connection()?;
    CustomerRepository::update(&conn, id, input)
}

#[tauri::command(async)]
pub fn delete_customer(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    CustomerRepository::delete(&conn, id)
}

#[tauri::command(async)]
pub fn toggle_customer_favorite(
    id: i64,
    is_favorite: bool,
    state: State<'_, AppState>,
) -> Result<Customer, String> {
    let conn = state.db.connection()?;
    CustomerRepository::toggle_favorite(&conn, id, is_favorite)
}

#[tauri::command(async)]
pub fn touch_customer_last_used(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Customer, String> {
    let conn = state.db.connection()?;
    CustomerRepository::update_last_used(&conn, id)
}
