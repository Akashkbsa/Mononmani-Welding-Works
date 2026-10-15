use super::models::{
    SupplierAllocationDetail, SupplierPayment, SupplierPaymentFilter, SupplierPaymentInput, SupplierPaymentListItem,
    SupplierPaymentMessage, SupplierPaymentWithAllocations, SupplierPaymentsSummary, UnpaidBill,
};
use crate::rentals::reminder::{normalize_whatsapp_number, whatsapp_link};
use crate::customers::models::PartyRole;
use crate::customers::repository::CustomerRepository;
use crate::util::{
    display_date, doc_number, doc_sequence, financial_year_label, normalize_date, parse_date, round2, rupees, today, MONEY_EPS,
};
use chrono::{Datelike, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;

pub struct SupplierPaymentRepository;

/// Bill figures used when validating an allocation.
struct BillBalance {
    number: String,
    supplier_id: i64,
    outstanding: f64,
}

impl SupplierPaymentRepository {
    /// The next number in the current financial year, e.g. SP/26-27/003.
    pub fn next_payment_number(conn: &Connection) -> Result<String, String> {
        let fy = financial_year_label();
        let mut stmt = conn
            .prepare("SELECT payment_number FROM supplier_payments WHERE payment_number LIKE 'SP/%'")
            .map_err(|e| format!("Failed to work out the next payment number: {}", e))?;
        let max_seq = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to work out the next payment number: {}", e))?
            .filter_map(Result::ok)
            .filter_map(|num| doc_sequence(&num, "SP", &fy))
            .max()
            .unwrap_or(0);
        Ok(doc_number("SP", max_seq + 1, &fy))
    }

    pub fn create(conn: &Connection, input: SupplierPaymentInput) -> Result<SupplierPaymentWithAllocations, String> {
        let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin transaction: {}", e))?;
        let id = Self::save(&tx, None, input)?;
        tx.commit().map_err(|e| format!("Failed to save payment: {}", e))?;
        Self::get(conn, id)?.ok_or_else(|| "Saved payment could not be reloaded.".to_string())
    }

    pub fn update(conn: &Connection, id: i64, input: SupplierPaymentInput) -> Result<SupplierPaymentWithAllocations, String> {
        let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin transaction: {}", e))?;
        Self::save(&tx, Some(id), input)?;
        tx.commit().map_err(|e| format!("Failed to save payment: {}", e))?;
        Self::get(conn, id)?.ok_or_else(|| "Saved payment could not be reloaded.".to_string())
    }

    /// Deleting a payment reopens the bills it settled.
    pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
        let exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM supplier_payments WHERE id = ?1", params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err("Payment not found.".to_string());
        }
        conn.execute("DELETE FROM supplier_payments WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete payment: {}", e))?;
        Ok(())
    }

    /// Validates the input and writes the payment and its allocations. Runs inside the caller's
    /// transaction, so any error undoes everything.
    fn save(conn: &Connection, id: Option<i64>, input: SupplierPaymentInput) -> Result<i64, String> {
        // When editing, undo this payment's previous allocations first so the balances below are worked
        // out as if it had never been recorded. The supplier and the number never change.
        let (supplier_id, payment_number) = match id {
            Some(pid) => {
                let (supplier, number): (i64, String) = conn
                    .query_row(
                        "SELECT supplier_id, payment_number FROM supplier_payments WHERE id = ?1",
                        params![pid],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()
                    .map_err(|e| format!("Failed to load payment: {}", e))?
                    .ok_or_else(|| "Payment not found.".to_string())?;
                conn.execute("DELETE FROM supplier_payment_allocations WHERE payment_id = ?1", params![pid])
                    .map_err(|e| format!("Failed to update allocations: {}", e))?;
                (supplier, number)
            }
            None => {
                let number = match input.payment_number.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    Some(n) => n.to_string(),
                    None => Self::next_payment_number(conn)?,
                };
                let taken: Option<i64> = conn
                    .query_row(
                        "SELECT id FROM supplier_payments WHERE payment_number = ?1 COLLATE NOCASE",
                        params![number],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                if taken.is_some() {
                    return Err(format!("Payment number {} is already used.", number));
                }
                (input.supplier_id, number)
            }
        };

        let known: Option<String> = conn
            .query_row("SELECT name FROM customers WHERE id = ?1", params![supplier_id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if known.is_none() {
            return Err("Select a supplier.".to_string());
        }
        CustomerRepository::require_party(conn, supplier_id, PartyRole::Supplier)?;

        let payment_date = normalize_date(&input.payment_date, "Payment date")?;
        let amount_paid = round2(input.amount_paid);
        let writeoff_amount = round2(input.writeoff_amount);
        if amount_paid < 0.0 || writeoff_amount < 0.0 {
            return Err("Amounts cannot be negative.".to_string());
        }
        let total_settled = round2(amount_paid + writeoff_amount);

        // Check every allocation against the bill's current balance.
        let mut seen = HashSet::new();
        let mut allocations = Vec::new();
        for alloc in &input.allocations {
            let amount = round2(alloc.allocated_amount);
            if amount <= 0.0 {
                continue;
            }
            if !seen.insert(alloc.bill_id) {
                return Err("The same bill is listed twice.".to_string());
            }
            let bill = Self::bill_balance(conn, alloc.bill_id)?;
            if bill.supplier_id != supplier_id {
                return Err(format!("Bill {} belongs to a different supplier.", bill.number));
            }
            if amount > bill.outstanding + MONEY_EPS {
                return Err(format!(
                    "{} is more than the {} still due on bill {}.",
                    rupees(amount),
                    rupees(bill.outstanding),
                    bill.number
                ));
            }
            allocations.push((alloc.bill_id, amount));
        }
        let total_allocated = round2(allocations.iter().map(|(_, a)| a).sum());

        if total_settled <= 0.0 {
            return Err("Enter the amount paid.".to_string());
        }
        if allocations.is_empty() {
            return Err("Choose the bills this payment is for.".to_string());
        }
        if writeoff_amount > MONEY_EPS && total_allocated + MONEY_EPS < total_settled {
            return Err(format!(
                "{} written off is more than the shortfall. Only {} is short.",
                rupees(writeoff_amount),
                rupees((total_allocated - amount_paid).max(0.0))
            ));
        }
        if total_allocated > total_settled + MONEY_EPS {
            return Err(format!("Allocated {} is more than the {} paid.", rupees(total_allocated), rupees(total_settled)));
        }

        // Money paid beyond the bills is a round-off: counted as paid, nothing owed back. Less than half
        // a paisa left over is rounding, not an extra.
        let leftover = round2((total_settled - total_allocated).max(0.0));
        let excess_amount = if leftover > MONEY_EPS { leftover } else { 0.0 };
        let excess_action = if excess_amount > 0.0 { "ROUNDOFF" } else { "NONE" };

        let now = Utc::now().to_rfc3339();
        let clean = |v: &Option<String>| v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let method = clean(&input.payment_method).unwrap_or_else(|| "Bank Transfer".to_string());

        let payment_id = match id {
            None => {
                conn.execute(
                    r#"
                    INSERT INTO supplier_payments (
                        payment_number, supplier_id, payment_date, payment_method, reference_number, bank_name,
                        amount_paid, total_settled, credit_applied, excess_amount, excess_action, writeoff_amount,
                        remarks, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0.0, ?9, ?10, ?11, ?12, ?13, ?13)
                    "#,
                    params![
                        payment_number,
                        supplier_id,
                        payment_date,
                        method,
                        clean(&input.reference_number),
                        clean(&input.bank_name),
                        amount_paid,
                        total_settled,
                        excess_amount,
                        excess_action,
                        writeoff_amount,
                        clean(&input.remarks),
                        now
                    ],
                )
                .map_err(|e| format!("Failed to save payment: {}", e))?;
                conn.last_insert_rowid()
            }
            Some(pid) => {
                conn.execute(
                    r#"
                    UPDATE supplier_payments SET
                        payment_date = ?1, payment_method = ?2, reference_number = ?3, bank_name = ?4,
                        amount_paid = ?5, total_settled = ?6, credit_applied = 0.0, excess_amount = ?7,
                        excess_action = ?8, writeoff_amount = ?9, remarks = ?10, updated_at = ?11
                    WHERE id = ?12
                    "#,
                    params![
                        payment_date,
                        method,
                        clean(&input.reference_number),
                        clean(&input.bank_name),
                        amount_paid,
                        total_settled,
                        excess_amount,
                        excess_action,
                        writeoff_amount,
                        clean(&input.remarks),
                        now,
                        pid
                    ],
                )
                .map_err(|e| format!("Failed to save payment: {}", e))?;
                pid
            }
        };

        for (bill_id, amount) in &allocations {
            conn.execute(
                "INSERT INTO supplier_payment_allocations (payment_id, bill_id, amount_allocated, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![payment_id, bill_id, amount, now],
            )
            .map_err(|e| format!("Failed to save allocation: {}", e))?;
        }
        Ok(payment_id)
    }

    fn bill_balance(conn: &Connection, bill_id: i64) -> Result<BillBalance, String> {
        conn.query_row(
            r#"
            SELECT b.bill_number, b.supplier_id, b.total_amount,
                   COALESCE((SELECT SUM(amount_allocated) FROM supplier_payment_allocations WHERE bill_id = b.id), 0.0)
            FROM supplier_bills b WHERE b.id = ?1
            "#,
            params![bill_id],
            |r| {
                let total: f64 = r.get(2)?;
                let settled: f64 = r.get(3)?;
                Ok(BillBalance { number: r.get(0)?, supplier_id: r.get(1)?, outstanding: round2(total - settled).max(0.0) })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Bill {} was not found.", bill_id))
    }

    pub fn get(conn: &Connection, id: i64) -> Result<Option<SupplierPaymentWithAllocations>, String> {
        let payment = conn
            .query_row(
                r#"
                SELECT p.id, p.payment_number, p.supplier_id, c.name, p.payment_date, p.payment_method,
                       p.reference_number, p.bank_name, p.amount_paid, p.writeoff_amount, p.total_settled,
                       p.excess_amount, p.excess_action, p.remarks, p.created_at, p.updated_at, p.whatsapp_sent_on
                FROM supplier_payments p JOIN customers c ON c.id = p.supplier_id WHERE p.id = ?1
                "#,
                params![id],
                |r| {
                    Ok(SupplierPayment {
                        id: r.get(0)?,
                        payment_number: r.get(1)?,
                        supplier_id: r.get(2)?,
                        supplier_name: r.get(3)?,
                        payment_date: r.get(4)?,
                        payment_method: r.get(5)?,
                        reference_number: r.get(6)?,
                        bank_name: r.get(7)?,
                        amount_paid: r.get(8)?,
                        writeoff_amount: r.get(9)?,
                        total_settled: r.get(10)?,
                        excess_amount: r.get(11)?,
                        excess_action: r.get(12)?,
                        remarks: r.get(13)?,
                        created_at: r.get(14)?,
                        updated_at: r.get(15)?,
                        whatsapp_sent_on: r.get(16)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to load payment: {}", e))?;
        let Some(payment) = payment else { return Ok(None) };

        let mut stmt = conn
            .prepare(
                r#"
                SELECT a.bill_id, b.bill_number, b.bill_date, b.total_amount, a.amount_allocated
                FROM supplier_payment_allocations a JOIN supplier_bills b ON b.id = a.bill_id
                WHERE a.payment_id = ?1 ORDER BY b.bill_date ASC, a.id ASC
                "#,
            )
            .map_err(|e| format!("Failed to load allocations: {}", e))?;
        let allocations = stmt
            .query_map(params![id], |r| {
                Ok(SupplierAllocationDetail {
                    bill_id: r.get(0)?,
                    bill_number: r.get(1)?,
                    bill_date: r.get(2)?,
                    bill_total_amount: r.get(3)?,
                    allocated_amount: r.get(4)?,
                })
            })
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(|e| format!("Failed to load allocations: {}", e))?;

        Ok(Some(SupplierPaymentWithAllocations { payment, allocations }))
    }

    pub fn list(conn: &Connection, filter: SupplierPaymentFilter) -> Result<Vec<SupplierPaymentListItem>, String> {
        let mut query = String::from(
            r#"
            SELECT p.id, p.payment_number, p.supplier_id, c.name, p.payment_date, p.payment_method, p.reference_number,
                   p.amount_paid, p.writeoff_amount, p.total_settled, p.excess_amount, p.excess_action,
                   (SELECT GROUP_CONCAT(b.bill_number, ', ') FROM supplier_payment_allocations a
                    JOIN supplier_bills b ON b.id = a.bill_id WHERE a.payment_id = p.id),
                   p.whatsapp_sent_on
            FROM supplier_payments p JOIN customers c ON c.id = p.supplier_id
            WHERE 1=1
            "#,
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(q) = filter.query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let pattern = format!("%{}%", q);
            query.push_str(
                " AND (p.payment_number LIKE ? OR c.name LIKE ? OR p.reference_number LIKE ? OR p.remarks LIKE ?
                  OR EXISTS (SELECT 1 FROM supplier_payment_allocations a JOIN supplier_bills b ON b.id = a.bill_id
                             WHERE a.payment_id = p.id AND b.bill_number LIKE ?))",
            );
            for _ in 0..5 {
                args.push(Box::new(pattern.clone()));
            }
        }
        if let Some(sid) = filter.supplier_id {
            query.push_str(" AND p.supplier_id = ?");
            args.push(Box::new(sid));
        }
        if let Some(from) = filter.date_from.as_deref().and_then(parse_date) {
            query.push_str(" AND p.payment_date >= ?");
            args.push(Box::new(from.format("%Y-%m-%d").to_string()));
        }
        if let Some(to) = filter.date_to.as_deref().and_then(parse_date) {
            query.push_str(" AND p.payment_date <= ?");
            args.push(Box::new(to.format("%Y-%m-%d").to_string()));
        }
        if let Some(method) = filter.payment_method.as_deref().map(str::trim).filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("ALL")) {
            query.push_str(" AND p.payment_method = ?");
            args.push(Box::new(method.to_string()));
        }
        query.push_str(" ORDER BY p.payment_date DESC, p.id DESC");

        let mut stmt = conn.prepare(&query).map_err(|e| format!("Failed to load payments: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(args.iter()), |r| {
                let covered: Option<String> = r.get(12)?;
                Ok(SupplierPaymentListItem {
                    id: r.get(0)?,
                    payment_number: r.get(1)?,
                    supplier_id: r.get(2)?,
                    supplier_name: r.get(3)?,
                    payment_date: r.get(4)?,
                    payment_method: r.get(5)?,
                    reference_number: r.get(6)?,
                    amount_paid: r.get(7)?,
                    writeoff_amount: r.get(8)?,
                    total_settled: r.get(9)?,
                    excess_amount: r.get(10)?,
                    excess_action: r.get(11)?,
                    bills_covered: covered.map(|s| s.split(", ").map(str::to_string).collect()).unwrap_or_default(),
                    whatsapp_sent_on: r.get(13)?,
                })
            })
            .map_err(|e| format!("Failed to load payments: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to load payments: {}", e))
    }

    /// The message telling the supplier which of their invoices this payment covers, and the WhatsApp
    /// link to their chat. Each bill shows its full amount; the last line is what was actually paid.
    /// The number is the company's WhatsApp number, or its phone when none is set.
    pub fn whatsapp_message(conn: &Connection, id: i64) -> Result<SupplierPaymentMessage, String> {
        let found = Self::get(conn, id)?.ok_or_else(|| "Payment not found.".to_string())?;
        let message = payment_message_text(&found);

        let (phone, whatsapp): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT phone, whatsapp_number FROM customers WHERE id = ?1",
                params![found.payment.supplier_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| format!("Failed to load the supplier: {}", e))?;
        let clean = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let number = match (clean(whatsapp), clean(phone)) {
            (Some(w), _) => normalize_whatsapp_number(&w).map_err(|e| format!("The supplier's WhatsApp number: {}", e))?,
            (None, Some(p)) => normalize_whatsapp_number(&p).map_err(|_| {
                "The supplier's phone number is not a mobile number WhatsApp can use. Edit the company and add its WhatsApp number."
                    .to_string()
            })?,
            (None, None) => return Err("Add a phone or WhatsApp number for this supplier.".to_string()),
        };

        let link = whatsapp_link(&number, &message);
        Ok(SupplierPaymentMessage { message, number, link, whatsapp_sent_on: found.payment.whatsapp_sent_on })
    }

    /// Records that the WhatsApp message for this payment was opened on `date` (YYYY-MM-DD).
    pub fn stamp_whatsapp_sent(conn: &Connection, id: i64, date: &str) -> Result<(), String> {
        let n = conn
            .execute("UPDATE supplier_payments SET whatsapp_sent_on = ?1 WHERE id = ?2", params![date, id])
            .map_err(|e| format!("Failed to mark the message as sent: {}", e))?;
        if n == 0 {
            return Err("Payment not found.".to_string());
        }
        Ok(())
    }

    /// Bills a payment to this supplier can be applied to, oldest first. When editing, pass the payment
    /// id so the bills it already covers stay available, counted without that payment.
    pub fn unpaid_bills_for_supplier(
        conn: &Connection,
        supplier_id: i64,
        exclude_payment_id: Option<i64>,
    ) -> Result<Vec<UnpaidBill>, String> {
        let exclude = exclude_payment_id.unwrap_or(-1);
        let mut stmt = conn
            .prepare(
                r#"
                SELECT b.id, b.bill_number, b.bill_date, b.total_amount,
                       COALESCE(SUM(CASE WHEN a.payment_id != ?2 THEN a.amount_allocated END), 0.0),
                       MAX(CASE WHEN a.payment_id = ?2 THEN 1 ELSE 0 END)
                FROM supplier_bills b
                LEFT JOIN supplier_payment_allocations a ON a.bill_id = b.id
                WHERE b.supplier_id = ?1
                GROUP BY b.id
                ORDER BY b.bill_date ASC, b.id ASC
                "#,
            )
            .map_err(|e| format!("Failed to load unpaid bills: {}", e))?;
        let rows = stmt
            .query_map(params![supplier_id, exclude], |r| {
                let total_amount: f64 = r.get(3)?;
                let total_settled = round2(r.get::<_, f64>(4)?);
                let has_own: i32 = r.get::<_, Option<i32>>(5)?.unwrap_or(0);
                Ok((
                    has_own == 1,
                    UnpaidBill {
                        bill_id: r.get(0)?,
                        bill_number: r.get(1)?,
                        bill_date: r.get(2)?,
                        total_amount,
                        total_settled,
                        outstanding_amount: round2(total_amount - total_settled).max(0.0),
                    },
                ))
            })
            .map_err(|e| format!("Failed to load unpaid bills: {}", e))?;
        let mut list = Vec::new();
        for row in rows {
            let (has_own, bill) = row.map_err(|e| e.to_string())?;
            if has_own || bill.outstanding_amount > MONEY_EPS {
                list.push(bill);
            }
        }
        Ok(list)
    }

    pub fn summary(conn: &Connection) -> Result<SupplierPaymentsSummary, String> {
        let month_start = today().with_day(1).unwrap_or_else(today).format("%Y-%m-%d").to_string();
        let (total_paid, paid_this_month): (f64, f64) = conn
            .query_row(
                "SELECT COALESCE(SUM(amount_paid), 0.0), COALESCE(SUM(CASE WHEN payment_date >= ?1 THEN amount_paid ELSE 0 END), 0.0)
                 FROM supplier_payments",
                params![month_start],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        Ok(SupplierPaymentsSummary { total_paid: round2(total_paid), paid_this_month: round2(paid_this_month) })
    }
}

/// Invoice No & Date and Amount for each bill the payment covers, then the bills' total and the
/// amount sent.
pub fn payment_message_text(found: &SupplierPaymentWithAllocations) -> String {
    let mut lines = Vec::new();
    let mut total = 0.0;
    for a in &found.allocations {
        lines.push(format!("Invoice No & Date : {} / {}", a.bill_number, display_date(&a.bill_date)));
        lines.push(format!("Amount : {}", rupees(a.bill_total_amount)));
        total += a.bill_total_amount;
    }
    lines.push(format!("Total amount : {}", rupees(round2(total))));
    lines.push(format!("Amount sent : {}", rupees(found.payment.amount_paid)));
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::customers::models::CustomerCreateInput;
    use crate::customers::repository::CustomerRepository;
    use crate::db::DatabaseManager;
    use crate::supplier_bills::models::SupplierBillInput;
    use crate::supplier_bills::repository::SupplierBillRepository;
    use crate::supplier_payments::models::*;
    use crate::util::financial_year_label;
    use rusqlite::Connection;

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
                whatsapp_number: None,
                party_type: Some(party.to_string()),
            },
        )
        .unwrap()
        .id
    }

    fn supplier(conn: &Connection, name: &str) -> i64 {
        company(conn, name, "SUPPLIER")
    }

    fn bill(conn: &Connection, supplier: i64, number: &str, total: f64) -> i64 {
        bill_on(conn, supplier, number, "2026-04-10", total)
    }

    fn bill_on(conn: &Connection, supplier: i64, number: &str, date: &str, total: f64) -> i64 {
        SupplierBillRepository::create(
            conn,
            SupplierBillInput {
                supplier_id: supplier,
                bill_number: number.to_string(),
                bill_date: date.to_string(),
                total_amount: total,
                notes: None,
            },
        )
        .unwrap()
        .bill
        .id
    }

    fn pay(supplier: i64, paid: f64, allocs: &[(i64, f64)]) -> SupplierPaymentInput {
        SupplierPaymentInput {
            payment_number: None,
            supplier_id: supplier,
            payment_date: "2026-05-01".to_string(),
            payment_method: None,
            reference_number: None,
            bank_name: None,
            amount_paid: paid,
            remarks: None,
            allocations: allocs
                .iter()
                .map(|(bill_id, amount)| SupplierAllocationInput { bill_id: *bill_id, allocated_amount: *amount })
                .collect(),
            writeoff_amount: 0.0,
        }
    }

    fn pay_off(supplier: i64, paid: f64, allocs: &[(i64, f64)], writeoff: f64) -> SupplierPaymentInput {
        let mut input = pay(supplier, paid, allocs);
        input.writeoff_amount = writeoff;
        input
    }

    fn status(conn: &Connection, bill: i64) -> String {
        SupplierBillRepository::get(conn, bill).unwrap().unwrap().status
    }

    fn set_numbers(conn: &Connection, id: i64, phone: Option<&str>, whatsapp: Option<&str>) {
        conn.execute("UPDATE customers SET phone = ?1, whatsapp_number = ?2 WHERE id = ?3", params![phone, whatsapp, id]).unwrap();
    }

    #[test]
    fn whatsapp_message_lists_each_invoice_at_its_full_amount() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        set_numbers(&conn, s, Some("98765 43210"), None);
        let a = bill_on(&conn, s, "INV-123", "2026-10-05", 12500.0);
        let b = bill_on(&conn, s, "INV-130", "2026-10-09", 8000.0);
        // INV-123 is only part paid by this payment; the message still shows its full amount.
        let p = SupplierPaymentRepository::create(&conn, pay(s, 13000.0, &[(a, 5000.0), (b, 8000.0)])).unwrap().payment;

        let msg = SupplierPaymentRepository::whatsapp_message(&conn, p.id).unwrap();
        assert_eq!(
            msg.message,
            "Invoice No & Date : INV-123 / 05-10-2026\nAmount : ₹12,500.00\nInvoice No & Date : INV-130 / 09-10-2026\nAmount : ₹8,000.00\nTotal amount : ₹20,500.00\nAmount sent : ₹13,000.00"
        );
        assert_eq!(msg.number, "+919876543210");
        assert!(msg.link.starts_with("https://wa.me/919876543210?text=Invoice%20No%20%26%20Date"), "{}", msg.link);
        assert_eq!(msg.whatsapp_sent_on, None);
    }

    #[test]
    fn whatsapp_message_uses_the_whatsapp_number_before_the_phone() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.0);
        let p = SupplierPaymentRepository::create(&conn, pay(s, 1000.0, &[(a, 1000.0)])).unwrap().payment;
        let number = |conn: &Connection| SupplierPaymentRepository::whatsapp_message(conn, p.id).map(|m| m.number);

        assert_eq!(number(&conn).unwrap_err(), "Add a phone or WhatsApp number for this supplier.");
        set_numbers(&conn, s, Some("0413 2234567"), None);
        assert!(number(&conn).unwrap_err().contains("add its WhatsApp number"), "a landline cannot be used");
        set_numbers(&conn, s, Some("0413 2234567"), Some("+919123456780"));
        assert_eq!(number(&conn).unwrap(), "+919123456780");
        set_numbers(&conn, s, Some("9876543210"), Some("+919123456780"));
        assert_eq!(number(&conn).unwrap(), "+919123456780");
        set_numbers(&conn, s, Some("9876543210"), None);
        assert_eq!(number(&conn).unwrap(), "+919876543210");
    }

    #[test]
    fn stamping_the_message_shows_on_the_payment_and_in_the_list() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.0);
        let p = SupplierPaymentRepository::create(&conn, pay(s, 1000.0, &[(a, 1000.0)])).unwrap().payment;
        assert_eq!(p.whatsapp_sent_on, None);

        SupplierPaymentRepository::stamp_whatsapp_sent(&conn, p.id, "2026-10-15").unwrap();
        let got = SupplierPaymentRepository::get(&conn, p.id).unwrap().unwrap().payment;
        assert_eq!(got.whatsapp_sent_on.as_deref(), Some("2026-10-15"));
        let listed = SupplierPaymentRepository::list(&conn, SupplierPaymentFilter::default()).unwrap();
        assert_eq!(listed[0].whatsapp_sent_on.as_deref(), Some("2026-10-15"));
        assert!(SupplierPaymentRepository::stamp_whatsapp_sent(&conn, 9999, "2026-10-15").is_err());
    }

    #[test]
    fn the_owners_cases_on_an_11550_bill() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");

        // Pay 11,500 and settle in full: the 50 short is written off.
        let a = bill(&conn, s, "B-1", 11550.0);
        let p = SupplierPaymentRepository::create(&conn, pay_off(s, 11500.0, &[(a, 11550.0)], 50.0)).unwrap().payment;
        assert_eq!((p.total_settled, p.writeoff_amount, p.excess_amount, p.excess_action.as_str()), (11550.0, 50.0, 0.0, "NONE"));
        assert_eq!(status(&conn, a), "PAID");

        // Pay 11,600: the extra 50 is a round-off, counted as paid, nothing kept as an advance.
        let b = bill(&conn, s, "B-2", 11550.0);
        let p = SupplierPaymentRepository::create(&conn, pay(s, 11600.0, &[(b, 11550.0)])).unwrap().payment;
        assert_eq!((p.excess_amount, p.excess_action.as_str()), (50.0, "ROUNDOFF"));
        assert_eq!(status(&conn, b), "PAID");
    }

    #[test]
    fn write_off_and_round_off_have_no_limit() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 100000.0);
        SupplierPaymentRepository::create(&conn, pay_off(s, 40000.0, &[(a, 100000.0)], 60000.0)).unwrap();
        assert_eq!(status(&conn, a), "PAID");
        let b = bill(&conn, s, "B-2", 100000.0);
        let p = SupplierPaymentRepository::create(&conn, pay(s, 150000.0, &[(b, 100000.0)])).unwrap().payment;
        assert_eq!(p.excess_amount, 50000.0);
        assert_eq!(status(&conn, b), "PAID");
    }

    #[test]
    fn a_write_off_cannot_exceed_the_shortfall() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.0);
        assert_eq!(
            SupplierPaymentRepository::create(&conn, pay_off(s, 900.0, &[(a, 1000.0)], 150.0)).unwrap_err(),
            "₹150.00 written off is more than the shortfall. Only ₹100.00 is short."
        );
        assert_eq!(status(&conn, a), "NOT_PAID", "a refused payment leaves nothing behind");
        assert!(SupplierPaymentRepository::create(&conn, pay_off(s, 900.0, &[(a, 1000.0)], 100.0)).is_ok());
    }

    #[test]
    fn a_shortfall_without_a_write_off_is_refused() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.0);
        assert_eq!(
            SupplierPaymentRepository::create(&conn, pay(s, 900.0, &[(a, 1000.0)])).unwrap_err(),
            "Allocated ₹1,000.00 is more than the ₹900.00 paid."
        );
    }

    #[test]
    fn allocation_rules() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let other = supplier(&conn, "Other Metals");
        let a = bill(&conn, s, "T/1", 1000.0);
        let theirs = bill(&conn, other, "T/9", 500.0);

        assert_eq!(
            SupplierPaymentRepository::create(&conn, pay(s, 1500.0, &[(a, 1500.0)])).unwrap_err(),
            "₹1,500.00 is more than the ₹1,000.00 still due on bill T/1."
        );
        assert_eq!(
            SupplierPaymentRepository::create(&conn, pay(s, 500.0, &[(theirs, 500.0)])).unwrap_err(),
            "Bill T/9 belongs to a different supplier."
        );
        assert_eq!(
            SupplierPaymentRepository::create(&conn, pay(s, 200.0, &[(a, 100.0), (a, 100.0)])).unwrap_err(),
            "The same bill is listed twice."
        );
        let customer = company(&conn, "Buyer Co", "CUSTOMER");
        let err = SupplierPaymentRepository::create(&conn, pay(customer, 100.0, &[])).unwrap_err();
        assert!(err.contains("customer only"), "{}", err);
        assert_eq!(SupplierPaymentRepository::create(&conn, pay(s, 0.0, &[(a, 100.0)])).unwrap_err(), "Enter the amount paid.");
        assert_eq!(SupplierPaymentRepository::create(&conn, pay(9999, 10.0, &[])).unwrap_err(), "Select a supplier.");
        assert_eq!(status(&conn, a), "NOT_PAID");
    }

    #[test]
    fn a_payment_must_be_for_a_bill() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        assert_eq!(SupplierPaymentRepository::create(&conn, pay(s, 5000.0, &[])).unwrap_err(), "Choose the bills this payment is for.");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM supplier_payments"), 0);
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn the_advance_tables_are_gone() {
        let (_d, conn) = setup();
        for table in ["supplier_credits", "supplier_credit_applications"] {
            let n = count(&conn, &format!("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '{}'", table));
            assert_eq!(n, 0, "{}", table);
        }
    }

    #[test]
    fn one_payment_can_settle_two_bills() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 600.0);
        let b = bill(&conn, s, "B-2", 400.0);
        let saved = SupplierPaymentRepository::create(&conn, pay(s, 1000.0, &[(a, 600.0), (b, 400.0)])).unwrap();
        assert_eq!(saved.allocations.len(), 2);
        assert_eq!((status(&conn, a), status(&conn, b)), ("PAID".to_string(), "PAID".to_string()));
    }

    #[test]
    fn payment_numbers_run_on_and_must_be_unique() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let fy = financial_year_label();
        let a = bill(&conn, s, "B-1", 1000.0);
        let first = SupplierPaymentRepository::create(&conn, pay(s, 10.0, &[(a, 10.0)])).unwrap().payment.payment_number;
        assert_eq!(first, format!("SP/{}/001", fy));
        let second = SupplierPaymentRepository::create(&conn, pay(s, 10.0, &[(a, 10.0)])).unwrap().payment.payment_number;
        assert_eq!(second, format!("SP/{}/002", fy));

        let mut dup = pay(s, 10.0, &[(a, 10.0)]);
        dup.payment_number = Some(first.to_lowercase());
        assert_eq!(
            SupplierPaymentRepository::create(&conn, dup).unwrap_err(),
            format!("Payment number {} is already used.", first.to_lowercase())
        );

        // A number typed in another series is kept but does not move the running number.
        let mut other = pay(s, 10.0, &[(a, 10.0)]);
        other.payment_number = Some(format!("PAY/{}/005", fy));
        SupplierPaymentRepository::create(&conn, other).unwrap();
        assert_eq!(SupplierPaymentRepository::next_payment_number(&conn).unwrap(), format!("SP/{}/003", fy));
    }

    #[test]
    fn pennies_never_leave_a_bill_part_paid() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.10);
        for part in [333.37, 333.37, 333.36] {
            SupplierPaymentRepository::create(&conn, pay(s, part, &[(a, part)])).unwrap();
        }
        assert_eq!(status(&conn, a), "PAID");

        let tiny = bill(&conn, s, "B-2", 0.30);
        let floaty = 0.1 + 0.2;
        let p = SupplierPaymentRepository::create(&conn, pay(s, floaty, &[(tiny, 0.30)])).unwrap().payment;
        assert_eq!((p.excess_amount, p.excess_action.as_str()), (0.0, "NONE"), "a rounding crumb is not an extra");
        assert_eq!(status(&conn, tiny), "PAID");
    }

    #[test]
    fn editing_recalculates_as_if_never_recorded() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.0);
        let id = SupplierPaymentRepository::create(&conn, pay(s, 1000.0, &[(a, 1000.0)])).unwrap().payment.id;
        assert_eq!(status(&conn, a), "PAID");
        assert!(SupplierPaymentRepository::unpaid_bills_for_supplier(&conn, s, None).unwrap().is_empty());
        let own = SupplierPaymentRepository::unpaid_bills_for_supplier(&conn, s, Some(id)).unwrap();
        assert_eq!((own.len(), own[0].total_settled, own[0].outstanding_amount), (1, 0.0, 1000.0), "its own bill stays available");

        let edited = SupplierPaymentRepository::update(&conn, id, pay(s, 400.0, &[(a, 400.0)])).unwrap();
        assert_eq!(edited.allocations.len(), 1);
        let detail = SupplierBillRepository::get(&conn, a).unwrap().unwrap();
        assert_eq!((detail.status.as_str(), detail.outstanding_amount), ("PARTIAL", 600.0));
    }

    #[test]
    fn the_supplier_and_number_are_fixed_when_editing() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let other = supplier(&conn, "Other Metals");
        let a = bill(&conn, s, "B-1", 1000.0);
        let created = SupplierPaymentRepository::create(&conn, pay(s, 100.0, &[(a, 100.0)])).unwrap().payment;
        let mut edit = pay(other, 150.0, &[(a, 150.0)]);
        edit.payment_number = Some("SP/99-00/099".to_string());
        let edited = SupplierPaymentRepository::update(&conn, created.id, edit).unwrap().payment;
        assert_eq!((edited.supplier_id, edited.payment_number.as_str()), (s, created.payment_number.as_str()));
        assert_eq!(edited.amount_paid, 150.0);
    }

    #[test]
    fn deleting_reopens_the_bills() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.0);
        let id = SupplierPaymentRepository::create(&conn, pay(s, 1000.0, &[(a, 1000.0)])).unwrap().payment.id;
        assert_eq!(status(&conn, a), "PAID");
        SupplierPaymentRepository::delete(&conn, id).unwrap();
        assert_eq!(status(&conn, a), "NOT_PAID");
    }

    #[test]
    fn lists_filter_and_name_the_bills_covered() {
        let (_d, conn) = setup();
        let a = supplier(&conn, "Sri Ganesh Steel");
        let b = supplier(&conn, "Other Metals");
        let bill_a = bill(&conn, a, "BILL-77", 500.0);
        let bill_b = bill(&conn, b, "BILL-88", 900.0);
        let mut one = pay(a, 500.0, &[(bill_a, 500.0)]);
        one.payment_method = Some("Cheque".to_string());
        one.reference_number = Some("UTR123".to_string());
        let first = SupplierPaymentRepository::create(&conn, one).unwrap().payment.id;
        let mut two = pay(b, 200.0, &[(bill_b, 200.0)]);
        two.payment_date = "2026-06-15".to_string();
        two.remarks = Some("part for the next order".to_string());
        SupplierPaymentRepository::create(&conn, two).unwrap();

        let all = SupplierPaymentRepository::list(&conn, SupplierPaymentFilter::default()).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].supplier_name, "Other Metals", "newest first");
        assert_eq!(all[0].bills_covered, vec!["BILL-88".to_string()]);
        assert_eq!(all[1].bills_covered, vec!["BILL-77".to_string()]);

        let q = |t: &str| SupplierPaymentFilter { query: Some(t.to_string()), ..Default::default() };
        for text in ["BILL-77", "UTR123", "ganesh", "SP/"] {
            assert!(!SupplierPaymentRepository::list(&conn, q(text)).unwrap().is_empty(), "{}", text);
        }
        assert_eq!(SupplierPaymentRepository::list(&conn, q("next order")).unwrap().len(), 1);
        assert_eq!(SupplierPaymentRepository::list(&conn, q("BILL-77")).unwrap()[0].id, first);
        let by_supplier = SupplierPaymentFilter { supplier_id: Some(b), ..Default::default() };
        assert_eq!(SupplierPaymentRepository::list(&conn, by_supplier).unwrap().len(), 1);
        let by_method = SupplierPaymentFilter { payment_method: Some("Cheque".to_string()), ..Default::default() };
        assert_eq!(SupplierPaymentRepository::list(&conn, by_method).unwrap()[0].id, first);
        let by_date = SupplierPaymentFilter { date_from: Some("2026-06-01".to_string()), date_to: Some("2026-06-30".to_string()), ..Default::default() };
        assert_eq!(SupplierPaymentRepository::list(&conn, by_date).unwrap().len(), 1);
    }

    #[test]
    fn unpaid_bills_are_oldest_first_and_only_the_open_ones() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        bill_on(&conn, s, "B-NEW", "2026-05-01", 300.0);
        let older = bill_on(&conn, s, "B-OLD", "2026-03-01", 500.0);
        let done = bill_on(&conn, s, "B-DONE", "2026-04-01", 100.0);
        SupplierPaymentRepository::create(&conn, pay(s, 100.0, &[(done, 100.0)])).unwrap();
        SupplierPaymentRepository::create(&conn, pay(s, 200.0, &[(older, 200.0)])).unwrap();
        let open = SupplierPaymentRepository::unpaid_bills_for_supplier(&conn, s, None).unwrap();
        let numbers: Vec<&str> = open.iter().map(|b| b.bill_number.as_str()).collect();
        assert_eq!(numbers, vec!["B-OLD", "B-NEW"]);
        assert_eq!((open[0].total_settled, open[0].outstanding_amount), (200.0, 300.0));
    }

    #[test]
    fn the_summary_adds_up() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.0);
        SupplierPaymentRepository::create(&conn, pay(s, 500.0, &[(a, 500.0)])).unwrap();
        let mut now = pay(s, 70.0, &[(a, 70.0)]);
        now.payment_date = crate::util::today().format("%Y-%m-%d").to_string();
        SupplierPaymentRepository::create(&conn, now).unwrap();
        let sum = SupplierPaymentRepository::summary(&conn).unwrap();
        assert_eq!((sum.total_paid, sum.paid_this_month), (570.0, 70.0));
    }

    #[test]
    fn a_missing_payment_gets_a_plain_message() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 100.0);
        assert_eq!(SupplierPaymentRepository::update(&conn, 9999, pay(s, 10.0, &[(a, 10.0)])).unwrap_err(), "Payment not found.");
        assert_eq!(SupplierPaymentRepository::delete(&conn, 9999).unwrap_err(), "Payment not found.");
    }
}
