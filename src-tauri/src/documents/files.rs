//! Rules for the files kept in the Document Vault: any document, photo or spreadsheet up to 25 MB,
//! but never a program. Each file is stored once in the Documents folder under its SHA-256.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use md5::Md5;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// Largest file the vault takes: 25 MB.
pub const MAX_DOCUMENT_BYTES: usize = 25 * 1024 * 1024;

const TOO_BIG: &str = "That file is over 25 MB. Reduce its size and add it again.";

/// Programs and scripts. They are not documents, and opening one from the app could run a virus.
const BLOCKED_EXTENSIONS: &[&str] = &[
    "exe", "msi", "msp", "bat", "cmd", "com", "scr", "pif", "cpl", "dll", "sys", "ps1", "psm1", "vbs", "vbe", "js",
    "jse", "wsf", "wsh", "hta", "lnk", "reg", "jar", "appx", "msix", "appinstaller", "scf", "inf", "gadget",
];

/// Photos the app can show itself. SVG is left out: it can carry scripts.
const PREVIEW_TYPES: &[&str] = &["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"];

fn extension(name: &str) -> String {
    name.rsplit_once('.').map(|(_, e)| e.trim().to_ascii_lowercase()).unwrap_or_default()
}

/// The MIME type for a file name. Unknown kinds are kept as plain bytes.
pub fn mime_for(file_name: &str) -> &'static str {
    match extension(file_name).as_str() {
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "rtf" => "application/rtf",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "heic" => "image/heic",
        "svg" => "image/svg+xml",
        "zip" => "application/zip",
        "rar" => "application/vnd.rar",
        "7z" => "application/x-7z-compressed",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

/// Check a file before it goes into the vault. Returns its MIME type.
pub fn validate_document(file_name: &str, bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.is_empty() {
        return Err("That file is empty.".to_string());
    }
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(TOO_BIG.to_string());
    }
    let ext = extension(file_name);
    // A Windows program starts with "MZ" whatever it is called.
    if BLOCKED_EXTENSIONS.contains(&ext.as_str()) || bytes.starts_with(b"MZ") {
        return Err("Programs and scripts (.exe, .bat, .msi and similar) can't be kept in the vault. Add documents, photos or spreadsheets.".to_string());
    }
    Ok(mime_for(file_name))
}

