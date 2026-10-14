use super::models::{
    CustomerCredit, InvoicePaymentItem, InvoicePaymentSummary, Payment, PaymentAllocationDetail,
    PaymentFilterInput, PaymentInput, PaymentListItem, PaymentWithAllocations, PaymentsKpiSummary,
    UnpaidInvoiceSummary,
};
use crate::customers::models::PartyRole;
use crate::customers::repository::CustomerRepository;
use crate::invoices::repository::InvoiceRepository;
use crate::util::{doc_number, doc_sequence, financial_year_label, normalize_date, parse_date, round2, rupees, today};
use chrono::{Datelike, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;

const EPS: f64 = 0.005;

pub struct PaymentRepository;

/// Invoice figures used when validating an allocation.
struct InvoiceBalance {
    number: String,
    customer_id: Option<i64>,
    status: String,
    outstanding: f64,
}

impl PaymentRepository {
    pub fn get_next_payment_number(conn: &Connection) -> Result<String, String> {
        let fy = financial_year_label();

        let mut stmt = conn
            .prepare("SELECT payment_number FROM payments WHERE payment_number LIKE 'PAY/%'")
            .map_err(|e| format!("Failed to work out the next payment number: {}", e))?;

        let max_seq = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to work out the next payment number: {}", e))?
            .filter_map(Result::ok)
            .filter_map(|num| doc_sequence(&num, "PAY", &fy))
            .max()
            .unwrap_or(0);

        // e.g. PAY/004/26-27; the older PAY/26-27/004 form still counts towards the running number.
        Ok(doc_number("PAY", max_seq + 1, &fy))
    }

    pub fn create_payment(conn: &Connection, input: PaymentInput) -> Result<PaymentWithAllocations, String> {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        let id = Self::save(&tx, None, input)?;
        tx.commit().map_err(|e| format!("Failed to save payment: {}", e))?;
        Self::get_payment_by_id(conn, id)?.ok_or_else(|| "Saved payment could not be reloaded.".to_string())
    }

    pub fn update_payment(conn: &Connection, id: i64, input: PaymentInput) -> Result<PaymentWithAllocations, String> {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        Self::save(&tx, Some(id), input)?;
        tx.commit().map_err(|e| format!("Failed to save payment: {}", e))?;
        Self::get_payment_by_id(conn, id)?.ok_or_else(|| "Saved payment could not be reloaded.".to_string())
    }

    pub fn delete_payment(conn: &Connection, id: i64) -> Result<(), String> {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        let used = Self::advance_used(&tx, id)?;
        if used > EPS {
            return Err(format!(
                "{} of the advance from this payment has already been used by a later payment. Remove that payment first.",
                rupees(used)
            ));
        }

        Self::release_credit_applications(&tx, id)?;
        tx.execute("DELETE FROM customer_credits WHERE source_payment_id = ?1", params![id])
            .map_err(|e| format!("Failed to remove advance: {}", e))?;

        let rows = tx
            .execute("DELETE FROM payments WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete payment: {}", e))?;
        if rows == 0 {
            return Err(format!("Payment {} was not found.", id));
        }

        tx.commit().map_err(|e| format!("Failed to delete payment: {}", e))
    }

    /// Validates the input and writes the payment, its allocations, the advances it uses
    /// and the advance it creates. Runs inside the caller's transaction.
    fn save(conn: &Connection, id: Option<i64>, input: PaymentInput) -> Result<i64, String> {
        // When editing, undo this payment's previous effects first so balances below
        // are computed as if it had never been recorded.
        let (customer_id, payment_number) = match id {
            Some(pid) => {
                let (cust, number): (Option<i64>, String) = conn
                    .query_row(
                        "SELECT customer_id, payment_number FROM payments WHERE id = ?1",
                        params![pid],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()
                    .map_err(|e| format!("Failed to load payment: {}", e))?
                    .ok_or_else(|| format!("Payment {} was not found.", pid))?;
                let cust = cust.ok_or("This payment's customer has been deleted, so it can no longer be edited.")?;
                Self::release_credit_applications(conn, pid)?;
                conn.execute("DELETE FROM payment_allocations WHERE payment_id = ?1", params![pid])
                    .map_err(|e| format!("Failed to update allocations: {}", e))?;
                (cust, number)
            }
            None => {
                let number = match input.payment_number.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    Some(n) => n.to_string(),
                    None => Self::get_next_payment_number(conn)?,
                };
                let taken: Option<i64> = conn
                    .query_row(
                        "SELECT id FROM payments WHERE payment_number = ?1 COLLATE NOCASE",
                        params![number],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                if taken.is_some() {
                    return Err(format!("Payment number {} is already used.", number));
                }
                (input.customer_id, number)
            }
        };

        let customer_name: String = conn
            .query_row("SELECT name FROM customers WHERE id = ?1", params![customer_id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("Select a customer.")?;
        CustomerRepository::require_party(conn, customer_id, PartyRole::Customer)?;

        let payment_date = normalize_date(&input.payment_date, "Payment date")?;
        let amount_received = round2(input.amount_received);
        let tds_amount = round2(input.tds_amount);
        if amount_received < 0.0 || tds_amount < 0.0 {
            return Err("Amounts cannot be negative.".to_string());
        }
        let tds_recognized = input.tds_recognized && tds_amount > 0.0;
        let writeoff_amount = round2(input.writeoff_amount);
        if writeoff_amount < 0.0 {
            return Err("Amounts cannot be negative.".to_string());
        }
        let money_in = round2(amount_received + if tds_recognized { tds_amount } else { 0.0 });
        let total_settled = round2(money_in + writeoff_amount);

        // Check every allocation against the invoice's current balance.
        let mut seen = HashSet::new();
        let mut allocations = Vec::new();
        for alloc in &input.allocations {
            let amount = round2(alloc.allocated_amount);
            if amount <= 0.0 {
                continue;
            }
            if !seen.insert(alloc.invoice_id) {
                return Err("The same invoice is listed twice.".to_string());
            }
            let inv = Self::invoice_balance(conn, alloc.invoice_id)?;
            if inv.customer_id != Some(customer_id) {
                return Err(format!("Invoice {} belongs to a different customer.", inv.number));
            }
            if !inv.status.eq_ignore_ascii_case("ISSUED") {
                return Err(format!("Invoice {} is {} and cannot take payments.", inv.number, inv.status.to_lowercase()));
            }
            if amount > inv.outstanding + EPS {
                return Err(format!(
                    "{} is more than the {} still due on invoice {}.",
                    rupees(amount), rupees(inv.outstanding), inv.number
                ));
            }
            allocations.push((alloc.invoice_id, amount));
        }
        let total_allocated = round2(allocations.iter().map(|(_, a)| a).sum());

        // Advances fill any gap between the allocations and the money received.
        let id_for_exclusion = id.unwrap_or(-1);
        let available_credit = Self::available_credit(conn, customer_id, id_for_exclusion)?;
        let credit_allowed = round2(input.credit_to_apply.max(0.0).min(available_credit));
        if writeoff_amount > EPS && total_allocated + EPS < total_settled {
            return Err(format!(
                "{} written off is more than the shortfall. Only {} is short.",
                rupees(writeoff_amount),
                rupees((total_allocated - money_in).max(0.0))
            ));
        }
        let credit_needed = round2((total_allocated - total_settled).max(0.0));
        if credit_needed > credit_allowed + EPS {
            return Err(if credit_allowed > 0.0 {
                format!(
                    "Allocated {}, but only {} received plus {} advance is available.",
                    rupees(total_allocated), rupees(total_settled), rupees(credit_allowed)
                )
            } else {
                format!(
                    "Allocated {} is more than the {} received.",
                    rupees(total_allocated), rupees(total_settled)
                )
            });
        }
        if total_settled <= 0.0 && credit_needed <= 0.0 {
            return Err("Enter the amount received.".to_string());
        }

        let excess_amount = round2((total_settled - total_allocated).max(0.0));
        let excess_action = if excess_amount > EPS {
            match input.excess_action.as_deref().map(|s| s.trim().to_ascii_uppercase()) {
                Some(a) if a == "REFUND" => "REFUND",
                Some(a) if a == "ROUNDOFF" => "ROUNDOFF",
                _ => "CREDIT",
            }
        } else {
            "NONE"
        };

        let now = Utc::now().to_rfc3339();
        let clean = |v: &Option<String>| v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let method = clean(&input.payment_method).unwrap_or_else(|| "Bank Transfer".to_string());

        let payment_id = match id {
            None => {
                conn.execute(
                    r#"
                    INSERT INTO payments (
                        payment_number, customer_id, customer_name, payment_date, payment_method,
                        reference_number, bank_name, amount_received, tds_deducted, total_settled,
                        credit_applied, excess_amount, excess_action, is_verified, is_important,
                        remarks, created_at, updated_at, tds_recognized, writeoff_amount
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 0, ?15, ?16, ?16, ?17, ?18)
                    "#,
                    params![
                        payment_number, customer_id, customer_name, payment_date, method,
                        clean(&input.reference_number), clean(&input.bank_name), amount_received, tds_amount,
                        total_settled, credit_needed, excess_amount, excess_action, input.is_verified as i32,
                        clean(&input.remarks), now, tds_recognized as i32, writeoff_amount,
                    ],
                )
                .map_err(|e| format!("Failed to save payment: {}", e))?;
                conn.last_insert_rowid()
            }
            Some(pid) => {
                conn.execute(
                    r#"
                    UPDATE payments SET
                        customer_name = ?1, payment_date = ?2, payment_method = ?3, reference_number = ?4,
                        bank_name = ?5, amount_received = ?6, tds_deducted = ?7, total_settled = ?8,
                        credit_applied = ?9, excess_amount = ?10, excess_action = ?11, is_verified = ?12,
                        remarks = ?13, updated_at = ?14, tds_recognized = ?15, writeoff_amount = ?16
                    WHERE id = ?17
                    "#,
                    params![
                        customer_name, payment_date, method, clean(&input.reference_number),
                        clean(&input.bank_name), amount_received, tds_amount, total_settled, credit_needed,
                        excess_amount, excess_action, input.is_verified as i32, clean(&input.remarks), now, tds_recognized as i32, writeoff_amount, pid,
                    ],
                )
                .map_err(|e| format!("Failed to save payment: {}", e))?;
                pid
            }
        };

        for (invoice_id, amount) in &allocations {
            conn.execute(
                "INSERT INTO payment_allocations (payment_id, invoice_id, amount_allocated, tds_allocated, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
                params![payment_id, invoice_id, amount, now],
            )
            .map_err(|e| format!("Failed to save allocation: {}", e))?;
        }

        if credit_needed > 0.0 {
            Self::consume_credits(conn, customer_id, payment_id, credit_needed, &now)?;
        }

        Self::sync_own_advance(conn, payment_id, customer_id, &payment_number, excess_action, excess_amount, &now)?;

        Ok(payment_id)
    }

    fn invoice_balance(conn: &Connection, invoice_id: i64) -> Result<InvoiceBalance, String> {
        conn.query_row(
            r#"
            SELECT i.invoice_number, i.customer_id, i.status, i.total_amount,
                   COALESCE((SELECT SUM(amount_allocated + tds_allocated) FROM payment_allocations WHERE invoice_id = i.id), 0.0)
            FROM invoices i WHERE i.id = ?1
            "#,
            params![invoice_id],
            |r| {
                let total: f64 = r.get(3)?;
                let settled: f64 = r.get(4)?;
                Ok(InvoiceBalance {
                    number: r.get(0)?,
                    customer_id: r.get(1)?,
                    status: r.get(2)?,
                    outstanding: round2(total - settled).max(0.0),
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Invoice {} was not found.", invoice_id))
    }

    /// Advance the customer can use, not counting the advance created by `exclude_payment_id`.
    fn available_credit(conn: &Connection, customer_id: i64, exclude_payment_id: i64) -> Result<f64, String> {
        conn.query_row(
            "SELECT COALESCE(SUM(remaining_amount), 0.0) FROM customer_credits WHERE customer_id = ?1 AND COALESCE(source_payment_id, -1) != ?2",
            params![customer_id, exclude_payment_id],
            |r| r.get::<_, f64>(0),
        )
        .map(round2)
        .map_err(|e| e.to_string())
    }

    /// Use advances oldest first.
    fn consume_credits(conn: &Connection, customer_id: i64, payment_id: i64, amount: f64, now: &str) -> Result<(), String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, remaining_amount FROM customer_credits
                 WHERE customer_id = ?1 AND remaining_amount > 0 AND COALESCE(source_payment_id, -1) != ?2
                 ORDER BY created_at ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;
        let credits = stmt
            .query_map(params![customer_id, payment_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(|e| e.to_string())?;

        let mut left = amount;
        for (credit_id, remaining) in credits {
            if left <= EPS {
                break;
            }
            let take = round2(left.min(remaining));
            conn.execute(
                "UPDATE customer_credits SET remaining_amount = ROUND(remaining_amount - ?1, 2), updated_at = ?2 WHERE id = ?3",
                params![take, now, credit_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO credit_applications (payment_id, credit_id, amount, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![payment_id, credit_id, take, now],
            )
            .map_err(|e| e.to_string())?;
            left = round2(left - take);
        }
        if left > EPS {
            return Err("Not enough advance is available.".to_string());
        }
        Ok(())
    }

    /// Give back advances this payment had used.
    fn release_credit_applications(conn: &Connection, payment_id: i64) -> Result<(), String> {
        conn.execute(
            "UPDATE customer_credits SET remaining_amount = ROUND(remaining_amount +
                (SELECT SUM(amount) FROM credit_applications ca WHERE ca.credit_id = customer_credits.id AND ca.payment_id = ?1), 2)
             WHERE id IN (SELECT credit_id FROM credit_applications WHERE payment_id = ?1)",
            params![payment_id],
        )
        .map_err(|e| format!("Failed to restore advance: {}", e))?;
        conn.execute("DELETE FROM credit_applications WHERE payment_id = ?1", params![payment_id])
            .map_err(|e| format!("Failed to restore advance: {}", e))?;
        Ok(())
    }

    /// How much of the advance created by this payment later payments have used.
    fn advance_used(conn: &Connection, payment_id: i64) -> Result<f64, String> {
        conn.query_row(
            "SELECT COALESCE(SUM(original_amount - remaining_amount), 0.0) FROM customer_credits WHERE source_payment_id = ?1",
            params![payment_id],
            |r| r.get::<_, f64>(0),
        )
        .map(round2)
        .map_err(|e| e.to_string())
    }

    /// Keep the advance created by this payment in line with its unallocated amount.
    fn sync_own_advance(
        conn: &Connection,
        payment_id: i64,
        customer_id: i64,
        payment_number: &str,
        excess_action: &str,
        excess_amount: f64,
        now: &str,
    ) -> Result<(), String> {
        let used = Self::advance_used(conn, payment_id)?;
        let keep = if excess_action == "CREDIT" { excess_amount } else { 0.0 };
        if used > keep + EPS {
            return Err(format!(
                "{} of this payment's advance has already been used by a later payment, so at least that much must stay as advance.",
                rupees(used)
            ));
        }

        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM customer_credits WHERE source_payment_id = ?1",
                params![payment_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        match (existing, keep > EPS) {
            (Some(credit_id), true) => conn.execute(
                "UPDATE customer_credits SET original_amount = ?1, remaining_amount = ROUND(?1 - ?2, 2), updated_at = ?3 WHERE id = ?4",
                params![keep, used, now, credit_id],
            ),
            (Some(credit_id), false) => conn.execute("DELETE FROM customer_credits WHERE id = ?1", params![credit_id]),
            (None, true) => conn.execute(
                "INSERT INTO customer_credits (customer_id, source_payment_id, original_amount, remaining_amount, notes, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?5)",
                params![customer_id, payment_id, keep, format!("Advance from {}", payment_number), now],
            ),
            (None, false) => Ok(0),
        }
        .map_err(|e| format!("Failed to update advance: {}", e))?;
        Ok(())
    }

    pub fn get_payment_by_id(conn: &Connection, id: i64) -> Result<Option<PaymentWithAllocations>, String> {
        let payment = conn
            .query_row(
                r#"
                SELECT id, payment_number, customer_id, customer_name, payment_date, payment_method,
                       reference_number, bank_name, amount_received, tds_deducted, total_settled,
                       credit_applied, excess_amount, excess_action, is_verified, remarks, created_at, updated_at,
                       tds_recognized, writeoff_amount
                FROM payments WHERE id = ?1
                "#,
                params![id],
                |r| {
                    Ok(Payment {
                        id: r.get(0)?,
                        payment_number: r.get(1)?,
                        customer_id: r.get(2)?,
                        customer_name: r.get(3)?,
                        payment_date: r.get(4)?,
                        payment_method: r.get(5)?,
                        reference_number: r.get(6)?,
                        bank_name: r.get(7)?,
                        amount_received: r.get(8)?,
                        tds_amount: r.get(9)?,
                        total_settled: r.get(10)?,
                        credit_applied: r.get(11)?,
                        excess_amount: r.get(12)?,
                        excess_action: r.get(13)?,
                        advance_used: 0.0,
                        is_verified: r.get::<_, i32>(14)? != 0,
                        remarks: r.get(15)?,
                        created_at: r.get(16)?,
                        updated_at: r.get(17)?,
                        tds_recognized: r.get::<_, i32>(18)? != 0,
                        writeoff_amount: r.get(19)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to load payment: {}", e))?;

        let Some(mut payment) = payment else {
            return Ok(None);
        };
        payment.advance_used = Self::advance_used(conn, id)?;

        let mut stmt = conn
            .prepare(
                r#"
                SELECT pa.invoice_id, i.invoice_number, i.invoice_date, i.total_amount, pa.amount_allocated + pa.tds_allocated
                FROM payment_allocations pa
                JOIN invoices i ON i.id = pa.invoice_id
                WHERE pa.payment_id = ?1
                ORDER BY i.invoice_date ASC, pa.id ASC
                "#,
            )
            .map_err(|e| format!("Failed to load allocations: {}", e))?;

        let allocations = stmt
            .query_map(params![id], |r| {
                Ok(PaymentAllocationDetail {
                    invoice_id: r.get(0)?,
                    invoice_number: r.get(1)?,
                    invoice_date: r.get(2)?,
                    invoice_total_amount: r.get(3)?,
                    allocated_amount: r.get(4)?,
                })
            })
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(|e| format!("Failed to load allocations: {}", e))?;

        Ok(Some(PaymentWithAllocations { payment, allocations }))
    }

    pub fn list_payments(conn: &Connection, filter: PaymentFilterInput) -> Result<Vec<PaymentListItem>, String> {
        let mut query = String::from(
            r#"
            SELECT p.id, p.payment_number, p.customer_id, p.customer_name, p.payment_date, p.payment_method,
                   p.reference_number, p.amount_received, p.tds_deducted, p.total_settled, p.credit_applied,
                   p.excess_amount, p.excess_action, p.is_verified,
                   (SELECT GROUP_CONCAT(i.invoice_number, ', ') FROM payment_allocations pa
                    JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = p.id),
                   p.tds_recognized, p.writeoff_amount
            FROM payments p
            WHERE 1=1
            "#,
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(q) = filter.query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let pat = format!("%{}%", q);
            query.push_str(
                " AND (p.payment_number LIKE ? OR p.customer_name LIKE ? OR p.reference_number LIKE ? OR p.remarks LIKE ?
                  OR EXISTS (SELECT 1 FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id
                             WHERE pa.payment_id = p.id AND i.invoice_number LIKE ?))",
            );
            for _ in 0..5 {
                params_vec.push(Box::new(pat.clone()));
            }
        }
        if let Some(cid) = filter.customer_id {
            query.push_str(" AND p.customer_id = ?");
            params_vec.push(Box::new(cid));
        }
        if let Some(df) = filter.date_from.as_deref().and_then(parse_date) {
            query.push_str(" AND p.payment_date >= ?");
            params_vec.push(Box::new(df.format("%Y-%m-%d").to_string()));
        }
        if let Some(dt) = filter.date_to.as_deref().and_then(parse_date) {
            query.push_str(" AND p.payment_date <= ?");
            params_vec.push(Box::new(dt.format("%Y-%m-%d").to_string()));
        }
        if let Some(method) = filter.payment_method.as_deref().map(str::trim).filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("ALL")) {
            query.push_str(" AND p.payment_method = ?");
            params_vec.push(Box::new(method.to_string()));
        }
        if let Some(ver) = filter.is_verified {
            query.push_str(" AND p.is_verified = ?");
            params_vec.push(Box::new(ver as i32));
        }
        query.push_str(" ORDER BY p.payment_date DESC, p.id DESC");

        let mut stmt = conn.prepare(&query).map_err(|e| format!("Failed to load payments: {}", e))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params_vec.iter()), |r| {
                let covered: Option<String> = r.get(14)?;
                Ok(PaymentListItem {
                    id: r.get(0)?,
                    payment_number: r.get(1)?,
                    customer_id: r.get(2)?,
                    customer_name: r.get(3)?,
                    payment_date: r.get(4)?,
                    payment_method: r.get(5)?,
                    reference_number: r.get(6)?,
                    amount_received: r.get(7)?,
                    tds_amount: r.get(8)?,
                    tds_recognized: r.get::<_, i32>(15)? != 0,
                    total_settled: r.get(9)?,
                    credit_applied: r.get(10)?,
                    excess_amount: r.get(11)?,
                    excess_action: r.get(12)?,
                    writeoff_amount: r.get(16)?,
                    is_verified: r.get::<_, i32>(13)? != 0,
                    invoices_covered: covered
                        .map(|s| s.split(", ").map(str::to_string).collect())
                        .unwrap_or_default(),
                })
            })
            .map_err(|e| format!("Failed to load payments: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to load payments: {}", e))
    }

    /// Invoices a payment for this customer can be allocated to, oldest first. When editing,
    /// pass the payment id so its own allocations count as still available.
    pub fn get_unpaid_invoices_for_customer(
        conn: &Connection,
        customer_id: i64,
        exclude_payment_id: Option<i64>,
    ) -> Result<Vec<UnpaidInvoiceSummary>, String> {
        let exclude = exclude_payment_id.unwrap_or(-1);
        let mut stmt = conn
            .prepare(
                r#"
                SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount,
                       COALESCE(SUM(CASE WHEN pa.payment_id != ?2 THEN pa.amount_allocated + pa.tds_allocated END), 0.0),
                       MAX(CASE WHEN pa.payment_id = ?2 THEN 1 ELSE 0 END),
                       i.subtotal - i.discount
                FROM invoices i
                LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
                WHERE i.customer_id = ?1 AND i.status = 'ISSUED'
                GROUP BY i.id
                ORDER BY i.invoice_date ASC, i.id ASC
                "#,
            )
            .map_err(|e| format!("Failed to load unpaid invoices: {}", e))?;

        let rows = stmt
            .query_map(params![customer_id, exclude], |r| {
                let total_amount: f64 = r.get(3)?;
                let total_settled = round2(r.get::<_, f64>(4)?);
                let has_own: i32 = r.get::<_, Option<i32>>(5)?.unwrap_or(0);
                Ok((
                    has_own == 1,
                    UnpaidInvoiceSummary {
                        invoice_id: r.get(0)?,
                        invoice_number: r.get(1)?,
                        invoice_date: r.get(2)?,
                        total_amount,
                        taxable_amount: round2(r.get::<_, f64>(6)?),
                        total_settled,
                        outstanding_amount: round2(total_amount - total_settled).max(0.0),
                    },
                ))
            })
            .map_err(|e| format!("Failed to load unpaid invoices: {}", e))?;

        let mut list = Vec::new();
        for row in rows {
            let (has_own, inv) = row.map_err(|e| e.to_string())?;
            if has_own || inv.outstanding_amount > 0.01 {
                list.push(inv);
            }
        }
        Ok(list)
    }

    pub fn get_invoice_payment_summary(conn: &Connection, invoice_id: i64) -> Result<InvoicePaymentSummary, String> {
        let (total_amount, status): (f64, String) = conn
            .query_row(
                "SELECT total_amount, status FROM invoices WHERE id = ?1",
                params![invoice_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| format!("Invoice {} was not found: {}", invoice_id, e))?;

        let mut stmt = conn
            .prepare(
                r#"
                SELECT p.id, p.payment_number, p.payment_date, p.payment_method, p.reference_number,
                       pa.amount_allocated + pa.tds_allocated, p.is_verified
                FROM payment_allocations pa
                JOIN payments p ON p.id = pa.payment_id
                WHERE pa.invoice_id = ?1
                ORDER BY p.payment_date ASC, pa.id ASC
                "#,
            )
            .map_err(|e| e.to_string())?;

        let payments = stmt
            .query_map(params![invoice_id], |r| {
                Ok(InvoicePaymentItem {
                    payment_id: r.get(0)?,
                    payment_number: r.get(1)?,
                    payment_date: r.get(2)?,
                    payment_method: r.get(3)?,
                    reference_number: r.get(4)?,
                    amount: r.get(5)?,
                    is_verified: r.get::<_, i32>(6)? != 0,
                })
            })
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(|e| e.to_string())?;

        let total_settled = round2(payments.iter().map(|p| p.amount).sum());
        let outstanding_amount = round2(total_amount - total_settled).max(0.0);

        Ok(InvoicePaymentSummary {
            invoice_id,
            total_amount,
            total_settled,
            outstanding_amount,
            payment_status: InvoiceRepository::payment_status(&status, total_settled, outstanding_amount),
            payments,
        })
    }

    pub fn get_payments_kpi_summary(conn: &Connection) -> Result<PaymentsKpiSummary, String> {
        let month_start = today().with_day(1).unwrap_or_else(today).format("%Y-%m-%d").to_string();

        let (total_received, total_tds, unverified_count, received_this_month): (f64, f64, i64, f64) = conn
            .query_row(
                r#"
                SELECT COALESCE(SUM(amount_received), 0.0), COALESCE(SUM(tds_deducted), 0.0),
                       COALESCE(SUM(CASE WHEN is_verified = 0 THEN 1 ELSE 0 END), 0),
                       COALESCE(SUM(CASE WHEN payment_date >= ?1 THEN amount_received ELSE 0 END), 0.0)
                FROM payments
                "#,
                params![month_start],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(|e| e.to_string())?;

        let advances_held: f64 = conn
            .query_row("SELECT COALESCE(SUM(remaining_amount), 0.0) FROM customer_credits", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;

        let invoiced_this_month: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total_amount), 0.0) FROM invoices WHERE status = 'ISSUED' AND invoice_date >= ?1",
                params![month_start],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare(
                r#"
                SELECT i.total_amount,
                       COALESCE(SUM(pa.amount_allocated + pa.tds_allocated), 0.0)
                FROM invoices i
                LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
                WHERE i.status = 'ISSUED'
                GROUP BY i.id
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)))
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(|e| e.to_string())?;

        let mut total_outstanding = 0.0;
        let mut unpaid_invoices_count = 0;
        for (total, settled) in rows {
            let outstanding = round2(total - settled).max(0.0);
            if outstanding > 0.01 {
                total_outstanding += outstanding;
                unpaid_invoices_count += 1;
            }
        }

        Ok(PaymentsKpiSummary {
            total_received: round2(total_received),
            total_tds: round2(total_tds),
            total_outstanding: round2(total_outstanding),
            unpaid_invoices_count,
            unverified_count,
            advances_held: round2(advances_held),
            received_this_month: round2(received_this_month),
            invoiced_this_month: round2(invoiced_this_month),
        })
    }

    /// Advances the customer can use. When editing a payment, pass its id so the advance it
    /// already used counts as available and its own advance is left out.
    pub fn get_customer_credits(
        conn: &Connection,
        customer_id: i64,
        exclude_payment_id: Option<i64>,
    ) -> Result<Vec<CustomerCredit>, String> {
        let exclude = exclude_payment_id.unwrap_or(-1);
        let mut stmt = conn
            .prepare(
                r#"
                SELECT c.id, c.customer_id, c.source_payment_id, p.payment_number, c.original_amount,
                       c.remaining_amount + COALESCE((SELECT SUM(amount) FROM credit_applications ca
                                                      WHERE ca.credit_id = c.id AND ca.payment_id = ?2), 0.0),
                       c.created_at
                FROM customer_credits c
                LEFT JOIN payments p ON p.id = c.source_payment_id
                WHERE c.customer_id = ?1 AND COALESCE(c.source_payment_id, -1) != ?2
                ORDER BY c.created_at ASC, c.id ASC
                "#,
            )
            .map_err(|e| e.to_string())?;

        let credits = stmt
            .query_map(params![customer_id, exclude], |r| {
                Ok(CustomerCredit {
                    id: r.get(0)?,
                    customer_id: r.get(1)?,
                    source_payment_id: r.get(2)?,
                    source_payment_number: r.get(3)?,
                    original_amount: r.get(4)?,
                    remaining_amount: round2(r.get(5)?),
                    created_at: r.get(6)?,
                })
            })
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(|e| e.to_string())?;

        Ok(credits.into_iter().filter(|c| c.remaining_amount > 0.01).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::customers::models::CustomerCreateInput;
    use crate::customers::repository::CustomerRepository;
    use crate::db::DatabaseManager;
    use crate::invoices::models::{InvoiceCreateInput, InvoiceItemInput};
    use crate::payments::models::PaymentAllocationInput;

    fn setup() -> Connection {
        let dir = tempfile::tempdir().unwrap().keep();
        DatabaseManager::new(dir.join("payments.db")).unwrap().get_connection().unwrap()
    }

    fn customer(conn: &Connection, name: &str) -> i64 {
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
                party_type: None,
            },
        )
        .unwrap()
        .id
    }

    /// An issued invoice for `customer_id` with no tax, so its total is exactly `amount`.
    fn invoice_input(customer_id: i64, number: &str, amount: f64) -> InvoiceCreateInput {
        InvoiceCreateInput {
            invoice_number: number.to_string(),
            invoice_date: "2026-04-10".to_string(),
            due_date: None,
            payment_terms_days: None,
            invoice_state: None,
            customer_id: Some(customer_id),
            customer_name: "Customer".to_string(),
            customer_address: None,
            customer_phone: None,
            customer_gstin: None,
            customer_state: None,
            customer_state_code: None,
            po_number_and_date: None,
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
            cgst_rate: Some(0.0),
            sgst_rate: Some(0.0),
            igst_rate: None,
            bank_name: None,
            bank_branch: None,
            bank_account_no: None,
            bank_ifsc: None,
            terms_and_conditions: None,
            status: None,
            notes: None,
            purchase_order_id: None,
            items: vec![InvoiceItemInput {
                sl_no: None,
                description: "Work".to_string(),
                hsn_sac: None,
                qum: None,
                quantity: 1.0,
                rate: amount,
            }],
        }
    }

    fn invoice(conn: &Connection, customer_id: i64, number: &str, amount: f64) -> i64 {
        InvoiceRepository::create(conn, invoice_input(customer_id, number, amount)).unwrap().invoice.id
    }

    fn payment(customer_id: i64, received: f64, allocs: &[(i64, f64)], credit: f64, action: &str) -> PaymentInput {
        PaymentInput {
            payment_number: None,
            customer_id,
            payment_date: "2026-05-01".to_string(),
            payment_method: None,
            reference_number: None,
            bank_name: Some("SBI".to_string()),
            amount_received: received,
            tds_amount: 0.0,
            tds_recognized: true,
            credit_to_apply: credit,
            is_verified: true,
            remarks: None,
            allocations: allocs
                .iter()
                .map(|(invoice_id, amount)| PaymentAllocationInput { invoice_id: *invoice_id, allocated_amount: *amount })
                .collect(),
            excess_action: Some(action.to_string()),
            writeoff_amount: 0.0,
        }
    }

    fn advance(conn: &Connection, customer_id: i64) -> f64 {
        PaymentRepository::available_credit(conn, customer_id, -1).unwrap()
    }

    #[test]
    fn rejects_allocation_above_invoice_balance() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "T/1", 1000.0);
        let err = PaymentRepository::create_payment(&conn, payment(c, 1500.0, &[(inv, 1500.0)], 0.0, "CREDIT")).unwrap_err();
        assert!(err.contains("still due"), "{}", err);
    }

    #[test]
    fn rejects_allocation_above_money_received() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "T/1", 1000.0);
        let err = PaymentRepository::create_payment(&conn, payment(c, 400.0, &[(inv, 1000.0)], 0.0, "CREDIT")).unwrap_err();
        assert!(err.contains("more than"), "{}", err);
    }

    #[test]
    fn rejects_other_customers_invoice() {
        let conn = setup();
        let a = customer(&conn, "A");
        let b = customer(&conn, "B");
        let inv = invoice(&conn, b, "T/1", 1000.0);
        assert!(PaymentRepository::create_payment(&conn, payment(a, 1000.0, &[(inv, 1000.0)], 0.0, "CREDIT")).is_err());
    }

    #[test]
    fn overpayment_becomes_advance_and_is_used_later() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv1 = invoice(&conn, c, "T/1", 1000.0);
        let inv2 = invoice(&conn, c, "T/2", 800.0);

        let p1 = PaymentRepository::create_payment(&conn, payment(c, 1500.0, &[(inv1, 1000.0)], 0.0, "CREDIT")).unwrap();
        assert_eq!(p1.payment.excess_amount, 500.0);
        assert_eq!(p1.payment.bank_name.as_deref(), Some("SBI"));
        assert_eq!(advance(&conn, c), 500.0);

        // Pay the second invoice with 300 new money plus the 500 advance.
        let p2 = PaymentRepository::create_payment(&conn, payment(c, 300.0, &[(inv2, 800.0)], 500.0, "CREDIT")).unwrap();
        assert_eq!(p2.payment.credit_applied, 500.0);
        assert_eq!(advance(&conn, c), 0.0);
        assert_eq!(PaymentRepository::get_invoice_payment_summary(&conn, inv2).unwrap().outstanding_amount, 0.0);

        // The first payment's advance is in use, so it cannot be deleted yet.
        assert!(PaymentRepository::delete_payment(&conn, p1.payment.id).is_err());

        // Deleting the second payment gives the advance back.
        PaymentRepository::delete_payment(&conn, p2.payment.id).unwrap();
        assert_eq!(advance(&conn, c), 500.0);

        // Now the first can be deleted, and no advance is left behind.
        PaymentRepository::delete_payment(&conn, p1.payment.id).unwrap();
        assert_eq!(advance(&conn, c), 0.0);
        assert_eq!(PaymentRepository::get_payments_kpi_summary(&conn).unwrap().advances_held, 0.0);
    }

    #[test]
    fn refunded_overpayment_creates_no_advance() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "T/1", 1000.0);
        PaymentRepository::create_payment(&conn, payment(c, 1200.0, &[(inv, 1000.0)], 0.0, "REFUND")).unwrap();
        assert_eq!(advance(&conn, c), 0.0);
    }

    #[test]
    fn editing_keeps_own_invoices_available() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "T/1", 1000.0);
        let p = PaymentRepository::create_payment(&conn, payment(c, 1000.0, &[(inv, 1000.0)], 0.0, "CREDIT")).unwrap();

        // Fully paid, so not offered for a new payment...
        assert!(PaymentRepository::get_unpaid_invoices_for_customer(&conn, c, None).unwrap().is_empty());
        // ...but listed with its full balance when editing the payment that paid it.
        let own = PaymentRepository::get_unpaid_invoices_for_customer(&conn, c, Some(p.payment.id)).unwrap();
        assert_eq!(own.len(), 1);
        assert_eq!(own[0].outstanding_amount, 1000.0);

        let updated =
            PaymentRepository::update_payment(&conn, p.payment.id, payment(c, 600.0, &[(inv, 600.0)], 0.0, "CREDIT")).unwrap();
        assert_eq!(updated.allocations.len(), 1);
        assert_eq!(PaymentRepository::get_invoice_payment_summary(&conn, inv).unwrap().outstanding_amount, 400.0);
    }

    #[test]
    fn invoice_total_cannot_drop_below_payments() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "T/1", 1000.0);
        PaymentRepository::create_payment(&conn, payment(c, 1000.0, &[(inv, 1000.0)], 0.0, "CREDIT")).unwrap();

        let err = InvoiceRepository::update(&conn, inv, invoice_input(c, "T/1", 500.0)).unwrap_err();
        assert!(err.contains("already paid"), "{}", err);
        assert!(InvoiceRepository::update(&conn, inv, invoice_input(c, "T/1", 1200.0)).is_ok());
    }

    #[test]
    fn customer_with_records_cannot_be_deleted() {
        let conn = setup();
        let c = customer(&conn, "A");
        invoice(&conn, c, "T/1", 1000.0);
        assert!(CustomerRepository::delete(&conn, c).is_err());
    }

    fn outstanding(conn: &Connection, inv: i64) -> f64 {
        PaymentRepository::get_invoice_payment_summary(conn, inv).unwrap().outstanding_amount
    }

    #[test]
    fn next_numbers_put_the_year_before_the_running_number() {
        let conn = setup();
        let c = customer(&conn, "A");
        let fy = financial_year_label();
        // One invoice in the swapped form issued for a while, and one in the current form.
        invoice(&conn, c, &format!("MWW/007/{fy}"), 100.0);
        invoice(&conn, c, &format!("MWW/{fy}/003"), 100.0);
        assert_eq!(InvoiceRepository::get_next_invoice_number(&conn).unwrap(), format!("MWW/{fy}/008"));

        assert_eq!(PaymentRepository::get_next_payment_number(&conn).unwrap(), format!("PAY/{fy}/001"));
        let inv = invoice(&conn, c, "X/1", 100.0);
        let p = PaymentRepository::create_payment(&conn, payment(c, 100.0, &[(inv, 100.0)], 0.0, "NONE")).unwrap();
        assert_eq!(p.payment.payment_number, format!("PAY/{fy}/001"));
        assert_eq!(PaymentRepository::get_next_payment_number(&conn).unwrap(), format!("PAY/{fy}/002"));
    }

    #[test]
    fn vehicle_number_is_standardised_and_checked_on_invoices() {
        let conn = setup();
        let c = customer(&conn, "A");
        let mut input = invoice_input(c, "V/1", 100.0);
        input.vehicle_number = Some("py-01-ck-2064".to_string());
        let created = InvoiceRepository::create(&conn, input).unwrap();
        assert_eq!(created.invoice.vehicle_number.as_deref(), Some("PY 01 CK 2064"));

        let mut bad = invoice_input(c, "V/2", 100.0);
        bad.vehicle_number = Some("PY087945632".to_string());
        let err = InvoiceRepository::create(&conn, bad).unwrap_err();
        assert!(err.contains("not a valid Indian vehicle number"), "{err}");

        // An invoice saved earlier with an unusual value can be edited without touching it.
        conn.execute("UPDATE invoices SET vehicle_number = 'PY087945632' WHERE id = ?1", params![created.invoice.id])
            .unwrap();
        let mut again = invoice_input(c, "V/1", 100.0);
        again.vehicle_number = Some("PY087945632".to_string());
        InvoiceRepository::update(&conn, created.invoice.id, again).unwrap();
    }

    #[test]
    fn older_rounded_invoices_become_exact_unless_fully_paid() {
        let conn = setup();
        let c = customer(&conn, "A");
        let open = invoice(&conn, c, "E/1", 3590.0);
        let paid = invoice(&conn, c, "E/2", 3590.0);
        PaymentRepository::create_payment(&conn, payment(c, 3590.0, &[(paid, 3590.0)], 0.0, "NONE")).unwrap();
        // Make both look like invoices saved when totals were rounded: exact 3590.40 stored as 3590.00.
        conn.execute("UPDATE invoices SET round_off = -0.4", []).unwrap();

        conn.execute_batch(crate::db::migrations::EXACT_TOTALS_SQL).unwrap();

        let total = |id: i64| -> f64 {
            conn.query_row("SELECT total_amount FROM invoices WHERE id = ?1", params![id], |r| r.get(0)).unwrap()
        };
        assert_eq!(total(open), 3590.4);
        assert_eq!(outstanding(&conn, open), 3590.4);
        // The paid invoice keeps its settled total, so it does not reopen for 40 paise.
        assert_eq!(total(paid), 3590.0);
        assert_eq!(outstanding(&conn, paid), 0.0);
    }

    #[test]
    fn extra_money_can_be_kept_as_round_off() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "R/1", 3590.0);
        let p = PaymentRepository::create_payment(&conn, payment(c, 3600.0, &[(inv, 3590.0)], 0.0, "ROUNDOFF")).unwrap();
        assert_eq!(p.payment.amount_received, 3600.0);
        assert_eq!(p.payment.excess_amount, 10.0);
        assert_eq!(p.payment.excess_action, "ROUNDOFF");
        // Nothing is held as an advance and nothing is owed back.
        assert_eq!(advance(&conn, c), 0.0);
        assert_eq!(PaymentRepository::get_payments_kpi_summary(&conn).unwrap().advances_held, 0.0);
        let summary = PaymentRepository::get_invoice_payment_summary(&conn, inv).unwrap();
        assert_eq!(summary.outstanding_amount, 0.0);
        assert_eq!(summary.payment_status, "PAID");
    }

    #[test]
    fn round_off_has_no_size_limit() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "R/2", 10000.0);
        let p = PaymentRepository::create_payment(&conn, payment(c, 10600.0, &[(inv, 10000.0)], 0.0, "ROUNDOFF")).unwrap();
        assert_eq!(p.payment.excess_amount, 600.0);
        assert_eq!(p.payment.excess_action, "ROUNDOFF");
        assert_eq!(advance(&conn, c), 0.0);
    }

    #[test]
    fn short_payment_can_be_written_off_to_settle_the_invoice() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "W/1", 3590.0);
        let mut input = payment(c, 3500.0, &[(inv, 3590.0)], 0.0, "NONE");
        input.writeoff_amount = 90.0;
        let p = PaymentRepository::create_payment(&conn, input).unwrap();
        // The bank received 3500, but the invoice is fully settled.
        assert_eq!(p.payment.amount_received, 3500.0);
        assert_eq!(p.payment.writeoff_amount, 90.0);
        assert_eq!(p.payment.total_settled, 3590.0);
        assert_eq!(p.payment.excess_amount, 0.0);
        let summary = PaymentRepository::get_invoice_payment_summary(&conn, inv).unwrap();
        assert_eq!(summary.outstanding_amount, 0.0);
        assert_eq!(summary.payment_status, "PAID");
        assert_eq!(PaymentRepository::get_payments_kpi_summary(&conn).unwrap().total_received, 3500.0);

        // Deleting the payment reopens the invoice for the full amount.
        PaymentRepository::delete_payment(&conn, p.payment.id).unwrap();
        assert_eq!(outstanding(&conn, inv), 3590.0);
    }

    #[test]
    fn short_payment_without_write_off_is_still_refused() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "W/2", 3590.0);
        assert!(PaymentRepository::create_payment(&conn, payment(c, 3500.0, &[(inv, 3590.0)], 0.0, "NONE")).is_err());
    }

    #[test]
    fn write_off_larger_than_the_shortfall_is_refused() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "W/3", 3590.0);
        // Only 40 is short (3550 applied against 3500 received), so a 90 write-off is too much.
        let mut input = payment(c, 3500.0, &[(inv, 3550.0)], 0.0, "NONE");
        input.writeoff_amount = 90.0;
        let err = PaymentRepository::create_payment(&conn, input).unwrap_err();
        assert!(err.contains("more than the shortfall"), "{err}");
    }

    #[test]
    fn write_off_has_no_size_limit_but_must_match_the_shortfall() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "W/4", 10000.0);
        let mut input = payment(c, 9000.0, &[(inv, 10000.0)], 0.0, "NONE");
        input.writeoff_amount = 1000.0;
        let p = PaymentRepository::create_payment(&conn, input).unwrap();
        assert_eq!(p.payment.total_settled, 10000.0);
        assert_eq!(outstanding(&conn, inv), 0.0);
    }

    #[test]
    fn unpaid_invoices_report_the_amount_before_gst() {
        let conn = setup();
        let c = customer(&conn, "A");
        invoice(&conn, c, "U/1", 1000.0);
        let list = PaymentRepository::get_unpaid_invoices_for_customer(&conn, c, None).unwrap();
        assert_eq!(list.len(), 1);
        // Taxable amount is the subtotal less discount, never more than the total.
        assert!(list[0].taxable_amount > 0.0 && list[0].taxable_amount <= list[0].total_amount);
    }

    #[test]
    fn recognized_tds_settles_the_invoice() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "T/1", 50000.0);
        let mut input = payment(c, 48000.0, &[(inv, 50000.0)], 0.0, "CREDIT");
        input.tds_amount = 2000.0;
        let p = PaymentRepository::create_payment(&conn, input).unwrap();
        assert_eq!(p.payment.amount_received, 48000.0);
        assert_eq!(p.payment.total_settled, 50000.0);
        let summary = PaymentRepository::get_invoice_payment_summary(&conn, inv).unwrap();
        assert_eq!(summary.outstanding_amount, 0.0);
        assert_eq!(summary.payment_status, "PAID");
    }

    #[test]
    fn unrecognized_tds_leaves_balance_outstanding() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "T/1", 50000.0);
        let mut input = payment(c, 48000.0, &[(inv, 48000.0)], 0.0, "CREDIT");
        input.tds_amount = 2000.0;
        input.tds_recognized = false;
        let p = PaymentRepository::create_payment(&conn, input).unwrap();
        assert_eq!(p.payment.total_settled, 48000.0);
        assert!(!p.payment.tds_recognized);
        assert_eq!(outstanding(&conn, inv), 2000.0);

        // The unrecognised TDS cannot be allocated.
        let mut too_much = payment(c, 48000.0, &[(inv, 50000.0)], 0.0, "CREDIT");
        too_much.tds_amount = 2000.0;
        too_much.tds_recognized = false;
        assert!(PaymentRepository::create_payment(&conn, too_much).is_err());
    }

    #[test]
    fn three_payments_edit_and_delete_recalculate_balance() {
        let conn = setup();
        let c = customer(&conn, "A");
        let inv = invoice(&conn, c, "T/1", 50000.0);
        PaymentRepository::create_payment(&conn, payment(c, 20000.0, &[(inv, 20000.0)], 0.0, "CREDIT")).unwrap();
        assert_eq!(outstanding(&conn, inv), 30000.0);
        let p2 = PaymentRepository::create_payment(&conn, payment(c, 15000.0, &[(inv, 15000.0)], 0.0, "CREDIT")).unwrap();
        assert_eq!(outstanding(&conn, inv), 15000.0);
        PaymentRepository::create_payment(&conn, payment(c, 15000.0, &[(inv, 15000.0)], 0.0, "CREDIT")).unwrap();
        assert_eq!(outstanding(&conn, inv), 0.0);
        assert_eq!(PaymentRepository::get_invoice_payment_summary(&conn, inv).unwrap().payment_status, "PAID");

        PaymentRepository::update_payment(&conn, p2.payment.id, payment(c, 10000.0, &[(inv, 10000.0)], 0.0, "CREDIT")).unwrap();
        assert_eq!(outstanding(&conn, inv), 5000.0);
        PaymentRepository::delete_payment(&conn, p2.payment.id).unwrap();
        assert_eq!(outstanding(&conn, inv), 15000.0);
        let orphans: i64 = conn
            .query_row("SELECT COUNT(*) FROM payment_allocations WHERE payment_id = ?1", params![p2.payment.id], |r| r.get(0))
            .unwrap();
        assert_eq!(orphans, 0);
    }

    #[test]
    fn one_payment_can_cover_two_invoices() {
        let conn = setup();
        let c = customer(&conn, "A");
        let a = invoice(&conn, c, "T/1", 30000.0);
        let b = invoice(&conn, c, "T/2", 20000.0);
        let p = PaymentRepository::create_payment(&conn, payment(c, 50000.0, &[(a, 30000.0), (b, 20000.0)], 0.0, "CREDIT")).unwrap();
        assert_eq!(p.allocations.len(), 2);
        assert_eq!(outstanding(&conn, a), 0.0);
        assert_eq!(outstanding(&conn, b), 0.0);
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
    fn a_payment_cannot_be_recorded_for_a_supplier_only_company() {
        let conn = setup();
        let supplier = add_company_of_type(&conn, "Steel Supplier", "SUPPLIER");
        let both = add_company_of_type(&conn, "Both Co", "BOTH");
        let err = PaymentRepository::create_payment(&conn, payment(supplier, 100.0, &[], 0.0, "CREDIT")).unwrap_err();
        assert!(err.contains("supplier only"), "{}", err);
        assert!(PaymentRepository::create_payment(&conn, payment(both, 100.0, &[], 0.0, "CREDIT")).is_ok());
    }
}
