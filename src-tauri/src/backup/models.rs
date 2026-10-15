use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRun {
    pub id: i64,
    pub started_at: String,
    pub finished_at: String,
    /// "SUCCESS" or "FAILED".
    pub status: String,
    pub file_name: Option<String>,
    pub size_bytes: Option<i64>,
    /// Plain-language lines such as "2 invoices added".
    pub summary: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PendingChanges {
    /// Customers, invoices, payments and advances added, edited or deleted since the last good backup.
    pub total: i64,
    pub lines: Vec<String>,
    /// Some change (including child rows) exists after the last good backup.
    pub any: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupStatus {
    /// Google client id and secret have been saved.
    pub configured: bool,
    pub connected: bool,
    pub account_email: Option<String>,
    pub last_success: Option<BackupRun>,
    pub last_run: Option<BackupRun>,
    pub pending: PendingChanges,
    pub running: bool,
    /// Google Drive space at the last check: "OK", "LOW" (under 500 MB free) or "FULL" (the next backup does not fit).
    pub drive_space: String,
    /// Free bytes at the last check; None when unknown or unlimited.
    pub drive_free_bytes: Option<i64>,
}

/// Sent to the window after an automatic backup worked or failed (never for being offline).
#[derive(Debug, Clone, Serialize)]
pub struct AutoBackupEvent {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveBackup {
    pub id: String,
    pub name: String,
    pub size_bytes: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveBackupList {
    pub backups: Vec<DriveBackup>,
    pub used_bytes: Option<i64>,
    pub limit_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    /// "SUCCESS" or "SKIPPED".
    pub outcome: String,
    pub message: String,
    pub run: Option<BackupRun>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupProgress {
    pub stage: String,
    pub message: String,
}
