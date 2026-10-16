use crate::invoices::models::InvoiceWithItems;
use crate::invoices::repository::{InvoiceRepository, DEFAULT_TERMS};
use crate::settings::models::BusinessSettings;
use crate::util::{display_date, indian_number};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

/// Text shown as it is when put into HTML: `<`, `>`, `&` and quotes are escaped.
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// The three copies a GST tax invoice is printed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CopyType {
    Original,
    Duplicate,
    Triplicate,
}

impl CopyType {
    pub fn parse(value: Option<&str>) -> Self {
        let v = value.unwrap_or("").trim().to_ascii_lowercase();
        if v.starts_with("dup") {
            CopyType::Duplicate
        } else if v.starts_with("trip") {
            CopyType::Triplicate
        } else {
            CopyType::Original
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            CopyType::Original => "ORIGINAL FOR RECIPIENT",
            CopyType::Duplicate => "DUPLICATE FOR TRANSPORTER",
            CopyType::Triplicate => "TRIPLICATE FOR SUPPLIER",
        }
    }

    pub fn file_suffix(self) -> &'static str {
        match self {
            CopyType::Original => "original",
            CopyType::Duplicate => "duplicate",
            CopyType::Triplicate => "triplicate",
        }
    }
}

pub struct PdfRenderer;

