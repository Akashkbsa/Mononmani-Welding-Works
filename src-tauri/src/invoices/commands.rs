use super::models::{
    DuplicateInvoiceCheckResult, InvoiceCreateInput, InvoiceFilterInput, InvoiceListItem,
    InvoiceUpdateInput, InvoiceWithItems,
};
use super::repository::InvoiceRepository;
use crate::pdf::{CopyType, PdfRenderer};
use crate::util::parse_date;
use crate::AppState;
use serde::Serialize;
use tauri::State;

#[tauri::command(async)]
pub fn list_invoices(
    filter: Option<InvoiceFilterInput>,
    state: State<'_, AppState>,
) -> Result<Vec<InvoiceListItem>, String> {
    let conn = state.db.connection()?;
    InvoiceRepository::find_all(&conn, filter.unwrap_or_default())
}

#[tauri::command(async)]
pub fn get_invoice(id: i64, state: State<'_, AppState>) -> Result<Option<InvoiceWithItems>, String> {
    let conn = state.db.connection()?;
    InvoiceRepository::find_by_id(&conn, id)
}

#[tauri::command(async)]
pub fn get_next_invoice_number(state: State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.connection()?;
    InvoiceRepository::get_next_invoice_number(&conn)
}

#[tauri::command(async)]
pub fn check_duplicate_invoice_number(
    invoice_number: String,
    exclude_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<DuplicateInvoiceCheckResult, String> {
    let conn = state.db.connection()?;
    InvoiceRepository::check_duplicate_number(&conn, &invoice_number, exclude_id)
}

#[tauri::command(async)]
pub fn create_invoice(input: InvoiceCreateInput, state: State<'_, AppState>) -> Result<InvoiceWithItems, String> {
    let conn = state.db.connection()?;
    InvoiceRepository::create(&conn, input)
}

#[tauri::command(async)]
pub fn update_invoice(
    id: i64,
    input: InvoiceUpdateInput,
    state: State<'_, AppState>,
) -> Result<InvoiceWithItems, String> {
    let conn = state.db.connection()?;
    InvoiceRepository::update(&conn, id, input)
}

/// Cancel an invoice (`cancelled` true) or restore it to Issued (false).
#[tauri::command(async)]
pub fn set_invoice_cancelled(
    id: i64,
    cancelled: bool,
    state: State<'_, AppState>,
) -> Result<InvoiceWithItems, String> {
    let conn = state.db.connection()?;
    InvoiceRepository::set_cancelled(&conn, id, cancelled)?;
    InvoiceRepository::find_by_id(&conn, id)?.ok_or_else(|| format!("Invoice {} was not found.", id))
}

#[tauri::command(async)]
pub fn delete_invoice(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.connection()?;
    InvoiceRepository::delete(&conn, id)
}

/// Render one copy of an invoice to PDF and return its path. Runs off the UI thread
/// because the browser print can take a few seconds.
#[tauri::command]
pub async fn generate_invoice_pdf_by_id(
    id: i64,
    copy_type: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let copy = CopyType::parse(copy_type.as_deref());
    let (invoice, seller) = {
        let conn = state.db.connection()?;
        let invoice =
            InvoiceRepository::find_by_id(&conn, id)?.ok_or_else(|| format!("Invoice {} was not found.", id))?;
        (invoice, crate::settings::repository::SettingsRepository::get(&conn)?)
    };

    // Saved in the invoice's financial year folder, e.g. Invoices6-27.
    let year = crate::util::financial_year_folder(parse_date(&invoice.invoice.invoice_date).unwrap_or_else(crate::util::today));
    let filename = format!(
        "{}_{}.pdf",
        invoice.invoice.invoice_number.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_"),
        copy.file_suffix()
    );
    let target_path = state.storage.prepare_invoice_save_path(&year, &filename)?;

    let generated = tauri::async_runtime::spawn_blocking(move || {
        PdfRenderer::generate_pdf_from_invoice(&invoice, copy, &target_path, &seller)
    })
    .await
    .map_err(|e| format!("PDF generation stopped unexpectedly: {}", e))??;

    let path = generated.to_string_lossy().to_string();
    if copy == CopyType::Original {
        let conn = state.db.connection()?;
        InvoiceRepository::update_pdf_path(&conn, id, &path)?;
    }
    Ok(path)
}

/// One PDF holding the chosen copies of an invoice (e.g. original and duplicate, or all three),
/// in the order given. Returns its path.
#[tauri::command]
pub async fn generate_invoice_copies_pdf(
    id: i64,
    copy_types: Vec<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut copies: Vec<CopyType> = Vec::new();
    for name in &copy_types {
        let copy = CopyType::parse(Some(name));
        if !copies.contains(&copy) {
            copies.push(copy);
        }
    }
    if copies.is_empty() {
        return Err("Choose at least one copy to print.".to_string());
    }

    let (invoice, seller) = {
        let conn = state.db.connection()?;
        let invoice =
            InvoiceRepository::find_by_id(&conn, id)?.ok_or_else(|| format!("Invoice {} was not found.", id))?;
        (invoice, crate::settings::repository::SettingsRepository::get(&conn)?)
    };

    // Saved in the invoice's financial year folder, e.g. Invoices6-27.
    let year = crate::util::financial_year_folder(parse_date(&invoice.invoice.invoice_date).unwrap_or_else(crate::util::today));
    let suffix = if copies.len() == 3 {
        "all-copies".to_string()
    } else {
        copies.iter().map(|c| c.file_suffix()).collect::<Vec<_>>().join("-")
    };
    let filename = format!(
        "{}_{}.pdf",
        invoice.invoice.invoice_number.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_"),
        suffix
    );
    let target_path = state.storage.prepare_invoice_save_path(&year, &filename)?;

    let generated = tauri::async_runtime::spawn_blocking(move || {
        PdfRenderer::generate_copies_pdf(&invoice, &copies, &target_path, &seller)
    })
    .await
    .map_err(|e| format!("PDF generation stopped unexpectedly: {}", e))??;
    Ok(generated.to_string_lossy().to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct MonthlyPdfResult {
    pub path: String,
    pub invoice_count: usize,
}

/// One PDF with every issued invoice dated in the given month (triplicate copy, one per page),
/// oldest first, for sending to the accountant. Cancelled invoices are included (stamped
/// CANCELLED) so the number sequence is complete; drafts are left out.
#[tauri::command]
pub async fn generate_month_invoices_pdf(
    year: i32,
    month: u32,
    state: State<'_, AppState>,
) -> Result<MonthlyPdfResult, String> {
    let first = chrono::NaiveDate::from_ymd_opt(year, month, 1).ok_or("Choose a valid month.")?;
    let next_first = if month == 12 {
        chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .ok_or("Choose a valid month.")?;
    let last = next_first.pred_opt().ok_or("Choose a valid month.")?;

    let (invoices, seller) = {
        let conn = state.db.connection()?;
        let mut list = InvoiceRepository::find_all(
            &conn,
            InvoiceFilterInput {
                date_from: Some(first.format("%Y-%m-%d").to_string()),
                date_to: Some(last.format("%Y-%m-%d").to_string()),
                ..Default::default()
            },
        )?;
        list.retain(|i| i.status == "ISSUED" || i.status == "CANCELLED");
        // Oldest first, so the pages follow invoice order.
        list.sort_by(|a, b| a.invoice_date.cmp(&b.invoice_date).then(a.id.cmp(&b.id)));
        let mut full = Vec::with_capacity(list.len());
        for item in &list {
            if let Some(inv) = InvoiceRepository::find_by_id(&conn, item.id)? {
                full.push(inv);
            }
        }
        (full, crate::settings::repository::SettingsRepository::get(&conn)?)
    };

    if invoices.is_empty() {
        return Err(format!("No issued or cancelled invoices are dated {}.", first.format("%B %Y")));
    }
    let invoice_count = invoices.len();

    let filename = format!("Invoices_{}.pdf", first.format("%Y-%m"));
    let target_path = state.storage.prepare_invoice_save_path("Monthly", &filename)?;

    let generated = tauri::async_runtime::spawn_blocking(move || {
        PdfRenderer::generate_batch_pdf(&invoices, &target_path, &seller)
    })
    .await
    .map_err(|e| format!("PDF generation stopped unexpectedly: {}", e))??;

    Ok(MonthlyPdfResult {
        path: generated.to_string_lossy().to_string(),
        invoice_count,
    })
}