/// Turn the base64 text the screen sends into the file's bytes. Text longer than a 25 MB file
/// could be is refused before any decoding.
pub fn decode_document_upload(data_base64: &str) -> Result<Vec<u8>, String> {
    if data_base64.len() > MAX_DOCUMENT_BYTES / 3 * 4 + 8 {
        return Err(TOO_BIG.to_string());
    }
    STANDARD
        .decode(data_base64.trim())
        .map_err(|_| "The file could not be read. Try adding it again.".to_string())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

pub fn md5_hex(bytes: &[u8]) -> String {
    hex(&Md5::digest(bytes))
}

/// True for a 64-character lowercase hex string, the only names the vault ever uses.
pub fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Where the file with this SHA-256 is kept. The name is checked, so the path is always one file
/// directly inside the vault folder.
pub fn stored_path(vault_dir: &Path, sha256: &str) -> Result<PathBuf, String> {
    if !is_sha256(sha256) {
        return Err("This document's record is damaged.".to_string());
    }
    Ok(vault_dir.join(sha256))
}

/// Write the file into the vault. It is written beside its final name first and then moved into
/// place, so a crash never leaves half a file under a real name. Returns true when the file was
/// written now, false when the same file was already there.
pub fn store(vault_dir: &Path, sha256: &str, bytes: &[u8]) -> Result<bool, String> {
    fs::create_dir_all(vault_dir).map_err(|e| format!("Could not prepare the Documents folder: {}", e))?;
    let path = stored_path(vault_dir, sha256)?;
    if fs::read(&path).map(|existing| sha256_hex(&existing) == sha256).unwrap_or(false) {
        return Ok(false);
    }
    let part = vault_dir.join(format!("{}.part", sha256));
    fs::write(&part, bytes).map_err(|e| format!("Could not save the document: {}", e))?;
    if let Err(e) = fs::rename(&part, &path) {
        let _ = fs::remove_file(&part);
        return Err(format!("Could not save the document: {}", e));
    }
    Ok(true)
}

/// The file's bytes, checked against its SHA-256. None when it is missing or damaged.
pub fn read_stored(vault_dir: &Path, sha256: &str) -> Result<Option<Vec<u8>>, String> {
    let path = stored_path(vault_dir, sha256)?;
    match fs::read(&path) {
        Ok(bytes) if sha256_hex(&bytes) == sha256 => Ok(Some(bytes)),
        Ok(_) => Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read the document: {}", e)),
    }
}

/// A `data:` URL for showing a photo in the app. Other kinds have no preview.
pub fn preview_data_url(mime: &str, bytes: &[u8]) -> Result<String, String> {
    if !PREVIEW_TYPES.contains(&mime) {
        return Err("Only photos can be previewed. Use Open for this file.".to_string());
    }
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn any_document_photo_or_sheet_is_accepted() {
        assert_eq!(validate_document("deed.pdf", b"%PDF-1.4").unwrap(), "application/pdf");
        assert_eq!(validate_document("photo.JPG", &[0xFF, 0xD8, 0xFF]).unwrap(), "image/jpeg");
        assert_eq!(validate_document("stock.xlsx", b"PK\x03\x04").unwrap(), mime_for("a.xlsx"));
        assert_eq!(validate_document("letter.docx", b"PK\x03\x04").unwrap(), mime_for("a.docx"));
        assert_eq!(validate_document("notes", b"hello").unwrap(), "application/octet-stream", "no extension is fine");
        assert_eq!(validate_document("scan.heic", b"....ftypheic").unwrap(), "image/heic");
    }

    #[test]
    fn programs_and_scripts_are_refused_by_name_or_by_contents() {
        for name in ["setup.exe", "run.BAT", "x.msi", "a.ps1", "a.vbs", "shortcut.lnk", "a.js", "a.reg"] {
            let err = validate_document(name, b"anything").unwrap_err();
            assert!(err.contains("Programs"), "{}: {}", name, err);
        }
        assert!(validate_document("invoice.pdf", b"MZ\x90\x00").is_err(), "a program renamed to .pdf");
    }

    #[test]
    fn size_limit_is_twenty_five_megabytes_exactly() {
        let mut ok = vec![b'a'; MAX_DOCUMENT_BYTES];
        assert!(validate_document("a.txt", &ok).is_ok());
        ok.push(b'a');
        assert!(validate_document("a.txt", &ok).unwrap_err().contains("25 MB"));
        assert!(validate_document("a.txt", &[]).unwrap_err().contains("empty"));
    }

    #[test]
    fn decode_refuses_oversized_text_before_decoding() {
        assert_eq!(decode_document_upload("JVBERi0xLjQ=").unwrap(), b"%PDF-1.4");
        assert!(decode_document_upload("not base64 !!").unwrap_err().contains("could not be read"));
        let huge = "A".repeat(MAX_DOCUMENT_BYTES * 2);
        assert!(decode_document_upload(&huge).unwrap_err().contains("25 MB"));
    }

    #[test]
    fn hashes_are_lowercase_hex() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert!(is_sha256(&sha256_hex(b"x")));
        assert!(!is_sha256("..\\..\\windows"));
        assert!(!is_sha256(&"A".repeat(64)), "upper case is not one of ours");
    }

    #[test]
    fn stored_files_live_directly_inside_the_vault_under_their_hash() {
        let dir = tempfile::tempdir().unwrap();
        let sha = sha256_hex(b"deed");
        assert!(store(dir.path(), &sha, b"deed").unwrap(), "written the first time");
        assert!(!store(dir.path(), &sha, b"deed").unwrap(), "the same file is not written twice");
        let path = stored_path(dir.path(), &sha).unwrap();
        assert_eq!(path.parent().unwrap(), dir.path());
        assert_eq!(read_stored(dir.path(), &sha).unwrap().unwrap(), b"deed");
        assert!(!dir.path().join(format!("{}.part", sha)).exists());
        assert!(stored_path(dir.path(), "../../evil").is_err());
    }

    #[test]
    fn a_missing_or_changed_file_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let sha = sha256_hex(b"deed");
        assert_eq!(read_stored(dir.path(), &sha).unwrap(), None);
        fs::write(dir.path().join(&sha), b"edited in Word").unwrap();
        assert_eq!(read_stored(dir.path(), &sha).unwrap(), None);
        // A damaged copy is replaced by the real file when it is stored again.
        assert!(store(dir.path(), &sha, b"deed").unwrap());
        assert_eq!(read_stored(dir.path(), &sha).unwrap().unwrap(), b"deed");
    }

    #[test]
    fn only_photos_get_a_preview() {
        assert!(preview_data_url("image/png", b"x").unwrap().starts_with("data:image/png;base64,"));
        assert!(preview_data_url("image/webp", b"x").is_ok());
        assert!(preview_data_url("image/svg+xml", b"<svg/>").is_err());
        assert!(preview_data_url("application/pdf", b"%PDF").is_err());
    }
}
