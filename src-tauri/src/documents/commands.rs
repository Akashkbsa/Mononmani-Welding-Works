use super::files::{decode_document_upload, preview_data_url, sha256_hex, store};
use super::models::{Document, DocumentFilter, DocumentInput, DocumentSummary};
use super::repository::DocumentRepository;
use super::sync::DocumentStore;
use crate::attachments::prepare_temp_copy;
use crate::AppState;
use tauri::State;

#[tauri::command(async)]
pub fn list_documents(filter: Option<DocumentFilter>, state: State<'_, AppState>) -> Result<Vec<Document>, String> {
    let conn = state.db.connection()?;
    DocumentRepository::list(&conn, &filter.unwrap_or_default())
}

#[tauri::command(async)]
pub fn get_document_summary(state: State<'_, AppState>) -> Result<DocumentSummary, String> {
    let conn = state.db.connection()?;
    DocumentRepository::summary(&conn)
}

/// `data_base64` is the file's bytes as base64 text, without a `data:` prefix.
#[tauri::command(async)]
pub fn add_document(
    input: DocumentInput,
    file_name: String,
    data_base64: String,
    state: State<'_, AppState>,
) -> Result<Document, String> {
    let bytes = decode_document_upload(&data_base64)?;
    let conn = state.db.connection()?;
    DocumentRepository::add(&conn, &state.storage.get_documents_dir(), &input, &file_name, &bytes)
}

#[tauri::command(async)]
pub fn update_document(id: i64, input: DocumentInput, state: State<'_, AppState>) -> Result<Document, String> {
    let conn = state.db.connection()?;
    DocumentRepository::update(&conn, id, &input)
}

/// Removes the document from this computer only. Its copy on Google Drive is never deleted.
#[tauri::command(async)]
pub fn delete_document(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    DocumentRepository::delete(&conn, &state.storage.get_documents_dir(), id)
}

/// The document's bytes. A file missing from this computer (a restore on a new computer) is
/// fetched from Google Drive, checked, and kept again.
fn document_bytes(state: &State<'_, AppState>, id: i64) -> Result<(Document, Vec<u8>), String> {
    let vault = state.storage.get_documents_dir();
    let (doc, bytes, noted) = {
        let conn = state.db.connection()?;
        let (doc, bytes) = DocumentRepository::read(&conn, &vault, id)?;
        let noted = if bytes.is_none() { DocumentRepository::drive_copy(&conn, &doc.sha256)? } else { None };
        (doc, bytes, noted)
    };
    if let Some(bytes) = bytes {
        return Ok((doc, bytes));
    }

    // Downloading is slow, so the shared connection is not held meanwhile.
    let not_here = |reason: String| format!("\"{}\" is not on this computer and could not be fetched from Google Drive. {}", doc.title, reason);
    let drive = crate::backup::document_store().map_err(not_here)?;
    let drive_id = match noted {
        Some(id) => id,
        None => drive
            .find(&doc.sha256)
            .map_err(not_here)?
            .ok_or_else(|| not_here("It was never backed up.".to_string()))?,
    };
    let bytes = drive.download(&drive_id).map_err(not_here)?;
    if sha256_hex(&bytes) != doc.sha256 {
        return Err(not_here("The copy there is not the same file.".to_string()));
    }
    store(&vault, &doc.sha256, &bytes)?;
    let conn = state.db.connection()?;
    DocumentRepository::mark_backed_up(&conn, &doc.sha256, &drive_id)?;
    Ok((doc, bytes))
}

/// A photo as a `data:` URL for showing inside the app.
#[tauri::command(async)]
pub fn get_document_preview(id: i64, state: State<'_, AppState>) -> Result<String, String> {
    let (doc, bytes) = document_bytes(&state, id)?;
    preview_data_url(&doc.mime_type, &bytes)
}

/// Open a copy of the document (in the app's Temp folder) in the program Windows uses for it.
/// The vault's own file is never opened, so editing in Word can't change what is kept.
#[tauri::command(async)]
pub fn open_document(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let (doc, bytes) = document_bytes(&state, id)?;
    let file = prepare_temp_copy(&state.storage.get_temp_dir(), "vault", id, &doc.file_name, &bytes)?;
    tauri_plugin_opener::open_path(file, None::<&str>)
        .map_err(|e| format!("Could not open the file: {}. Check that a program for this file type is installed.", e))
}
