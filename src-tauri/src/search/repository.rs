use rusqlite::{params, Connection};
use super::models::SearchResult;

const LIMIT: i64 = 5;

pub struct SearchRepository;

impl SearchRepository {
    pub fn search(conn: &Connection, query: &str) -> Result<Vec<SearchResult>, String> {
        let q = format!("%{}%", query);
        let mut results: Vec<SearchResult> = Vec::new();

        // Customers
        let mut stmt = conn
            .prepare(
                "SELECT id, name, COALESCE(gstin, '') FROM customers \
                 WHERE name LIKE ?1 OR COALESCE(gstin, '') LIKE ?1 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<SearchResult> = stmt
            .query_map(params![q, LIMIT], |r| {
                Ok(SearchResult {
                    kind: "COMPANY".to_string(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    subtitle: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e: rusqlite::Error| e.to_string())?;
        results.extend(rows);

        // Invoices
        let mut stmt = conn
            .prepare(
                "SELECT id, invoice_number, customer_name FROM invoices \
                 WHERE invoice_number LIKE ?1 OR customer_name LIKE ?1 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<SearchResult> = stmt
            .query_map(params![q, LIMIT], |r| {
                Ok(SearchResult {
                    kind: "INVOICE".to_string(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    subtitle: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e: rusqlite::Error| e.to_string())?;
        results.extend(rows);

        // Payments
        let mut stmt = conn
            .prepare(
                "SELECT id, payment_number, customer_name FROM payments \
                 WHERE payment_number LIKE ?1 OR customer_name LIKE ?1 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<SearchResult> = stmt
            .query_map(params![q, LIMIT], |r| {
                Ok(SearchResult {
                    kind: "PAYMENT".to_string(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    subtitle: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e: rusqlite::Error| e.to_string())?;
        results.extend(rows);

        // Purchase orders (no customer_name column — join customers)
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.po_number, c.name FROM purchase_orders p \
                 JOIN customers c ON c.id = p.customer_id \
                 WHERE p.po_number LIKE ?1 OR c.name LIKE ?1 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<SearchResult> = stmt
            .query_map(params![q, LIMIT], |r| {
                Ok(SearchResult {
                    kind: "PURCHASE_ORDER".to_string(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    subtitle: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e: rusqlite::Error| e.to_string())?;
        results.extend(rows);

        // Quotations (no customer_name column — join customers)
        let mut stmt = conn
            .prepare(
                "SELECT q.id, q.quotation_number, c.name FROM quotations q \
                 JOIN customers c ON c.id = q.customer_id \
                 WHERE q.quotation_number LIKE ?1 OR c.name LIKE ?1 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<SearchResult> = stmt
            .query_map(params![q, LIMIT], |r| {
                Ok(SearchResult {
                    kind: "QUOTATION".to_string(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    subtitle: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e: rusqlite::Error| e.to_string())?;
        results.extend(rows);

        // Supplier bills (join customers for supplier name)
        let mut stmt = conn
            .prepare(
                "SELECT b.id, b.bill_number, c.name FROM supplier_bills b \
                 JOIN customers c ON c.id = b.supplier_id \
                 WHERE b.bill_number LIKE ?1 OR c.name LIKE ?1 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<SearchResult> = stmt
            .query_map(params![q, LIMIT], |r| {
                Ok(SearchResult {
                    kind: "SUPPLIER_BILL".to_string(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    subtitle: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e: rusqlite::Error| e.to_string())?;
        results.extend(rows);

        // Supplier payments (join customers for supplier name)
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.payment_number, c.name FROM supplier_payments p \
                 JOIN customers c ON c.id = p.supplier_id \
                 WHERE p.payment_number LIKE ?1 OR c.name LIKE ?1 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<SearchResult> = stmt
            .query_map(params![q, LIMIT], |r| {
                Ok(SearchResult {
                    kind: "SUPPLIER_PAYMENT".to_string(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    subtitle: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e: rusqlite::Error| e.to_string())?;
        results.extend(rows);

        // Employees
        let mut stmt = conn
            .prepare("SELECT id, name FROM employees WHERE name LIKE ?1 LIMIT ?2")
            .map_err(|e| e.to_string())?;
        let rows: Vec<SearchResult> = stmt
            .query_map(params![q, LIMIT], |r| {
                Ok(SearchResult {
                    kind: "EMPLOYEE".to_string(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    subtitle: String::new(),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e: rusqlite::Error| e.to_string())?;
        results.extend(rows);

        Ok(results)
    }
}
