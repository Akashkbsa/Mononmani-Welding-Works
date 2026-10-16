//! What the owner is told when the app cannot start, instead of it closing without a word.

use std::path::{Path, PathBuf};

/// Where the last start-up problem is written, so support can read it.
pub fn log_path() -> PathBuf {
    std::env::temp_dir().join("mww_startup_error.log")
}

/// What to do about a start-up problem, from the error text.
fn advice(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("webview2") || lower.contains("webview") {
        "Microsoft Edge WebView2 is missing or damaged on this computer. Run the Mononmani Welding Works setup again; it installs WebView2."
    } else if lower.contains("os error 112") || lower.contains("os error 39") || lower.contains("disk is full") {
        "The computer's disk is full. Free some space (empty the Recycle Bin, delete old downloads) and open the app again."
    } else if lower.contains("os error 5)") || lower.contains("readonly database") || lower.contains("access is denied") {
        "Windows did not let the app use its data folder. If an antivirus or Controlled folder access is on, allow Mononmani Welding Works and open the app again."
    } else if lower.contains("os error 32") || lower.contains("database is locked") {
        "The data is in use by another program. Restart the computer and open the app again."
    } else if lower.contains("malformed") || lower.contains("not a database") {
        "The database file is damaged. Do not delete anything; contact support to restore it from the Google Drive backup."
    } else {
        "Restart the computer and open the app again. If it still does not open, contact support."
    }
}

/// The text of the message box shown when the app cannot start.
pub fn message(error: &str, data_dir: Option<&Path>) -> String {
    let mut text = format!("Mononmani Welding Works could not start.\n\n{}\n\nReason: {}", advice(error), error);
    if let Some(dir) = data_dir {
        text.push_str(&format!("\n\nYour data folder: {}", dir.display()));
    }
    text.push_str(&format!("\nThese details are saved in: {}", log_path().display()));
    text
}

/// Keep the problem in the log file; failures here are ignored, the message box still shows.
pub fn write_log(text: &str) {
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let _ = std::fs::write(log_path(), format!("{}\n{}\n", stamp, text));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_kind_of_problem_gets_its_own_advice() {
        assert!(message("Failed to create directory C:\\x: Access is denied. (os error 5)", None).contains("antivirus"));
        assert!(message("There is not enough space on the disk. (os error 112)", None).contains("disk is full"));
        assert!(message("database disk image is malformed", None).contains("Do not delete anything"));
        assert!(message("failed to create webview: WebView2 not found", None).contains("installs WebView2"));
        assert!(message("something else", None).contains("Restart the computer"));
        assert!(!message("(os error 50)", None).contains("antivirus"));
    }

    #[test]
    fn the_message_names_the_reason_the_data_folder_and_the_log() {
        let text = message("boom", Some(Path::new(r"C:\Users\Mani\AppData\Roaming\com.manonmani.app")));
        assert!(text.contains("Reason: boom"));
        assert!(text.contains(r"com.manonmani.app"));
        assert!(text.contains("mww_startup_error.log"));
    }

    #[test]
    fn a_damaged_database_file_is_reported_not_crashed_on() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("manonmani.db");
        std::fs::write(&path, vec![b'x'; 4096]).unwrap();
        let err = crate::db::DatabaseManager::new(&path).err().expect("a garbage file is not opened as the database");
        assert!(message(&err, None).contains("damaged"), "{}", err);
    }

    #[test]
    fn a_data_folder_that_cannot_be_made_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("Database");
        std::fs::write(&blocker, b"a file where the folder should be").unwrap();
        assert!(crate::db::DatabaseManager::new(blocker.join("manonmani.db")).is_err());
    }
}
