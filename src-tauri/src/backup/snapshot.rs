use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use md5::Md5;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

pub struct Snapshot {
    pub gz_path: PathBuf,
    pub sha256: String,
    pub md5: String,
    pub size_bytes: u64,
}

fn sql_quote(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// SHA-256 and MD5 of a file, read in chunks.
pub fn hash_file(path: &Path) -> Result<(String, String), String> {
    let mut file = File::open(path).map_err(|e| format!("Could not read {}: {}", path.display(), e))?;
    let mut sha = Sha256::new();
    let mut md5 = Md5::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        sha.update(&buf[..n]);
        md5.update(&buf[..n]);
    }
    Ok((hex(&sha.finalize()), hex(&md5.finalize())))
}

/// Run `PRAGMA integrity_check` on a database file.
pub fn check_integrity(db_file: &Path) -> Result<(), String> {
    let conn = Connection::open(db_file).map_err(|e| format!("Could not open the copy: {}", e))?;
    let result: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| format!("Integrity check failed: {}", e))?;
    if result != "ok" {
        return Err(format!("The database copy failed its integrity check: {}", result));
    }
    Ok(())
}

/// Highest migration version recorded inside a database file.
pub fn schema_version(db_file: &Path) -> Result<i32, String> {
    let conn = Connection::open(db_file).map_err(|e| e.to_string())?;
    conn.query_row("SELECT COALESCE(MAX(version), 0) FROM _migrations", [], |r| r.get(0))
        .map_err(|_| "This file is not a Mononmani database.".to_string())
}

/// A consistent copy of the live database (safe while the app is open), via VACUUM INTO.
pub fn copy_database(source: &Connection, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        fs::remove_file(dest).map_err(|e| e.to_string())?;
    }
    source
        .execute_batch(&format!("VACUUM INTO '{}'", sql_quote(dest)))
        .map_err(|e| format!("Could not copy the database: {}", e))
}

fn gzip(src: &Path, dest: &Path) -> Result<(), String> {
    let mut input = File::open(src).map_err(|e| e.to_string())?;
    let output = File::create(dest).map_err(|e| e.to_string())?;
    let mut encoder = GzEncoder::new(output, Compression::default());
    io::copy(&mut input, &mut encoder).map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn gunzip(src: &Path, dest: &Path) -> Result<(), String> {
    let input = File::open(src).map_err(|e| e.to_string())?;
    let mut decoder = GzDecoder::new(input);
    let mut output = File::create(dest).map_err(|e| e.to_string())?;
    io::copy(&mut decoder, &mut output).map_err(|e| format!("The backup file is damaged: {}", e))?;
    Ok(())
}

/// Copy the database, verify the copy, compress it and hash the compressed file.
pub fn create_snapshot(source: &Connection, work_dir: &Path, gz_name: &str) -> Result<Snapshot, String> {
    fs::create_dir_all(work_dir).map_err(|e| e.to_string())?;
    let temp_db = work_dir.join("snapshot-temp.db");
    let result = (|| {
        copy_database(source, &temp_db)?;
        check_integrity(&temp_db)?;
        let gz_path = work_dir.join(gz_name);
        gzip(&temp_db, &gz_path)?;
        let (sha256, md5) = hash_file(&gz_path)?;
        let size_bytes = fs::metadata(&gz_path).map_err(|e| e.to_string())?.len();
        Ok(Snapshot { gz_path, sha256, md5, size_bytes })
    })();
    let _ = fs::remove_file(&temp_db);
    result
}

/// Keep only the newest `keep` local `manonmani-*.db.gz` files.
pub fn prune_local(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("manonmani-") && n.ends_with(".db.gz"))
                .unwrap_or(false)
        })
        .collect();
    files.sort(); // names start with a timestamp, so oldest first
    while files.len() > keep {
        let _ = fs::remove_file(files.remove(0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;

    #[test]
    fn snapshot_round_trips_and_passes_integrity() {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("live.db")).unwrap();
        let conn = db.get_connection().unwrap();
        conn.execute(
            "INSERT INTO customers (name, is_favorite, created_at, updated_at) VALUES ('Snap', 0, 'x', 'x')",
            [],
        )
        .unwrap();

        let snap = create_snapshot(&conn, &dir.path().join("work"), "manonmani-test.db.gz").unwrap();
        assert!(snap.size_bytes > 0);
        assert_eq!(hash_file(&snap.gz_path).unwrap().0, snap.sha256);

        let restored = dir.path().join("restored.db");
        gunzip(&snap.gz_path, &restored).unwrap();
        check_integrity(&restored).unwrap();
        assert_eq!(schema_version(&restored).unwrap(), crate::db::latest_version());
        let name: String = Connection::open(&restored)
            .unwrap()
            .query_row("SELECT name FROM customers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Snap");
    }

    #[test]
    fn prune_keeps_newest_files() {
        let dir = tempfile::tempdir().unwrap();
        for n in ["manonmani-2026-01-01.db.gz", "manonmani-2026-01-02.db.gz", "manonmani-2026-01-03.db.gz"] {
            fs::write(dir.path().join(n), b"x").unwrap();
        }
        prune_local(dir.path(), 2);
        assert!(!dir.path().join("manonmani-2026-01-01.db.gz").exists());
        assert!(dir.path().join("manonmani-2026-01-03.db.gz").exists());
    }
}
