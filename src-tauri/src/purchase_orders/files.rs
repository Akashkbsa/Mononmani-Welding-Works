//! Rules for the files attached to a purchase order: size, type, and a safe name.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::path::{Path, PathBuf};

/// Largest file that can be attached: 10 MB.
pub const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;

const MAX_NAME_CHARS: usize = 120;
const DOCX_MIME: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/// Check the size, the extension and that the first bytes really are that kind of file.
/// Returns the file's MIME type.
pub fn validate_file(file_name: &str, bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.is_empty() {
        return Err("That file is empty.".to_string());
    }
    if bytes.len() > MAX_FILE_BYTES {
        return Err("That file is over 10 MB. Reduce its size and add it again.".to_string());
    }

    let name = clean_file_name(file_name);
    let extension = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let (mime, matches): (&'static str, bool) = match extension.as_str() {
        "jpg" | "jpeg" => ("image/jpeg", bytes.starts_with(&[0xFF, 0xD8, 0xFF])),
        "png" => ("image/png", bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])),
        // Some scanners put a few bytes before the header, so look in the first KB.
        "pdf" => ("application/pdf", bytes.windows(5).take(1024).any(|w| w == b"%PDF-")),
        "doc" => ("application/msword", bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])),
        "docx" => (DOCX_MIME, bytes.starts_with(&[0x50, 0x4B, 0x03, 0x04])),
        _ => return Err("Only JPG, PNG, PDF and Word (.doc, .docx) files can be added.".to_string()),
    };
    if !matches {
        return Err(format!("\"{}\" does not look like a real {} file.", name, extension.to_ascii_uppercase()));
    }
    Ok(mime)
}

/// A file name that is safe to keep and to write under the Temp folder: no folders, no
/// characters Windows rejects, at most 120 characters (the extension is kept).
pub fn clean_file_name(raw: &str) -> String {
    let last = raw.rsplit(|c| c == '/' || c == '\\').next().unwrap_or("");
    let kept: String = last
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .collect();
    let trimmed = kept.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        return "file".to_string();
    }
    if trimmed.chars().count() <= MAX_NAME_CHARS {
        return trimmed.to_string();
    }
    match trimmed.rsplit_once('.') {
        Some((stem, ext)) if ext.chars().count() < 10 => {
            let keep = MAX_NAME_CHARS - ext.chars().count() - 1;
            format!("{}.{}", stem.chars().take(keep).collect::<String>(), ext)
        }
        _ => trimmed.chars().take(MAX_NAME_CHARS).collect(),
    }
}

/// Turn the base64 text the screen sends into the file's bytes. Text that is already longer
/// than a 10 MB file could be is refused before any decoding.
pub fn decode_upload(data_base64: &str) -> Result<Vec<u8>, String> {
    if data_base64.len() > MAX_FILE_BYTES / 3 * 4 + 8 {
        return Err("That file is over 10 MB. Reduce its size and add it again.".to_string());
    }
    STANDARD
        .decode(data_base64.trim())
        .map_err(|_| "The file could not be read. Try adding it again.".to_string())
}

/// Where a copy of file `file_id` is written so the default program can open it. The name is
/// already cleaned, so the result is always one file directly inside `temp_dir`.
pub fn temp_open_path(temp_dir: &Path, file_id: i64, clean_name: &str) -> PathBuf {
    temp_dir.join(format!("{}_{}", file_id, clean_name))
}

/// A `data:` URL for showing a photo in the app. Other file types have no preview.
pub fn image_data_url(mime: &str, bytes: &[u8]) -> Result<String, String> {
    if mime != "image/jpeg" && mime != "image/png" {
        return Err("Only photos can be previewed.".to_string());
    }
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PDF: &[u8] = b"%PDF-1.4 sample";
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10];
    const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0];
    const ZIP: &[u8] = &[0x50, 0x4B, 0x03, 0x04, 0, 0];
    const OLE: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

    #[test]
    fn accepts_each_allowed_type_with_matching_bytes() {
        assert_eq!(validate_file("order.pdf", PDF).unwrap(), "application/pdf");
        assert_eq!(validate_file("photo.JPG", JPEG).unwrap(), "image/jpeg");
        assert_eq!(validate_file("photo.jpeg", JPEG).unwrap(), "image/jpeg");
        assert_eq!(validate_file("scan.png", PNG).unwrap(), "image/png");
        assert_eq!(validate_file("po.doc", OLE).unwrap(), "application/msword");
        assert_eq!(
            validate_file("po.docx", ZIP).unwrap(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
    }

    #[test]
    fn size_limit_is_ten_megabytes_exactly() {
        let mut ok = PDF.to_vec();
        ok.resize(MAX_FILE_BYTES, 0);
        assert!(validate_file("a.pdf", &ok).is_ok());
        ok.push(0);
        let err = validate_file("a.pdf", &ok).unwrap_err();
        assert!(err.contains("10 MB"), "{}", err);
    }

    #[test]
    fn empty_file_is_rejected() {
        assert!(validate_file("a.pdf", &[]).unwrap_err().contains("empty"));
    }

    #[test]
    fn extension_must_match_the_contents() {
        assert!(validate_file("fake.pdf", b"just some text").is_err());
        assert!(validate_file("fake.docx", PDF).is_err());
        assert!(validate_file("fake.doc", ZIP).is_err());
        assert!(validate_file("fake.png", JPEG).is_err());
    }

    #[test]
    fn other_types_are_rejected() {
        let err = validate_file("setup.exe", b"MZ").unwrap_err();
        assert!(err.contains("PDF"), "{}", err);
        assert!(validate_file("noextension", PDF).is_err());
    }

    #[test]
    fn file_names_are_cleaned() {
        assert_eq!(clean_file_name("..\\..\\evil.pdf"), "evil.pdf");
        assert_eq!(clean_file_name("../x.pdf"), "x.pdf");
        assert_eq!(clean_file_name("a\"b<c>.pdf"), "abc.pdf");
        assert_eq!(clean_file_name("   "), "file");
        let long = format!("{}.pdf", "a".repeat(300));
        let cleaned = clean_file_name(&long);
        assert_eq!(cleaned.chars().count(), 120);
        assert!(cleaned.ends_with(".pdf"));
    }

    #[test]
    fn decode_upload_round_trips_and_rejects_bad_text() {
        assert_eq!(decode_upload("JVBERi0xLjQ=").unwrap(), b"%PDF-1.4");
        assert!(decode_upload("not base64 !!").unwrap_err().contains("could not be read"));
    }

    #[test]
    fn decode_upload_refuses_oversized_text_before_decoding() {
        let huge = "A".repeat(MAX_FILE_BYTES * 2);
        assert!(decode_upload(&huge).unwrap_err().contains("10 MB"));
    }

    #[test]
    fn temp_open_path_is_a_single_file_directly_inside_the_temp_folder() {
        let temp = Path::new("C:/data/Temp");
        let path = temp_open_path(temp, 7, "order.pdf");
        assert_eq!(path.parent().unwrap(), temp);
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "7_order.pdf");
    }

    #[test]
    fn only_photos_get_a_preview() {
        assert!(image_data_url("image/jpeg", JPEG).unwrap().starts_with("data:image/jpeg;base64,"));
        assert!(image_data_url("image/png", PNG).unwrap().starts_with("data:image/png;base64,"));
        assert!(image_data_url("application/pdf", PDF).is_err());
    }
}
