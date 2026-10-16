use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageInfo {
    pub app_data_dir: String,
    pub db_dir: String,
    pub db_path: String,
    pub invoices_dir: String,
    pub backups_dir: String,
    pub settings_dir: String,
}

pub struct StorageManager {
    app_data_dir: PathBuf,
}

impl StorageManager {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data directory: {}", e))?;

        let manager = Self { app_data_dir };
        manager.ensure_directories()?;
        Ok(manager)
    }

    pub fn ensure_directories(&self) -> Result<(), String> {
        let dirs = [
            self.get_db_dir(),
            self.get_invoices_dir(),
            self.get_backups_dir(),
            self.get_settings_dir(),
            self.get_temp_dir(),
            self.get_documents_dir(),
        ];

        for dir in &dirs {
            if !dir.exists() {
                fs::create_dir_all(dir)
                    .map_err(|e| format!("Failed to create directory {}: {}", dir.display(), e))?;
            }
        }

        Ok(())
    }

    pub fn get_app_data_dir(&self) -> PathBuf {
        self.app_data_dir.clone()
    }

    pub fn get_db_dir(&self) -> PathBuf {
        self.app_data_dir.join("Database")
    }

    pub fn get_db_path(&self) -> PathBuf {
        self.get_db_dir().join("manonmani.db")
    }

    pub fn get_invoices_dir(&self) -> PathBuf {
        self.app_data_dir.join("Invoices")
    }

    pub fn get_invoice_year_dir(&self, year: &str) -> PathBuf {
        self.get_invoices_dir().join(year)
    }

    pub fn get_backups_dir(&self) -> PathBuf {
        self.app_data_dir.join("Backups")
    }

    /// Document Vault files, each named by its SHA-256.
    pub fn get_documents_dir(&self) -> PathBuf {
        self.app_data_dir.join("Documents")
    }

    pub fn get_settings_dir(&self) -> PathBuf {
        self.app_data_dir.join("Settings")
    }

    /// Short-lived copies of purchase order files made so they can be opened; emptied at start.
    pub fn get_temp_dir(&self) -> PathBuf {
        self.app_data_dir.join("Temp")
    }

    /// Delete everything left in the Temp folder. Failures are ignored: a file still open in
    /// another program just stays until the next start.
    pub fn clear_temp_dir(&self) {
        if let Ok(entries) = fs::read_dir(self.get_temp_dir()) {
            for entry in entries.flatten() {
                let path = entry.path();
                let _ = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
            }
        }
    }

    pub fn get_storage_info(&self) -> StorageInfo {
        StorageInfo {
            app_data_dir: self.app_data_dir.to_string_lossy().to_string(),
            db_dir: self.get_db_dir().to_string_lossy().to_string(),
            db_path: self.get_db_path().to_string_lossy().to_string(),
            invoices_dir: self.get_invoices_dir().to_string_lossy().to_string(),
            backups_dir: self.get_backups_dir().to_string_lossy().to_string(),
            settings_dir: self.get_settings_dir().to_string_lossy().to_string(),
        }
    }

    pub fn get_invoice_pdf_path(&self, year: &str, filename: &str) -> PathBuf {
        let clean_filename = if filename.ends_with(".pdf") {
            filename.to_string()
        } else {
            format!("{}.pdf", filename)
        };
        self.get_invoice_year_dir(year).join(clean_filename)
    }

    pub fn prepare_invoice_save_path(&self, year: &str, filename: &str) -> Result<PathBuf, String> {
        let year_dir = self.get_invoice_year_dir(year);
        if !year_dir.exists() {
            fs::create_dir_all(&year_dir)
                .map_err(|e| format!("Failed to create year directory {}: {}", year_dir.display(), e))?;
        }
        Ok(self.get_invoice_pdf_path(year, filename))
    }
}
