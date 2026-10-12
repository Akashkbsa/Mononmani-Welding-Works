use super::models::{
    DuplicateInvoiceCheckResult, Invoice, InvoiceCreateInput, InvoiceFilterInput, InvoiceItem,
    InvoiceItemInput, InvoiceListItem, InvoiceWithItems,
};
use crate::util::{rupees, financial_year_label, normalize_date, parse_date, round2};
use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};

pub const DEFAULT_TERMS: &str = "1. Goods once sold will not be taken back or Exchanged\n2. Dispute if any will be subject to Puducherry.\n3. Payment within due date else 21% p.a. interest will be charged";

/// Totals worked out from the line items. The backend is the authority on these.
#[derive(Debug, Clone)]
pub struct InvoiceTotals {
    pub item_amounts: Vec<f64>,
    pub subtotal: f64,
    pub discount: f64,
    pub cgst_rate: f64,
    pub cgst_amount: f64,
    pub sgst_rate: f64,
    pub sgst_amount: f64,
    pub igst_rate: f64,
    pub igst_amount: f64,
    pub round_off: f64,
    pub total_amount: f64,
    pub amount_in_words: String,
}

pub struct InvoiceRepository;

impl InvoiceRepository {
    pub fn calculate_due_date(invoice_date: &str, terms_days: i32) -> Option<String> {
        parse_date(invoice_date).map(|d| {
            (d + Duration::days(terms_days.max(0) as i64))
                .format("%Y-%m-%d")
                .to_string()
        })
    }

    /// Payment status shown across the app, derived from the invoice status and money received.
    pub fn payment_status(status: &str, total_settled: f64, outstanding: f64) -> String {
        if status.eq_ignore_ascii_case("CANCELLED") {
            "CANCELLED"
        } else if status.eq_ignore_ascii_case("DRAFT") {
            "DRAFT"
        } else if outstanding <= 0.01 {
            "PAID"
        } else if total_settled > 0.01 {
            "PARTIALLY PAID"
        } else {
            "UNPAID"
        }
        .to_string()
    }

    fn map_invoice_row(row: &Row) -> Result<Invoice, rusqlite::Error> {
        Ok(Invoice {
            id: row.get(0)?,
            invoice_number: row.get(1)?,
            invoice_date: row.get(2)?,
            due_date: row.get(3)?,
            payment_terms_days: row.get(4)?,
            invoice_state: row.get(5)?,
            customer_id: row.get(6)?,
            customer_name: row.get(7)?,
            customer_address: row.get(8)?,
            customer_phone: row.get(9)?,
            customer_gstin: row.get(10)?,
            customer_state: row.get(11)?,
            customer_state_code: row.get(12)?,
            po_number_and_date: row.get(13)?,
            vehicle_number: row.get(14)?,
            date_of_supply: row.get(15)?,
            place_of_supply: row.get(16)?,
            our_dc_number_and_date: row.get(17)?,
            your_dc_number_and_date: row.get(18)?,
            delivery_note: row.get(19)?,
            supplier_ref: row.get(20)?,
            buyer_ref: row.get(21)?,
            dispatch_doc_no: row.get(22)?,
            delivery_note_date: row.get(23)?,
            dispatch_through: row.get(24)?,
            destination: row.get(25)?,
            terms_of_delivery: row.get(26)?,
            tax_type: row.get(27)?,
            subtotal: row.get(28)?,
            discount: row.get(29)?,
            cgst_rate: row.get(30)?,
            cgst_amount: row.get(31)?,
            sgst_rate: row.get(32)?,
            sgst_amount: row.get(33)?,
            igst_rate: row.get(34)?,
            igst_amount: row.get(35)?,
            round_off: row.get(36)?,
            total_amount: row.get(37)?,
            amount_in_words: row.get(38)?,
            bank_name: row.get(39)?,
            bank_branch: row.get(40)?,
            bank_account_no: row.get(41)?,
            bank_ifsc: row.get(42)?,
            terms_and_conditions: row.get(43)?,
            status: row.get(44)?,
            notes: row.get(45)?,
            pdf_path: row.get(46)?,
            created_at: row.get(47)?,
            updated_at: row.get(48)?,
        })
    }

