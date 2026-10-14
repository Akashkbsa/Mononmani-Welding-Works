use super::models::{
    BillPayment, DuplicateBillCheck, SupplierBill, SupplierBillDetail, SupplierBillFileInfo, SupplierBillFilter,
    SupplierBillInput, SupplierBillListItem, SupplierBillsSummary,
};
use crate::attachments::{clean_file_name, validate_file};
use crate::customers::models::PartyRole;
use crate::customers::repository::CustomerRepository;
use crate::util::{normalize_date, round2, rupees, MONEY_EPS};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

const FILE_GONE: &str = "That file is no longer there.";
const NOT_FOUND: &str = "Bill not found.";

/// What the payments allocated to a bill add up to.
const SETTLED_SQL: &str =
    "COALESCE((SELECT SUM(a.amount_allocated) FROM supplier_payment_allocations a WHERE a.bill_id = b.id), 0.0)";

pub struct SupplierBillRepository;

impl SupplierBillRepository {
    /// "NOT_PAID", "PARTIAL" or "PAID" for a bill of `total` with `settled` allocated to it.
    /// Less than half a paisa short counts as paid.
    pub fn status_for(total: f64, settled: f64) -> &'static str {
        if settled <= MONEY_EPS {
            "NOT_PAID"
        } else if total - settled <= MONEY_EPS {
            "PAID"
        } else {
            "PARTIAL"
        }
    }

    /// Validate an input and return the cleaned number, date, total and note.
    fn clean_input(conn: &Connection, input: &SupplierBillInput) -> Result<(String, String, f64, Option<String>), String> {
        let number = input.bill_number.trim().to_string();
        if number.is_empty() {
            return Err("Bill number is required.".to_string());
        }
        let date = input.bill_date.trim();
        if date.is_empty() {
            return Err("Bill date is required.".to_string());
        }
        let date = normalize_date(date, "Bill date")?;
        let total = round2(input.total_amount);
        if !(total > 0.0) {
            return Err("Bill total must be more than zero.".to_string());
        }
        CustomerRepository::require_party(conn, input.supplier_id, PartyRole::Supplier)?;
        let notes = input.notes.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);
        Ok((number, date, total, notes))
    }

    fn settled(conn: &Connection, bill_id: i64) -> Result<f64, String> {
        conn.query_row(
            "SELECT COALESCE(SUM(amount_allocated), 0.0) FROM supplier_payment_allocations WHERE bill_id = ?1",
            params![bill_id],
            |r| r.get::<_, f64>(0),
        )
        .map(round2)
        .map_err(|e| format!("Failed to check the bill's payments: {}", e))
    }

    fn payment_count(conn: &Connection, bill_id: i64) -> Result<i64, String> {
        conn.query_row(
            "SELECT COUNT(*) FROM supplier_payment_allocations WHERE bill_id = ?1",
            params![bill_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check the bill's payments: {}", e))
    }

    fn exists(conn: &Connection, id: i64) -> Result<bool, String> {
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM supplier_bills WHERE id = ?1", params![id], |r| r.get(0))
            .map_err(|e| format!("Failed to load the bill: {}", e))?;
        Ok(n > 0)
    }

    /// Warn when this supplier already has a bill with this number (not case sensitive). Bill numbers
    /// are the supplier's own series, so another supplier may use the same one. Only a warning.
    pub fn check_duplicate(
        conn: &Connection,
        supplier_id: i64,
        bill_number: &str,
        exclude_id: Option<i64>,
    ) -> Result<DuplicateBillCheck, String> {
        let number = bill_number.trim();
        if number.is_empty() {
            return Ok(DuplicateBillCheck { has_duplicate: false, existing_id: None });
        }
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM supplier_bills WHERE supplier_id = ?1 AND bill_number = ?2 COLLATE NOCASE AND id != ?3
                 ORDER BY id LIMIT 1",
                params![supplier_id, number, exclude_id.unwrap_or(-1)],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("Error checking duplicate bill number: {}", e))?;
        Ok(DuplicateBillCheck { has_duplicate: existing.is_some(), existing_id: existing })
    }

    pub fn create(conn: &Connection, input: SupplierBillInput) -> Result<SupplierBillDetail, String> {
        let (number, date, total, notes) = Self::clean_input(conn, &input)?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO supplier_bills (supplier_id, bill_number, bill_date, total_amount, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![input.supplier_id, number, date, total, notes, now],
        )
        .map_err(|e| format!("Failed to save the bill: {}", e))?;
        let id = conn.last_insert_rowid();
        Self::get(conn, id)?.ok_or_else(|| "Saved bill could not be reloaded.".to_string())
    }

    pub fn update(conn: &Connection, id: i64, input: SupplierBillInput) -> Result<SupplierBillDetail, String> {
        let stored_supplier: i64 = conn
            .query_row("SELECT supplier_id FROM supplier_bills WHERE id = ?1", params![id], |r| r.get(0))
            .optional()
            .map_err(|e| format!("Failed to load the bill: {}", e))?
            .ok_or_else(|| NOT_FOUND.to_string())?;
        let (number, date, total, notes) = Self::clean_input(conn, &input)?;
        if Self::payment_count(conn, id)? > 0 {
            if stored_supplier != input.supplier_id {
                return Err("The supplier can't be changed once payments are recorded against this bill.".to_string());
            }
            let settled = Self::settled(conn, id)?;
            if total + MONEY_EPS < settled {
                return Err(format!("The total can't be less than {} already settled on this bill.", rupees(settled)));
            }
        }
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE supplier_bills SET supplier_id = ?1, bill_number = ?2, bill_date = ?3, total_amount = ?4, notes = ?5,
                    updated_at = ?6 WHERE id = ?7",
            params![input.supplier_id, number, date, total, notes, now, id],
        )
        .map_err(|e| format!("Failed to save the bill: {}", e))?;
        Self::get(conn, id)?.ok_or_else(|| "Saved bill could not be reloaded.".to_string())
    }

    pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
        if !Self::exists(conn, id)? {
            return Err(NOT_FOUND.to_string());
        }
        let payments = Self::payment_count(conn, id)?;
        if payments > 0 {
            return Err(format!("This bill has {} payment(s). Remove or edit them first.", payments));
        }
        conn.execute("DELETE FROM supplier_bills WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete the bill: {}", e))?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: i64) -> Result<Option<SupplierBillDetail>, String> {
        let bill = conn
            .query_row(
                "SELECT b.id, b.supplier_id, c.name, b.bill_number, b.bill_date, b.total_amount, b.notes, b.created_at, b.updated_at
                 FROM supplier_bills b JOIN customers c ON c.id = b.supplier_id WHERE b.id = ?1",
                params![id],
                |r| {
                    Ok(SupplierBill {
                        id: r.get(0)?,
                        supplier_id: r.get(1)?,
                        supplier_name: r.get(2)?,
                        bill_number: r.get(3)?,
                        bill_date: r.get(4)?,
                        total_amount: r.get(5)?,
                        notes: r.get(6)?,
                        created_at: r.get(7)?,
                        updated_at: r.get(8)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to load the bill: {}", e))?;
        let Some(bill) = bill else { return Ok(None) };

        // The file contents are never read here, only their names and sizes.
        let mut stmt = conn
            .prepare("SELECT id, file_name, mime_type, size_bytes FROM supplier_bill_files WHERE bill_id = ?1 ORDER BY id")
            .map_err(|e| format!("Failed to load files: {}", e))?;
        let files = stmt
            .query_map(params![id], |r| {
                Ok(SupplierBillFileInfo { id: r.get(0)?, file_name: r.get(1)?, mime_type: r.get(2)?, size_bytes: r.get(3)? })
            })
            .map_err(|e| format!("Failed to load files: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read files: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.payment_number, p.payment_date, p.payment_method, p.reference_number, a.amount_allocated
                 FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id
                 WHERE a.bill_id = ?1 ORDER BY p.payment_date ASC, a.id ASC",
            )
            .map_err(|e| format!("Failed to load payments: {}", e))?;
        let payments = stmt
            .query_map(params![id], |r| {
                Ok(BillPayment {
                    payment_id: r.get(0)?,
                    payment_number: r.get(1)?,
                    payment_date: r.get(2)?,
                    payment_method: r.get(3)?,
                    reference_number: r.get(4)?,
                    amount_settled: r.get(5)?,
                })
            })
            .map_err(|e| format!("Failed to load payments: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read payments: {}", e))?;

        let settled = round2(payments.iter().map(|p| p.amount_settled).sum());
        let outstanding_amount = round2(bill.total_amount - settled).max(0.0);
        let status = Self::status_for(bill.total_amount, settled).to_string();
        Ok(Some(SupplierBillDetail { bill, settled_amount: settled, outstanding_amount, status, files, payments }))
    }

    pub fn list(conn: &Connection, filter: SupplierBillFilter) -> Result<Vec<SupplierBillListItem>, String> {
        let mut query = format!(
            "SELECT b.id, b.supplier_id, c.name, b.bill_number, b.bill_date, b.total_amount, {},
                    (SELECT COUNT(*) FROM supplier_bill_files f WHERE f.bill_id = b.id)
             FROM supplier_bills b JOIN customers c ON c.id = b.supplier_id WHERE 1=1",
            SETTLED_SQL
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(text) = filter.query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            query.push_str(" AND (b.bill_number LIKE ? OR c.name LIKE ?)");
            let pattern = format!("%{}%", text);
            args.push(Box::new(pattern.clone()));
            args.push(Box::new(pattern));
        }
        if let Some(sid) = filter.supplier_id {
            query.push_str(" AND b.supplier_id = ?");
            args.push(Box::new(sid));
        }
        query.push_str(" ORDER BY b.bill_date DESC, b.id DESC");

        let mut stmt = conn.prepare(&query).map_err(|e| format!("Failed to load bills: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(args.iter()), |r| {
                let total: f64 = r.get(5)?;
                let settled = round2(r.get::<_, f64>(6)?);
                Ok(SupplierBillListItem {
                    id: r.get(0)?,
                    supplier_id: r.get(1)?,
                    supplier_name: r.get(2)?,
                    bill_number: r.get(3)?,
                    bill_date: r.get(4)?,
                    total_amount: total,
                    settled_amount: settled,
                    outstanding_amount: round2(total - settled).max(0.0),
                    status: Self::status_for(total, settled).to_string(),
                    file_count: r.get(7)?,
                })
            })
            .map_err(|e| format!("Failed to load bills: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read bills: {}", e))?;

        let wanted = filter.status.as_deref().map(|s| s.trim().to_uppercase()).filter(|s| !s.is_empty() && s != "ALL");
        Ok(match wanted {
            Some(status) => rows.into_iter().filter(|b| b.status == status).collect(),
            None => rows,
        })
    }

    /// What is still owed across all bills, how many bills are still open, and the advances held.
    pub fn summary(conn: &Connection) -> Result<SupplierBillsSummary, String> {
        let mut stmt = conn
            .prepare(&format!("SELECT b.total_amount, {} FROM supplier_bills b", SETTLED_SQL))
            .map_err(|e| format!("Failed to total the bills: {}", e))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)))
            .map_err(|e| format!("Failed to total the bills: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to total the bills: {}", e))?;
        let mut total_outstanding = 0.0;
        let mut open_bills_count = 0;
        for (total, settled) in rows {
            let outstanding = round2(total - settled);
            if outstanding > MONEY_EPS {
                total_outstanding += outstanding;
                open_bills_count += 1;
            }
        }
        let advances: f64 = conn
            .query_row("SELECT COALESCE(SUM(remaining_amount), 0.0) FROM supplier_credits", [], |r| r.get(0))
            .map_err(|e| format!("Failed to total the advances: {}", e))?;
        Ok(SupplierBillsSummary {
            total_outstanding: round2(total_outstanding),
            open_bills_count,
            advances_held: round2(advances),
        })
    }

    pub fn add_file(conn: &Connection, bill_id: i64, file_name: &str, bytes: &[u8]) -> Result<SupplierBillFileInfo, String> {
        if !Self::exists(conn, bill_id)? {
            return Err(NOT_FOUND.to_string());
        }
        let mime = validate_file(file_name, bytes)?;
        let name = clean_file_name(file_name);
        conn.execute(
            "INSERT INTO supplier_bill_files (bill_id, file_name, mime_type, size_bytes, data, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![bill_id, name, mime, bytes.len() as i64, bytes, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Failed to save the file: {}", e))?;
        Ok(SupplierBillFileInfo {
            id: conn.last_insert_rowid(),
            file_name: name,
            mime_type: mime.to_string(),
            size_bytes: bytes.len() as i64,
        })
    }

    pub fn remove_file(conn: &Connection, file_id: i64) -> Result<(), String> {
        let removed = conn
            .execute("DELETE FROM supplier_bill_files WHERE id = ?1", params![file_id])
            .map_err(|e| format!("Failed to remove the file: {}", e))?;
        if removed == 0 {
            return Err(FILE_GONE.to_string());
        }
        Ok(())
    }

    /// File name, MIME type and contents of one attached file.
    pub fn read_file(conn: &Connection, file_id: i64) -> Result<(String, String, Vec<u8>), String> {
        conn.query_row(
            "SELECT file_name, mime_type, data FROM supplier_bill_files WHERE id = ?1",
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
    use crate::customers::models::CustomerCreateInput;
    use crate::customers::repository::CustomerRepository;
    use crate::db::DatabaseManager;
    use crate::supplier_bills::models::*;
    use rusqlite::{params, Connection};

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("t.db")).unwrap();
        let conn = db.get_connection().unwrap();
        (dir, conn)
    }

    fn company(conn: &Connection, name: &str, party: &str) -> i64 {
        CustomerRepository::create(
            conn,
            CustomerCreateInput {
                name: name.to_string(),
                gstin: None,
                phone: None,
                email: None,
                address_line1: None,
                address_line2: None,
                city: None,
                state: None,
                postal_code: None,
                is_favorite: None,
                party_type: Some(party.to_string()),
            },
        )
        .unwrap()
        .id
    }

    fn input(supplier_id: i64, number: &str, date: &str, total: f64) -> SupplierBillInput {
        SupplierBillInput {
            supplier_id,
            bill_number: number.to_string(),
            bill_date: date.to_string(),
            total_amount: total,
            notes: None,
        }
    }

    fn new_bill(conn: &Connection, supplier: i64, number: &str, total: f64) -> i64 {
        SupplierBillRepository::create(conn, input(supplier, number, "2026-10-01", total)).unwrap().bill.id
    }

    /// A raw supplier payment row (the payment rules arrive with the supplier payments module).
    fn payment_row(conn: &Connection, supplier: i64, number: &str) -> i64 {
        conn.execute(
            "INSERT INTO supplier_payments (payment_number, supplier_id, payment_date, created_at, updated_at)
             VALUES (?1, ?2, '2026-10-02', 'x', 'x')",
            params![number, supplier],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn allocate(conn: &Connection, payment: i64, bill: i64, amount: f64) {
        conn.execute(
            "INSERT INTO supplier_payment_allocations (payment_id, bill_id, amount_allocated, created_at) VALUES (?1, ?2, ?3, 'x')",
            params![payment, bill, amount],
        )
        .unwrap();
    }

    fn status(conn: &Connection, bill: i64) -> String {
        SupplierBillRepository::get(conn, bill).unwrap().unwrap().status
    }

    const PDF: &[u8] = b"%PDF-1.4 sample";

    #[test]
    fn create_requires_number_date_total_and_a_supplier() {
        let (_d, conn) = setup();
        let s = company(&conn, "Steel Co", "SUPPLIER");
        assert_eq!(SupplierBillRepository::create(&conn, input(s, "   ", "2026-10-01", 100.0)).unwrap_err(), "Bill number is required.");
        assert_eq!(SupplierBillRepository::create(&conn, input(s, "B-1", "  ", 100.0)).unwrap_err(), "Bill date is required.");
        assert!(SupplierBillRepository::create(&conn, input(s, "B-1", "not a date", 100.0)).is_err());
        for total in [0.0, -5.0] {
            assert_eq!(
                SupplierBillRepository::create(&conn, input(s, "B-1", "2026-10-01", total)).unwrap_err(),
                "Bill total must be more than zero."
            );
        }
        assert_eq!(SupplierBillRepository::create(&conn, input(9999, "B-1", "2026-10-01", 100.0)).unwrap_err(), "Supplier not found.");

        // A customer-only company is refused; a company that is both is fine.
        let customer = company(&conn, "Buyer Co", "CUSTOMER");
        let err = SupplierBillRepository::create(&conn, input(customer, "B-1", "2026-10-01", 100.0)).unwrap_err();
        assert!(err.contains("customer only"), "{}", err);
        let both = company(&conn, "Both Co", "BOTH");
        assert!(SupplierBillRepository::create(&conn, input(both, "B-1", "2026-10-01", 100.0)).is_ok());

        let mut padded = input(s, " B-2 ", "05-10-2026", 100.456);
        padded.notes = Some("   ".to_string());
        let saved = SupplierBillRepository::create(&conn, padded).unwrap();
        assert_eq!(saved.bill.bill_number, "B-2");
        assert_eq!(saved.bill.bill_date, "2026-10-05");
        assert_eq!(saved.bill.total_amount, 100.46);
        assert_eq!(saved.bill.notes, None);
        assert_eq!(saved.bill.supplier_name, "Steel Co");
        assert_eq!(saved.status, "NOT_PAID");
    }

    #[test]
    fn duplicate_bill_numbers_warn_for_the_same_supplier_only() {
        let (_d, conn) = setup();
        let a = company(&conn, "A Steel", "SUPPLIER");
        let b = company(&conn, "B Steel", "SUPPLIER");
        let first = new_bill(&conn, a, "B-14", 100.0);
        let dup = SupplierBillRepository::check_duplicate(&conn, a, " b-14 ", None).unwrap();
        assert!(dup.has_duplicate);
        assert_eq!(dup.existing_id, Some(first));
        assert!(!SupplierBillRepository::check_duplicate(&conn, a, "B-14", Some(first)).unwrap().has_duplicate, "not against itself");
        assert!(!SupplierBillRepository::check_duplicate(&conn, b, "B-14", None).unwrap().has_duplicate, "another supplier may reuse it");
        assert!(!SupplierBillRepository::check_duplicate(&conn, a, "   ", None).unwrap().has_duplicate);
        assert!(SupplierBillRepository::create(&conn, input(a, "B-14", "2026-10-02", 50.0)).is_ok(), "a duplicate is a warning, not an error");
    }

    #[test]
    fn status_follows_the_allocations() {
        let (_d, conn) = setup();
        let s = company(&conn, "Steel Co", "SUPPLIER");
        let bill = new_bill(&conn, s, "B-1", 1000.0);
        assert_eq!(status(&conn, bill), "NOT_PAID");
        let p1 = payment_row(&conn, s, "SP/26-27/001");
        allocate(&conn, p1, bill, 400.0);
        let part = SupplierBillRepository::get(&conn, bill).unwrap().unwrap();
        assert_eq!((part.status.as_str(), part.settled_amount, part.outstanding_amount), ("PARTIAL", 400.0, 600.0));
        let p2 = payment_row(&conn, s, "SP/26-27/002");
        allocate(&conn, p2, bill, 600.0);
        let done = SupplierBillRepository::get(&conn, bill).unwrap().unwrap();
        assert_eq!((done.status.as_str(), done.outstanding_amount), ("PAID", 0.0));

        // Under half a paisa short still counts as paid.
        let near = new_bill(&conn, s, "B-2", 11550.0);
        let p3 = payment_row(&conn, s, "SP/26-27/003");
        allocate(&conn, p3, near, 11549.996);
        assert_eq!(status(&conn, near), "PAID");
        assert_eq!(SupplierBillRepository::status_for(100.0, 99.99), "PARTIAL");
    }

    #[test]
    fn the_total_cannot_drop_below_what_is_settled() {
        let (_d, conn) = setup();
        let s = company(&conn, "Steel Co", "SUPPLIER");
        let bill = new_bill(&conn, s, "B-1", 1000.0);
        let p = payment_row(&conn, s, "SP/26-27/001");
        allocate(&conn, p, bill, 400.0);
        assert_eq!(
            SupplierBillRepository::update(&conn, bill, input(s, "B-1", "2026-10-01", 399.0)).unwrap_err(),
            "The total can't be less than ₹400.00 already settled on this bill."
        );
        assert_eq!(SupplierBillRepository::update(&conn, bill, input(s, "B-1", "2026-10-01", 400.0)).unwrap().status, "PAID");
        assert_eq!(SupplierBillRepository::update(&conn, bill, input(s, "B-1", "2026-10-01", 2000.0)).unwrap().status, "PARTIAL");
    }

    #[test]
    fn the_supplier_is_locked_once_payments_exist() {
        let (_d, conn) = setup();
        let a = company(&conn, "A Steel", "SUPPLIER");
        let b = company(&conn, "B Steel", "SUPPLIER");
        let bill = new_bill(&conn, a, "B-1", 1000.0);
        let moved = SupplierBillRepository::update(&conn, bill, input(b, "B-1", "2026-10-01", 1000.0)).unwrap();
        assert_eq!(moved.bill.supplier_name, "B Steel", "free to change while nothing is paid");
        let p = payment_row(&conn, b, "SP/26-27/001");
        allocate(&conn, p, bill, 100.0);
        assert_eq!(
            SupplierBillRepository::update(&conn, bill, input(a, "B-1", "2026-10-01", 1000.0)).unwrap_err(),
            "The supplier can't be changed once payments are recorded against this bill."
        );
    }

    #[test]
    fn delete_is_blocked_with_payments_and_cascades_files_otherwise() {
        let (_d, conn) = setup();
        let s = company(&conn, "Steel Co", "SUPPLIER");
        let bill = new_bill(&conn, s, "B-1", 1000.0);
        SupplierBillRepository::add_file(&conn, bill, "bill.pdf", PDF).unwrap();
        let p = payment_row(&conn, s, "SP/26-27/001");
        allocate(&conn, p, bill, 100.0);
        assert_eq!(SupplierBillRepository::delete(&conn, bill).unwrap_err(), "This bill has 1 payment(s). Remove or edit them first.");
        conn.execute("DELETE FROM supplier_payments WHERE id = ?1", params![p]).unwrap();
        SupplierBillRepository::delete(&conn, bill).unwrap();
        let files: i64 = conn.query_row("SELECT COUNT(*) FROM supplier_bill_files", [], |r| r.get(0)).unwrap();
        assert_eq!(files, 0, "files go with the bill");

        // The bill is gone: a stale screen gets plain answers, not a crash.
        assert_eq!(SupplierBillRepository::delete(&conn, bill).unwrap_err(), "Bill not found.");
        assert!(SupplierBillRepository::get(&conn, bill).unwrap().is_none());
        assert_eq!(SupplierBillRepository::update(&conn, bill, input(s, "B-1", "2026-10-01", 10.0)).unwrap_err(), "Bill not found.");
    }

    #[test]
    fn list_searches_filters_and_reports_amounts() {
        let (_d, conn) = setup();
        let a = company(&conn, "Sri Ganesh Steel", "SUPPLIER");
        let b = company(&conn, "Other Metals", "SUPPLIER");
        let first = new_bill(&conn, a, "B-100", 1000.0);
        let second = SupplierBillRepository::create(&conn, input(b, "B-200", "2026-10-05", 500.0)).unwrap().bill.id;
        SupplierBillRepository::add_file(&conn, second, "bill.pdf", PDF).unwrap();
        let p = payment_row(&conn, a, "SP/26-27/001");
        allocate(&conn, p, first, 400.0);

        let all = SupplierBillRepository::list(&conn, SupplierBillFilter::default()).unwrap();
        assert_eq!(all[0].bill_number, "B-200", "newest first");
        let row = all.iter().find(|r| r.bill_number == "B-100").unwrap();
        assert_eq!((row.settled_amount, row.outstanding_amount, row.status.as_str(), row.file_count), (400.0, 600.0, "PARTIAL", 0));
        assert_eq!(all[0].file_count, 1);

        let q = |text: &str| SupplierBillFilter { query: Some(text.to_string()), ..Default::default() };
        assert_eq!(SupplierBillRepository::list(&conn, q("100")).unwrap().len(), 1);
        assert_eq!(SupplierBillRepository::list(&conn, q("ganesh")).unwrap().len(), 1);
        let by_supplier = SupplierBillFilter { supplier_id: Some(b), ..Default::default() };
        assert_eq!(SupplierBillRepository::list(&conn, by_supplier).unwrap()[0].bill_number, "B-200");
        let by_status = |s: &str| SupplierBillFilter { status: Some(s.to_string()), ..Default::default() };
        assert_eq!(SupplierBillRepository::list(&conn, by_status("PARTIAL")).unwrap()[0].bill_number, "B-100");
        assert_eq!(SupplierBillRepository::list(&conn, by_status("NOT_PAID")).unwrap()[0].bill_number, "B-200");
        assert!(SupplierBillRepository::list(&conn, by_status("PAID")).unwrap().is_empty());
        assert_eq!(SupplierBillRepository::list(&conn, by_status("ALL")).unwrap().len(), 2);
    }

    #[test]
    fn detail_lists_the_payments_settling_the_bill() {
        let (_d, conn) = setup();
        let s = company(&conn, "Steel Co", "SUPPLIER");
        let bill = new_bill(&conn, s, "B-1", 1000.0);
        let p1 = payment_row(&conn, s, "SP/26-27/001");
        conn.execute("UPDATE supplier_payments SET payment_method = 'Cheque', reference_number = '123456' WHERE id = ?1", params![p1]).unwrap();
        let p2 = payment_row(&conn, s, "SP/26-27/002");
        allocate(&conn, p1, bill, 300.0);
        allocate(&conn, p2, bill, 200.0);
        let detail = SupplierBillRepository::get(&conn, bill).unwrap().unwrap();
        assert_eq!(detail.payments.len(), 2);
        let first = &detail.payments[0];
        assert_eq!(
            (first.payment_number.as_str(), first.payment_method.as_str(), first.reference_number.as_deref(), first.amount_settled),
            ("SP/26-27/001", "Cheque", Some("123456"), 300.0)
        );
        assert_eq!(detail.payments[1].amount_settled, 200.0);
    }

    #[test]
    fn files_follow_the_shared_rules() {
        let (_d, conn) = setup();
        let s = company(&conn, "Steel Co", "SUPPLIER");
        let bill = new_bill(&conn, s, "B-1", 1000.0);
        let info = SupplierBillRepository::add_file(&conn, bill, "..\\bill.pdf", PDF).unwrap();
        assert_eq!((info.file_name.as_str(), info.mime_type.as_str()), ("bill.pdf", "application/pdf"));
        assert_eq!(SupplierBillRepository::get(&conn, bill).unwrap().unwrap().files.len(), 1);
        let (name, mime, bytes) = SupplierBillRepository::read_file(&conn, info.id).unwrap();
        assert_eq!((name.as_str(), mime.as_str(), bytes.as_slice()), ("bill.pdf", "application/pdf", PDF));
        assert!(SupplierBillRepository::add_file(&conn, bill, "fake.pdf", b"just text").is_err());
        assert_eq!(SupplierBillRepository::add_file(&conn, 9999, "a.pdf", PDF).unwrap_err(), "Bill not found.");
        SupplierBillRepository::remove_file(&conn, info.id).unwrap();
        assert_eq!(SupplierBillRepository::remove_file(&conn, info.id).unwrap_err(), "That file is no longer there.");
        assert_eq!(SupplierBillRepository::read_file(&conn, info.id).unwrap_err(), "That file is no longer there.");
    }

    #[test]
    fn summary_totals() {
        let (_d, conn) = setup();
        let s = company(&conn, "Steel Co", "SUPPLIER");
        let part = new_bill(&conn, s, "B-1", 1000.0);
        new_bill(&conn, s, "B-2", 500.0);
        let paid = new_bill(&conn, s, "B-3", 300.0);
        let p = payment_row(&conn, s, "SP/26-27/001");
        allocate(&conn, p, part, 400.0);
        allocate(&conn, p, paid, 300.0);
        conn.execute(
            "INSERT INTO supplier_credits (supplier_id, original_amount, remaining_amount, created_at, updated_at) VALUES (?1, 30, 25, 'x', 'x')",
            params![s],
        )
        .unwrap();
        let sum = SupplierBillRepository::summary(&conn).unwrap();
        assert_eq!((sum.total_outstanding, sum.open_bills_count, sum.advances_held), (1100.0, 2, 25.0));
    }
}
