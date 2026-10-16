//! Copying vault documents to Google Drive and bringing them back.
//!
//! The backup copy of a document must never be deleted, so the store below can only upload, find
//! and download. There is no way to remove anything through it. Google Drive implements it in the
//! app (`backup::drive`); the tests use a folder on disk.

use super::files::{md5_hex, read_stored, sha256_hex, store};
use super::models::{Document, DocumentRestoreReport};
use super::repository::DocumentRepository;
use rusqlite::Connection;
use std::path::Path;

/// A copy that the store confirmed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredCopy {
    pub id: String,
    pub size: i64,
    /// Empty when the store does not report one.
    pub md5: String,
}

/// Where vault documents are backed up. Deliberately without delete.
pub trait DocumentStore {
    /// The copy of the file with this SHA-256, if the store already has one.
    fn find(&self, sha256: &str) -> Result<Option<String>, String>;
    /// Store a new copy and return what the store saw.
    fn upload(&self, doc: &Document, bytes: &[u8]) -> Result<StoredCopy, String>;
    /// The bytes of a stored copy.
    fn download(&self, id: &str) -> Result<Vec<u8>, String>;
}

/// Back up every document that has no copy yet. `progress(done, total, title)` is called before
/// each one. Stops at the first failure (offline, Drive full); what was copied stays noted, so the
/// next backup carries on from there. Returns how many were copied now.
pub fn upload_waiting(
    conn: &Connection,
    vault_dir: &Path,
    store_to: &dyn DocumentStore,
    progress: &mut dyn FnMut(usize, usize, &str),
) -> Result<usize, String> {
    let waiting = DocumentRepository::waiting_for_backup(conn)?;
    let total = waiting.len();
    let mut copied = 0;
    for (i, doc) in waiting.iter().enumerate() {
        progress(i, total, &doc.title);
        // Copied before but not noted (the app closed mid-backup): just note it.
        if let Some(id) = store_to.find(&doc.sha256)? {
            DocumentRepository::mark_backed_up(conn, &doc.sha256, &id)?;
            continue;
        }
        let Some(bytes) = read_stored(vault_dir, &doc.sha256)? else {
            // Not on this computer and not on Drive: nothing to copy. Opening it explains.
            continue;
        };
        let copy = store_to.upload(doc, &bytes)?;
        if copy.size != bytes.len() as i64 || (!copy.md5.is_empty() && copy.md5 != md5_hex(&bytes)) {
            return Err(format!(
                "The copy of \"{}\" on Google Drive did not match the original. It will be sent again next time.",
                doc.title
            ));
        }
        DocumentRepository::mark_backed_up(conn, &doc.sha256, &copy.id)?;
        copied += 1;
    }
    progress(total, total, "");
    Ok(copied)
}

/// The store's copy of a document: the id noted at upload, or found by its SHA-256.
fn copy_id(conn: &Connection, store_from: &dyn DocumentStore, doc: &Document) -> Result<Option<String>, String> {
    match DocumentRepository::drive_copy(conn, &doc.sha256)? {
        Some(id) => Ok(Some(id)),
        None => store_from.find(&doc.sha256),
    }
}

/// Download one document's file into the vault and check it is exactly the file that was added.
pub fn fetch_one(conn: &Connection, vault_dir: &Path, store_from: &dyn DocumentStore, doc: &Document) -> Result<Vec<u8>, String> {
    let id = copy_id(conn, store_from, doc)?.ok_or_else(|| {
        format!("\"{}\" is not on this computer and was never backed up to Google Drive.", doc.title)
    })?;
    let bytes = store_from.download(&id)?;
    if sha256_hex(&bytes) != doc.sha256 {
        return Err(format!("The copy of \"{}\" on Google Drive is not the same file. It was not used.", doc.title));
    }
    store(vault_dir, &doc.sha256, &bytes)?;
    DocumentRepository::mark_backed_up(conn, &doc.sha256, &id)?;
    Ok(bytes)
}

/// After a restore (or on a new computer): bring back every document whose file is missing here.
/// One failure does not stop the others.
pub fn restore_missing(conn: &Connection, vault_dir: &Path, store_from: &dyn DocumentStore) -> Result<DocumentRestoreReport, String> {
    let mut report = DocumentRestoreReport::default();
    for doc in DocumentRepository::missing_files(conn, vault_dir)? {
        match copy_id(conn, store_from, &doc) {
            Ok(None) => report.not_on_drive.push(doc.title.clone()),
            Ok(Some(_)) => match fetch_one(conn, vault_dir, store_from, &doc) {
                Ok(_) => report.restored += 1,
                Err(e) => report.failed.push(format!("{}: {}", doc.title, e)),
            },
            Err(e) => report.failed.push(format!("{}: {}", doc.title, e)),
        }
    }
    Ok(report)
}

