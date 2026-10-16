use super::files::{read_stored, sha256_hex, store, stored_path, validate_document};
use super::models::{Document, DocumentFilter, DocumentInput, DocumentSummary, CATEGORIES};
use crate::attachments::clean_file_name;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;

pub struct DocumentRepository;

const MAX_TITLE_CHARS: usize = 200;
const MAX_NOTE_CHARS: usize = 2000;
const NOT_FOUND: &str = "That document is no longer in the vault.";

const SELECT: &str = "SELECT d.id, d.category, d.title, d.note, d.file_name, d.mime_type, d.size_bytes, d.sha256,
        c.sha256 IS NOT NULL, d.created_at, d.updated_at
    FROM documents d LEFT JOIN document_drive_copies c ON c.sha256 = d.sha256";

pub fn category_label(category: &str) -> &'static str {
    if category == "FUTURE" {
        "Keep for Future"
    } else {
        "Important"
    }
}

/// The title, note and group, trimmed and checked. An empty title takes the file's name.
fn clean_input(input: &DocumentInput, file_name: &str) -> Result<(String, String, Option<String>), String> {
    let category = input.category.trim().to_ascii_uppercase();
    if !CATEGORIES.contains(&category.as_str()) {
        return Err("Choose Important or Keep for Future.".to_string());
    }
    let mut title = input.title.trim().to_string();
    if title.is_empty() {
        title = file_name.to_string();
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("The title is too long (maximum {} characters).", MAX_TITLE_CHARS));
    }
    let note = input.note.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);
    if note.as_ref().is_some_and(|n| n.chars().count() > MAX_NOTE_CHARS) {
        return Err(format!("The note is too long (maximum {} characters).", MAX_NOTE_CHARS));
    }
    Ok((category, title, note))
}

impl DocumentRepository {
    fn map_row(r: &Row) -> rusqlite::Result<Document> {
        Ok(Document {
            id: r.get(0)?,
            category: r.get(1)?,
            title: r.get(2)?,
            note: r.get(3)?,
            file_name: r.get(4)?,
            mime_type: r.get(5)?,
            size_bytes: r.get(6)?,
            sha256: r.get(7)?,
            backed_up: r.get(8)?,
            created_at: r.get(9)?,
            updated_at: r.get(10)?,
        })
    }

    /// Put a file into the vault. The same file can be in the vault only once.
    pub fn add(conn: &Connection, vault_dir: &Path, input: &DocumentInput, file_name: &str, bytes: &[u8]) -> Result<Document, String> {
        let name = clean_file_name(file_name);
        let mime = validate_document(&name, bytes)?;
        let (category, title, note) = clean_input(input, &name)?;
        let sha = sha256_hex(bytes);

        let already = |conn: &Connection| -> Result<Option<String>, String> {
            conn.query_row("SELECT title, category FROM documents WHERE sha256 = ?1", params![sha], |r| {
                Ok(format!(
                    "This file is already in the vault as \"{}\" ({}).",
                    r.get::<_, String>(0)?,
                    category_label(&r.get::<_, String>(1)?)
                ))
            })
            .optional()
            .map_err(|e| format!("Failed to check the vault: {}", e))
        };
        if let Some(message) = already(conn)? {
            return Err(message);
        }

        let written = store(vault_dir, &sha, bytes)?;
        let now = Utc::now().to_rfc3339();
        let inserted = conn.execute(
            "INSERT INTO documents (category, title, note, file_name, mime_type, size_bytes, sha256, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![category, title, note, name, mime, bytes.len() as i64, sha, now],
        );
        if let Err(e) = inserted {
            // The same file saved at the same moment from elsewhere won: its file must stay.
            let taken = already(conn).ok().flatten();
            if written && taken.is_none() {
                let _ = std::fs::remove_file(stored_path(vault_dir, &sha)?);
            }
            return Err(taken.unwrap_or_else(|| format!("Failed to save the document: {}", e)));
        }
        Self::get(conn, conn.last_insert_rowid())?.ok_or_else(|| NOT_FOUND.to_string())
    }

    pub fn get(conn: &Connection, id: i64) -> Result<Option<Document>, String> {
        conn.query_row(&format!("{} WHERE d.id = ?1", SELECT), params![id], Self::map_row)
            .optional()
            .map_err(|e| format!("Failed to load the document: {}", e))
    }

