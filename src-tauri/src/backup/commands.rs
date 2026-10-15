use super::drive::{self, Credentials, Drive, DRIVE_FULL_MESSAGE, OFFLINE_MESSAGE};
use super::models::{AutoBackupEvent, BackupProgress, BackupResult, BackupStatus, DriveBackupList, PendingChanges};
use super::repository::BackupRepository;
use super::schedule::{self, SpaceState};
use super::snapshot;
use crate::AppState;
use chrono::Local;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// The automatic backup first looks one minute after the app opens, then every 15 minutes.
const AUTO_FIRST_CHECK: Duration = Duration::from_secs(60);
const AUTO_CHECK_EVERY: Duration = Duration::from_secs(15 * 60);

/// Local copies kept next to the database as an offline fallback.
const KEEP_LOCAL_COPIES: usize = 7;

static BUSY: AtomicBool = AtomicBool::new(false);

/// Only one backup or restore at a time.
struct BusyGuard;

impl BusyGuard {
    fn acquire() -> Result<BusyGuard, String> {
        if BUSY.swap(true, Ordering::SeqCst) {
            return Err("A backup or restore is already running.".to_string());
        }
        Ok(BusyGuard)
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}

fn open(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Could not open the database: {}", e))?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn progress(app: &AppHandle, stage: &str, message: &str) {
    let _ = app.emit("backup-progress", BackupProgress { stage: stage.to_string(), message: message.to_string() });
}

fn human_size(bytes: i64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.0} KB", (bytes as f64 / 1024.0).max(1.0))
    }
}

fn now() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn connected_credentials() -> Result<Credentials, String> {
    drive::load_credentials()?
        .filter(|c| c.refresh_token.is_some())
        .ok_or_else(|| "Connect Google Drive first (Settings).".to_string())
}

#[tauri::command]
pub fn backup_status(state: State<'_, AppState>) -> Result<BackupStatus, String> {
    let creds = drive::load_credentials().ok().flatten();
    let conn = state.db.get_connection()?;
    let last_success = BackupRepository::last_run(&conn, true)?;
    let last_seq = BackupRepository::last_success_seq(&conn)?;
    let (drive_space, drive_free_bytes) = BackupRepository::drive_space(&conn)?;
    let pending = match last_seq {
        Some(seq) => BackupRepository::pending_changes(&conn, seq)?,
        // Records made before change tracking existed are all unbacked-up.
        None => PendingChanges { total: 0, lines: vec!["Everything (no backup yet)".to_string()], any: true },
    };
    Ok(BackupStatus {
        configured: creds.as_ref().map(|c| !c.client_id.is_empty()).unwrap_or(false),
        connected: creds.as_ref().map(|c| c.refresh_token.is_some()).unwrap_or(false),
        account_email: creds.and_then(|c| c.email),
        last_success,
        last_run: BackupRepository::last_run(&conn, false)?,
        pending,
        running: BUSY.load(Ordering::SeqCst),
        drive_space,
        drive_free_bytes,
    })
}

/// Open Google Drive in the browser so the owner can delete old backups when it is full.
#[tauri::command]
pub fn open_google_drive() -> Result<(), String> {
    tauri_plugin_opener::open_url("https://drive.google.com/drive/search?q=Mononmani%20Backups", None::<&str>)
        .map_err(|e| format!("Could not open Google Drive: {}", e))
}

/// Start the automatic daily backup: while the app is open it checks every 15 minutes and backs up
/// once a day when something changed and Google Drive can be reached. Offline is simply tried again.
pub fn start_auto_backup(app: AppHandle, db_path: PathBuf, dir: PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(AUTO_FIRST_CHECK);
        loop {
            auto_backup_tick(&app, &db_path, &dir);
            std::thread::sleep(AUTO_CHECK_EVERY);
        }
    });
}

fn auto_backup_tick(app: &AppHandle, db_path: &Path, dir: &Path) {
    if BUSY.load(Ordering::SeqCst) || connected_credentials().is_err() {
        return;
    }
    let due = (|| -> Result<bool, String> {
        let conn = open(db_path)?;
        let last = BackupRepository::last_run(&conn, true)?.map(|r| r.finished_at);
        let has_changes = match BackupRepository::last_success_seq(&conn)? {
            Some(last_seq) => BackupRepository::max_seq(&conn)? > last_seq,
            None => true,
        };
        Ok(schedule::backup_due(last.as_deref(), &Local::now().format("%Y-%m-%d").to_string(), has_changes))
    })();
    if !matches!(due, Ok(true)) {
        return;
    }
    match backup_blocking(app, db_path, dir, true) {
        Ok(result) if result.outcome == "SUCCESS" => {
            let _ = app.emit("backup-auto", AutoBackupEvent { ok: true, message: "Backed up to Google Drive.".to_string() });
        }
        Ok(_) => {}
        Err(err) if err.starts_with(OFFLINE_MESSAGE) => {}
        Err(err) => {
            let _ = app.emit("backup-auto", AutoBackupEvent { ok: false, message: err });
        }
    }
}

