use super::models::{
    DuplicateQuotationCheck, LinkedOrder, Quotation, QuotationDetail, QuotationFileInfo, QuotationFilter, QuotationInput,
    QuotationListItem,
};
use crate::attachments::{clean_file_name, validate_file};
use crate::customers::models::PartyRole;
use crate::customers::repository::CustomerRepository;
use crate::util::normalize_date;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

const FILE_GONE: &str = "That file is no longer there.";
const NOT_FOUND: &str = "Quotation not found.";

pub struct QuotationRepository;

impl QuotationRepository {
    /// Validate an input and return the cleaned number, date and note.
    fn clean_input(conn: &Connection, input: &QuotationInput) -> Result<(String, String, Option<String>), String> {
        let number = input.quotation_number.trim().to_string();
        if number.is_empty() {
            return Err("Quotation number is required.".to_string());
        }
        let date = input.quotation_date.trim();
        if date.is_empty() {
            return Err("Quotation date is required.".to_string());
        }
        let date = normalize_date(date, "Quotation date")?;
        let customer: i64 = conn
            .query_row("SELECT COUNT(*) FROM customers WHERE id = ?1", params![input.customer_id], |r| r.get(0))
            .map_err(|e| format!("Failed to check the customer: {}", e))?;
        if customer == 0 {
            return Err("Customer not found.".to_string());
        }
        CustomerRepository::require_party(conn, input.customer_id, PartyRole::Customer)?;
        let notes = input.notes.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);
        Ok((number, date, notes))
    }

    fn linked_count(conn: &Connection, id: i64) -> Result<i64, String> {
        conn.query_row("SELECT COUNT(*) FROM purchase_orders WHERE quotation_id = ?1", params![id], |r| r.get(0))
            .map_err(|e| format!("Failed to check linked purchase orders: {}", e))
    }

    fn exists(conn: &Connection, id: i64) -> Result<bool, String> {
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM quotations WHERE id = ?1", params![id], |r| r.get(0))
            .map_err(|e| format!("Failed to load the quotation: {}", e))?;
        Ok(n > 0)
    }

    /// Warn when any customer already has a quotation with this number (not case sensitive).
    /// Quotation numbers are the owner's own series, so the check spans all customers. It is only a
    /// warning: a revised quotation may be sent again under the same number.
    pub fn check_duplicate(
        conn: &Connection,
        quotation_number: &str,
        exclude_id: Option<i64>,
    ) -> Result<DuplicateQuotationCheck, String> {
        let number = quotation_number.trim();
        let none = DuplicateQuotationCheck { has_duplicate: false, existing_id: None, existing_customer_name: None };
        if number.is_empty() {
            return Ok(none);
        }
        let existing: Option<(i64, String)> = conn
            .query_row(
                "SELECT q.id, c.name FROM quotations q JOIN customers c ON c.id = q.customer_id
                 WHERE q.quotation_number = ?1 COLLATE NOCASE AND q.id != ?2 ORDER BY q.id LIMIT 1",
                params![number, exclude_id.unwrap_or(-1)],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Error checking duplicate quotation number: {}", e))?;
        Ok(match existing {
            Some((id, name)) => {
                DuplicateQuotationCheck { has_duplicate: true, existing_id: Some(id), existing_customer_name: Some(name) }
            }
            None => none,
        })
    }

    /// Attach orders when saving. An order already on a different quotation is refused, so one never
    /// moves silently; one already on this quotation is left alone.
    fn attach_orders(conn: &Connection, quotation_id: i64, order_ids: &[i64]) -> Result<(), String> {
        for order_id in order_ids {
            let row: Option<(String, Option<i64>)> = conn
                .query_row(
                    "SELECT po_number, quotation_id FROM purchase_orders WHERE id = ?1",
                    params![order_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(|e| format!("Failed to load the purchase order: {}", e))?;
            let (number, current) = row.ok_or_else(|| "Purchase order not found.".to_string())?;
            match current {
                Some(other) if other != quotation_id => {
                    return Err(format!("Purchase order {} is already linked to another quotation.", number));
                }
                Some(_) => {}
                None => Self::set_purchase_order_link(conn, *order_id, Some(quotation_id))?,
            }
        }
        Ok(())
    }

    pub fn create(conn: &Connection, input: QuotationInput) -> Result<QuotationDetail, String> {
        let (number, date, notes) = Self::clean_input(conn, &input)?;
        let now = Utc::now().to_rfc3339();
        let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin transaction: {}", e))?;
        tx.execute(
            "INSERT INTO quotations (customer_id, quotation_number, quotation_date, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![input.customer_id, number, date, notes, now],
        )
        .map_err(|e| format!("Failed to save the quotation: {}", e))?;
        let id = tx.last_insert_rowid();
        // Any error here drops the transaction, which rolls the whole save back.
        Self::attach_orders(&tx, id, &input.purchase_order_ids)?;
        tx.commit().map_err(|e| format!("Failed to save the quotation: {}", e))?;
        Self::get(conn, id)?.ok_or_else(|| "Saved quotation could not be reloaded.".to_string())
    }

    pub fn update(conn: &Connection, id: i64, input: QuotationInput) -> Result<QuotationDetail, String> {
        let current: i64 = conn
            .query_row("SELECT customer_id FROM quotations WHERE id = ?1", params![id], |r| r.get(0))
            .optional()
            .map_err(|e| format!("Failed to load the quotation: {}", e))?
            .ok_or_else(|| NOT_FOUND.to_string())?;
        let (number, date, notes) = Self::clean_input(conn, &input)?;
        if current != input.customer_id && Self::linked_count(conn, id)? > 0 {
            return Err("Unlink this quotation's purchase orders before changing its customer.".to_string());
        }
        let now = Utc::now().to_rfc3339();
        let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin transaction: {}", e))?;
        tx.execute(
            "UPDATE quotations SET customer_id = ?1, quotation_number = ?2, quotation_date = ?3, notes = ?4, updated_at = ?5
             WHERE id = ?6",
            params![input.customer_id, number, date, notes, now, id],
        )
        .map_err(|e| format!("Failed to save the quotation: {}", e))?;
        Self::attach_orders(&tx, id, &input.purchase_order_ids)?;
        tx.commit().map_err(|e| format!("Failed to save the quotation: {}", e))?;
        Self::get(conn, id)?.ok_or_else(|| "Saved quotation could not be reloaded.".to_string())
    }

    pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
        if !Self::exists(conn, id)? {
            return Err(NOT_FOUND.to_string());
        }
        let linked = Self::linked_count(conn, id)?;
        if linked > 0 {
            return Err(format!("This quotation has {} linked purchase order(s). Unlink them first.", linked));
        }
        conn.execute("DELETE FROM quotations WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete the quotation: {}", e))?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: i64) -> Result<Option<QuotationDetail>, String> {
        let quotation = conn
            .query_row(
                "SELECT q.id, q.customer_id, c.name, q.quotation_number, q.quotation_date, q.notes, q.created_at, q.updated_at
                 FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?1",
                params![id],
                |r| {
                    Ok(Quotation {
                        id: r.get(0)?,
                        customer_id: r.get(1)?,
                        customer_name: r.get(2)?,
                        quotation_number: r.get(3)?,
                        quotation_date: r.get(4)?,
                        notes: r.get(5)?,
                        created_at: r.get(6)?,
                        updated_at: r.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to load the quotation: {}", e))?;
        let Some(quotation) = quotation else { return Ok(None) };

        // The file contents are never read here, only their names and sizes.
        let mut stmt = conn
            .prepare("SELECT id, file_name, mime_type, size_bytes FROM quotation_files WHERE quotation_id = ?1 ORDER BY id")
            .map_err(|e| format!("Failed to load files: {}", e))?;
        let files = stmt
            .query_map(params![id], |r| {
                Ok(QuotationFileInfo { id: r.get(0)?, file_name: r.get(1)?, mime_type: r.get(2)?, size_bytes: r.get(3)? })
            })
            .map_err(|e| format!("Failed to load files: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read files: {}", e))?;

        let orders = Self::order_rows(conn, "po.quotation_id = ?1", id)?;
        Ok(Some(QuotationDetail { quotation, files, orders }))
    }

    pub fn list(conn: &Connection, filter: QuotationFilter) -> Result<Vec<QuotationListItem>, String> {
        let mut query = String::from(
            "SELECT q.id, q.customer_id, c.name, q.quotation_number, q.quotation_date,
                    (SELECT COUNT(*) FROM quotation_files f WHERE f.quotation_id = q.id),
                    (SELECT COUNT(*) FROM purchase_orders po WHERE po.quotation_id = q.id)
             FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(text) = filter.query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            query.push_str(" AND (q.quotation_number LIKE ? OR c.name LIKE ?)");
            let pattern = format!("%{}%", text);
            args.push(Box::new(pattern.clone()));
            args.push(Box::new(pattern));
        }
        if let Some(cid) = filter.customer_id {
            query.push_str(" AND q.customer_id = ?");
            args.push(Box::new(cid));
        }
        query.push_str(" ORDER BY q.quotation_date DESC, q.id DESC");

        let mut stmt = conn.prepare(&query).map_err(|e| format!("Failed to load quotations: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(args.iter()), |r| {
                Ok(QuotationListItem {
                    id: r.get(0)?,
                    customer_id: r.get(1)?,
                    customer_name: r.get(2)?,
                    quotation_number: r.get(3)?,
                    quotation_date: r.get(4)?,
                    file_count: r.get(5)?,
                    order_count: r.get(6)?,
                })
            })
            .map_err(|e| format!("Failed to load quotations: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read quotations: {}", e))
    }

    /// Purchase orders matching `where_sql` (one `?1` parameter), with how many invoices each has.
    fn order_rows(conn: &Connection, where_sql: &str, arg: i64) -> Result<Vec<LinkedOrder>, String> {
        let sql = format!(
            "SELECT po.id, po.po_number, po.po_date, po.status,
                    (SELECT COUNT(*) FROM invoices i WHERE i.purchase_order_id = po.id)
             FROM purchase_orders po WHERE {}
             ORDER BY COALESCE(po.po_date, substr(po.created_at, 1, 10)) DESC, po.id DESC",
            where_sql
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| format!("Failed to load purchase orders: {}", e))?;
        let rows = stmt
            .query_map(params![arg], |r| {
                Ok(LinkedOrder {
                    id: r.get(0)?,
                    po_number: r.get(1)?,
                    po_date: r.get(2)?,
                    status: r.get(3)?,
                    invoice_count: r.get(4)?,
                })
            })
            .map_err(|e| format!("Failed to load purchase orders: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read purchase orders: {}", e))
    }

    /// The customer's purchase orders that have no quotation yet, of every status.
    pub fn unlinked_orders_for_customer(conn: &Connection, customer_id: i64) -> Result<Vec<LinkedOrder>, String> {
        Self::order_rows(conn, "po.customer_id = ?1 AND po.quotation_id IS NULL", customer_id)
    }

    /// Link a purchase order to a quotation (or unlink with `None`). The quotation must belong to the
    /// order's customer. Nothing printed changes; this is a reference only.
    pub fn set_purchase_order_link(
        conn: &Connection,
        purchase_order_id: i64,
        quotation_id: Option<i64>,
    ) -> Result<(), String> {
        let order_customer: i64 = conn
            .query_row("SELECT customer_id FROM purchase_orders WHERE id = ?1", params![purchase_order_id], |r| r.get(0))
            .optional()
            .map_err(|e| format!("Failed to load the purchase order: {}", e))?
            .ok_or_else(|| "Purchase order not found.".to_string())?;
        let now = Utc::now().to_rfc3339();

        if let Some(q) = quotation_id {
            let quotation_customer: i64 = conn
                .query_row("SELECT customer_id FROM quotations WHERE id = ?1", params![q], |r| r.get(0))
                .optional()
                .map_err(|e| format!("Failed to load the quotation: {}", e))?
                .ok_or_else(|| NOT_FOUND.to_string())?;
            if quotation_customer != order_customer {
                return Err("This purchase order belongs to a different customer.".to_string());
            }
        }
        conn.execute(
            "UPDATE purchase_orders SET quotation_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![quotation_id, now, purchase_order_id],
        )
        .map_err(|e| format!("Failed to link the purchase order: {}", e))?;
        Ok(())
    }

    pub fn add_file(
        conn: &Connection,
        quotation_id: i64,
        file_name: &str,
        bytes: &[u8],
    ) -> Result<QuotationFileInfo, String> {
        if !Self::exists(conn, quotation_id)? {
            return Err(NOT_FOUND.to_string());
        }
        let mime = validate_file(file_name, bytes)?;
        let name = clean_file_name(file_name);
        conn.execute(
            "INSERT INTO quotation_files (quotation_id, file_name, mime_type, size_bytes, data, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![quotation_id, name, mime, bytes.len() as i64, bytes, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Failed to save the file: {}", e))?;
        Ok(QuotationFileInfo {
            id: conn.last_insert_rowid(),
            file_name: name,
            mime_type: mime.to_string(),
            size_bytes: bytes.len() as i64,
        })
    }

    pub fn remove_file(conn: &Connection, file_id: i64) -> Result<(), String> {
        let removed = conn
            .execute("DELETE FROM quotation_files WHERE id = ?1", params![file_id])
            .map_err(|e| format!("Failed to remove the file: {}", e))?;
        if removed == 0 {
            return Err(FILE_GONE.to_string());
        }
        Ok(())
    }

    /// File name, MIME type and contents of one attached file.
    pub fn read_file(conn: &Connection, file_id: i64) -> Result<(String, String, Vec<u8>), String> {
        conn.query_row(
            "SELECT file_name, mime_type, data FROM quotation_files WHERE id = ?1",
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
    use crate::quotations::models::*;
    use rusqlite::{params, Connection};

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("t.db")).unwrap();
        let conn = db.get_connection().unwrap();
        (dir, conn)
    }

    fn add_customer(conn: &Connection, name: &str) -> i64 {
        conn.execute("INSERT INTO customers (name, created_at, updated_at) VALUES (?1, 'x', 'x')", params![name]).unwrap();
        conn.last_insert_rowid()
    }

    fn add_order(conn: &Connection, customer_id: i64, number: &str, status: &str) -> i64 {
        conn.execute(
            "INSERT INTO purchase_orders (customer_id, po_number, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'x', 'x')",
            params![customer_id, number, status],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn add_invoice_on_order(conn: &Connection, customer_id: i64, order_id: i64) {
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, customer_name, status, total_amount, amount_in_words, purchase_order_id, created_at, updated_at)
             VALUES ('I-1', '2026-10-01', ?1, 'Sample', 'ISSUED', 1000.0, 'x', ?2, 'x', 'x')",
            params![customer_id, order_id],
        )
        .unwrap();
    }

    fn order_quotation(conn: &Connection, order_id: i64) -> Option<i64> {
        conn.query_row("SELECT quotation_id FROM purchase_orders WHERE id = ?1", params![order_id], |r| r.get(0)).unwrap()
    }

    fn quotation_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM quotations", [], |r| r.get(0)).unwrap()
    }

    fn input(customer_id: i64, number: &str, date: &str) -> QuotationInput {
        QuotationInput {
            customer_id,
            quotation_number: number.to_string(),
            quotation_date: date.to_string(),
            notes: None,
            purchase_order_ids: vec![],
        }
    }

    const PDF: &[u8] = b"%PDF-1.4 sample";

    #[test]
    fn create_requires_number_date_and_a_known_customer() {
        let (_d, conn) = setup();
        let c = add_customer(&conn, "A");
        assert_eq!(
            QuotationRepository::create(&conn, input(c, "   ", "2026-10-01")).unwrap_err(),
            "Quotation number is required."
        );
        assert_eq!(
            QuotationRepository::create(&conn, input(c, "Q-1", "  ")).unwrap_err(),
            "Quotation date is required."
        );
        assert!(QuotationRepository::create(&conn, input(c, "Q-1", "not a date")).is_err());
        assert!(QuotationRepository::create(&conn, input(9999, "Q-1", "2026-10-01")).unwrap_err().contains("Customer"));
        assert_eq!(quotation_count(&conn), 0);

        let mut padded = input(c, " Q-1 ", "05-10-2026");
        padded.notes = Some("   ".to_string());
        let ok = QuotationRepository::create(&conn, padded).unwrap();
        assert_eq!(ok.quotation.quotation_number, "Q-1");
        assert_eq!(ok.quotation.quotation_date, "2026-10-05");
        assert_eq!(ok.quotation.notes, None, "a note of only spaces is no note");
        assert_eq!(ok.quotation.customer_name, "A");
    }

    #[test]
    fn duplicate_check_ignores_case_and_spaces_and_spans_customers_but_only_warns() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let b = add_customer(&conn, "B");
        let first = QuotationRepository::create(&conn, input(a, "Q-14", "2026-10-01")).unwrap();
        let id = first.quotation.id;

        let dup = QuotationRepository::check_duplicate(&conn, " q-14 ", None).unwrap();
        assert!(dup.has_duplicate);
        assert_eq!(dup.existing_id, Some(id));
        assert_eq!(dup.existing_customer_name.as_deref(), Some("A"));
        assert!(!QuotationRepository::check_duplicate(&conn, "Q-14", Some(id)).unwrap().has_duplicate, "not against itself");
        assert!(!QuotationRepository::check_duplicate(&conn, "   ", None).unwrap().has_duplicate);
        assert!(!QuotationRepository::check_duplicate(&conn, "Q-15", None).unwrap().has_duplicate);

        // Another customer reusing the number is saved all the same: it is only a warning.
        let second = QuotationRepository::create(&conn, input(b, "Q-14", "2026-10-02")).unwrap();
        let dup = QuotationRepository::check_duplicate(&conn, "Q-14", Some(second.quotation.id)).unwrap();
        assert_eq!(dup.existing_id, Some(id));
    }

    #[test]
    fn one_quotation_can_have_many_orders_and_an_order_has_one_quotation() {
        let (_d, conn) = setup();
        let c = add_customer(&conn, "A");
        let o1 = add_order(&conn, c, "PO-1", "NOT_STARTED");
        let o2 = add_order(&conn, c, "PO-2", "COMPLETED");
        add_invoice_on_order(&conn, c, o1);

        let mut inp = input(c, "Q-1", "2026-10-01");
        inp.purchase_order_ids = vec![o1, o2];
        let saved = QuotationRepository::create(&conn, inp).unwrap();
        let q = saved.quotation.id;
        assert_eq!(saved.orders.len(), 2);
        let by_number = |n: &str| saved.orders.iter().find(|o| o.po_number == n).unwrap().clone();
        assert_eq!(by_number("PO-1").invoice_count, 1);
        assert_eq!(by_number("PO-2").invoice_count, 0);
        assert_eq!(by_number("PO-2").status, "COMPLETED");
        assert_eq!(order_quotation(&conn, o1), Some(q));
        assert_eq!(order_quotation(&conn, o2), Some(q));

        QuotationRepository::add_file(&conn, q, "sent.pdf", PDF).unwrap();
        let list = QuotationRepository::list(&conn, QuotationFilter::default()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].order_count, list[0].file_count), (2, 1));

        // Saving again with an order that is already on this quotation is fine.
        let mut again = input(c, "Q-1", "2026-10-01");
        again.purchase_order_ids = vec![o1];
        assert!(QuotationRepository::update(&conn, q, again).is_ok());
        assert_eq!(QuotationRepository::get(&conn, q).unwrap().unwrap().orders.len(), 2);
    }

    #[test]
    fn list_searches_number_and_company_and_filters_by_customer() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "Sri Ganesh Traders");
        let b = add_customer(&conn, "Other Co");
        QuotationRepository::create(&conn, input(a, "Q-100", "2026-10-01")).unwrap();
        QuotationRepository::create(&conn, input(b, "Q-200", "2026-10-05")).unwrap();
        let q = |text: &str| QuotationFilter { query: Some(text.to_string()), customer_id: None };
        assert_eq!(QuotationRepository::list(&conn, q("100")).unwrap().len(), 1);
        assert_eq!(QuotationRepository::list(&conn, q("ganesh")).unwrap().len(), 1);
        let by_customer = QuotationFilter { query: None, customer_id: Some(b) };
        assert_eq!(QuotationRepository::list(&conn, by_customer).unwrap()[0].quotation_number, "Q-200");
        let all = QuotationRepository::list(&conn, QuotationFilter::default()).unwrap();
        assert_eq!(all[0].quotation_number, "Q-200", "newest first");
    }

    #[test]
    fn attaching_an_order_of_another_customer_is_refused_and_nothing_is_saved() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let b = add_customer(&conn, "B");
        let mine = add_order(&conn, a, "PO-A", "NOT_STARTED");
        let theirs = add_order(&conn, b, "PO-B", "NOT_STARTED");
        let mut inp = input(a, "Q-1", "2026-10-01");
        inp.purchase_order_ids = vec![mine, theirs];
        let err = QuotationRepository::create(&conn, inp).unwrap_err();
        assert!(err.contains("different customer"), "{}", err);
        assert_eq!(quotation_count(&conn), 0, "no half-saved quotation is left behind");
        assert_eq!(order_quotation(&conn, mine), None, "the good order was not linked either");
    }

    #[test]
    fn attaching_an_order_that_has_another_quotation_is_refused() {
        let (_d, conn) = setup();
        let c = add_customer(&conn, "A");
        let order = add_order(&conn, c, "PO-1", "NOT_STARTED");
        let mut first = input(c, "Q-1", "2026-10-01");
        first.purchase_order_ids = vec![order];
        let first = QuotationRepository::create(&conn, first).unwrap();

        let mut second = input(c, "Q-2", "2026-10-02");
        second.purchase_order_ids = vec![order];
        let err = QuotationRepository::create(&conn, second).unwrap_err();
        assert_eq!(err, "Purchase order PO-1 is already linked to another quotation.");
        assert_eq!(quotation_count(&conn), 1);
        assert_eq!(order_quotation(&conn, order), Some(first.quotation.id));
    }

    #[test]
    fn the_attach_list_only_offers_orders_without_a_quotation_of_that_customer() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let b = add_customer(&conn, "B");
        let free_new = add_order(&conn, a, "PO-NEW", "NOT_STARTED");
        let free_done = add_order(&conn, a, "PO-DONE", "COMPLETED");
        let taken = add_order(&conn, a, "PO-TAKEN", "NOT_STARTED");
        add_order(&conn, b, "PO-OTHER", "NOT_STARTED");
        let mut inp = input(a, "Q-1", "2026-10-01");
        inp.purchase_order_ids = vec![taken];
        QuotationRepository::create(&conn, inp).unwrap();

        let offered: Vec<i64> = QuotationRepository::unlinked_orders_for_customer(&conn, a).unwrap().iter().map(|o| o.id).collect();
        assert!(offered.contains(&free_new) && offered.contains(&free_done), "every status is offered");
        assert_eq!(offered.len(), 2);
    }

    #[test]
    fn linking_checks_both_records_exist_and_unlinking_clears() {
        let (_d, conn) = setup();
        let c = add_customer(&conn, "A");
        let order = add_order(&conn, c, "PO-1", "NOT_STARTED");
        let q = QuotationRepository::create(&conn, input(c, "Q-1", "2026-10-01")).unwrap().quotation.id;
        assert_eq!(QuotationRepository::set_purchase_order_link(&conn, 9999, Some(q)).unwrap_err(), "Purchase order not found.");
        assert_eq!(QuotationRepository::set_purchase_order_link(&conn, order, Some(9999)).unwrap_err(), "Quotation not found.");
        QuotationRepository::set_purchase_order_link(&conn, order, Some(q)).unwrap();
        assert_eq!(order_quotation(&conn, order), Some(q));
        QuotationRepository::set_purchase_order_link(&conn, order, None).unwrap();
        assert_eq!(order_quotation(&conn, order), None);
    }

    #[test]
    fn customer_cannot_change_while_orders_are_linked() {
        let (_d, conn) = setup();
        let a = add_customer(&conn, "A");
        let b = add_customer(&conn, "B");
        let order = add_order(&conn, a, "PO-1", "NOT_STARTED");
        let mut inp = input(a, "Q-1", "2026-10-01");
        inp.purchase_order_ids = vec![order];
        let q = QuotationRepository::create(&conn, inp).unwrap().quotation.id;

        let err = QuotationRepository::update(&conn, q, input(b, "Q-1", "2026-10-01")).unwrap_err();
        assert_eq!(err, "Unlink this quotation's purchase orders before changing its customer.");
        QuotationRepository::set_purchase_order_link(&conn, order, None).unwrap();
        let moved = QuotationRepository::update(&conn, q, input(b, "Q-1", "2026-10-01")).unwrap();
        assert_eq!(moved.quotation.customer_name, "B");
    }

    #[test]
    fn delete_is_blocked_while_orders_are_linked_and_removes_files_otherwise() {
        let (_d, conn) = setup();
        let c = add_customer(&conn, "A");
        let order = add_order(&conn, c, "PO-1", "NOT_STARTED");
        let mut inp = input(c, "Q-1", "2026-10-01");
        inp.purchase_order_ids = vec![order];
        let q = QuotationRepository::create(&conn, inp).unwrap().quotation.id;
        QuotationRepository::add_file(&conn, q, "sent.pdf", PDF).unwrap();

        assert_eq!(
            QuotationRepository::delete(&conn, q).unwrap_err(),
            "This quotation has 1 linked purchase order(s). Unlink them first."
        );
        QuotationRepository::set_purchase_order_link(&conn, order, None).unwrap();
        QuotationRepository::delete(&conn, q).unwrap();
        let files: i64 = conn.query_row("SELECT COUNT(*) FROM quotation_files", [], |r| r.get(0)).unwrap();
        assert_eq!(files, 0, "files go with the quotation");

        // The quotation is gone: a stale screen gets plain answers, not a crash.
        assert_eq!(QuotationRepository::delete(&conn, q).unwrap_err(), "Quotation not found.");
        assert!(QuotationRepository::get(&conn, q).unwrap().is_none());
        assert_eq!(QuotationRepository::update(&conn, q, input(c, "Q-1", "2026-10-01")).unwrap_err(), "Quotation not found.");
    }

    #[test]
    fn files_follow_the_shared_rules() {
        let (_d, conn) = setup();
        let c = add_customer(&conn, "A");
        let q = QuotationRepository::create(&conn, input(c, "Q-1", "2026-10-01")).unwrap().quotation.id;

        let info = QuotationRepository::add_file(&conn, q, "..\\sent.pdf", PDF).unwrap();
        assert_eq!(info.file_name, "sent.pdf");
        assert_eq!(info.mime_type, "application/pdf");
        assert_eq!(QuotationRepository::get(&conn, q).unwrap().unwrap().files.len(), 1);
        let (name, mime, bytes) = QuotationRepository::read_file(&conn, info.id).unwrap();
        assert_eq!((name.as_str(), mime.as_str(), bytes.as_slice()), ("sent.pdf", "application/pdf", PDF));

        assert!(QuotationRepository::add_file(&conn, q, "fake.pdf", b"just text").is_err());
        assert_eq!(QuotationRepository::add_file(&conn, 9999, "a.pdf", PDF).unwrap_err(), "Quotation not found.");

        QuotationRepository::remove_file(&conn, info.id).unwrap();
        assert_eq!(QuotationRepository::remove_file(&conn, info.id).unwrap_err(), "That file is no longer there.");
        assert_eq!(QuotationRepository::read_file(&conn, info.id).unwrap_err(), "That file is no longer there.");
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
    fn a_quotation_cannot_be_raised_for_a_supplier_only_company() {
        let (_d, conn) = setup();
        let supplier = add_company_of_type(&conn, "Steel Supplier", "SUPPLIER");
        let both = add_company_of_type(&conn, "Both Co", "BOTH");
        let err = QuotationRepository::create(&conn, input(supplier, "Q-1", "2026-10-01")).unwrap_err();
        assert!(err.contains("supplier only"), "{}", err);
        assert!(QuotationRepository::create(&conn, input(both, "Q-2", "2026-10-01")).is_ok());
    }
}