/// A store in a folder on disk: the tests' stand-in for Google Drive. Like Drive, it only ever adds.
pub struct FolderStore {
    pub dir: std::path::PathBuf,
}

impl DocumentStore for FolderStore {
    fn find(&self, sha256: &str) -> Result<Option<String>, String> {
        let id = format!("copy-{}", sha256);
        Ok(self.dir.join(&id).exists().then_some(id))
    }

    fn upload(&self, doc: &Document, bytes: &[u8]) -> Result<StoredCopy, String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let id = format!("copy-{}", doc.sha256);
        std::fs::write(self.dir.join(&id), bytes).map_err(|e| e.to_string())?;
        Ok(StoredCopy { id, size: bytes.len() as i64, md5: md5_hex(bytes) })
    }

    fn download(&self, id: &str) -> Result<Vec<u8>, String> {
        std::fs::read(self.dir.join(id)).map_err(|e| format!("Could not download: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;
    use crate::documents::models::DocumentInput;
    use std::cell::{Cell, RefCell};

    fn setup() -> (tempfile::TempDir, Connection, std::path::PathBuf, FolderStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("t.db")).unwrap();
        let conn = db.get_connection().unwrap();
        let vault = dir.path().join("Documents");
        let drive = FolderStore { dir: dir.path().join("Drive") };
        (dir, conn, vault, drive)
    }

    fn add(conn: &Connection, vault: &Path, title: &str, bytes: &[u8]) -> Document {
        let input = DocumentInput { category: "IMPORTANT".to_string(), title: title.to_string(), note: None };
        DocumentRepository::add(conn, vault, &input, &format!("{}.pdf", title), bytes).unwrap()
    }

    /// Counts uploads, and can be told to fail or to report a wrong size.
    struct Watched {
        inner: FolderStore,
        uploads: Cell<usize>,
        fail_after: Option<usize>,
        bad_size: bool,
        titles: RefCell<Vec<String>>,
    }

    impl DocumentStore for Watched {
        fn find(&self, sha256: &str) -> Result<Option<String>, String> {
            self.inner.find(sha256)
        }
        fn upload(&self, doc: &Document, bytes: &[u8]) -> Result<StoredCopy, String> {
            if self.fail_after.is_some_and(|n| self.uploads.get() >= n) {
                return Err("You're offline.".to_string());
            }
            self.uploads.set(self.uploads.get() + 1);
            self.titles.borrow_mut().push(doc.title.clone());
            let mut copy = self.inner.upload(doc, bytes)?;
            if self.bad_size {
                copy.size -= 1;
            }
            Ok(copy)
        }
        fn download(&self, id: &str) -> Result<Vec<u8>, String> {
            self.inner.download(id)
        }
    }

    fn watched(drive: FolderStore) -> Watched {
        Watched { inner: drive, uploads: Cell::new(0), fail_after: None, bad_size: false, titles: RefCell::new(vec![]) }
    }

    #[test]
    fn each_document_is_uploaded_once() {
        let (_d, conn, vault, drive) = setup();
        add(&conn, &vault, "Deed", b"deed");
        add(&conn, &vault, "Lease", b"lease");
        let store_to = watched(drive);
        let mut seen = Vec::new();
        let n = upload_waiting(&conn, &vault, &store_to, &mut |done, total, _| seen.push((done, total))).unwrap();
        assert_eq!(n, 2);
        assert_eq!(seen, vec![(0, 2), (1, 2), (2, 2)]);
        assert_eq!(DocumentRepository::summary(&conn).unwrap().waiting_for_backup, 0);
        assert_eq!(upload_waiting(&conn, &vault, &store_to, &mut |_, _, _| {}).unwrap(), 0, "nothing new");
        assert_eq!(store_to.uploads.get(), 2);
    }

    #[test]
    fn a_failure_keeps_what_was_copied_and_the_next_run_continues() {
        let (_d, conn, vault, drive) = setup();
        for t in ["A", "B", "C"] {
            add(&conn, &vault, t, t.as_bytes());
        }
        let mut store_to = watched(drive);
        store_to.fail_after = Some(1);
        assert!(upload_waiting(&conn, &vault, &store_to, &mut |_, _, _| {}).is_err());
        assert_eq!(DocumentRepository::summary(&conn).unwrap().waiting_for_backup, 2);
        store_to.fail_after = None;
        assert_eq!(upload_waiting(&conn, &vault, &store_to, &mut |_, _, _| {}).unwrap(), 2);
        assert_eq!(*store_to.titles.borrow(), vec!["A", "B", "C"]);
    }

    #[test]
    fn a_copy_already_on_drive_is_noted_not_sent_again() {
        let (_d, conn, vault, drive) = setup();
        let doc = add(&conn, &vault, "Deed", b"deed");
        drive.upload(&doc, b"deed").unwrap(); // sent, but the app closed before noting it
        let store_to = watched(drive);
        assert_eq!(upload_waiting(&conn, &vault, &store_to, &mut |_, _, _| {}).unwrap(), 0);
        assert_eq!(store_to.uploads.get(), 0);
        assert!(DocumentRepository::get(&conn, doc.id).unwrap().unwrap().backed_up);
    }

    #[test]
    fn a_copy_that_does_not_match_is_not_counted() {
        let (_d, conn, vault, drive) = setup();
        add(&conn, &vault, "Deed", b"deed");
        let mut store_to = watched(drive);
        store_to.bad_size = true;
        let err = upload_waiting(&conn, &vault, &store_to, &mut |_, _, _| {}).unwrap_err();
        assert!(err.contains("did not match"), "{}", err);
        assert_eq!(DocumentRepository::summary(&conn).unwrap().waiting_for_backup, 1);
    }

    #[test]
    fn missing_files_come_back_from_drive_and_are_checked() {
        let (_d, conn, vault, drive) = setup();
        let deed = add(&conn, &vault, "Deed", b"deed");
        let lease = add(&conn, &vault, "Lease", b"lease");
        let fresh = add(&conn, &vault, "Fresh", b"fresh");
        upload_waiting(&conn, &vault, &drive, &mut |_, _, _| {}).unwrap();
        // "Fresh" is removed from Drive's stand-in by hand to act as never backed up; on Drive itself
        // the app can't do that.
        conn.execute("DELETE FROM document_drive_copies WHERE sha256 = ?1", [&fresh.sha256]).unwrap();
        std::fs::remove_file(drive.dir.join(format!("copy-{}", fresh.sha256))).unwrap();
        std::fs::remove_dir_all(&vault).unwrap();

        let report = restore_missing(&conn, &vault, &drive).unwrap();
        assert_eq!(report.restored, 2);
        assert_eq!(report.not_on_drive, vec!["Fresh"]);
        assert!(report.failed.is_empty());
        assert_eq!(read_stored(&vault, &deed.sha256).unwrap().unwrap(), b"deed");
        assert_eq!(read_stored(&vault, &lease.sha256).unwrap().unwrap(), b"lease");
        assert!(restore_missing(&conn, &vault, &drive).unwrap().restored == 0, "nothing left to fetch");
    }

    #[test]
    fn a_wrong_file_on_drive_is_never_used() {
        let (_d, conn, vault, drive) = setup();
        let deed = add(&conn, &vault, "Deed", b"deed");
        upload_waiting(&conn, &vault, &drive, &mut |_, _, _| {}).unwrap();
        std::fs::write(drive.dir.join(format!("copy-{}", deed.sha256)), b"tampered").unwrap();
        std::fs::remove_file(vault.join(&deed.sha256)).unwrap();
        let report = restore_missing(&conn, &vault, &drive).unwrap();
        assert_eq!(report.restored, 0);
        assert!(report.failed[0].contains("not the same file"), "{:?}", report.failed);
        assert!(!vault.join(&deed.sha256).exists());
    }

    #[test]
    fn copies_on_drive_are_found_without_the_noted_id() {
        // A database restored from before the upload was noted still finds the copy by its hash.
        let (_d, conn, vault, drive) = setup();
        let deed = add(&conn, &vault, "Deed", b"deed");
        upload_waiting(&conn, &vault, &drive, &mut |_, _, _| {}).unwrap();
        conn.execute("DELETE FROM document_drive_copies", []).unwrap();
        std::fs::remove_file(vault.join(&deed.sha256)).unwrap();
        assert_eq!(fetch_one(&conn, &vault, &drive, &deed).unwrap(), b"deed");
        assert!(DocumentRepository::get(&conn, deed.id).unwrap().unwrap().backed_up);
    }

    #[test]
    fn deleting_a_document_never_touches_its_drive_copy() {
        let (_d, conn, vault, drive) = setup();
        let deed = add(&conn, &vault, "Deed", b"deed");
        upload_waiting(&conn, &vault, &drive, &mut |_, _, _| {}).unwrap();
        DocumentRepository::delete(&conn, &vault, deed.id).unwrap();
        assert_eq!(drive.download(&format!("copy-{}", deed.sha256)).unwrap(), b"deed");
        assert_eq!(sha256_hex(b"deed"), deed.sha256);
    }
}
