use crate::attachments::{clean_file_name, validate_file};
use super::models::{
    DuplicatePoCheck, LinkedInvoice, PurchaseOrder, PurchaseOrderDetail, PurchaseOrderFileInfo, PurchaseOrderFilter,
    PurchaseOrderInput, PurchaseOrderListItem, STATUSES,
};
use crate::customers::models::PartyRole;
use crate::customers::repository::CustomerRepository;
use crate::invoices::repository::InvoiceRepository;
use crate::quotations::repository::QuotationRepository;
use crate::util::{display_date, normalize_date, round2};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

const FILE_GONE: &str = "That file is no longer there.";

pub struct PurchaseOrderRepository;

impl PurchaseOrderRepository {
    /// The text an invoice shows in "PO number & date": `number & dd-mm-yyyy`, or just the number
    /// when the order has no date. Same form the invoice screen builds by hand.
    pub fn po_reference_text(po_number: &str, po_date: Option<&str>) -> String {
        match po_date.map(str::trim).filter(|d| !d.is_empty()) {
            Some(d) => format!("{} & {}", po_number.trim(), display_date(d)),
            None => po_number.trim().to_string(),
        }
    }

    /// Validate an input and return the cleaned number, date and note.
    fn clean_input(conn: &Connection, input: &PurchaseOrderInput) -> Result<(String, Option<String>, Option<String>), String> {
        let number = input.po_number.trim().to_string();
        if number.is_empty() {
            return Err("PO number is required.".to_string());
        }
        let customer: i64 = conn
            .query_row("SELECT COUNT(*) FROM customers WHERE id = ?1", params![input.customer_id], |r| r.get(0))
            .map_err(|e| format!("Failed to check the customer: {}", e))?;
        if customer == 0 {
            return Err("Customer not found.".to_string());
        }
        CustomerRepository::require_party(conn, input.customer_id, PartyRole::Customer)?;
        if !STATUSES.contains(&input.status.as_str()) {
            return Err("Choose a valid status.".to_string());
        }
        let date = match input.po_date.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
            Some(d) => Some(normalize_date(d, "PO date")?),
            None => None,
        };
        let notes = input.notes.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);
        Ok((number, date, notes))
    }

    fn linked_count(conn: &Connection, id: i64) -> Result<i64, String> {
        conn.query_row("SELECT COUNT(*) FROM invoices WHERE purchase_order_id = ?1", params![id], |r| r.get(0))
            .map_err(|e| format!("Failed to check linked invoices: {}", e))
    }

    /// Warn when this customer already has an order with the same number (not case sensitive).
    /// It is only a warning: a customer may re-send a revised order under the same number.
    pub fn check_duplicate(
        conn: &Connection,
        customer_id: i64,
        po_number: &str,
        exclude_id: Option<i64>,
    ) -> Result<DuplicatePoCheck, String> {
        let number = po_number.trim();
        if number.is_empty() {
            return Ok(DuplicatePoCheck { has_duplicate: false, existing_id: None });
        }
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM purchase_orders WHERE customer_id = ?1 AND po_number = ?2 COLLATE NOCASE AND id != ?3 LIMIT 1",
                params![customer_id, number, exclude_id.unwrap_or(-1)],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("Error checking duplicate PO number: {}", e))?;
        Ok(DuplicatePoCheck { has_duplicate: existing.is_some(), existing_id: existing })
    }

    pub fn create(conn: &Connection, input: PurchaseOrderInput) -> Result<PurchaseOrderDetail, String> {
        let (number, date, notes) = Self::clean_input(conn, &input)?;
        let now = Utc::now().to_rfc3339();
        let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin transaction: {}", e))?;
        tx.execute(
            "INSERT INTO purchase_orders (customer_id, po_number, po_date, status, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![input.customer_id, number, date, input.status, notes, now],
        )
        .map_err(|e| format!("Failed to save the purchase order: {}", e))?;
        let id = tx.last_insert_rowid();
        if let Some(quotation_id) = input.quotation_id {
            QuotationRepository::set_purchase_order_link(&tx, id, Some(quotation_id))?;
        }
        for invoice_id in &input.invoice_ids {
            Self::set_invoice_link(&tx, *invoice_id, Some(id))?;
        }
        tx.commit().map_err(|e| format!("Failed to save the purchase order: {}", e))?;
        Self::get(conn, id)?.ok_or_else(|| "Saved purchase order could not be reloaded.".to_string())
    }

    pub fn update(conn: &Connection, id: i64, input: PurchaseOrderInput) -> Result<PurchaseOrderDetail, String> {
        let (current, stored_quotation): (i64, Option<i64>) = conn
            .query_row("SELECT customer_id, quotation_id FROM purchase_orders WHERE id = ?1", params![id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .map_err(|e| format!("Failed to load the purchase order: {}", e))?
            .ok_or_else(|| "Purchase order not found.".to_string())?;
        let (number, date, notes) = Self::clean_input(conn, &input)?;
        if current != input.customer_id && Self::linked_count(conn, id)? > 0 {
            return Err("Unlink this order's invoices before changing its customer.".to_string());
        }
        // Same lock the invoice link has: the order keeps its quotation, so its customer is fixed.
        if current != input.customer_id && stored_quotation.is_some() && input.quotation_id == stored_quotation {
            return Err("Remove this order's quotation before changing its customer.".to_string());
        }
        let now = Utc::now().to_rfc3339();
        let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin transaction: {}", e))?;
        tx.execute(
            "UPDATE purchase_orders SET customer_id = ?1, po_number = ?2, po_date = ?3, status = ?4, notes = ?5, updated_at = ?6
             WHERE id = ?7",
            params![input.customer_id, number, date, input.status, notes, now, id],
        )
        .map_err(|e| format!("Failed to save the purchase order: {}", e))?;
        if input.quotation_id != stored_quotation {
            QuotationRepository::set_purchase_order_link(&tx, id, input.quotation_id)?;
        }
        for invoice_id in &input.invoice_ids {
            Self::set_invoice_link(&tx, *invoice_id, Some(id))?;
        }
        tx.commit().map_err(|e| format!("Failed to save the purchase order: {}", e))?;
        Self::get(conn, id)?.ok_or_else(|| "Saved purchase order could not be reloaded.".to_string())
    }

    pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
        if Self::get(conn, id)?.is_none() {
            return Err("Purchase order not found.".to_string());
        }
        let linked = Self::linked_count(conn, id)?;
        if linked > 0 {
            return Err(format!("This purchase order has {} linked invoice(s). Unlink them first.", linked));
        }
        conn.execute("DELETE FROM purchase_orders WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete the purchase order: {}", e))?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: i64) -> Result<Option<PurchaseOrderDetail>, String> {
        let order = conn
            .query_row(
                "SELECT po.id, po.customer_id, c.name, po.po_number, po.po_date, po.status, po.notes, po.created_at, po.updated_at,
                        po.quotation_id, q.quotation_number, q.quotation_date
                 FROM purchase_orders po JOIN customers c ON c.id = po.customer_id
                 LEFT JOIN quotations q ON q.id = po.quotation_id WHERE po.id = ?1",
                params![id],
                |r| {
                    Ok(PurchaseOrder {
                        id: r.get(0)?,
                        customer_id: r.get(1)?,
                        customer_name: r.get(2)?,
                        po_number: r.get(3)?,
                        po_date: r.get(4)?,
                        status: r.get(5)?,
                        notes: r.get(6)?,
                        quotation_id: r.get(9)?,
                        quotation_number: r.get(10)?,
                        quotation_date: r.get(11)?,
                        created_at: r.get(7)?,
                        updated_at: r.get(8)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to load the purchase order: {}", e))?;
        let Some(order) = order else { return Ok(None) };

        // The file contents are never read here, only their names and sizes.
        let mut stmt = conn
            .prepare("SELECT id, file_name, mime_type, size_bytes FROM purchase_order_files WHERE purchase_order_id = ?1 ORDER BY id")
            .map_err(|e| format!("Failed to load files: {}", e))?;
        let files = stmt
            .query_map(params![id], |r| {
                Ok(PurchaseOrderFileInfo { id: r.get(0)?, file_name: r.get(1)?, mime_type: r.get(2)?, size_bytes: r.get(3)? })
            })
            .map_err(|e| format!("Failed to load files: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read files: {}", e))?;

        let invoices = Self::invoice_rows(conn, "i.purchase_order_id = ?1", id)?;
        Ok(Some(PurchaseOrderDetail { order, files, invoices }))
    }

    pub fn list(conn: &Connection, filter: PurchaseOrderFilter) -> Result<Vec<PurchaseOrderListItem>, String> {
        let mut query = String::from(
            "SELECT po.id, po.customer_id, c.name, po.po_number, po.po_date, po.status,
                    (SELECT COUNT(*) FROM purchase_order_files f WHERE f.purchase_order_id = po.id),
                    (SELECT COUNT(*) FROM invoices i WHERE i.purchase_order_id = po.id),
                    po.quotation_id, q.quotation_number
             FROM purchase_orders po JOIN customers c ON c.id = po.customer_id
             LEFT JOIN quotations q ON q.id = po.quotation_id WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(q) = filter.query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            query.push_str(" AND (po.po_number LIKE ? OR c.name LIKE ?)");
            let pattern = format!("%{}%", q);
            args.push(Box::new(pattern.clone()));
            args.push(Box::new(pattern));
        }
        if let Some(st) = filter.status.as_deref().map(|s| s.trim().to_uppercase()) {
            if !st.is_empty() && st != "ALL" {
                query.push_str(" AND po.status = ?");
                args.push(Box::new(st));
            }
        }
        if let Some(cid) = filter.customer_id {
            query.push_str(" AND po.customer_id = ?");
            args.push(Box::new(cid));
        }
        query.push_str(" ORDER BY COALESCE(po.po_date, substr(po.created_at, 1, 10)) DESC, po.id DESC");

        let mut stmt = conn.prepare(&query).map_err(|e| format!("Failed to load purchase orders: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(args.iter()), |r| {
                Ok(PurchaseOrderListItem {
                    id: r.get(0)?,
                    customer_id: r.get(1)?,
                    customer_name: r.get(2)?,
                    po_number: r.get(3)?,
                    po_date: r.get(4)?,
                    status: r.get(5)?,
                    file_count: r.get(6)?,
                    invoice_count: r.get(7)?,
                    quotation_id: r.get(8)?,
                    quotation_number: r.get(9)?,
                })
            })
            .map_err(|e| format!("Failed to load purchase orders: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read purchase orders: {}", e))
    }

    /// Invoices matching `where_sql` (one `?1` parameter), with their payment status.
    fn invoice_rows(conn: &Connection, where_sql: &str, arg: i64) -> Result<Vec<LinkedInvoice>, String> {
        let sql = format!(
            "SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount, i.status,
                    COALESCE(SUM(pa.amount_allocated), 0.0), COALESCE(SUM(pa.tds_allocated), 0.0),
                    i.po_number_and_date
             FROM invoices i LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
             WHERE {} GROUP BY i.id ORDER BY i.invoice_date DESC, i.id DESC",
            where_sql
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| format!("Failed to load invoices: {}", e))?;
        let rows = stmt
            .query_map(params![arg], |r| {
                let total_amount: f64 = r.get(3)?;
                let status: String = r.get(4)?;
                let settled = round2(r.get::<_, f64>(5)? + r.get::<_, f64>(6)?);
                let outstanding = round2(total_amount - settled).max(0.0);
                Ok(LinkedInvoice {
                    id: r.get(0)?,
                    invoice_number: r.get(1)?,
                    invoice_date: r.get(2)?,
                    total_amount,
                    payment_status: InvoiceRepository::payment_status(&status, settled, outstanding),
                    status,
                    po_number_and_date: r.get(7)?,
                })
            })
            .map_err(|e| format!("Failed to load invoices: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read invoices: {}", e))
    }

    /// The customer's invoices that have no purchase order yet, of every status.
    pub fn unlinked_invoices_for_customer(conn: &Connection, customer_id: i64) -> Result<Vec<LinkedInvoice>, String> {
        Self::invoice_rows(conn, "i.customer_id = ?1 AND i.purchase_order_id IS NULL", customer_id)
    }

    /// Link an invoice to a purchase order (or unlink with `None`). The order must belong to the
    /// invoice's customer. Linking fills the invoice's "PO number & date" text; unlinking leaves
    /// that text alone, so an invoice already issued never changes behind the owner's back.
    pub fn set_invoice_link(conn: &Connection, invoice_id: i64, purchase_order_id: Option<i64>) -> Result<(), String> {
        let invoice_customer: Option<i64> = conn
            .query_row("SELECT customer_id FROM invoices WHERE id = ?1", params![invoice_id], |r| r.get(0))
            .optional()
            .map_err(|e| format!("Failed to load the invoice: {}", e))?
            .ok_or_else(|| "Invoice not found.".to_string())?;
        let now = Utc::now().to_rfc3339();

        let Some(po_id) = purchase_order_id else {
            conn.execute(
                "UPDATE invoices SET purchase_order_id = NULL, updated_at = ?1 WHERE id = ?2",
                params![now, invoice_id],
            )
            .map_err(|e| format!("Failed to unlink the invoice: {}", e))?;
            return Ok(());
        };

        let (po_customer, number, date): (i64, String, Option<String>) = conn
            .query_row(
                "SELECT customer_id, po_number, po_date FROM purchase_orders WHERE id = ?1",
                params![po_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to load the purchase order: {}", e))?
            .ok_or_else(|| "Purchase order not found.".to_string())?;
        if invoice_customer != Some(po_customer) {
            return Err("This invoice belongs to a different customer.".to_string());
        }
        conn.execute(
            "UPDATE invoices SET purchase_order_id = ?1, po_number_and_date = ?2, updated_at = ?3 WHERE id = ?4",
            params![po_id, Self::po_reference_text(&number, date.as_deref()), now, invoice_id],
        )
        .map_err(|e| format!("Failed to link the invoice: {}", e))?;
        Ok(())
    }

    pub fn add_file(conn: &Connection, purchase_order_id: i64, file_name: &str, bytes: &[u8]) -> Result<PurchaseOrderFileInfo, String> {
        let exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM purchase_orders WHERE id = ?1", params![purchase_order_id], |r| r.get(0))
            .map_err(|e| format!("Failed to load the purchase order: {}", e))?;
        if exists == 0 {
            return Err("Purchase order not found.".to_string());
        }
        let mime = validate_file(file_name, bytes)?;
        let name = clean_file_name(file_name);
        conn.execute(
            "INSERT INTO purchase_order_files (purchase_order_id, file_name, mime_type, size_bytes, data, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![purchase_order_id, name, mime, bytes.len() as i64, bytes, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Failed to save the file: {}", e))?;
        Ok(PurchaseOrderFileInfo {
            id: conn.last_insert_rowid(),
            file_name: name,
            mime_type: mime.to_string(),
            size_bytes: bytes.len() as i64,
        })
    }

    pub fn remove_file(conn: &Connection, file_id: i64) -> Result<(), String> {
        let removed = conn
            .execute("DELETE FROM purchase_order_files WHERE id = ?1", params![file_id])
            .map_err(|e| format!("Failed to remove the file: {}", e))?;
        if removed == 0 {
            return Err(FILE_GONE.to_string());
        }
        Ok(())
    }

    /// File name, MIME type and contents of one attached file.
    pub fn read_file(conn: &Connection, file_id: i64) -> Result<(String, String, Vec<u8>), String> {
        conn.query_row(
            "SELECT file_name, mime_type, data FROM purchase_order_files WHERE id = ?1",
            params![file_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| format!("Failed to read the file: {}", e))?
        .ok_or_else(|| FILE_GONE.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;
    use rusqlite::{params, Connection};

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("t.db")).unwrap();
        let conn = db.get_connection().unwrap();
        (dir, conn)
    }

    fn add_customer(conn: &Connection, name: &str) -> i64 {
        conn.execute(
            "INSERT INTO customers (name, created_at, updated_at) VALUES (?1, 'x', 'x')",
            params![name],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn add_invoice(conn: &Connection, number: &str, customer_id: i64, status: &str) -> i64 {
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, customer_name, status, total_amount, amount_in_words, created_at, updated_at)
             VALUES (?1, '2026-10-01', ?2, 'Sample', ?3, 1000.0, 'x', 'x', 'x')",
            params![number, customer_id, status],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn input(customer_id: i64, number: &str, date: Option<&str>) -> PurchaseOrderInput {
        PurchaseOrderInput {
            customer_id,
            po_number: number.to_string(),
            po_date: date.map(str::to_string),
            status: "NOT_STARTED".to_string(),
            notes: None,
            invoice_ids: vec![],
            quotation_id: None,
        }
    }

    fn reference_text(conn: &Connection, invoice_id: i64) -> Option<String> {
        conn.query_row("SELECT po_number_and_date FROM invoices WHERE id = ?1", params![invoice_id], |r| r.get(0)).unwrap()
    }

    fn linked_order(conn: &Connection, invoice_id: i64) -> Option<i64> {
        conn.query_row("SELECT purchase_order_id FROM invoices WHERE id = ?1", params![invoice_id], |r| r.get(0)).unwrap()
    }

    const PDF: &[u8] = b"%PDF-1.4 sample";

    fn add_quotation(conn: &Connection, customer_id: i64, number: &str, date: &str) -> i64 {
        crate::quotations::repository::QuotationRepository::create(
            conn,
            crate::quotations::models::QuotationInput {
                customer_id,
                quotation_number: number.to_string(),
                quotation_date: date.to_string(),
                notes: None,
                purchase_order_ids: vec![],
            },
        )
        .unwrap()
        .quotation
        .id
    }

    fn order_count_of(conn: &Connection, quotation_id: i64) -> usize {
        crate::quotations::repository::QuotationRepository::get(conn, quotation_id).unwrap().unwrap().orders.len()
    }

    #[test]
    fn an_order_links_to_a_quotation_of_its_customer_and_shows_its_number_and_date() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let q = add_quotation(&conn, a, "Q-7", "2026-09-30");
        let mut inp = input(a, "PO-1", None);
        inp.quotation_id = Some(q);
        let po = PurchaseOrderRepository::create(&conn, inp).unwrap();
        assert_eq!(po.order.quotation_id, Some(q));
        assert_eq!(po.order.quotation_number.as_deref(), Some("Q-7"));
        assert_eq!(po.order.quotation_date.as_deref(), Some("2026-09-30"));
        let list = PurchaseOrderRepository::list(&conn, PurchaseOrderFilter::default()).unwrap();
        assert_eq!(list[0].quotation_id, Some(q));
        assert_eq!(list[0].quotation_number.as_deref(), Some("Q-7"));
        let none = PurchaseOrderRepository::create(&conn, input(a, "PO-2", None)).unwrap();
        assert_eq!(none.order.quotation_id, None);
        assert_eq!(none.order.quotation_number, None);
    }

    #[test]
    fn an_order_cannot_take_a_quotation_of_another_customer_or_a_missing_one() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let b = add_customer(&conn, "B");
        let theirs = add_quotation(&conn, b, "Q-B", "2026-09-30");
        let mut inp = input(a, "PO-1", None);
        inp.quotation_id = Some(theirs);
        let err = PurchaseOrderRepository::create(&conn, inp).unwrap_err();
        assert!(err.contains("different customer"), "{}", err);
        let mut gone = input(a, "PO-2", None);
        gone.quotation_id = Some(9999);
        assert_eq!(PurchaseOrderRepository::create(&conn, gone).unwrap_err(), "Quotation not found.");
        let orders: i64 = conn.query_row("SELECT COUNT(*) FROM purchase_orders", [], |r| r.get(0)).unwrap();
        assert_eq!(orders, 0, "a refused save leaves no order behind");
    }

    #[test]
    fn moving_an_order_to_another_quotation_or_removing_it_updates_both_sides() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let q1 = add_quotation(&conn, a, "Q-1", "2026-09-01");
        let q2 = add_quotation(&conn, a, "Q-2", "2026-09-02");
        let mut inp = input(a, "PO-1", None);
        inp.quotation_id = Some(q1);
        let po = PurchaseOrderRepository::create(&conn, inp).unwrap().order.id;
        assert_eq!((order_count_of(&conn, q1), order_count_of(&conn, q2)), (1, 0));

        let mut to_q2 = input(a, "PO-1", None);
        to_q2.quotation_id = Some(q2);
        PurchaseOrderRepository::update(&conn, po, to_q2).unwrap();
        assert_eq!((order_count_of(&conn, q1), order_count_of(&conn, q2)), (0, 1));
        assert!(crate::quotations::repository::QuotationRepository::delete(&conn, q1).is_ok(), "q1 has no orders left");

        let removed = PurchaseOrderRepository::update(&conn, po, input(a, "PO-1", None)).unwrap();
        assert_eq!(removed.order.quotation_id, None);
        assert_eq!(order_count_of(&conn, q2), 0);
        assert!(crate::quotations::repository::QuotationRepository::delete(&conn, q2).is_ok());
    }

    #[test]
    fn customer_cannot_change_while_the_order_keeps_its_quotation() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let b = add_customer(&conn, "B");
        let q = add_quotation(&conn, a, "Q-1", "2026-09-01");
        let mut inp = input(a, "PO-1", None);
        inp.quotation_id = Some(q);
        let po = PurchaseOrderRepository::create(&conn, inp).unwrap().order.id;

        let mut same_quotation = input(b, "PO-1", None);
        same_quotation.quotation_id = Some(q);
        assert_eq!(
            PurchaseOrderRepository::update(&conn, po, same_quotation).unwrap_err(),
            "Remove this order's quotation before changing its customer."
        );
        // Removing the quotation in the same save lets the customer change.
        let moved = PurchaseOrderRepository::update(&conn, po, input(b, "PO-1", None)).unwrap();
        assert_eq!(moved.order.customer_name, "B");
        assert_eq!(moved.order.quotation_id, None);

        // Invoices on the order still lock the customer, quotation or not.
        let invoice = add_invoice(&conn, "I-1", b, "ISSUED");
        PurchaseOrderRepository::set_invoice_link(&conn, invoice, Some(po)).unwrap();
        let err = PurchaseOrderRepository::update(&conn, po, input(a, "PO-1", None)).unwrap_err();
        assert!(err.contains("invoices"), "{}", err);
    }

    #[test]
    fn create_requires_a_customer_and_a_po_number() {
        let (_d, conn) = setup();
        let c = add_customer(&conn, "A");
        assert_eq!(
            PurchaseOrderRepository::create(&conn, input(c, "   ", None)).unwrap_err(),
            "PO number is required."
        );
        assert!(PurchaseOrderRepository::create(&conn, input(9999, "PO-1", None)).unwrap_err().contains("Customer"));
        let mut bad = input(c, "PO-1", None);
        bad.status = "DONE".into();
        assert!(PurchaseOrderRepository::create(&conn, bad).unwrap_err().contains("status"));
        let ok = PurchaseOrderRepository::create(&conn, input(c, " PO-1 ", Some("05-10-2026"))).unwrap();
        assert_eq!(ok.order.po_number, "PO-1");
        assert_eq!(ok.order.po_date.as_deref(), Some("2026-10-05"));
        assert_eq!(ok.order.status, "NOT_STARTED");
    }

    #[test]
    fn duplicate_check_is_per_customer_and_ignores_case_but_only_warns() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let b = add_customer(&conn, "B");
        let first = PurchaseOrderRepository::create(&conn, input(a, "PO-1", None)).unwrap();
        let same = PurchaseOrderRepository::check_duplicate(&conn, a, "po-1", None).unwrap();
        assert!(same.has_duplicate);
        assert_eq!(same.existing_id, Some(first.order.id));
        assert!(!PurchaseOrderRepository::check_duplicate(&conn, b, "PO-1", None).unwrap().has_duplicate);
        assert!(!PurchaseOrderRepository::check_duplicate(&conn, a, "PO-1", Some(first.order.id)).unwrap().has_duplicate);
        assert!(PurchaseOrderRepository::create(&conn, input(a, "PO-1", None)).is_ok(), "a duplicate is a warning, not an error");
    }

    #[test]
    fn linking_an_invoice_of_another_customer_is_refused() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let b = add_customer(&conn, "B");
        let po = PurchaseOrderRepository::create(&conn, input(a, "PO-1", None)).unwrap();
        let theirs = add_invoice(&conn, "I-1", b, "ISSUED");
        let err = PurchaseOrderRepository::set_invoice_link(&conn, theirs, Some(po.order.id)).unwrap_err();
        assert!(err.contains("different customer"), "{}", err);
        assert_eq!(linked_order(&conn, theirs), None);
    }

    #[test]
    fn linking_fills_the_invoice_reference_text() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let dated = PurchaseOrderRepository::create(&conn, input(a, "PO-1045", Some("2026-10-05"))).unwrap();
        let undated = PurchaseOrderRepository::create(&conn, input(a, "PO-7", None)).unwrap();
        let i1 = add_invoice(&conn, "I-1", a, "ISSUED");
        let i2 = add_invoice(&conn, "I-2", a, "ISSUED");
        PurchaseOrderRepository::set_invoice_link(&conn, i1, Some(dated.order.id)).unwrap();
        PurchaseOrderRepository::set_invoice_link(&conn, i2, Some(undated.order.id)).unwrap();
        assert_eq!(reference_text(&conn, i1).as_deref(), Some("PO-1045 & 05-10-2026"));
        assert_eq!(reference_text(&conn, i2).as_deref(), Some("PO-7"), "no date means no trailing ampersand");
        assert_eq!(linked_order(&conn, i1), Some(dated.order.id));
    }

    #[test]
    fn unlinking_keeps_the_reference_text() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let po = PurchaseOrderRepository::create(&conn, input(a, "PO-1", Some("2026-10-05"))).unwrap();
        let inv = add_invoice(&conn, "I-1", a, "ISSUED");
        PurchaseOrderRepository::set_invoice_link(&conn, inv, Some(po.order.id)).unwrap();
        PurchaseOrderRepository::set_invoice_link(&conn, inv, None).unwrap();
        assert_eq!(linked_order(&conn, inv), None);
        assert_eq!(reference_text(&conn, inv).as_deref(), Some("PO-1 & 05-10-2026"));
    }

    #[test]
    fn an_invoice_has_one_order_and_relinking_moves_it() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let first = PurchaseOrderRepository::create(&conn, input(a, "PO-1", None)).unwrap();
        let second = PurchaseOrderRepository::create(&conn, input(a, "PO-2", None)).unwrap();
        let inv = add_invoice(&conn, "I-1", a, "ISSUED");
        PurchaseOrderRepository::set_invoice_link(&conn, inv, Some(first.order.id)).unwrap();
        PurchaseOrderRepository::set_invoice_link(&conn, inv, Some(second.order.id)).unwrap();
        let list = PurchaseOrderRepository::list(&conn, PurchaseOrderFilter::default()).unwrap();
        let count = |id: i64| list.iter().find(|p| p.id == id).unwrap().invoice_count;
        assert_eq!(count(first.order.id), 0);
        assert_eq!(count(second.order.id), 1);
    }

    #[test]
    fn one_order_can_have_several_invoices_and_saving_attaches_them() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let i1 = add_invoice(&conn, "I-1", a, "ISSUED");
        let i2 = add_invoice(&conn, "I-2", a, "ISSUED");
        let mut with_invoices = input(a, "PO-1", Some("2026-10-05"));
        with_invoices.invoice_ids = vec![i1, i2];
        let po = PurchaseOrderRepository::create(&conn, with_invoices).unwrap();
        assert_eq!(po.invoices.len(), 2);
        assert_eq!(reference_text(&conn, i2).as_deref(), Some("PO-1 & 05-10-2026"));
    }

    #[test]
    fn delete_is_blocked_while_invoices_are_linked_and_removes_files_otherwise() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let po = PurchaseOrderRepository::create(&conn, input(a, "PO-1", None)).unwrap();
        let inv = add_invoice(&conn, "I-1", a, "ISSUED");
        PurchaseOrderRepository::add_file(&conn, po.order.id, "order.pdf", PDF).unwrap();
        PurchaseOrderRepository::set_invoice_link(&conn, inv, Some(po.order.id)).unwrap();
        let err = PurchaseOrderRepository::delete(&conn, po.order.id).unwrap_err();
        assert!(err.contains("linked invoice"), "{}", err);
        PurchaseOrderRepository::set_invoice_link(&conn, inv, None).unwrap();
        PurchaseOrderRepository::delete(&conn, po.order.id).unwrap();
        let files: i64 = conn.query_row("SELECT COUNT(*) FROM purchase_order_files", [], |r| r.get(0)).unwrap();
        assert_eq!(files, 0);
        assert!(PurchaseOrderRepository::get(&conn, po.order.id).unwrap().is_none());
    }

    #[test]
    fn changing_the_customer_is_refused_while_invoices_are_linked() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let b = add_customer(&conn, "B");
        let po = PurchaseOrderRepository::create(&conn, input(a, "PO-1", None)).unwrap();
        let inv = add_invoice(&conn, "I-1", a, "ISSUED");
        PurchaseOrderRepository::set_invoice_link(&conn, inv, Some(po.order.id)).unwrap();
        let err = PurchaseOrderRepository::update(&conn, po.order.id, input(b, "PO-1", None)).unwrap_err();
        assert!(err.contains("Unlink"), "{}", err);
        let mut same_customer = input(a, "PO-9", Some("2026-11-01"));
        same_customer.status = "PARTIAL".into();
        let saved = PurchaseOrderRepository::update(&conn, po.order.id, same_customer).unwrap();
        assert_eq!(saved.order.status, "PARTIAL");
        assert_eq!(reference_text(&conn, inv).as_deref(), Some("PO-1"), "editing the order does not rewrite an invoice already issued");
    }

    #[test]
    fn attachable_invoices_include_cancelled_and_draft_ones_but_not_linked_or_other_customers() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let b = add_customer(&conn, "B");
        let po = PurchaseOrderRepository::create(&conn, input(a, "PO-1", None)).unwrap();
        let issued = add_invoice(&conn, "I-1", a, "ISSUED");
        let draft = add_invoice(&conn, "I-2", a, "DRAFT");
        let cancelled = add_invoice(&conn, "I-3", a, "CANCELLED");
        add_invoice(&conn, "I-4", b, "ISSUED");
        let taken = add_invoice(&conn, "I-5", a, "ISSUED");
        PurchaseOrderRepository::set_invoice_link(&conn, taken, Some(po.order.id)).unwrap();
        let list = PurchaseOrderRepository::unlinked_invoices_for_customer(&conn, a).unwrap();
        let mut ids: Vec<i64> = list.iter().map(|i| i.id).collect();
        ids.sort();
        assert_eq!(ids, vec![issued, draft, cancelled]);
        assert_eq!(list.iter().find(|i| i.id == cancelled).unwrap().payment_status, "CANCELLED");
        assert_eq!(list.iter().find(|i| i.id == issued).unwrap().payment_status, "UNPAID");
    }

    #[test]
    fn attachable_invoices_show_the_po_text_they_already_carry() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let printed = add_invoice(&conn, "I-1", a, "ISSUED");
        let blank = add_invoice(&conn, "I-2", a, "ISSUED");
        conn.execute("UPDATE invoices SET po_number_and_date = 'PO/88 & 01-10-2026' WHERE id = ?1", params![printed]).unwrap();
        let list = PurchaseOrderRepository::unlinked_invoices_for_customer(&conn, a).unwrap();
        assert_eq!(list.iter().find(|i| i.id == printed).unwrap().po_number_and_date.as_deref(), Some("PO/88 & 01-10-2026"));
        assert_eq!(list.iter().find(|i| i.id == blank).unwrap().po_number_and_date, None);
    }

    #[test]
    fn list_filters_by_search_status_and_customer() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "Alpha Works");
        let b = add_customer(&conn, "Beta Steel");
        let one = PurchaseOrderRepository::create(&conn, input(a, "PO-100", None)).unwrap();
        let mut done = input(b, "PO-200", None);
        done.status = "COMPLETED".into();
        PurchaseOrderRepository::create(&conn, done).unwrap();
        let all = PurchaseOrderRepository::list(&conn, PurchaseOrderFilter::default()).unwrap();
        assert_eq!(all.len(), 2);
        let f = |query: Option<&str>, status: Option<&str>, customer: Option<i64>| PurchaseOrderFilter {
            query: query.map(str::to_string),
            status: status.map(str::to_string),
            customer_id: customer,
        };
        assert_eq!(PurchaseOrderRepository::list(&conn, f(Some("alpha"), None, None)).unwrap()[0].id, one.order.id);
        assert_eq!(PurchaseOrderRepository::list(&conn, f(Some("PO-2"), None, None)).unwrap().len(), 1);
        assert_eq!(PurchaseOrderRepository::list(&conn, f(None, Some("COMPLETED"), None)).unwrap().len(), 1);
        assert_eq!(PurchaseOrderRepository::list(&conn, f(None, None, Some(a))).unwrap().len(), 1);
    }

    #[test]
    fn files_round_trip_and_are_counted_without_loading_them() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let po = PurchaseOrderRepository::create(&conn, input(a, "PO-1", None)).unwrap();
        let info = PurchaseOrderRepository::add_file(&conn, po.order.id, "..\\my order.pdf", PDF).unwrap();
        assert_eq!(info.file_name, "my order.pdf");
        assert_eq!(info.size_bytes, PDF.len() as i64);
        let (name, mime, bytes) = PurchaseOrderRepository::read_file(&conn, info.id).unwrap();
        assert_eq!((name.as_str(), mime.as_str(), bytes.as_slice()), ("my order.pdf", "application/pdf", PDF));
        let list = PurchaseOrderRepository::list(&conn, PurchaseOrderFilter::default()).unwrap();
        assert_eq!(list[0].file_count, 1);
        assert!(PurchaseOrderRepository::add_file(&conn, po.order.id, "x.exe", b"MZ").is_err());
        assert!(PurchaseOrderRepository::add_file(&conn, 9999, "a.pdf", PDF).unwrap_err().contains("not found"));
        PurchaseOrderRepository::remove_file(&conn, info.id).unwrap();
        assert!(PurchaseOrderRepository::read_file(&conn, info.id).unwrap_err().contains("no longer"));
        assert!(PurchaseOrderRepository::remove_file(&conn, info.id).unwrap_err().contains("no longer"));
    }

    fn add_company_of_type(conn: &Connection, name: &str, kind: &str) -> i64 {
        conn.execute(
            "INSERT INTO customers (name, party_type, created_at, updated_at) VALUES (?1, ?2, 'x', 'x')",
            params![name, kind],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn an_order_cannot_be_raised_for_a_supplier_only_company() {
        let (_d, conn) = setup();
        let supplier = add_company_of_type(&conn, "Steel Supplier", "SUPPLIER");
        let both = add_company_of_type(&conn, "Both Co", "BOTH");
        let err = PurchaseOrderRepository::create(&conn, input(supplier, "PO-1", None)).unwrap_err();
        assert!(err.contains("supplier only"), "{}", err);
        assert!(PurchaseOrderRepository::create(&conn, input(both, "PO-2", None)).is_ok());
    }
}
