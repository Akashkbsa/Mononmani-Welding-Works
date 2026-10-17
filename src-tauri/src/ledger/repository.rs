//! A company's ledger: everything with them in one account, as Tally keeps it. Debit is what they
//! owe us more (our invoices, our payments to them, refunds); Credit is what they owe us less
//! (their payments, TDS, write-offs, their bills). The balance is + Dr (they owe us), − Cr (we owe them).

use super::models::{Ledger, LedgerLine, OpeningBalance, OpeningBalanceInput};
use crate::util::{check_amount, normalize_date, round2};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

pub struct LedgerRepository;

/// A ledger line before the running balance; `order` keeps a day's lines in a steady order.
struct Entry {
    date: String,
    order: (u8, i64, u8),
    particulars: String,
    number: String,
    detail: String,
    debit: f64,
    credit: f64,
}

fn join_detail(parts: &[Option<String>]) -> String {
    parts.iter().flatten().map(|s| s.trim()).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ")
}

fn query<T>(conn: &Connection, sql: &str, id: i64, map: impl FnMut(&rusqlite::Row) -> rusqlite::Result<T>) -> Result<Vec<T>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| format!("Failed to load the ledger: {}", e))?;
    let rows = stmt.query_map(params![id], map).map_err(|e| format!("Failed to load the ledger: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read the ledger: {}", e))
}

