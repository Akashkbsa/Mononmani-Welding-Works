use super::models::{
    SupplierAllocationDetail, SupplierCredit, SupplierPayment, SupplierPaymentFilter, SupplierPaymentInput,
    SupplierPaymentListItem, SupplierPaymentWithAllocations, SupplierPaymentsSummary, UnpaidBill,
};
use crate::customers::models::PartyRole;
use crate::customers::repository::CustomerRepository;
use crate::util::{doc_number, doc_sequence, financial_year_label, normalize_date, parse_date, round2, rupees, today, MONEY_EPS};
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

    pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
        let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin transaction: {}", e))?;
        let exists: i64 = tx
            .query_row("SELECT COUNT(*) FROM supplier_payments WHERE id = ?1", params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err("Payment not found.".to_string());
        }
        let used = Self::advance_used(&tx, id)?;
        if used > MONEY_EPS {
            return Err(format!(
                "{} of the advance from this payment has already been used by a later payment. Remove that payment first.",
                rupees(used)
            ));
        }
        Self::release_credit_applications(&tx, id)?;
        tx.execute("DELETE FROM supplier_credits WHERE source_payment_id = ?1", params![id])
            .map_err(|e| format!("Failed to remove advance: {}", e))?;
        tx.execute("DELETE FROM supplier_payments WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete payment: {}", e))?;
        tx.commit().map_err(|e| format!("Failed to delete payment: {}", e))
    }

    /// Validates the input and writes the payment, its allocations, the advances it uses and the
    /// advance it creates. Runs inside the caller's transaction, so any error undoes everything.
    fn save(conn: &Connection, id: Option<i64>, input: SupplierPaymentInput) -> Result<i64, String> {
        // When editing, undo this payment's previous effects first so the balances below are worked
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
                Self::release_credit_applications(conn, pid)?;
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

        // How a leftover is kept: as an advance (the default) or counted as paid. No refund.
        let chosen_action = match input.excess_action.as_deref().map(|s| s.trim().to_ascii_uppercase()).as_deref() {
            None | Some("") | Some("NONE") | Some("CREDIT") => "CREDIT",
            Some("ROUNDOFF") => "ROUNDOFF",
            Some(_) => return Err("Choose how to keep the extra: advance or round-off.".to_string()),
        };

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

        // Advances fill any gap between the allocations and the money paid.
        let available_credit = Self::available_credit(conn, supplier_id, id.unwrap_or(-1))?;
        let credit_allowed = round2(input.credit_to_apply.max(0.0).min(available_credit));
        if writeoff_amount > MONEY_EPS && total_allocated + MONEY_EPS < total_settled {
            return Err(format!(
                "{} written off is more than the shortfall. Only {} is short.",
                rupees(writeoff_amount),
                rupees((total_allocated - amount_paid).max(0.0))
            ));
        }
        let credit_needed = round2((total_allocated - total_settled).max(0.0));
        if credit_needed > credit_allowed + MONEY_EPS {
            return Err(if credit_allowed > 0.0 {
                format!(
                    "Allocated {}, but only {} paid plus {} advance is available.",
                    rupees(total_allocated),
                    rupees(total_settled),
                    rupees(credit_allowed)
                )
            } else {
                format!("Allocated {} is more than the {} paid.", rupees(total_allocated), rupees(total_settled))
            });
        }
        if total_settled <= 0.0 && credit_needed <= 0.0 {
            return Err("Enter the amount paid.".to_string());
        }

        // Less than half a paisa left over is rounding, not an extra.
        let leftover = round2((total_settled - total_allocated).max(0.0));
        let excess_amount = if leftover > MONEY_EPS { leftover } else { 0.0 };
        let excess_action = if excess_amount > 0.0 { chosen_action } else { "NONE" };

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
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
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
                        credit_needed,
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
                        amount_paid = ?5, total_settled = ?6, credit_applied = ?7, excess_amount = ?8,
                        excess_action = ?9, writeoff_amount = ?10, remarks = ?11, updated_at = ?12
                    WHERE id = ?13
                    "#,
                    params![
                        payment_date,
                        method,
                        clean(&input.reference_number),
                        clean(&input.bank_name),
                        amount_paid,
                        total_settled,
                        credit_needed,
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

        if credit_needed > 0.0 {
            Self::consume_credits(conn, supplier_id, payment_id, credit_needed, &now)?;
        }
        Self::sync_own_advance(conn, payment_id, supplier_id, &payment_number, excess_action, excess_amount, &now)?;
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

    /// Advance the supplier holds, not counting the advance created by `exclude_payment_id`.
    fn available_credit(conn: &Connection, supplier_id: i64, exclude_payment_id: i64) -> Result<f64, String> {
        conn.query_row(
            "SELECT COALESCE(SUM(remaining_amount), 0.0) FROM supplier_credits
             WHERE supplier_id = ?1 AND COALESCE(source_payment_id, -1) != ?2",
            params![supplier_id, exclude_payment_id],
            |r| r.get::<_, f64>(0),
        )
        .map(round2)
        .map_err(|e| e.to_string())
    }

    /// Use advances oldest first.
    fn consume_credits(conn: &Connection, supplier_id: i64, payment_id: i64, amount: f64, now: &str) -> Result<(), String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, remaining_amount FROM supplier_credits
                 WHERE supplier_id = ?1 AND remaining_amount > 0 AND COALESCE(source_payment_id, -1) != ?2
                 ORDER BY created_at ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;
        let credits = stmt
            .query_map(params![supplier_id, payment_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(|e| e.to_string())?;

        let mut left = amount;
        for (credit_id, remaining) in credits {
            if left <= MONEY_EPS {
                break;
            }
            let take = round2(left.min(remaining));
            conn.execute(
                "UPDATE supplier_credits SET remaining_amount = ROUND(remaining_amount - ?1, 2), updated_at = ?2 WHERE id = ?3",
                params![take, now, credit_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO supplier_credit_applications (payment_id, credit_id, amount, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![payment_id, credit_id, take, now],
            )
            .map_err(|e| e.to_string())?;
            left = round2(left - take);
        }
        if left > MONEY_EPS {
            return Err("Not enough advance is available.".to_string());
        }
        Ok(())
    }

    /// Give back advances this payment had used.
    fn release_credit_applications(conn: &Connection, payment_id: i64) -> Result<(), String> {
        conn.execute(
            "UPDATE supplier_credits SET remaining_amount = ROUND(remaining_amount +
                (SELECT SUM(amount) FROM supplier_credit_applications ca WHERE ca.credit_id = supplier_credits.id AND ca.payment_id = ?1), 2)
             WHERE id IN (SELECT credit_id FROM supplier_credit_applications WHERE payment_id = ?1)",
            params![payment_id],
        )
        .map_err(|e| format!("Failed to restore advance: {}", e))?;
        conn.execute("DELETE FROM supplier_credit_applications WHERE payment_id = ?1", params![payment_id])
            .map_err(|e| format!("Failed to restore advance: {}", e))?;
        Ok(())
    }

    /// How much of the advance created by this payment later payments have used.
    fn advance_used(conn: &Connection, payment_id: i64) -> Result<f64, String> {
        conn.query_row(
            "SELECT COALESCE(SUM(original_amount - remaining_amount), 0.0) FROM supplier_credits WHERE source_payment_id = ?1",
            params![payment_id],
            |r| r.get::<_, f64>(0),
        )
        .map(round2)
        .map_err(|e| e.to_string())
    }

    /// Keep the advance created by this payment in line with its leftover amount.
    fn sync_own_advance(
        conn: &Connection,
        payment_id: i64,
        supplier_id: i64,
        payment_number: &str,
        excess_action: &str,
        excess_amount: f64,
        now: &str,
    ) -> Result<(), String> {
        let used = Self::advance_used(conn, payment_id)?;
        let keep = if excess_action == "CREDIT" { excess_amount } else { 0.0 };
        if used > keep + MONEY_EPS {
            return Err(format!(
                "{} of this payment's advance has already been used by a later payment, so at least that much must stay as advance.",
                rupees(used)
            ));
        }

        let existing: Option<i64> = conn
            .query_row("SELECT id FROM supplier_credits WHERE source_payment_id = ?1", params![payment_id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;

        match (existing, keep > MONEY_EPS) {
            (Some(credit_id), true) => conn.execute(
                "UPDATE supplier_credits SET original_amount = ?1, remaining_amount = ROUND(?1 - ?2, 2), updated_at = ?3 WHERE id = ?4",
                params![keep, used, now, credit_id],
            ),
            (Some(credit_id), false) => conn.execute("DELETE FROM supplier_credits WHERE id = ?1", params![credit_id]),
            (None, true) => conn.execute(
                "INSERT INTO supplier_credits (supplier_id, source_payment_id, original_amount, remaining_amount, notes, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?5)",
                params![supplier_id, payment_id, keep, format!("Advance from {}", payment_number), now],
            ),
            (None, false) => Ok(0),
        }
        .map_err(|e| format!("Failed to update advance: {}", e))?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: i64) -> Result<Option<SupplierPaymentWithAllocations>, String> {
        let payment = conn
            .query_row(
                r#"
                SELECT p.id, p.payment_number, p.supplier_id, c.name, p.payment_date, p.payment_method,
                       p.reference_number, p.bank_name, p.amount_paid, p.writeoff_amount, p.total_settled,
                       p.credit_applied, p.excess_amount, p.excess_action, p.remarks, p.created_at, p.updated_at
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
                        credit_applied: r.get(11)?,
                        excess_amount: r.get(12)?,
                        excess_action: r.get(13)?,
                        advance_used: 0.0,
                        remarks: r.get(14)?,
                        created_at: r.get(15)?,
                        updated_at: r.get(16)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to load payment: {}", e))?;
        let Some(mut payment) = payment else { return Ok(None) };
        payment.advance_used = Self::advance_used(conn, id)?;

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
                   p.amount_paid, p.writeoff_amount, p.total_settled, p.credit_applied, p.excess_amount, p.excess_action,
                   (SELECT GROUP_CONCAT(b.bill_number, ', ') FROM supplier_payment_allocations a
                    JOIN supplier_bills b ON b.id = a.bill_id WHERE a.payment_id = p.id)
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
                let covered: Option<String> = r.get(13)?;
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
                    credit_applied: r.get(10)?,
                    excess_amount: r.get(11)?,
                    excess_action: r.get(12)?,
                    bills_covered: covered.map(|s| s.split(", ").map(str::to_string).collect()).unwrap_or_default(),
                })
            })
            .map_err(|e| format!("Failed to load payments: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to load payments: {}", e))
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

    /// Advances paid to the supplier that can still be used. When editing a payment, pass its id so the
    /// advance it already used counts as available and its own advance is left out.
    pub fn supplier_credits(
        conn: &Connection,
        supplier_id: i64,
        exclude_payment_id: Option<i64>,
    ) -> Result<Vec<SupplierCredit>, String> {
        let exclude = exclude_payment_id.unwrap_or(-1);
        let mut stmt = conn
            .prepare(
                r#"
                SELECT c.id, c.supplier_id, c.source_payment_id, p.payment_number, c.original_amount,
                       c.remaining_amount + COALESCE((SELECT SUM(amount) FROM supplier_credit_applications ca
                                                      WHERE ca.credit_id = c.id AND ca.payment_id = ?2), 0.0),
                       c.created_at
                FROM supplier_credits c
                LEFT JOIN supplier_payments p ON p.id = c.source_payment_id
                WHERE c.supplier_id = ?1 AND COALESCE(c.source_payment_id, -1) != ?2
                ORDER BY c.created_at ASC, c.id ASC
                "#,
            )
            .map_err(|e| e.to_string())?;
        let credits = stmt
            .query_map(params![supplier_id, exclude], |r| {
                Ok(SupplierCredit {
                    id: r.get(0)?,
                    supplier_id: r.get(1)?,
                    source_payment_id: r.get(2)?,
                    source_payment_number: r.get(3)?,
                    original_amount: r.get(4)?,
                    remaining_amount: round2(r.get(5)?),
                    created_at: r.get(6)?,
                })
            })
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(|e| e.to_string())?;
        Ok(credits.into_iter().filter(|c| c.remaining_amount > MONEY_EPS).collect())
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
        let advances_held: f64 = conn
            .query_row("SELECT COALESCE(SUM(remaining_amount), 0.0) FROM supplier_credits", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(SupplierPaymentsSummary {
            total_paid: round2(total_paid),
            paid_this_month: round2(paid_this_month),
            advances_held: round2(advances_held),
        })
    }
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

    fn supplier(conn: &Connection, name: &str) -> i64 {
        company(conn, name, "SUPPLIER")
    }

    fn bill(conn: &Connection, supplier: i64, number: &str, total: f64) -> i64 {
        SupplierBillRepository::create(
            conn,
            SupplierBillInput {
                supplier_id: supplier,
                bill_number: number.to_string(),
                bill_date: "2026-04-10".to_string(),
                total_amount: total,
                notes: None,
            },
        )
        .unwrap()
        .bill
        .id
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

    fn pay(supplier: i64, paid: f64, allocs: &[(i64, f64)], credit: f64, action: &str) -> SupplierPaymentInput {
        SupplierPaymentInput {
            payment_number: None,
            supplier_id: supplier,
            payment_date: "2026-05-01".to_string(),
            payment_method: None,
            reference_number: None,
            bank_name: None,
            amount_paid: paid,
            credit_to_apply: credit,
            remarks: None,
            allocations: allocs
                .iter()
                .map(|(bill_id, amount)| SupplierAllocationInput { bill_id: *bill_id, allocated_amount: *amount })
                .collect(),
            excess_action: Some(action.to_string()),
            writeoff_amount: 0.0,
        }
    }

    fn pay_off(supplier: i64, paid: f64, allocs: &[(i64, f64)], writeoff: f64) -> SupplierPaymentInput {
        let mut input = pay(supplier, paid, allocs, 0.0, "NONE");
        input.writeoff_amount = writeoff;
        input
    }

    fn status(conn: &Connection, bill: i64) -> String {
        SupplierBillRepository::get(conn, bill).unwrap().unwrap().status
    }

    fn advance(conn: &Connection, supplier: i64) -> f64 {
        conn.query_row(
            "SELECT COALESCE(SUM(remaining_amount), 0.0) FROM supplier_credits WHERE supplier_id = ?1",
            params![supplier],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn the_owners_three_cases_on_an_11550_bill() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");

        // Pay 11,500 and settle in full: the 50 short is written off.
        let a = bill(&conn, s, "B-1", 11550.0);
        let p = SupplierPaymentRepository::create(&conn, pay_off(s, 11500.0, &[(a, 11550.0)], 50.0)).unwrap().payment;
        assert_eq!((p.total_settled, p.writeoff_amount, p.excess_amount, p.excess_action.as_str()), (11550.0, 50.0, 0.0, "NONE"));
        assert_eq!(status(&conn, a), "PAID");
        assert_eq!(advance(&conn, s), 0.0);

        // Pay 11,600 and count it as paid: the extra 50 is a round-off.
        let b = bill(&conn, s, "B-2", 11550.0);
        let p = SupplierPaymentRepository::create(&conn, pay(s, 11600.0, &[(b, 11550.0)], 0.0, "ROUNDOFF")).unwrap().payment;
        assert_eq!((p.excess_amount, p.excess_action.as_str()), (50.0, "ROUNDOFF"));
        assert_eq!(status(&conn, b), "PAID");
        assert_eq!(advance(&conn, s), 0.0, "a round-off is not an advance");

        // Pay 11,600 and keep the extra as an advance, then use it on the next bill.
        let c = bill(&conn, s, "B-3", 11550.0);
        SupplierPaymentRepository::create(&conn, pay(s, 11600.0, &[(c, 11550.0)], 0.0, "CREDIT")).unwrap();
        assert_eq!(status(&conn, c), "PAID");
        assert_eq!(advance(&conn, s), 50.0);
        let d = bill(&conn, s, "B-4", 1000.0);
        let p = SupplierPaymentRepository::create(&conn, pay(s, 950.0, &[(d, 1000.0)], 50.0, "NONE")).unwrap().payment;
        assert_eq!(p.credit_applied, 50.0);
        assert_eq!(status(&conn, d), "PAID");
        assert_eq!(advance(&conn, s), 0.0);
    }

    #[test]
    fn write_off_and_round_off_have_no_limit() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 100000.0);
        SupplierPaymentRepository::create(&conn, pay_off(s, 40000.0, &[(a, 100000.0)], 60000.0)).unwrap();
        assert_eq!(status(&conn, a), "PAID");
        let b = bill(&conn, s, "B-2", 100000.0);
        let p = SupplierPaymentRepository::create(&conn, pay(s, 150000.0, &[(b, 100000.0)], 0.0, "ROUNDOFF")).unwrap().payment;
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
    fn a_shortfall_without_write_off_or_advance_is_refused() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.0);
        assert_eq!(
            SupplierPaymentRepository::create(&conn, pay(s, 900.0, &[(a, 1000.0)], 0.0, "NONE")).unwrap_err(),
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
            SupplierPaymentRepository::create(&conn, pay(s, 1500.0, &[(a, 1500.0)], 0.0, "CREDIT")).unwrap_err(),
            "₹1,500.00 is more than the ₹1,000.00 still due on bill T/1."
        );
        assert_eq!(
            SupplierPaymentRepository::create(&conn, pay(s, 500.0, &[(theirs, 500.0)], 0.0, "CREDIT")).unwrap_err(),
            "Bill T/9 belongs to a different supplier."
        );
        assert_eq!(
            SupplierPaymentRepository::create(&conn, pay(s, 200.0, &[(a, 100.0), (a, 100.0)], 0.0, "CREDIT")).unwrap_err(),
            "The same bill is listed twice."
        );
        let customer = company(&conn, "Buyer Co", "CUSTOMER");
        let err = SupplierPaymentRepository::create(&conn, pay(customer, 100.0, &[], 0.0, "CREDIT")).unwrap_err();
        assert!(err.contains("customer only"), "{}", err);
        assert_eq!(
            SupplierPaymentRepository::create(&conn, pay(s, 0.0, &[], 0.0, "CREDIT")).unwrap_err(),
            "Enter the amount paid."
        );
        assert_eq!(SupplierPaymentRepository::create(&conn, pay(9999, 10.0, &[], 0.0, "CREDIT")).unwrap_err(), "Select a supplier.");
        assert_eq!(status(&conn, a), "NOT_PAID");
    }

    #[test]
    fn one_payment_can_settle_two_bills() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 600.0);
        let b = bill(&conn, s, "B-2", 400.0);
        let saved = SupplierPaymentRepository::create(&conn, pay(s, 1000.0, &[(a, 600.0), (b, 400.0)], 0.0, "CREDIT")).unwrap();
        assert_eq!(saved.allocations.len(), 2);
        assert_eq!((status(&conn, a), status(&conn, b)), ("PAID".to_string(), "PAID".to_string()));
        assert_eq!(advance(&conn, s), 0.0);
    }

    #[test]
    fn a_payment_with_no_bills_becomes_an_advance() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let p = SupplierPaymentRepository::create(&conn, pay(s, 5000.0, &[], 0.0, "CREDIT")).unwrap().payment;
        assert_eq!((p.excess_amount, p.excess_action.as_str()), (5000.0, "CREDIT"));
        assert_eq!(advance(&conn, s), 5000.0);
    }

    #[test]
    fn advances_are_used_oldest_first() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        SupplierPaymentRepository::create(&conn, pay(s, 300.0, &[], 0.0, "CREDIT")).unwrap();
        SupplierPaymentRepository::create(&conn, pay(s, 500.0, &[], 0.0, "CREDIT")).unwrap();
        let a = bill(&conn, s, "B-1", 400.0);
        let p = SupplierPaymentRepository::create(&conn, pay(s, 0.0, &[(a, 400.0)], 1000.0, "NONE")).unwrap().payment;
        assert_eq!(p.credit_applied, 400.0);
        let remaining: Vec<f64> = conn
            .prepare("SELECT remaining_amount FROM supplier_credits ORDER BY created_at ASC, id ASC")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(remaining, vec![0.0, 400.0]);
        let applications: i64 = conn.query_row("SELECT COUNT(*) FROM supplier_credit_applications", [], |r| r.get(0)).unwrap();
        assert_eq!(applications, 2);
        assert_eq!(status(&conn, a), "PAID");
    }

    #[test]
    fn payment_numbers_run_on_and_must_be_unique() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let fy = financial_year_label();
        let first = SupplierPaymentRepository::create(&conn, pay(s, 10.0, &[], 0.0, "CREDIT")).unwrap().payment.payment_number;
        assert_eq!(first, format!("SP/{}/001", fy));
        let second = SupplierPaymentRepository::create(&conn, pay(s, 10.0, &[], 0.0, "CREDIT")).unwrap().payment.payment_number;
        assert_eq!(second, format!("SP/{}/002", fy));

        let mut dup = pay(s, 10.0, &[], 0.0, "CREDIT");
        dup.payment_number = Some(first.to_lowercase());
        assert_eq!(
            SupplierPaymentRepository::create(&conn, dup).unwrap_err(),
            format!("Payment number {} is already used.", first.to_lowercase())
        );

        // A number typed in another series is kept but does not move the running number.
        let mut other = pay(s, 10.0, &[], 0.0, "CREDIT");
        other.payment_number = Some(format!("PAY/{}/005", fy));
        SupplierPaymentRepository::create(&conn, other).unwrap();
        assert_eq!(SupplierPaymentRepository::next_payment_number(&conn).unwrap(), format!("SP/{}/003", fy));
    }

    #[test]
    fn pennies_never_leave_a_bill_part_paid_or_invent_an_advance() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.10);
        for part in [333.37, 333.37, 333.36] {
            SupplierPaymentRepository::create(&conn, pay(s, part, &[(a, part)], 0.0, "CREDIT")).unwrap();
        }
        assert_eq!(status(&conn, a), "PAID");
        assert_eq!(advance(&conn, s), 0.0);

        let tiny = bill(&conn, s, "B-2", 0.30);
        let floaty = 0.1 + 0.2;
        let p = SupplierPaymentRepository::create(&conn, pay(s, floaty, &[(tiny, 0.30)], 0.0, "CREDIT")).unwrap().payment;
        assert_eq!(p.excess_amount, 0.0);
        assert_eq!(status(&conn, tiny), "PAID");
        assert_eq!(advance(&conn, s), 0.0);
        let credits: i64 = conn.query_row("SELECT COUNT(*) FROM supplier_credits", [], |r| r.get(0)).unwrap();
        assert_eq!(credits, 0, "no advance row for a rounding crumb");
    }

    #[test]
    fn the_extra_defaults_to_advance_and_refund_is_refused() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 100.0);
        let mut none = pay(s, 150.0, &[(a, 100.0)], 0.0, "CREDIT");
        none.excess_action = None;
        assert_eq!(SupplierPaymentRepository::create(&conn, none).unwrap().payment.excess_action, "CREDIT");
        let b = bill(&conn, s, "B-2", 100.0);
        assert_eq!(
            SupplierPaymentRepository::create(&conn, pay(s, 150.0, &[(b, 100.0)], 0.0, "REFUND")).unwrap_err(),
            "Choose how to keep the extra: advance or round-off."
        );
        assert_eq!(status(&conn, b), "NOT_PAID");
    }

    #[test]
    fn editing_recalculates_as_if_never_recorded() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.0);
        let id = SupplierPaymentRepository::create(&conn, pay(s, 1000.0, &[(a, 1000.0)], 0.0, "CREDIT")).unwrap().payment.id;
        assert_eq!(status(&conn, a), "PAID");
        assert!(SupplierPaymentRepository::unpaid_bills_for_supplier(&conn, s, None).unwrap().is_empty());
        let own = SupplierPaymentRepository::unpaid_bills_for_supplier(&conn, s, Some(id)).unwrap();
        assert_eq!((own.len(), own[0].total_settled, own[0].outstanding_amount), (1, 0.0, 1000.0), "its own bill stays available");

        let edited = SupplierPaymentRepository::update(&conn, id, pay(s, 400.0, &[(a, 400.0)], 0.0, "CREDIT")).unwrap();
        assert_eq!(edited.allocations.len(), 1);
        let detail = SupplierBillRepository::get(&conn, a).unwrap().unwrap();
        assert_eq!((detail.status.as_str(), detail.outstanding_amount), ("PARTIAL", 600.0));
    }

    #[test]
    fn the_supplier_and_number_are_fixed_when_editing() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let other = supplier(&conn, "Other Metals");
        let created = SupplierPaymentRepository::create(&conn, pay(s, 100.0, &[], 0.0, "CREDIT")).unwrap().payment;
        let mut edit = pay(other, 150.0, &[], 0.0, "CREDIT");
        edit.payment_number = Some("SP/99-00/099".to_string());
        let edited = SupplierPaymentRepository::update(&conn, created.id, edit).unwrap().payment;
        assert_eq!((edited.supplier_id, edited.payment_number.as_str()), (s, created.payment_number.as_str()));
        assert_eq!(edited.amount_paid, 150.0);
        assert_eq!(advance(&conn, s), 150.0);
        assert_eq!(advance(&conn, other), 0.0);
    }

    #[test]
    fn deleting_reopens_bills_and_gives_back_the_advance_used() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let a = bill(&conn, s, "B-1", 1000.0);
        let first = SupplierPaymentRepository::create(&conn, pay(s, 1050.0, &[(a, 1000.0)], 0.0, "CREDIT")).unwrap().payment.id;
        assert_eq!(advance(&conn, s), 50.0);
        let b = bill(&conn, s, "B-2", 100.0);
        let second = SupplierPaymentRepository::create(&conn, pay(s, 50.0, &[(b, 100.0)], 50.0, "NONE")).unwrap().payment.id;
        assert_eq!((status(&conn, b), advance(&conn, s)), ("PAID".to_string(), 0.0));

        SupplierPaymentRepository::delete(&conn, second).unwrap();
        assert_eq!(status(&conn, b), "NOT_PAID");
        assert_eq!(advance(&conn, s), 50.0, "the advance it used is given back");

        SupplierPaymentRepository::delete(&conn, first).unwrap();
        assert_eq!(status(&conn, a), "NOT_PAID");
        assert_eq!(advance(&conn, s), 0.0, "its own advance goes with it");
    }

    #[test]
    fn a_used_advance_blocks_delete_and_cannot_shrink() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let first = SupplierPaymentRepository::create(&conn, pay(s, 500.0, &[], 0.0, "CREDIT")).unwrap().payment.id;
        let a = bill(&conn, s, "B-1", 300.0);
        let second = SupplierPaymentRepository::create(&conn, pay(s, 0.0, &[(a, 300.0)], 1000.0, "NONE")).unwrap().payment.id;
        assert_eq!(advance(&conn, s), 200.0);

        assert_eq!(
            SupplierPaymentRepository::delete(&conn, first).unwrap_err(),
            "₹300.00 of the advance from this payment has already been used by a later payment. Remove that payment first."
        );
        let err = SupplierPaymentRepository::update(&conn, first, pay(s, 200.0, &[], 0.0, "CREDIT")).unwrap_err();
        assert!(err.contains("already been used by a later payment, so at least that much must stay as advance"), "{}", err);
        assert_eq!(advance(&conn, s), 200.0, "a refused edit changes nothing");

        SupplierPaymentRepository::update(&conn, first, pay(s, 300.0, &[], 0.0, "CREDIT")).unwrap();
        assert_eq!(advance(&conn, s), 0.0);
        SupplierPaymentRepository::delete(&conn, second).unwrap();
        assert_eq!(advance(&conn, s), 300.0);
        SupplierPaymentRepository::delete(&conn, first).unwrap();
        assert_eq!(advance(&conn, s), 0.0);
    }

    #[test]
    fn lists_filter_and_name_the_bills_covered() {
        let (_d, conn) = setup();
        let a = supplier(&conn, "Sri Ganesh Steel");
        let b = supplier(&conn, "Other Metals");
        let bill_a = bill(&conn, a, "BILL-77", 500.0);
        let mut one = pay(a, 500.0, &[(bill_a, 500.0)], 0.0, "CREDIT");
        one.payment_method = Some("Cheque".to_string());
        one.reference_number = Some("UTR123".to_string());
        one.payment_date = "2026-05-01".to_string();
        let first = SupplierPaymentRepository::create(&conn, one).unwrap().payment.id;
        let mut two = pay(b, 200.0, &[], 0.0, "CREDIT");
        two.payment_date = "2026-06-15".to_string();
        two.remarks = Some("advance for the next order".to_string());
        SupplierPaymentRepository::create(&conn, two).unwrap();

        let all = SupplierPaymentRepository::list(&conn, SupplierPaymentFilter::default()).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].supplier_name, "Other Metals", "newest first");
        assert!(all[0].bills_covered.is_empty(), "an advance covers no bill");
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
        let newer = bill_on(&conn, s, "B-NEW", "2026-05-01", 300.0);
        let older = bill_on(&conn, s, "B-OLD", "2026-03-01", 500.0);
        let done = bill_on(&conn, s, "B-DONE", "2026-04-01", 100.0);
        SupplierPaymentRepository::create(&conn, pay(s, 100.0, &[(done, 100.0)], 0.0, "CREDIT")).unwrap();
        SupplierPaymentRepository::create(&conn, pay(s, 200.0, &[(older, 200.0)], 0.0, "CREDIT")).unwrap();
        let open = SupplierPaymentRepository::unpaid_bills_for_supplier(&conn, s, None).unwrap();
        let numbers: Vec<&str> = open.iter().map(|b| b.bill_number.as_str()).collect();
        assert_eq!(numbers, vec!["B-OLD", "B-NEW"]);
        assert_eq!((open[0].total_settled, open[0].outstanding_amount), (200.0, 300.0));
        let _ = newer;
    }

    #[test]
    fn credits_and_summary_add_up() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        let first = SupplierPaymentRepository::create(&conn, pay(s, 500.0, &[], 0.0, "CREDIT")).unwrap().payment;
        let a = bill(&conn, s, "B-1", 300.0);
        let second = SupplierPaymentRepository::create(&conn, pay(s, 0.0, &[(a, 300.0)], 1000.0, "NONE")).unwrap().payment;

        let credits = SupplierPaymentRepository::supplier_credits(&conn, s, None).unwrap();
        assert_eq!((credits.len(), credits[0].remaining_amount), (1, 200.0));
        assert_eq!(credits[0].source_payment_number.as_deref(), Some(first.payment_number.as_str()));
        // Editing the second payment gets back what it used; editing the first leaves its own advance out.
        assert_eq!(SupplierPaymentRepository::supplier_credits(&conn, s, Some(second.id)).unwrap()[0].remaining_amount, 500.0);
        assert!(SupplierPaymentRepository::supplier_credits(&conn, s, Some(first.id)).unwrap().is_empty());

        let today = crate::util::today().format("%Y-%m-%d").to_string();
        let open = bill(&conn, s, "B-2", 1000.0);
        let mut now = pay(s, 70.0, &[(open, 70.0)], 0.0, "CREDIT");
        now.payment_date = today;
        SupplierPaymentRepository::create(&conn, now).unwrap();
        let sum = SupplierPaymentRepository::summary(&conn).unwrap();
        assert_eq!((sum.total_paid, sum.paid_this_month, sum.advances_held), (570.0, 70.0, 200.0));
    }

    #[test]
    fn a_missing_payment_gets_a_plain_message() {
        let (_d, conn) = setup();
        let s = supplier(&conn, "Steel Co");
        assert_eq!(SupplierPaymentRepository::update(&conn, 9999, pay(s, 10.0, &[], 0.0, "CREDIT")).unwrap_err(), "Payment not found.");
        assert_eq!(SupplierPaymentRepository::delete(&conn, 9999).unwrap_err(), "Payment not found.");
        assert!(SupplierPaymentRepository::get(&conn, 9999).unwrap().is_none());
    }
}