impl PdfRenderer {
    /// Every installed Edge and Chrome, Edge first (it ships with Windows). Later ones are tried when one fails.
    fn find_chromium_binaries() -> Result<Vec<PathBuf>, String> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        for exe in [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"] {
            for var in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
                if let Ok(base) = std::env::var(var) {
                    let path = PathBuf::from(base).join(exe);
                    if path.exists() && !candidates.contains(&path) {
                        candidates.push(path);
                    }
                }
            }
        }
        if candidates.is_empty() {
            return Err("Microsoft Edge or Google Chrome is needed to create PDFs, but neither was found.".to_string());
        }
        Ok(candidates)
    }

    /// The values the invoice template fills one page with.
    fn invoice_payload(inv_data: &InvoiceWithItems, copy: CopyType, seller: &BusinessSettings) -> serde_json::Value {
        let inv = &inv_data.invoice;
        let is_igst = inv.tax_type.eq_ignore_ascii_case("IGST");
        let money = |v: f64| format!("₹{}", indian_number(v));
        let rate = |v: f64| format!("{}%", (v * 100.0).round() / 100.0);

        let items: Vec<serde_json::Value> = inv_data
            .items
            .iter()
            .map(|item| {
                serde_json::json!({
                    "sl_no": item.sl_no,
                    "description": crate::util::sanitize_rich_text(&item.description),
                    // The template puts the line cells in with innerHTML, so plain-text cells are escaped.
                    "hsn_sac": escape_html(&item.hsn_sac),
                    "qum": escape_html(&item.qum),
                    "qty": item.quantity,
                    "rate": indian_number(item.rate),
                    "amount": indian_number(item.amount),
                })
            })
            .collect();

        let terms: Vec<&str> = inv
            .terms_and_conditions
            .as_deref()
            .filter(|t| !t.trim().is_empty())
            .unwrap_or(DEFAULT_TERMS)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();

        let dash = |v: &Option<String>| v.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "—".to_string());

        serde_json::json!({
            "seller": {
                "name": seller.business_name,
                "subtitle": seller.business_subtitle,
                "gstin": seller.gstin,
                "phone": seller.phone,
                "services_banner": seller.services_banner,
                "address": seller.address,
                "email": seller.email
            },
            "invoice": {
                "number": inv.invoice_number,
                "date": display_date(&inv.invoice_date),
                "due_date": inv.due_date.as_deref().map(display_date).unwrap_or_default(),
                "state": inv.invoice_state,
                "copy_type": copy.label(),
                "cancelled": inv.status.eq_ignore_ascii_case("CANCELLED")
            },
            "customer": {
                "name": inv.customer_name,
                "address": inv.customer_address.clone().unwrap_or_default(),
                "phone": inv.customer_phone.clone().unwrap_or_default(),
                "gstin": inv.customer_gstin.clone().unwrap_or_default(),
                "state": inv.customer_state.clone().unwrap_or_default(),
                "state_code": inv.customer_state_code.clone().unwrap_or_default()
            },
            "delivery": {
                "po_number_and_date": dash(&inv.po_number_and_date),
                "vehicle_number": dash(&inv.vehicle_number),
                "date_of_supply": dash(&inv.date_of_supply),
                "place_of_supply": dash(&inv.place_of_supply),
                "our_dc_number_and_date": dash(&inv.our_dc_number_and_date),
                "your_dc_number_and_date": dash(&inv.your_dc_number_and_date)
            },
            "items": items,
            "terms": terms,
            "totals": {
                // Worked out from the total so every invoice reads the same way.
                "amount_in_words": InvoiceRepository::money_in_words(inv.total_amount),
                "subtotal": money(inv.subtotal),
                "discount": if inv.discount > 0.0 { money(inv.discount) } else { String::new() },
                "cgst_rate": if is_igst { String::new() } else { rate(inv.cgst_rate) },
                "cgst_amount": if is_igst { String::new() } else { money(inv.cgst_amount) },
                "sgst_rate": if is_igst { String::new() } else { rate(inv.sgst_rate) },
                "sgst_amount": if is_igst { String::new() } else { money(inv.sgst_amount) },
                "igst_rate": if is_igst { rate(inv.igst_rate) } else { String::new() },
                "igst_amount": if is_igst { money(inv.igst_amount) } else { String::new() },
                "total_amount": money(inv.total_amount)
            },
            "bank": {
                "name": inv.bank_name,
                "branch": inv.bank_branch,
                "account_no": inv.bank_account_no,
                "ifsc": inv.bank_ifsc
            }
        })
    }

    pub fn render_html_from_invoice(inv_data: &InvoiceWithItems, copy: CopyType, seller: &BusinessSettings) -> String {
        Self::render_html_for_pages(&[Self::invoice_payload(inv_data, copy, seller)])
    }

    /// One A4 page per payload, in order, in a single HTML document.
    fn render_html_for_pages(pages: &[serde_json::Value]) -> String {
        let template = include_str!("../../templates/invoice_template.html");
        let css = include_str!("../../templates/invoice_styles.css");

        // Escape '<' so text such as "</script>" in a description cannot end the script block.
        let json = serde_json::to_string(pages)
            .unwrap_or_else(|_| "[]".to_string())
            .replace('<', "\\u003c");

        template
            .replace(
                r#"<link rel="stylesheet" href="invoice_styles.css">"#,
                &format!("<style>\n{}\n</style>", css),
            )
            .replace(
                "</body>",
                &format!(
                    "<script>window.populateMany({});</script>\n</body>",
                    json
                ),
            )
    }

    pub fn generate_pdf_from_invoice(
        inv: &InvoiceWithItems,
        copy: CopyType,
        output_path: &Path,
        seller: &BusinessSettings,
    ) -> Result<PathBuf, String> {
        Self::print_html_to_pdf(Self::render_html_from_invoice(inv, copy, seller), output_path)
    }

    /// The chosen copies of one invoice, in the order given, as pages of one PDF.
    pub fn generate_copies_pdf(
        inv: &InvoiceWithItems,
        copies: &[CopyType],
        output_path: &Path,
        seller: &BusinessSettings,
    ) -> Result<PathBuf, String> {
        if copies.is_empty() {
            return Err("Choose at least one copy to print.".to_string());
        }
        let pages: Vec<serde_json::Value> = copies
            .iter()
            .map(|copy| Self::invoice_payload(inv, *copy, seller))
            .collect();
        Self::print_html_to_pdf(Self::render_html_for_pages(&pages), output_path)
    }

    /// One page per invoice (triplicate copy, the one kept by the supplier), in the order given, as a single PDF.
    pub fn generate_batch_pdf(
        invoices: &[InvoiceWithItems],
        output_path: &Path,
        seller: &BusinessSettings,
    ) -> Result<PathBuf, String> {
        if invoices.is_empty() {
            return Err("There are no invoices to print.".to_string());
        }
        let pages: Vec<serde_json::Value> = invoices
            .iter()
            .map(|inv| Self::invoice_payload(inv, CopyType::Triplicate, seller))
            .collect();
        Self::print_html_to_pdf(Self::render_html_for_pages(&pages), output_path)
    }

    /// Where the browser's own messages from the last failed PDF are kept, for finding out why.
    pub fn error_log_path() -> PathBuf {
        std::env::temp_dir().join("mww_pdf_error.log")
    }

    fn print_html_to_pdf(html: String, output_path: &Path) -> Result<PathBuf, String> {
        let browsers = Self::find_chromium_binaries()?;

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let work = std::env::temp_dir().join(format!("mww_pdf_{}_{}", std::process::id(), stamp));
        fs::create_dir_all(&work).map_err(|e| format!("Failed to prepare the invoice for printing: {}", e))?;
        let temp_html = work.join("invoice.html");
        if let Err(e) = fs::write(&temp_html, html) {
            let _ = fs::remove_dir_all(&work);
            return Err(format!("Failed to prepare the invoice for printing: {}", e));
        }

        // An old file must not be mistaken for a new one, and a file held open by a PDF viewer shows up here.
        if output_path.exists() && fs::remove_file(output_path).is_err() {
            let _ = fs::remove_dir_all(&work);
            return Err("The PDF could not be replaced. If it is open in a PDF viewer, close it and try again.".to_string());
        }

        let url = file_url(&temp_html);
        let mut log = String::new();
        let mut result = Err(String::new());
        for (i, browser) in browsers.iter().enumerate() {
            // Its own profile each time, so a running Edge (or Startup boost) can't take the job over and drop it.
            let profile = work.join(format!("profile{}", i));
            let output = Command::new(browser)
                .args([
                    "--headless",
                    "--disable-gpu",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-extensions",
                    "--no-pdf-header-footer",
                    "--run-all-compositor-stages-before-draw",
                    &format!("--user-data-dir={}", profile.to_string_lossy()),
                    &format!("--print-to-pdf={}", output_path.to_string_lossy()),
                    &url,
                ])
                .stdin(Stdio::null())
                .output();
            match output {
                Ok(_) if fs::metadata(output_path).map(|m| m.len() > 0).unwrap_or(false) => {
                    result = Ok(output_path.to_path_buf());
                    break;
                }
                Ok(out) => {
                    log.push_str(&format!(
                        "{} exit {:?}\n{}\n{}\n",
                        browser.display(),
                        out.status.code(),
                        String::from_utf8_lossy(&out.stdout),
                        String::from_utf8_lossy(&out.stderr)
                    ));
                }
                Err(e) => log.push_str(&format!("{} could not start: {}\n", browser.display(), e)),
            }
        }
        let _ = fs::remove_dir_all(&work);

        if result.is_err() {
            let _ = fs::write(Self::error_log_path(), format!("Output: {}\n{}", output_path.display(), log));
            result = Err(format!(
                "The PDF was not created. Try again; if it keeps failing, send the file {} to support.",
                Self::error_log_path().display()
            ));
        }
        result
    }
}