/// Sign in to Google in the browser. Empty id/secret reuse the ones already saved.
#[tauri::command]
pub async fn connect_drive(client_id: String, client_secret: String) -> Result<Option<String>, String> {
    let saved = drive::load_credentials().ok().flatten().unwrap_or_default();
    let creds = Credentials {
        client_id: if client_id.trim().is_empty() { saved.client_id } else { client_id.trim().to_string() },
        client_secret: if client_secret.trim().is_empty() { saved.client_secret } else { client_secret.trim().to_string() },
        refresh_token: None,
        email: None,
    };
    if creds.client_id.is_empty() || creds.client_secret.is_empty() {
        return Err("Enter the Client ID and Client secret from your Google Cloud project.".to_string());
    }

    let pending = drive::begin_auth(&creds.client_id)?;
    tauri_plugin_opener::open_url(&pending.url, None::<&str>)
        .map_err(|e| format!("Could not open the browser for sign-in: {}", e))?;

    let signed_in = tauri::async_runtime::spawn_blocking(move || drive::finish_auth(pending, &creds))
        .await
        .map_err(|e| e.to_string())??;
    drive::save_credentials(&signed_in)?;
    Ok(signed_in.email)
}

#[tauri::command]
pub fn disconnect_drive() -> Result<(), String> {
    if let Some(creds) = drive::load_credentials()? {
        drive::revoke(&creds);
    }
    drive::clear_credentials()
}

#[tauri::command]
pub async fn run_backup(app: AppHandle, state: State<'_, AppState>) -> Result<BackupResult, String> {
    let db_path = state.storage.get_db_path();
    let dir = state.storage.get_backups_dir();
    tauri::async_runtime::spawn_blocking(move || backup_blocking(&app, &db_path, &dir, false))
        .await
        .map_err(|e| e.to_string())?
}

/// `auto`: started by the daily check. Being offline is then not recorded (it is tried again soon), and
/// the same failure is recorded only once a day so the history does not fill up.
fn backup_blocking(app: &AppHandle, db_path: &Path, dir: &Path, auto: bool) -> Result<BackupResult, String> {
    let _guard = BusyGuard::acquire()?;
    let started = now();
    let conn = open(db_path)?;
    match do_backup(app, &conn, dir, &started) {
        Ok(result) => Ok(result),
        Err(err) => {
            if err == DRIVE_FULL_MESSAGE {
                let _ = BackupRepository::save_drive_space(&conn, SpaceState::Full.as_str(), Some(0));
            }
            let repeated = BackupRepository::last_run(&conn, false).ok().flatten().is_some_and(|r| {
                r.status == "FAILED" && r.error.as_deref() == Some(err.as_str()) && r.finished_at.get(..10) == started.get(..10)
            });
            if !(auto && (err == OFFLINE_MESSAGE || repeated)) {
                let _ = BackupRepository::record_failure(&conn, &started, &err);
            }
            if !auto {
                progress(app, "failed", &err);
            }
            Err(format!("{} Nothing was lost; the next backup will include everything.", err))
        }
    }
}

