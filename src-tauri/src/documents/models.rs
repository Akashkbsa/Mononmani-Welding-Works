use serde::{Deserialize, Serialize};

/// The two groups of the Document Vault.
pub const CATEGORIES: [&str; 2] = ["IMPORTANT", "FUTURE"];

/// One document in the vault. The file itself is in the Documents folder, named by `sha256`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: i64,
    /// "IMPORTANT" or "FUTURE" (Keep for Future).
    pub category: String,
    pub title: String,
    pub note: Option<String>,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    /// A copy is on Google Drive (and is never deleted there).
    pub backed_up: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// What the owner types: the group, a title and an optional note.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentInput {
    pub category: String,
    pub title: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DocumentFilter {
    pub category: Option<String>,
    /// Words to find in the title, file name or note.
    pub query: Option<String>,
}

/// The counts on the Vault's tabs and its backup line.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentSummary {
    pub important: i64,
    pub future: i64,
    /// Documents not yet copied to Google Drive.
    pub waiting_for_backup: i64,
    pub waiting_bytes: i64,
    pub total_bytes: i64,
}

/// What a restore brought back from Google Drive.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentRestoreReport {
    pub restored: i64,
    /// Titles of documents that were never backed up, so Drive has no copy.
    pub not_on_drive: Vec<String>,
    /// "Title: reason" for documents that could not be downloaded.
    pub failed: Vec<String>,
}