/// A `file:///` address for the path, safe when the Windows user name has spaces, `#`, `%` or Tamil letters.
fn file_url(path: &Path) -> String {
    let mut url = String::from("file:///");
    for byte in path.to_string_lossy().replace('\\', "/").bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b':' | b'.' | b'-' | b'_' | b'~' => url.push(byte as char),
            _ => url.push_str(&format!("%{:02X}", byte)),
        }
    }
    url
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_url_escapes_awkward_user_names() {
        assert_eq!(file_url(Path::new(r"C:\Users\Asus\a.html")), "file:///C:/Users/Asus/a.html");
        assert_eq!(file_url(Path::new(r"C:\Users\Mani #1\a b%.html")), "file:///C:/Users/Mani%20%231/a%20b%25.html");
        assert_eq!(file_url(Path::new(r"C:\Users\மணி\a.html")), "file:///C:/Users/%E0%AE%AE%E0%AE%A3%E0%AE%BF/a.html");
    }

    /// Prints through the real Edge or Chrome on this PC; skipped when neither is installed.
    #[test]
    fn prints_a_pdf_and_replaces_the_old_one() {
        if PdfRenderer::find_chromium_binaries().is_err() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("mww pdf #test மணி {}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let out = dir.join("INV 1_original.pdf");
        fs::write(&out, b"old").unwrap();
        let html = "<html><body><h1>Invoice # 1 &amp; மணி</h1></body></html>".to_string();
        assert_eq!(PdfRenderer::print_html_to_pdf(html.clone(), &out).unwrap(), out);
        assert!(fs::read(&out).unwrap().starts_with(b"%PDF"));
        PdfRenderer::print_html_to_pdf(html, &out).unwrap();
        assert!(fs::read(&out).unwrap().starts_with(b"%PDF"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_type_parsing() {
        assert_eq!(CopyType::parse(None), CopyType::Original);
        assert_eq!(CopyType::parse(Some("Duplicate")), CopyType::Duplicate);
        assert_eq!(CopyType::parse(Some("TRIPLICATE FOR SUPPLIER")), CopyType::Triplicate);
    }
}