fn do_backup(app: &AppHandle, conn: &Connection, dir: &Path, started: &str) -> Result<BackupResult, String> {
    let creds = connected_credentials()?;

    // Read the change number first. Anything written while the copy is made is
    // simply included again next time, so no change can be skipped.
    let last_seq = BackupRepository::last_success_seq(conn)?;
    let seq = BackupRepository::max_seq(conn)?;
    if let Some(last) = last_seq {
        if seq <= last {
            let when = BackupRepository::last_run(conn, true)?.map(|r| r.finished_at).unwrap_or_default();
            progress(app, "done", "Nothing to back up.");
            return Ok(BackupResult {
                outcome: "SKIPPED".to_string(),
                message: format!("Nothing has changed since your last backup ({}).", when),
                run: None,
            });
        }
    }
    let summary = match last_seq {
        Some(last) => BackupRepository::pending_changes(conn, last)?.lines,
        None => vec!["First backup: all records".to_string()],
    };

    progress(app, "connecting", "Connecting to Google Drive...");
    let drive = Drive::connect(&creds)?;
    let folder = drive.ensure_folder()?;
    drive.delete_partials(&folder)?;

    progress(app, "snapshot", "Copying and checking the database...");
    let name = format!("manonmani-{}-seq{}.db.gz", Local::now().format("%Y-%m-%d_%H%M%S"), seq);
    let snap = snapshot::create_snapshot(conn, dir, &name)?;
    let schema = crate::db::latest_version();

    // Room for this backup? If not, stop here and tell the owner to free space.
    let (used, limit) = drive.quota().unwrap_or((None, None));
    if schedule::space_state(used, limit, snap.size_bytes as i64) == SpaceState::Full {
        BackupRepository::save_drive_space(conn, SpaceState::Full.as_str(), schedule::free_bytes(used, limit))?;
        return Err(DRIVE_FULL_MESSAGE.to_string());
    }

    progress(app, "upload", "Uploading to Google Drive...");
    let temp_name = format!("{}.partial", name);
    let props = serde_json::json!({
        "sha256": snap.sha256,
        "change_seq": seq.to_string(),
        "schema_version": schema.to_string(),
    });
    let uploaded = drive.upload(&folder, &snap.gz_path, &temp_name, props)?;

    progress(app, "verify", "Checking the uploaded copy...");
    if uploaded.size != snap.size_bytes as i64 || (!uploaded.md5.is_empty() && uploaded.md5 != snap.md5) {
        let _ = drive.delete(&uploaded.id);
        return Err("The copy on Google Drive did not match the original, so it was discarded.".to_string());
    }
    drive.rename(&uploaded.id, &name)?;

    let run = BackupRepository::record_success(
        conn,
        started,
        seq,
        &uploaded.id,
        &name,
        snap.size_bytes as i64,
        &snap.sha256,
        &snap.md5,
        schema,
        &summary,
    )?;
    snapshot::prune_local(dir, KEEP_LOCAL_COPIES);

    // Older than two years: keep the newest backup of each month. Only the app's own backups are touched.
    progress(app, "tidy", "Tidying old backups...");
    if let Ok(list) = drive.list_backups(&folder) {
        let files: Vec<(String, String)> = list.into_iter().map(|b| (b.id, b.name)).collect();
        for id in schedule::files_to_thin(&files, Local::now().date_naive()) {
            let _ = drive.delete(&id);
        }
    }
    // Remember how much room is left for the next one (about the same size as this one).
    let (used, limit) = drive.quota().unwrap_or((None, None));
    let space = schedule::space_state(used, limit, snap.size_bytes as i64);
    BackupRepository::save_drive_space(conn, space.as_str(), schedule::free_bytes(used, limit))?;
    progress(app, "done", "Backup complete.");

    Ok(BackupResult {
        outcome: "SUCCESS".to_string(),
        message: format!("Backed up {} to Google Drive. Included: {}.", human_size(snap.size_bytes as i64), summary.join(", ")),
        run: Some(run),
    })
}

#[tauri::command]
pub async fn list_drive_backups() -> Result<DriveBackupList, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let creds = connected_credentials()?;
        let drive = Drive::connect(&creds)?;
        let folder = drive.ensure_folder()?;
        let backups = drive.list_backups(&folder)?;
        let (used_bytes, limit_bytes) = drive.quota().unwrap_or((None, None));
        Ok(DriveBackupList { backups, used_bytes, limit_bytes })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Replace the current data with a backup. The current data is copied aside first.
#[tauri::command]
pub async fn restore_drive_backup(file_id: String, state: State<'_, AppState>) -> Result<String, String> {
    let db_path = state.storage.get_db_path();
    let dir = state.storage.get_backups_dir();
    let message = tauri::async_runtime::spawn_blocking(move || restore_blocking(&db_path, &dir, &file_id))
        .await
        .map_err(|e| e.to_string())??;
    // Bring an older backup up to the current schema.
    state.db.initialize_and_migrate()?;
    Ok(message)
}

fn restore_blocking(db_path: &Path, dir: &Path, file_id: &str) -> Result<String, String> {
    let _guard = BusyGuard::acquire()?;
    let creds = connected_credentials()?;
    let drive = Drive::connect(&creds)?;

    let gz = dir.join("restore-download.gz");
    let temp_db = dir.join("restore-temp.db");
    let cleanup = || {
        let _ = fs::remove_file(&gz);
        let _ = fs::remove_file(&temp_db);
    };

    let result = (|| -> Result<String, String> {
        let drive_md5 = drive.download(file_id, &gz)?;
        let (_, local_md5) = snapshot::hash_file(&gz)?;
        if !drive_md5.is_empty() && drive_md5 != local_md5 {
            return Err("The downloaded backup was incomplete. Try again.".to_string());
        }
        snapshot::gunzip(&gz, &temp_db)?;
        snapshot::check_integrity(&temp_db)?;
        if snapshot::schema_version(&temp_db)? > crate::db::latest_version() {
            return Err("This backup was made by a newer version of the app. Update the app first.".to_string());
        }

        // Keep today's data so the restore itself can be undone.
        let before: PathBuf = dir.join(format!("before-restore-{}.db", Local::now().format("%Y-%m-%d_%H%M%S")));
        {
            let conn = open(db_path)?;
            snapshot::copy_database(&conn, &before)?;
        }

        for suffix in ["-wal", "-shm"] {
            let _ = fs::remove_file(PathBuf::from(format!("{}{}", db_path.display(), suffix)));
        }
        if let Err(e) = fs::copy(&temp_db, db_path) {
            let _ = fs::copy(&before, db_path);
            return Err(format!("Could not replace the database ({}). Your data was left as it was.", e));
        }
        Ok(format!("Restored. Your previous data was saved as {}.", before.display()))
    })();
    cleanup();
    result
}