    /// Newest first. Words in `query` must each appear in the title, file name or note.
    pub fn list(conn: &Connection, filter: &DocumentFilter) -> Result<Vec<Document>, String> {
        let mut sql = format!("{} WHERE 1 = 1", SELECT);
        let mut args: Vec<String> = Vec::new();
        if let Some(category) = filter.category.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            args.push(category.to_ascii_uppercase());
            sql.push_str(&format!(" AND d.category = ?{}", args.len()));
        }
        // Ten words of up to 100 characters each: longer text can only be pasted by mistake, and
        // SQLite refuses a LIKE pattern that long.
        for word in filter.query.as_deref().unwrap_or("").split_whitespace().take(10) {
            let word: String = word.chars().take(100).collect();
            let escaped = word.to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            args.push(format!("%{}%", escaped));
            let n = args.len();
            sql.push_str(&format!(
                " AND (lower(d.title) LIKE ?{n} ESCAPE '\\' OR lower(d.file_name) LIKE ?{n} ESCAPE '\\' OR lower(COALESCE(d.note, '')) LIKE ?{n} ESCAPE '\\')"
            ));
        }
        sql.push_str(" ORDER BY d.created_at DESC, d.id DESC");
        let mut stmt = conn.prepare(&sql).map_err(|e| format!("Failed to load documents: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(args.iter()), Self::map_row)
            .map_err(|e| format!("Failed to load documents: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read documents: {}", e))
    }

    /// Change the title, note or group. The file itself never changes.
    pub fn update(conn: &Connection, id: i64, input: &DocumentInput) -> Result<Document, String> {
        let current = Self::get(conn, id)?.ok_or_else(|| NOT_FOUND.to_string())?;
        let (category, title, note) = clean_input(input, &current.file_name)?;
        conn.execute(
            "UPDATE documents SET category = ?1, title = ?2, note = ?3, updated_at = ?4 WHERE id = ?5",
            params![category, title, note, Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to save the document: {}", e))?;
        Self::get(conn, id)?.ok_or_else(|| NOT_FOUND.to_string())
    }

    /// Remove a document from this computer. Its copy on Google Drive, and the note that it is
    /// there, are kept for ever.
    pub fn delete(conn: &Connection, vault_dir: &Path, id: i64) -> Result<(), String> {
        let doc = Self::get(conn, id)?.ok_or_else(|| NOT_FOUND.to_string())?;
        conn.execute("DELETE FROM documents WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete the document: {}", e))?;
        let path = stored_path(vault_dir, &doc.sha256)?;
        if let Err(e) = std::fs::remove_file(&path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                // The record is gone; a leftover file only takes space and is harmless.
                eprintln!("Could not remove {}: {}", path.display(), e);
            }
        }
        Ok(())
    }

    /// The document and its bytes. None for the bytes when the file is missing from this computer
    /// (for example after a restore on a new computer): it can then be fetched from Google Drive.
    pub fn read(conn: &Connection, vault_dir: &Path, id: i64) -> Result<(Document, Option<Vec<u8>>), String> {
        let doc = Self::get(conn, id)?.ok_or_else(|| NOT_FOUND.to_string())?;
        let bytes = read_stored(vault_dir, &doc.sha256)?;
        Ok((doc, bytes))
    }

    pub fn summary(conn: &Connection) -> Result<DocumentSummary, String> {
        conn.query_row(
            "SELECT COALESCE(SUM(d.category = 'IMPORTANT'), 0), COALESCE(SUM(d.category = 'FUTURE'), 0),
                    COALESCE(SUM(c.sha256 IS NULL), 0), COALESCE(SUM(CASE WHEN c.sha256 IS NULL THEN d.size_bytes END), 0),
                    COALESCE(SUM(d.size_bytes), 0)
             FROM documents d LEFT JOIN document_drive_copies c ON c.sha256 = d.sha256",
            [],
            |r| {
                Ok(DocumentSummary {
                    important: r.get(0)?,
                    future: r.get(1)?,
                    waiting_for_backup: r.get(2)?,
                    waiting_bytes: r.get(3)?,
                    total_bytes: r.get(4)?,
                })
            },
        )
        .map_err(|e| format!("Failed to count documents: {}", e))
    }

    /// Documents with no copy on Google Drive yet, oldest first.
    pub fn waiting_for_backup(conn: &Connection) -> Result<Vec<Document>, String> {
        let mut stmt = conn
            .prepare(&format!("{} WHERE c.sha256 IS NULL ORDER BY d.id", SELECT))
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], Self::map_row).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Note that this file is on Google Drive. Kept even if the document is later deleted here.
    pub fn mark_backed_up(conn: &Connection, sha256: &str, drive_file_id: &str) -> Result<(), String> {
        conn.execute(
            "INSERT INTO document_drive_copies (sha256, drive_file_id, uploaded_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(sha256) DO UPDATE SET drive_file_id = excluded.drive_file_id",
            params![sha256, drive_file_id, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Failed to note the backup: {}", e))?;
        Ok(())
    }

    /// The Google Drive file id of this file, if it was uploaded from this database.
    pub fn drive_copy(conn: &Connection, sha256: &str) -> Result<Option<String>, String> {
        conn.query_row("SELECT drive_file_id FROM document_drive_copies WHERE sha256 = ?1", params![sha256], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())
    }

    /// Documents whose file is not on this computer (or no longer matches), oldest first.
    pub fn missing_files(conn: &Connection, vault_dir: &Path) -> Result<Vec<Document>, String> {
        let all = Self::list(conn, &DocumentFilter::default())?;
        let mut missing = Vec::new();
        for doc in all.into_iter().rev() {
            let path = stored_path(vault_dir, &doc.sha256)?;
            let present = std::fs::metadata(&path).map(|m| m.len() == doc.size_bytes as u64).unwrap_or(false);
            if !present {
                missing.push(doc);
            }
        }
        Ok(missing)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;

    fn setup() -> (tempfile::TempDir, Connection, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("t.db")).unwrap();
        let conn = db.get_connection().unwrap();
        let vault = dir.path().join("Documents");
        (dir, conn, vault)
    }

    fn input(category: &str, title: &str) -> DocumentInput {
        DocumentInput { category: category.to_string(), title: title.to_string(), note: None }
    }

    #[test]
    fn a_document_is_stored_once_with_its_details() {
        let (_d, conn, vault) = setup();
        let doc = DocumentRepository::add(&conn, &vault, &input("important", " Land deed "), "..\\deed.pdf", b"%PDF-1.4 deed").unwrap();
        assert_eq!(doc.category, "IMPORTANT");
        assert_eq!(doc.title, "Land deed");
        assert_eq!(doc.file_name, "deed.pdf");
        assert_eq!(doc.mime_type, "application/pdf");
        assert_eq!(doc.size_bytes, 13);
        assert!(!doc.backed_up);
        assert_eq!(std::fs::read(vault.join(&doc.sha256)).unwrap(), b"%PDF-1.4 deed");
        let (_, bytes) = DocumentRepository::read(&conn, &vault, doc.id).unwrap();
        assert_eq!(bytes.unwrap(), b"%PDF-1.4 deed");
    }

    #[test]
    fn an_empty_title_takes_the_file_name() {
        let (_d, conn, vault) = setup();
        let doc = DocumentRepository::add(&conn, &vault, &input("FUTURE", "  "), "GST certificate.pdf", b"gst").unwrap();
        assert_eq!(doc.title, "GST certificate.pdf");
    }

    #[test]
    fn the_same_file_twice_is_refused_and_names_the_first() {
        let (_d, conn, vault) = setup();
        DocumentRepository::add(&conn, &vault, &input("FUTURE", "Old lease"), "a.pdf", b"same bytes").unwrap();
        let err = DocumentRepository::add(&conn, &vault, &input("IMPORTANT", "Lease"), "b.pdf", b"same bytes").unwrap_err();
        assert!(err.contains("\"Old lease\" (Keep for Future)"), "{}", err);
    }

    #[test]
    fn bad_input_is_refused_and_nothing_is_left_behind() {
        let (_d, conn, vault) = setup();
        assert!(DocumentRepository::add(&conn, &vault, &input("OTHER", "x"), "a.pdf", b"x").is_err());
        assert!(DocumentRepository::add(&conn, &vault, &input("IMPORTANT", &"t".repeat(201)), "a.pdf", b"x").is_err());
        assert!(DocumentRepository::add(&conn, &vault, &input("IMPORTANT", "x"), "setup.exe", b"MZ").is_err());
        let long_note = DocumentInput { note: Some("n".repeat(2001)), ..input("IMPORTANT", "x") };
        assert!(DocumentRepository::add(&conn, &vault, &long_note, "a.pdf", b"x").is_err());
        assert_eq!(DocumentRepository::summary(&conn).unwrap(), DocumentSummary::default());
        let files = std::fs::read_dir(&vault).map(|d| d.count()).unwrap_or(0);
        assert_eq!(files, 0);
    }

    #[test]
    fn list_filters_by_group_and_finds_words_anywhere() {
        let (_d, conn, vault) = setup();
        DocumentRepository::add(&conn, &vault, &input("IMPORTANT", "Land deed"), "deed.pdf", b"1").unwrap();
        let lease = DocumentInput { note: Some("Shop at Nehru Street".to_string()), ..input("FUTURE", "Lease") };
        DocumentRepository::add(&conn, &vault, &lease, "lease_2026.docx", b"2").unwrap();
        DocumentRepository::add(&conn, &vault, &input("FUTURE", "100% done"), "x.jpg", b"3").unwrap();

        let important = DocumentFilter { category: Some("IMPORTANT".to_string()), query: None };
        assert_eq!(DocumentRepository::list(&conn, &important).unwrap().len(), 1);
        let find = |q: &str| {
            DocumentRepository::list(&conn, &DocumentFilter { category: None, query: Some(q.to_string()) })
                .unwrap()
                .into_iter()
                .map(|d| d.title)
                .collect::<Vec<_>>()
        };
        assert_eq!(find("nehru"), vec!["Lease"], "words in the note");
        assert_eq!(find("LEASE_2026"), vec!["Lease"], "file name, any case, underscore taken literally");
        assert_eq!(find("deed land"), vec!["Land deed"], "every word must match");
        assert_eq!(find("100%"), vec!["100% done"], "percent taken literally");
        assert!(find("nothing").is_empty());
        assert!(find(&"x".repeat(100_000)).is_empty(), "a huge search is cut short, not an error");
        assert_eq!(find("").len(), 3);
        let all = DocumentRepository::list(&conn, &DocumentFilter::default()).unwrap();
        assert_eq!(all[0].title, "100% done", "newest first");
    }

    #[test]
    fn edit_changes_the_details_but_never_the_file() {
        let (_d, conn, vault) = setup();
        let doc = DocumentRepository::add(&conn, &vault, &input("IMPORTANT", "Deed"), "deed.pdf", b"deed").unwrap();
        let edited = DocumentInput { note: Some("  Original in the locker ".to_string()), ..input("FUTURE", "Deed 1998") };
        let after = DocumentRepository::update(&conn, doc.id, &edited).unwrap();
        assert_eq!((after.category.as_str(), after.title.as_str()), ("FUTURE", "Deed 1998"));
        assert_eq!(after.note.as_deref(), Some("Original in the locker"));
        assert_eq!(after.sha256, doc.sha256);
        assert!(DocumentRepository::update(&conn, 999, &edited).is_err());
    }

    #[test]
    fn delete_removes_the_file_here_but_remembers_the_drive_copy() {
        let (_d, conn, vault) = setup();
        let doc = DocumentRepository::add(&conn, &vault, &input("IMPORTANT", "Deed"), "deed.pdf", b"deed").unwrap();
        DocumentRepository::mark_backed_up(&conn, &doc.sha256, "drive-1").unwrap();
        assert!(DocumentRepository::get(&conn, doc.id).unwrap().unwrap().backed_up);
        DocumentRepository::delete(&conn, &vault, doc.id).unwrap();
        assert!(DocumentRepository::get(&conn, doc.id).unwrap().is_none());
        assert!(!vault.join(&doc.sha256).exists());
        assert_eq!(DocumentRepository::drive_copy(&conn, &doc.sha256).unwrap().as_deref(), Some("drive-1"));
        // Added again later, it is already backed up.
        let again = DocumentRepository::add(&conn, &vault, &input("FUTURE", "Deed"), "deed.pdf", b"deed").unwrap();
        assert!(again.backed_up);
        assert!(DocumentRepository::delete(&conn, &vault, 999).is_err());
    }

    #[test]
    fn summary_counts_groups_and_what_waits_for_backup() {
        let (_d, conn, vault) = setup();
        let a = DocumentRepository::add(&conn, &vault, &input("IMPORTANT", "A"), "a.pdf", b"aaaa").unwrap();
        DocumentRepository::add(&conn, &vault, &input("IMPORTANT", "B"), "b.pdf", b"bb").unwrap();
        DocumentRepository::add(&conn, &vault, &input("FUTURE", "C"), "c.pdf", b"c").unwrap();
        DocumentRepository::mark_backed_up(&conn, &a.sha256, "d-a").unwrap();
        let s = DocumentRepository::summary(&conn).unwrap();
        assert_eq!(s, DocumentSummary { important: 2, future: 1, waiting_for_backup: 2, waiting_bytes: 3, total_bytes: 7 });
        let waiting: Vec<String> = DocumentRepository::waiting_for_backup(&conn).unwrap().into_iter().map(|d| d.title).collect();
        assert_eq!(waiting, vec!["B", "C"]);
    }

    #[test]
    fn missing_files_are_found() {
        let (_d, conn, vault) = setup();
        let a = DocumentRepository::add(&conn, &vault, &input("IMPORTANT", "A"), "a.pdf", b"aaaa").unwrap();
        let b = DocumentRepository::add(&conn, &vault, &input("IMPORTANT", "B"), "b.pdf", b"bbbb").unwrap();
        assert!(DocumentRepository::missing_files(&conn, &vault).unwrap().is_empty());
        std::fs::remove_file(vault.join(&a.sha256)).unwrap();
        std::fs::write(vault.join(&b.sha256), b"cut").unwrap();
        let missing: Vec<String> = DocumentRepository::missing_files(&conn, &vault).unwrap().into_iter().map(|d| d.title).collect();
        assert_eq!(missing, vec!["A", "B"]);
        let (_, bytes) = DocumentRepository::read(&conn, &vault, a.id).unwrap();
        assert!(bytes.is_none());
    }
}