    fn map_item_row(row: &Row) -> Result<InvoiceItem, rusqlite::Error> {
        Ok(InvoiceItem {
            id: row.get(0)?,
            invoice_id: row.get(1)?,
            sl_no: row.get(2)?,
            description: row.get(3)?,
            hsn_sac: row.get(4)?,
            qum: row.get(5)?,
            quantity: row.get(6)?,
            rate: row.get(7)?,
            amount: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    }

    /// Next number in the current financial year, e.g. MWW/26-27/001.
    pub fn get_next_invoice_number(conn: &Connection) -> Result<String, String> {
        let prefix = format!("MWW/{}/", financial_year_label());

        let mut stmt = conn
            .prepare("SELECT invoice_number FROM invoices WHERE invoice_number LIKE ?1")
            .map_err(|e| format!("Failed to prepare query for next invoice number: {}", e))?;

        let rows = stmt
            .query_map(params![format!("{}%", prefix)], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query existing invoice numbers: {}", e))?;

        let max_seq = rows
            .filter_map(Result::ok)
            .filter_map(|num| num.strip_prefix(&prefix).and_then(|s| s.trim().parse::<i64>().ok()))
            .max()
            .unwrap_or(0);

        Ok(format!("{}{:03}", prefix, max_seq + 1))
    }

    pub fn check_duplicate_number(
        conn: &Connection,
        invoice_number: &str,
        exclude_id: Option<i64>,
    ) -> Result<DuplicateInvoiceCheckResult, String> {
        let clean_num = invoice_number.trim();
        if clean_num.is_empty() {
            return Ok(DuplicateInvoiceCheckResult {
                has_duplicate: false,
                existing_invoice_id: None,
            });
        }

        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM invoices WHERE invoice_number = ?1 COLLATE NOCASE AND id != ?2 LIMIT 1",
                params![clean_num, exclude_id.unwrap_or(-1)],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("Error checking duplicate invoice number: {}", e))?;

        Ok(DuplicateInvoiceCheckResult {
            has_duplicate: existing.is_some(),
            existing_invoice_id: existing,
        })
    }

    pub fn calculate_financials(
        items: &[InvoiceItemInput],
        tax_type: &str,
        discount: Option<f64>,
        cgst_rate: Option<f64>,
        sgst_rate: Option<f64>,
        igst_rate: Option<f64>,
    ) -> Result<InvoiceTotals, String> {
        if items.is_empty() {
            return Err("Add at least one line item.".to_string());
        }

        let mut item_amounts = Vec::with_capacity(items.len());
        for (idx, item) in items.iter().enumerate() {
            if item.description.trim().is_empty() {
                return Err(format!("Line {} needs a description.", idx + 1));
            }
            if item.quantity <= 0.0 {
                return Err(format!("Line {}: quantity must be greater than zero.", idx + 1));
            }
            if item.rate < 0.0 {
                return Err(format!("Line {}: rate cannot be negative.", idx + 1));
            }
            item_amounts.push(round2(item.quantity * item.rate));
        }

        let subtotal = round2(item_amounts.iter().sum());
        let discount = round2(discount.unwrap_or(0.0).max(0.0));
        if discount > subtotal {
            return Err("Discount cannot be more than the subtotal.".to_string());
        }
        let taxable = subtotal - discount;

        let (cgst_rate, sgst_rate, igst_rate) = if tax_type.eq_ignore_ascii_case("IGST") {
            (0.0, 0.0, igst_rate.unwrap_or(18.0).max(0.0))
        } else {
            (cgst_rate.unwrap_or(9.0).max(0.0), sgst_rate.unwrap_or(9.0).max(0.0), 0.0)
        };
        let cgst_amount = round2(taxable * cgst_rate / 100.0);
        let sgst_amount = round2(taxable * sgst_rate / 100.0);
        let igst_amount = round2(taxable * igst_rate / 100.0);

        // The total is printed exactly, to the paisa: no rounding to the rupee.
        let total_amount = round2(taxable + cgst_amount + sgst_amount + igst_amount);

        Ok(InvoiceTotals {
            item_amounts,
            subtotal,
            discount,
            cgst_rate,
            cgst_amount,
            sgst_rate,
            sgst_amount,
            igst_rate,
            igst_amount,
            round_off: 0.0,
            total_amount,
            amount_in_words: Self::money_in_words(total_amount),
        })
    }

    pub fn create(conn: &Connection, input: InvoiceCreateInput) -> Result<InvoiceWithItems, String> {
        Self::save(conn, None, input)
    }

    pub fn update(conn: &Connection, id: i64, input: InvoiceCreateInput) -> Result<InvoiceWithItems, String> {
        Self::save(conn, Some(id), input)
    }

    /// Insert a new invoice (id = None) or replace an existing one and its line items.
    fn save(conn: &Connection, id: Option<i64>, input: InvoiceCreateInput) -> Result<InvoiceWithItems, String> {
        let invoice_number = input.invoice_number.trim().to_string();
        if invoice_number.is_empty() {
            return Err("Invoice number is required.".to_string());
        }
        let customer_name = input.customer_name.trim().to_string();
        if customer_name.is_empty() {
            return Err("Customer name is required.".to_string());
        }
        if Self::check_duplicate_number(conn, &invoice_number, id)?.has_duplicate {
            return Err(format!("Invoice number {} is already used.", invoice_number));
        }

        let invoice_date = normalize_date(&input.invoice_date, "Invoice date")?;
        let terms_days = input.payment_terms_days.unwrap_or(60).max(0);
        let due_date = match input.due_date.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(d) => normalize_date(d, "Due date")?,
            None => Self::calculate_due_date(&invoice_date, terms_days).unwrap_or_default(),
        };

        let tax_type = if input.tax_type.trim().eq_ignore_ascii_case("IGST") { "IGST" } else { "CGST_SGST" };
        let status = input
            .status
            .as_deref()
            .map(|s| s.trim().to_uppercase())
            .filter(|s| ["ISSUED", "DRAFT", "CANCELLED"].contains(&s.as_str()))
            .unwrap_or_else(|| "ISSUED".to_string());

        let totals = Self::calculate_financials(
            &input.items,
            tax_type,
            input.discount,
            input.cgst_rate,
            input.sgst_rate,
            input.igst_rate,
        )?;

        if let Some(existing_id) = id {
            let (_, allocated, count) = Self::check_deletion_safety(conn, existing_id)?;
            if count > 0 {
                if status != "ISSUED" {
                    return Err(format!(
                        "This invoice has {} in recorded payments, so it must stay Issued. Remove those payments first.",
                        rupees(allocated)
                    ));
                }
                if totals.total_amount + 0.005 < allocated {
                    return Err(format!(
                        "The new total {} is less than the {} already paid against this invoice. Adjust the payments first.",
                        rupees(totals.total_amount), rupees(allocated)
                    ));
                }
            }
        }

        let clean = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let now = Utc::now().to_rfc3339();

        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        let values = params![
            invoice_number,
            invoice_date,
            due_date,
            terms_days,
            clean(input.invoice_state).unwrap_or_else(|| "Puducherry".to_string()),
            input.customer_id,
            customer_name,
            clean(input.customer_address),
            clean(input.customer_phone),
            clean(input.customer_gstin).map(|s| s.to_uppercase()),
            clean(input.customer_state),
            clean(input.customer_state_code),
            clean(input.po_number_and_date),
            clean(input.vehicle_number),
            clean(input.date_of_supply),
            clean(input.place_of_supply),
            clean(input.our_dc_number_and_date),
            clean(input.your_dc_number_and_date),
            clean(input.delivery_note),
            clean(input.supplier_ref),
            clean(input.buyer_ref),
            clean(input.dispatch_doc_no),
            clean(input.delivery_note_date),
            clean(input.dispatch_through),
            clean(input.destination),
            clean(input.terms_of_delivery),
            tax_type,
            totals.subtotal,
            totals.discount,
            totals.cgst_rate,
            totals.cgst_amount,
            totals.sgst_rate,
            totals.sgst_amount,
            totals.igst_rate,
            totals.igst_amount,
            totals.round_off,
            totals.total_amount,
            totals.amount_in_words,
            clean(input.bank_name).unwrap_or_else(|| "Indian Bank".to_string()),
            clean(input.bank_branch).unwrap_or_else(|| "Mettupalayam (PONDY)".to_string()),
            clean(input.bank_account_no).unwrap_or_else(|| "498877880".to_string()),
            clean(input.bank_ifsc).unwrap_or_else(|| "IDIB000M070".to_string()),
            clean(input.terms_and_conditions).unwrap_or_else(|| DEFAULT_TERMS.to_string()),
            status,
            clean(input.notes),
            now,
            id,
        ];

        let invoice_id = match id {
            None => {
                tx.execute(
                    r#"
                    INSERT INTO invoices (
                        invoice_number, invoice_date, due_date, payment_terms_days, invoice_state,
                        customer_id, customer_name, customer_address, customer_phone, customer_gstin, customer_state, customer_state_code,
                        po_number_and_date, vehicle_number, date_of_supply, place_of_supply,
                        our_dc_number_and_date, your_dc_number_and_date, delivery_note, supplier_ref,
                        buyer_ref, dispatch_doc_no, delivery_note_date, dispatch_through, destination, terms_of_delivery,
                        tax_type, subtotal, discount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount,
                        round_off, total_amount, amount_in_words,
                        bank_name, bank_branch, bank_account_no, bank_ifsc,
                        terms_and_conditions, status, notes,
                        created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                        ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
                        ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38, ?39, ?40, ?41, ?42, ?43, ?44,
                        ?45, ?46, ?46
                    )
                    "#,
                    rusqlite::params_from_iter(values[..46].iter()),
                )
                .map_err(|e| format!("Failed to save invoice: {}", e))?;
                tx.last_insert_rowid()
            }
            Some(existing_id) => {
                let changed = tx
                    .execute(
                        r#"
                        UPDATE invoices SET
                            invoice_number = ?1, invoice_date = ?2, due_date = ?3, payment_terms_days = ?4, invoice_state = ?5,
                            customer_id = ?6, customer_name = ?7, customer_address = ?8, customer_phone = ?9, customer_gstin = ?10,
                            customer_state = ?11, customer_state_code = ?12,
                            po_number_and_date = ?13, vehicle_number = ?14, date_of_supply = ?15, place_of_supply = ?16,
                            our_dc_number_and_date = ?17, your_dc_number_and_date = ?18, delivery_note = ?19, supplier_ref = ?20,
                            buyer_ref = ?21, dispatch_doc_no = ?22, delivery_note_date = ?23, dispatch_through = ?24,
                            destination = ?25, terms_of_delivery = ?26,
                            tax_type = ?27, subtotal = ?28, discount = ?29, cgst_rate = ?30, cgst_amount = ?31,
                            sgst_rate = ?32, sgst_amount = ?33, igst_rate = ?34, igst_amount = ?35,
                            round_off = ?36, total_amount = ?37, amount_in_words = ?38,
                            bank_name = ?39, bank_branch = ?40, bank_account_no = ?41, bank_ifsc = ?42,
                            terms_and_conditions = ?43, status = ?44, notes = ?45, updated_at = ?46
                        WHERE id = ?47
                        "#,
                        values,
                    )
                    .map_err(|e| format!("Failed to save invoice: {}", e))?;
                if changed == 0 {
                    return Err(format!("Invoice {} was not found.", existing_id));
                }
                tx.execute("DELETE FROM invoice_items WHERE invoice_id = ?1", params![existing_id])
                    .map_err(|e| format!("Failed to replace line items: {}", e))?;
                existing_id
            }
        };

        for (idx, (item, amount)) in input.items.iter().zip(&totals.item_amounts).enumerate() {
            tx.execute(
                r#"
                INSERT INTO invoice_items (
                    invoice_id, sl_no, description, hsn_sac, qum, quantity, rate, amount, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
                "#,
                params![
                    invoice_id,
                    (idx + 1) as i32,
                    item.description.trim(),
                    item.hsn_sac.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("9954"),
                    item.qum.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("NOS"),
                    item.quantity,
                    item.rate,
                    amount,
                    now,
                ],
            )
            .map_err(|e| format!("Failed to save line {}: {}", idx + 1, e))?;
        }

        if let Some(cid) = input.customer_id {
            tx.execute(
                "UPDATE customers SET last_used_at = ?1 WHERE id = ?2",
                params![now, cid],
            )
            .map_err(|e| format!("Failed to update customer: {}", e))?;
        }

        tx.commit().map_err(|e| format!("Failed to save invoice: {}", e))?;

        Self::find_by_id(conn, invoice_id)?.ok_or_else(|| "Saved invoice could not be reloaded.".to_string())
    }

    /// Returns (can_delete, amount allocated by payments, number of allocations).
    pub fn check_deletion_safety(conn: &Connection, id: i64) -> Result<(bool, f64, i64), String> {
        let (allocated, count): (f64, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(amount_allocated + tds_allocated), 0.0), COUNT(*) FROM payment_allocations WHERE invoice_id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| format!("Failed to check payments for invoice: {}", e))?;

        Ok((count == 0, round2(allocated), count))
    }

    /// Cancel an invoice, or restore a cancelled one to Issued. A cancelled invoice keeps its
    /// number and stays on record, but counts nowhere: no balance due, no payments against it.
    pub fn set_cancelled(conn: &Connection, id: i64, cancelled: bool) -> Result<(), String> {
        let current: String = conn
            .query_row("SELECT status FROM invoices WHERE id = ?1", params![id], |r| r.get(0))
            .map_err(|_| format!("Invoice {} was not found.", id))?;

        if cancelled {
            if current.eq_ignore_ascii_case("CANCELLED") {
                return Ok(());
            }
            let (_, allocated, count) = Self::check_deletion_safety(conn, id)?;
            if count > 0 {
                return Err(format!(
                    "This invoice has {} in recorded payments, so it cannot be cancelled. Remove those payments first.",
                    rupees(allocated)
                ));
            }
        } else if !current.eq_ignore_ascii_case("CANCELLED") {
            return Ok(());
        }

        let status = if cancelled { "CANCELLED" } else { "ISSUED" };
        conn.execute(
            "UPDATE invoices SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to update the invoice: {}", e))?;
        Ok(())
    }

    pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
        let (safe, allocated, count) = Self::check_deletion_safety(conn, id)?;
        if !safe {
            return Err(format!(
                "This invoice has {} in {} recorded payment(s). Remove those payments before deleting it.",
                rupees(allocated), count
            ));
        }

        let rows_affected = conn
            .execute("DELETE FROM invoices WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete invoice: {}", e))?;

        if rows_affected == 0 {
            return Err(format!("Invoice {} was not found.", id));
        }

        Ok(())
    }

    pub fn find_by_id(conn: &Connection, id: i64) -> Result<Option<InvoiceWithItems>, String> {
        let invoice = conn
            .query_row(
                r#"
                SELECT
                    id, invoice_number, invoice_date, due_date, payment_terms_days, invoice_state,
                    customer_id, customer_name, customer_address, customer_phone, customer_gstin, customer_state, customer_state_code,
                    po_number_and_date, vehicle_number, date_of_supply, place_of_supply,
                    our_dc_number_and_date, your_dc_number_and_date, delivery_note, supplier_ref,
                    buyer_ref, dispatch_doc_no, delivery_note_date, dispatch_through, destination, terms_of_delivery,
                    tax_type, subtotal, discount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount,
                    round_off, total_amount, amount_in_words,
                    bank_name, bank_branch, bank_account_no, bank_ifsc,
                    terms_and_conditions, status, notes, pdf_path,
                    created_at, updated_at
                FROM invoices
                WHERE id = ?1
                "#,
                params![id],
                Self::map_invoice_row,
            )
            .optional()
            .map_err(|e| format!("Failed to load invoice: {}", e))?;

        let Some(invoice) = invoice else {
            return Ok(None);
        };

        let mut items_stmt = conn
            .prepare(
                r#"
                SELECT id, invoice_id, sl_no, description, hsn_sac, qum, quantity, rate, amount, created_at, updated_at
                FROM invoice_items
                WHERE invoice_id = ?1
                ORDER BY sl_no ASC, id ASC
                "#,
            )
            .map_err(|e| format!("Failed to load line items: {}", e))?;

        let items = items_stmt
            .query_map(params![id], Self::map_item_row)
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(|e| format!("Failed to load line items: {}", e))?;

        Ok(Some(InvoiceWithItems { invoice, items }))
    }

    pub fn find_all(conn: &Connection, filter: InvoiceFilterInput) -> Result<Vec<InvoiceListItem>, String> {
        let mut query = String::from(
            r#"
            SELECT
                i.id, i.invoice_number, i.invoice_date, i.due_date, i.payment_terms_days,
                i.customer_id, i.customer_name, i.customer_gstin, i.total_amount, i.tax_type, i.status,
                COALESCE(SUM(pa.amount_allocated), 0.0) AS paid_amount,
                COALESCE(SUM(pa.tds_allocated), 0.0) AS tds_amount,
                i.pdf_path,
                (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) AS items_count,
                i.created_at
            FROM invoices i
            LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
            WHERE 1=1
            "#,
        );

        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(q) = filter.query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let pattern = format!("%{}%", q);
            query.push_str(" AND (i.invoice_number LIKE ? OR i.customer_name LIKE ? OR i.customer_gstin LIKE ? OR i.po_number_and_date LIKE ?)");
            for _ in 0..4 {
                params_vec.push(Box::new(pattern.clone()));
            }
        }

        if let Some(cid) = filter.customer_id {
            query.push_str(" AND i.customer_id = ?");
            params_vec.push(Box::new(cid));
        }

        if let Some(df) = filter.date_from.as_deref().and_then(parse_date) {
            query.push_str(" AND i.invoice_date >= ?");
            params_vec.push(Box::new(df.format("%Y-%m-%d").to_string()));
        }

        if let Some(dt) = filter.date_to.as_deref().and_then(parse_date) {
            query.push_str(" AND i.invoice_date <= ?");
            params_vec.push(Box::new(dt.format("%Y-%m-%d").to_string()));
        }

        query.push_str(" GROUP BY i.id ORDER BY i.invoice_date DESC, i.id DESC");

        let mut stmt = conn
            .prepare(&query)
            .map_err(|e| format!("Failed to load invoices: {}", e))?;

        let rows = stmt
            .query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
                let due_date: Option<String> = row.get(3)?;
                let total_amount: f64 = row.get(8)?;
                let status: String = row.get(10)?;
                let paid_amount: f64 = row.get(11)?;
                let tds_amount: f64 = row.get(12)?;

                let total_settled = round2(paid_amount + tds_amount);
                let outstanding_amount = round2(total_amount - total_settled).max(0.0);
                let payment_status = Self::payment_status(&status, total_settled, outstanding_amount);

                Ok(InvoiceListItem {
                    id: row.get(0)?,
                    invoice_number: row.get(1)?,
                    invoice_date: row.get(2)?,
                    due_date,
                    payment_terms_days: row.get(4)?,
                    customer_id: row.get(5)?,
                    customer_name: row.get(6)?,
                    customer_gstin: row.get(7)?,
                    total_amount,
                    tax_type: row.get(9)?,
                    status,
                    paid_amount,
                    tds_amount,
                    total_settled,
                    outstanding_amount,
                    payment_status,
                    pdf_path: row.get(13)?,
                    items_count: row.get(14)?,
                    created_at: row.get(15)?,
                })
            })
            .map_err(|e| format!("Failed to load invoices: {}", e))?;

        let mut results = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read invoice list: {}", e))?;

        if let Some(st) = filter.status.as_deref().map(|s| s.trim().to_uppercase()) {
            if !st.is_empty() && st != "ALL" {
                results.retain(|inv| inv.payment_status == st || inv.status.eq_ignore_ascii_case(&st));
            }
        }

        Ok(results)
    }

    pub fn update_pdf_path(conn: &Connection, id: i64, path: &str) -> Result<(), String> {
        conn.execute(
            "UPDATE invoices SET pdf_path = ?1 WHERE id = ?2",
            params![path, id],
        )
        .map_err(|e| format!("Failed to record PDF location: {}", e))?;

        Ok(())
    }

    /// An amount in words with paise when there are any, e.g.
    /// "THREE THOUSAND FIVE HUNDRED NINETY RUPEES AND FIFTY PAISE ONLY".
    pub fn money_in_words(amount: f64) -> String {
        let total_paise = (amount.abs() * 100.0).round() as i64;
        let (rupees, paise) = (total_paise / 100, total_paise % 100);
        let rupee_words = Self::number_to_words(rupees);
        if paise == 0 {
            return format!("{} ONLY", rupee_words);
        }
        let paise_words = Self::number_to_words(paise);
        let paise_words = paise_words.strip_suffix(" RUPEES").unwrap_or(&paise_words);
        format!("{} AND {} PAISE ONLY", rupee_words, paise_words)
    }

    /// Indian Rupee number to words converter
    pub fn number_to_words(mut num: i64) -> String {
        if num == 0 {
            return "ZERO RUPEES".to_string();
        }
        if num < 0 {
            num = num.abs();
        }

        let units = [
            "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
            "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN",
            "EIGHTEEN", "NINETEEN",
        ];
        let tens = [
            "", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY",
        ];

        let mut words = String::new();

        if num >= 1_00_00_000 {
            words.push_str(&format!("{} CRORE ", Self::convert_sub_lakh((num / 1_00_00_000) as usize, &units, &tens)));
            num %= 1_00_00_000;
        }

        if num >= 1_00_000 {
            words.push_str(&format!("{} LAKH ", Self::convert_sub_lakh((num / 1_00_000) as usize, &units, &tens)));
            num %= 1_00_000;
        }

        if num >= 1_000 {
            words.push_str(&format!("{} THOUSAND ", Self::convert_sub_lakh((num / 1_000) as usize, &units, &tens)));
            num %= 1_000;
        }

        if num >= 100 {
            words.push_str(&format!("{} HUNDRED ", units[(num / 100) as usize]));
            num %= 100;
        }

        if num > 0 {
            if num < 20 {
                words.push_str(units[num as usize]);
            } else {
                words.push_str(tens[(num / 10) as usize]);
                if num % 10 > 0 {
                    words.push_str("-");
                    words.push_str(units[(num % 10) as usize]);
                }
            }
        }

        let trimmed = words.trim();
        format!("{} RUPEES", trimmed)
    }

    fn convert_sub_lakh(n: usize, units: &[&str], tens: &[&str]) -> String {
        let mut res = String::new();
        let mut num = n;
        if num >= 100 {
            res.push_str(units[num / 100]);
            res.push_str(" HUNDRED ");
            num %= 100;
        }
        if num > 0 {
            if num < 20 {
                res.push_str(units[num]);
            } else {
                res.push_str(tens[num / 10]);
                if num % 10 > 0 {
                    res.push_str("-");
                    res.push_str(units[num % 10]);
                }
            }
        }
        res.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::customers::models::CustomerCreateInput;
    use crate::customers::repository::CustomerRepository;
    use crate::db::DatabaseManager;

    fn setup_test_db() -> Connection {
        // Keep the directory alive for the whole test; it is cleaned up by the OS temp policy.
        let temp_dir = tempfile::tempdir().unwrap().keep();
        let db_file = temp_dir.join("test_invoices.db");
        let db_manager = DatabaseManager::new(&db_file).unwrap();
        db_manager.get_connection().unwrap()
    }

    #[test]
    fn test_number_to_words() {
        assert_eq!(InvoiceRepository::number_to_words(0), "ZERO RUPEES");
        assert_eq!(InvoiceRepository::number_to_words(180), "ONE HUNDRED EIGHTY RUPEES");
        assert_eq!(InvoiceRepository::number_to_words(5040), "FIVE THOUSAND FORTY RUPEES");
        assert_eq!(InvoiceRepository::number_to_words(66080), "SIXTY-SIX THOUSAND EIGHTY RUPEES");
        assert_eq!(InvoiceRepository::number_to_words(100000), "ONE LAKH RUPEES");
    }

    #[test]
    fn money_in_words_includes_paise() {
        assert_eq!(InvoiceRepository::money_in_words(2360.0), "TWO THOUSAND THREE HUNDRED SIXTY RUPEES ONLY");
        assert_eq!(
            InvoiceRepository::money_in_words(118.53),
            "ONE HUNDRED EIGHTEEN RUPEES AND FIFTY-THREE PAISE ONLY"
        );
        assert_eq!(InvoiceRepository::money_in_words(0.05), "ZERO RUPEES AND FIVE PAISE ONLY");
    }

    #[test]
    fn invoice_total_is_exact_not_rounded_to_the_rupee() {
        let items = vec![InvoiceItemInput {
            sl_no: Some(1),
            description: "Job".to_string(),
            hsn_sac: None,
            qum: None,
            quantity: 1.0,
            rate: 100.45,
        }];
        let t = InvoiceRepository::calculate_financials(&items, "IGST", None, None, None, None).unwrap();
        assert_eq!(t.igst_amount, 18.08);
        assert_eq!(t.total_amount, 118.53);
        assert_eq!(t.round_off, 0.0);
        assert_eq!(t.amount_in_words, "ONE HUNDRED EIGHTEEN RUPEES AND FIFTY-THREE PAISE ONLY");
    }

    #[test]
    fn test_calculate_financials_cgst_sgst() {
        let items = vec![
            InvoiceItemInput {
                sl_no: Some(1),
                description: "Fabrication".to_string(),
                hsn_sac: Some("9954".to_string()),
                qum: Some("NOS".to_string()),
                quantity: 2.0,
                rate: 1000.0,
            },
        ];

        let t = InvoiceRepository::calculate_financials(&items, "CGST_SGST", None, None, None, None).unwrap();

        assert_eq!(t.subtotal, 2000.0);
        assert_eq!(t.discount, 0.0);
        assert_eq!(t.cgst_rate, 9.0);
        assert_eq!(t.cgst_amount, 180.0);
        assert_eq!(t.sgst_rate, 9.0);
        assert_eq!(t.sgst_amount, 180.0);
        assert_eq!(t.igst_rate, 0.0);
        assert_eq!(t.igst_amount, 0.0);
        assert_eq!(t.total_amount, 2360.0);
    }

    #[test]
    fn test_calculate_financials_igst() {
        let items = vec![
            InvoiceItemInput {
                sl_no: Some(1),
                description: "Inter-state fabrication".to_string(),
                hsn_sac: Some("9954".to_string()),
                qum: Some("JOB".to_string()),
                quantity: 1.0,
                rate: 10000.0,
            },
        ];

        let t = InvoiceRepository::calculate_financials(&items, "IGST", None, None, None, None).unwrap();

        assert_eq!(t.subtotal, 10000.0);
        assert_eq!(t.cgst_amount, 0.0);
        assert_eq!(t.sgst_amount, 0.0);
        assert_eq!(t.igst_rate, 18.0);
        assert_eq!(t.igst_amount, 1800.0);
        assert_eq!(t.total_amount, 11800.0);
    }

    #[test]
    fn test_customer_data_isolation() {
        let conn = setup_test_db();

        // 1. Create a customer
        let cust = CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "ABC Engineering".to_string(),
                gstin: Some("34AAAAA1234A1Z5".to_string()),
                phone: Some("9876543210".to_string()),
                email: None,
                address_line1: Some("Original Street".to_string()),
                address_line2: None,
                city: Some("Puducherry".to_string()),
                state: Some("Puducherry".to_string()),
                postal_code: Some("605009".to_string()),
                is_favorite: None,
            },
        )
        .unwrap();

        // 2. Create Invoice INV-001 for ABC Engineering
        let inv_with_items = InvoiceRepository::create(
            &conn,
            InvoiceCreateInput {
                invoice_number: "MWW/24-25/001".to_string(),
                invoice_date: "21-09-2024".to_string(),
                due_date: None,
                payment_terms_days: None,
                invoice_state: Some("Puducherry".to_string()),
                customer_id: Some(cust.id),
                customer_name: cust.name.clone(),
                customer_address: Some("Original Street, Puducherry - 605009".to_string()),
                customer_phone: cust.phone.clone(),
                customer_gstin: cust.gstin.clone(),
                customer_state: cust.state.clone(),
                customer_state_code: Some("34".to_string()),
                po_number_and_date: Some("PO-101".to_string()),
                vehicle_number: None,
                date_of_supply: None,
                place_of_supply: None,
                our_dc_number_and_date: None,
                your_dc_number_and_date: None,
                delivery_note: None,
                supplier_ref: None,
                buyer_ref: None,
                dispatch_doc_no: None,
                delivery_note_date: None,
                dispatch_through: None,
                destination: None,
                terms_of_delivery: None,
                tax_type: "CGST_SGST".to_string(),
                discount: None,
                cgst_rate: None,
                sgst_rate: None,
                igst_rate: None,
                bank_name: None,
                bank_branch: None,
                bank_account_no: None,
                bank_ifsc: None,
                terms_and_conditions: None,
                status: None,
                notes: None,
                items: vec![InvoiceItemInput {
                    sl_no: Some(1),
                    description: "Steel Plate Welding".to_string(),
                    hsn_sac: Some("9954".to_string()),
                    qum: Some("NOS".to_string()),
                    quantity: 1.0,
                    rate: 5000.0,
                }],
            },
        )
        .unwrap();

        assert_eq!(inv_with_items.invoice.customer_name, "ABC Engineering");
        assert_eq!(inv_with_items.invoice.invoice_date, "2024-09-21");
        assert_eq!(inv_with_items.invoice.due_date.as_deref(), Some("2024-11-20"));
        assert_eq!(
            inv_with_items.invoice.customer_address.as_deref(),
            Some("Original Street, Puducherry - 605009")
        );

        // 3. Customer changes address later in customer module
        CustomerRepository::update(
            &conn,
            cust.id,
            crate::customers::models::CustomerUpdateInput {
                name: "ABC Engineering Pvt Ltd".to_string(),
                gstin: Some("34AAAAA1234A1Z5".to_string()),
                phone: Some("9876543210".to_string()),
                email: None,
                address_line1: Some("Brand New Factory Address".to_string()),
                address_line2: None,
                city: Some("Chennai".to_string()),
                state: Some("Tamil Nadu".to_string()),
                postal_code: Some("600001".to_string()),
                is_favorite: None,
            },
        )
        .unwrap();

        // 4. Verify INV-001 did NOT change silently! It retains original snapshot!
        let refetched_invoice = InvoiceRepository::find_by_id(&conn, inv_with_items.invoice.id)
            .unwrap()
            .unwrap();

        assert_eq!(
            refetched_invoice.invoice.customer_name, "ABC Engineering",
            "Invoice customer name must remain immutable snapshot"
        );
        assert_eq!(
            refetched_invoice.invoice.customer_address.as_deref(),
            Some("Original Street, Puducherry - 605009"),
            "Invoice customer address must NOT silently change when customer record changes"
        );
    }
}