impl LedgerRepository {
    pub fn opening_balance(conn: &Connection, company_id: i64) -> Result<OpeningBalance, String> {
        let found: Option<(f64, Option<String>)> = conn
            .query_row(
                "SELECT opening_balance, opening_balance_date FROM customers WHERE id = ?1",
                params![company_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to load the company: {}", e))?;
        let (amount, as_on) = found.ok_or_else(|| "Company not found.".to_string())?;
        Ok(if amount == 0.0 { OpeningBalance::default() } else { OpeningBalance { amount, as_on } })
    }

    /// Sets or clears (amount 0) what the company owed before its records in the app.
    pub fn set_opening_balance(conn: &Connection, company_id: i64, input: OpeningBalanceInput) -> Result<OpeningBalance, String> {
        Self::opening_balance(conn, company_id)?;
        let amount = round2(check_amount(input.amount, "Opening balance")?);
        let as_on = if amount == 0.0 {
            None
        } else {
            let raw = input.as_on.as_deref().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| "Enter the date of the opening balance.".to_string())?;
            Some(normalize_date(raw, "Opening balance date")?)
        };
        conn.execute(
            "UPDATE customers SET opening_balance = ?1, opening_balance_date = ?2, updated_at = ?3 WHERE id = ?4",
            params![amount, as_on, Utc::now().to_rfc3339(), company_id],
        )
        .map_err(|e| format!("Failed to save the opening balance: {}", e))?;
        Self::opening_balance(conn, company_id)
    }

    /// Every ledger entry of the company, oldest first.
    fn entries(conn: &Connection, id: i64, opening: &OpeningBalance) -> Result<Vec<Entry>, String> {
        let mut out = Vec::new();
        if opening.amount != 0.0 {
            out.push(Entry {
                date: opening.as_on.clone().unwrap_or_default(),
                order: (0, 0, 0),
                particulars: "Opening balance".into(),
                number: String::new(),
                detail: "Balance before records in the app".into(),
                debit: opening.amount.max(0.0),
                credit: (-opening.amount).max(0.0),
            });
        }

        // Sales invoices that were issued; drafts and cancelled ones were never owed.
        out.extend(query(
            conn,
            "SELECT id, invoice_date, invoice_number, total_amount FROM invoices WHERE customer_id = ?1 AND status = 'ISSUED'",
            id,
            |r| {
                Ok(Entry {
                    date: r.get(1)?,
                    order: (1, r.get(0)?, 0),
                    particulars: "Sales invoice".into(),
                    number: r.get(2)?,
                    detail: String::new(),
                    debit: r.get(3)?,
                    credit: 0.0,
                })
            },
        )?);

        // Payments received, with TDS, write-off and what happened to anything paid extra.
        let payments = query(
            conn,
            "SELECT id, payment_date, payment_number, payment_method, reference_number, amount_received,
                    tds_deducted, tds_recognized, writeoff_amount, excess_amount, excess_action
             FROM payments WHERE customer_id = ?1",
            id,
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, f64>(5)?,
                    r.get::<_, f64>(6)?,
                    r.get::<_, i64>(7)? != 0,
                    r.get::<_, f64>(8)?,
                    r.get::<_, f64>(9)?,
                    r.get::<_, String>(10)?,
                ))
            },
        )?;
        for (pid, date, number, method, reference, received, tds, tds_ok, writeoff, excess, action) in payments {
            let line = |step: u8, particulars: &str, detail: String, debit: f64, credit: f64| Entry {
                date: date.clone(),
                order: (2, pid, step),
                particulars: particulars.into(),
                number: number.clone(),
                detail,
                debit,
                credit,
            };
            if received > 0.0 {
                out.push(line(0, "Payment received", join_detail(&[method.clone(), reference.clone()]), 0.0, received));
            }
            if tds_ok && tds > 0.0 {
                out.push(line(1, "TDS deducted", String::new(), 0.0, tds));
            }
            if writeoff > 0.0 {
                out.push(line(2, "Written off", "Short payment accepted".into(), 0.0, writeoff));
            }
            if excess > 0.0 && action == "REFUND" {
                out.push(line(3, "Refund", "Extra paid, returned".into(), excess, 0.0));
            }
            if excess > 0.0 && action == "ROUNDOFF" {
                out.push(line(3, "Round-off", "Extra paid, kept".into(), excess, 0.0));
            }
        }

        // Purchase bills from them.
        out.extend(query(
            conn,
            "SELECT id, bill_date, bill_number, total_amount FROM supplier_bills WHERE supplier_id = ?1",
            id,
            |r| {
                Ok(Entry {
                    date: r.get(1)?,
                    order: (3, r.get(0)?, 0),
                    particulars: "Purchase bill".into(),
                    number: r.get(2)?,
                    detail: String::new(),
                    debit: 0.0,
                    credit: r.get(3)?,
                })
            },
        )?);

        // Our payments to them, with their write-off and any extra counted as paid.
        let paid = query(
            conn,
            "SELECT id, payment_date, payment_number, payment_method, reference_number, amount_paid, writeoff_amount,
                    excess_amount, excess_action
             FROM supplier_payments WHERE supplier_id = ?1",
            id,
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, f64>(5)?,
                    r.get::<_, f64>(6)?,
                    r.get::<_, f64>(7)?,
                    r.get::<_, String>(8)?,
                ))
            },
        )?;
        for (pid, date, number, method, reference, amount, writeoff, excess, action) in paid {
            let line = |step: u8, particulars: &str, detail: String, debit: f64, credit: f64| Entry {
                date: date.clone(),
                order: (4, pid, step),
                particulars: particulars.into(),
                number: number.clone(),
                detail,
                debit,
                credit,
            };
            if amount > 0.0 {
                out.push(line(0, "Payment made", join_detail(&[method.clone(), reference.clone()]), amount, 0.0));
            }
            if writeoff > 0.0 {
                out.push(line(1, "Written off", "Short payment accepted by them".into(), writeoff, 0.0));
            }
            if excess > 0.0 && action != "NONE" {
                out.push(line(2, "Round-off", "Extra paid, counted as paid".into(), 0.0, excess));
            }
        }

        out.sort_by(|a, b| a.date.cmp(&b.date).then(a.order.cmp(&b.order)));
        Ok(out)
    }

    /// The company's ledger for the period (dates YYYY-MM-DD or DD-MM-YYYY; None for no limit).
    pub fn ledger(conn: &Connection, company_id: i64, from: Option<&str>, to: Option<&str>) -> Result<Ledger, String> {
        let (name, party_type): (String, String) = conn
            .query_row("SELECT name, party_type FROM customers WHERE id = ?1", params![company_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(|e| format!("Failed to load the company: {}", e))?
            .ok_or_else(|| "Company not found.".to_string())?;
        let clean = |d: Option<&str>, what: &str| -> Result<Option<String>, String> {
            match d.map(str::trim).filter(|s| !s.is_empty()) {
                Some(d) => normalize_date(d, what).map(Some),
                None => Ok(None),
            }
        };
        let from = clean(from, "From date")?;
        let to = clean(to, "To date")?;
        if let (Some(f), Some(t)) = (&from, &to) {
            if f > t {
                return Err("The From date is after the To date.".to_string());
            }
        }
        let opening_balance = Self::opening_balance(conn, company_id)?;
        let entries = Self::entries(conn, company_id, &opening_balance)?;
        let mut dates: Vec<String> = entries.iter().map(|e| e.date.clone()).filter(|d| !d.is_empty()).collect();
        dates.dedup();

        let mut brought_forward = 0.0;
        let mut balance = 0.0;
        let mut lines = Vec::new();
        let (mut total_debit, mut total_credit) = (0.0, 0.0);
        for e in entries {
            let before = from.as_deref().is_some_and(|f| e.date.as_str() < f);
            let after = to.as_deref().is_some_and(|t| e.date.as_str() > t);
            if after {
                continue;
            }
            balance = round2(balance + e.debit - e.credit);
            if before {
                brought_forward = balance;
                continue;
            }
            total_debit += e.debit;
            total_credit += e.credit;
            lines.push(LedgerLine {
                date: e.date,
                particulars: e.particulars,
                number: e.number,
                detail: e.detail,
                debit: round2(e.debit),
                credit: round2(e.credit),
                balance,
            });
        }
        let closing = if lines.is_empty() { brought_forward } else { balance };
        let closing = if closing == 0.0 { 0.0 } else { closing };
        Ok(Ledger {
            company_id,
            company_name: name,
            party_type,
            from,
            to,
            brought_forward: if brought_forward == 0.0 { 0.0 } else { brought_forward },
            lines,
            total_debit: round2(total_debit),
            total_credit: round2(total_credit),
            closing,
            opening_balance,
            dates,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("t.db")).unwrap();
        let conn = db.get_connection().unwrap();
        conn.execute(
            "INSERT INTO customers (name, party_type, created_at, updated_at) VALUES ('Sri Krishna Engineering Works', 'BOTH', 'x', 'x')",
            [],
        )
        .unwrap();
        (dir, conn)
    }

    fn invoice(conn: &Connection, number: &str, date: &str, total: f64, status: &str) {
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, customer_name, total_amount, amount_in_words, status, created_at, updated_at)
             VALUES (?1, ?2, 1, 'Sri Krishna', ?3, '', ?4, 'x', 'x')",
            params![number, date, total, status],
        )
        .unwrap();
    }

    #[allow(clippy::too_many_arguments)]
    fn received(conn: &Connection, number: &str, date: &str, amount: f64, tds: f64, tds_ok: bool, writeoff: f64, excess: f64, action: &str) {
        conn.execute(
            "INSERT INTO payments (payment_number, customer_id, customer_name, payment_date, payment_method, reference_number, amount_received,
                 tds_deducted, tds_recognized, writeoff_amount, excess_amount, excess_action, created_at, updated_at)
             VALUES (?1, 1, 'Sri Krishna', ?2, 'Bank Transfer', 'UTR9', ?3, ?4, ?5, ?6, ?7, ?8, 'x', 'x')",
            params![number, date, amount, tds, tds_ok as i64, writeoff, excess, action],
        )
        .unwrap();
    }

    fn bill(conn: &Connection, number: &str, date: &str, total: f64) {
        conn.execute(
            "INSERT INTO supplier_bills (supplier_id, bill_number, bill_date, total_amount, created_at, updated_at) VALUES (1, ?1, ?2, ?3, 'x', 'x')",
            params![number, date, total],
        )
        .unwrap();
    }

    fn paid(conn: &Connection, number: &str, date: &str, amount: f64, writeoff: f64, excess: f64) {
        conn.execute(
            "INSERT INTO supplier_payments (payment_number, supplier_id, payment_date, payment_method, amount_paid, writeoff_amount, excess_amount,
                 excess_action, created_at, updated_at)
             VALUES (?1, 1, ?2, 'Cash', ?3, ?4, ?5, ?6, 'x', 'x')",
            params![number, date, amount, writeoff, excess, if excess > 0.0 { "ROUNDOFF" } else { "NONE" }],
        )
        .unwrap();
    }

    #[test]
    fn sales_and_purchases_make_one_account() {
        let (_d, conn) = setup();
        invoice(&conn, "MWW/26-27/001", "2026-04-10", 11800.0, "ISSUED");
        invoice(&conn, "MWW/26-27/002", "2026-04-12", 5000.0, "DRAFT");
        invoice(&conn, "MWW/26-27/003", "2026-04-15", 3000.0, "CANCELLED");
        received(&conn, "PAY/001", "2026-05-02", 11000.0, 200.0, true, 600.0, 0.0, "NONE");
        bill(&conn, "SKE-55", "2026-05-10", 4000.0);
        paid(&conn, "SP/001", "2026-05-20", 3950.0, 50.0, 0.0);

        let l = LedgerRepository::ledger(&conn, 1, None, None).unwrap();
        let rows: Vec<(&str, f64, f64, f64)> = l.lines.iter().map(|x| (x.particulars.as_str(), x.debit, x.credit, x.balance)).collect();
        assert_eq!(
            rows,
            vec![
                ("Sales invoice", 11800.0, 0.0, 11800.0),
                ("Payment received", 0.0, 11000.0, 800.0),
                ("TDS deducted", 0.0, 200.0, 600.0),
                ("Written off", 0.0, 600.0, 0.0),
                ("Purchase bill", 0.0, 4000.0, -4000.0),
                ("Payment made", 3950.0, 0.0, -50.0),
                ("Written off", 50.0, 0.0, 0.0),
            ]
        );
        assert_eq!((l.total_debit, l.total_credit, l.closing), (15800.0, 15800.0, 0.0));
        assert_eq!(l.lines[1].detail, "Bank Transfer · UTR9");
        assert_eq!(l.party_type, "BOTH");
    }

    #[test]
    fn extra_money_is_shown_the_way_it_was_settled() {
        let (_d, conn) = setup();
        invoice(&conn, "INV1", "2026-04-10", 1000.0, "ISSUED");
        received(&conn, "P1", "2026-04-11", 1500.0, 0.0, false, 0.0, 500.0, "CREDIT");
        assert_eq!(LedgerRepository::ledger(&conn, 1, None, None).unwrap().closing, -500.0, "an advance kept is owed back to them");
        received(&conn, "P2", "2026-04-12", 300.0, 50.0, false, 0.0, 300.0, "REFUND");
        received(&conn, "P3", "2026-04-13", 20.0, 0.0, false, 0.0, 20.0, "ROUNDOFF");
        let l = LedgerRepository::ledger(&conn, 1, None, None).unwrap();
        assert_eq!(l.closing, -500.0, "a refund and a round-off cancel their extra; unrecognised TDS is left out");
        assert!(l.lines.iter().any(|x| x.particulars == "Refund" && x.debit == 300.0));
        bill(&conn, "B1", "2026-04-20", 100.0);
        paid(&conn, "S1", "2026-04-21", 105.0, 0.0, 5.0);
        assert_eq!(LedgerRepository::ledger(&conn, 1, None, None).unwrap().closing, -500.0);
    }

    #[test]
    fn a_period_brings_the_earlier_balance_forward() {
        let (_d, conn) = setup();
        LedgerRepository::set_opening_balance(&conn, 1, OpeningBalanceInput { amount: 18500.0, as_on: Some("01-01-2026".into()) }).unwrap();
        invoice(&conn, "INV1", "2026-03-10", 1000.0, "ISSUED");
        invoice(&conn, "INV2", "2026-04-10", 2000.0, "ISSUED");
        received(&conn, "P1", "2026-05-01", 500.0, 0.0, false, 0.0, 0.0, "NONE");
        invoice(&conn, "INV3", "2026-06-10", 4000.0, "ISSUED");

        let l = LedgerRepository::ledger(&conn, 1, Some("2026-04-01"), Some("31-05-2026")).unwrap();
        assert_eq!(l.brought_forward, 19500.0, "opening balance and March's invoice");
        assert_eq!(l.lines.iter().map(|x| x.number.as_str()).collect::<Vec<_>>(), vec!["INV2", "P1"]);
        assert_eq!((l.total_debit, l.total_credit, l.closing), (2000.0, 500.0, 21000.0));
        assert_eq!(l.lines[0].balance, 21500.0);

        let all = LedgerRepository::ledger(&conn, 1, None, None).unwrap();
        assert_eq!((all.brought_forward, all.lines[0].particulars.as_str(), all.lines[0].debit), (0.0, "Opening balance", 18500.0));
        assert_eq!(all.closing, 25000.0);

        let empty = LedgerRepository::ledger(&conn, 1, Some("2027-01-01"), None).unwrap();
        assert_eq!((empty.lines.len(), empty.brought_forward, empty.closing), (0, 25000.0, 25000.0));
        assert_eq!(LedgerRepository::ledger(&conn, 1, Some("2026-05-01"), Some("2026-04-01")).unwrap_err(), "The From date is after the To date.");
        assert_eq!(LedgerRepository::ledger(&conn, 9, None, None).unwrap_err(), "Company not found.");
    }

    #[test]
    fn the_opening_balance_can_be_owed_either_way_and_removed() {
        let (_d, conn) = setup();
        assert_eq!(LedgerRepository::opening_balance(&conn, 1).unwrap(), OpeningBalance::default());
        let o = LedgerRepository::set_opening_balance(&conn, 1, OpeningBalanceInput { amount: -41475.0, as_on: Some("2026-04-01".into()) }).unwrap();
        assert_eq!(o, OpeningBalance { amount: -41475.0, as_on: Some("2026-04-01".into()) });
        let l = LedgerRepository::ledger(&conn, 1, None, None).unwrap();
        assert_eq!((l.lines[0].credit, l.closing), (41475.0, -41475.0));
        assert_eq!(
            LedgerRepository::set_opening_balance(&conn, 1, OpeningBalanceInput { amount: 10.0, as_on: None }).unwrap_err(),
            "Enter the date of the opening balance."
        );
        let o = LedgerRepository::set_opening_balance(&conn, 1, OpeningBalanceInput { amount: 0.0, as_on: Some("2026-04-01".into()) }).unwrap();
        assert_eq!(o, OpeningBalance::default());
        assert!(LedgerRepository::ledger(&conn, 1, None, None).unwrap().lines.is_empty());
        assert_eq!(LedgerRepository::opening_balance(&conn, 7).unwrap_err(), "Company not found.");
    }
}
