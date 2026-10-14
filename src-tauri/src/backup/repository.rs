use super::models::{BackupRun, PendingChanges};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;

pub struct BackupRepository;

/// Tables whose rows people think of as records. Child tables (invoice lines,
/// allocations) change together with these and would only inflate the counts.
const RECORD_TABLES: &[(&str, &str, &str)] = &[
    ("customers", "customer", "customers"),
    ("invoices", "invoice", "invoices"),
    ("payments", "payment", "payments"),
    ("quotations", "quotation", "quotations"),
    ("supplier_bills", "supplier bill", "supplier bills"),
    ("supplier_payments", "supplier payment", "supplier payments"),
    ("rental_places", "rental place", "rental places"),
    ("rental_tenants", "tenant", "tenants"),
    ("rent_months", "rent month", "rent months"),
    ("purchase_orders", "purchase order", "purchase orders"),
    ("customer_credits", "advance", "advances"),
];

fn plural(n: i64, one: &str, many: &str) -> String {
    format!("{} {}", n, if n == 1 { one } else { many })
}

impl BackupRepository {
    fn map_run(row: &Row) -> rusqlite::Result<BackupRun> {
        let summary_json: Option<String> = row.get(6)?;
        Ok(BackupRun {
            id: row.get(0)?,
            started_at: row.get(1)?,
            finished_at: row.get(2)?,
            status: row.get(3)?,
            file_name: row.get(4)?,
            size_bytes: row.get(5)?,
            summary: summary_json
                .and_then(|j| serde_json::from_str::<Vec<String>>(&j).ok())
                .unwrap_or_default(),
            error: row.get(7)?,
        })
    }

    const RUN_COLUMNS: &'static str =
        "id, started_at, finished_at, status, file_name, size_bytes, summary_json, error";

    /// The change number covered by the last successful backup, or None if there never was one.
    pub fn last_success_seq(conn: &Connection) -> Result<Option<i64>, String> {
        conn.query_row(
            "SELECT change_seq_upto FROM backup_runs WHERE status = 'SUCCESS' ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("Could not read backup history: {}", e))
    }

    pub fn max_seq(conn: &Connection) -> Result<i64, String> {
        conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM change_log", [], |r| r.get(0))
            .map_err(|e| format!("Could not read the change log: {}", e))
    }

    /// What was added, edited or deleted after change number `since`.
    pub fn pending_changes(conn: &Connection, since: i64) -> Result<PendingChanges, String> {
        let mut stmt = conn
            .prepare("SELECT table_name, row_id, op FROM change_log WHERE seq > ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![since], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
            })
            .map_err(|e| e.to_string())?;

        // (table, row) -> (inserted, deleted)
        let mut seen: HashMap<(String, i64), (bool, bool)> = HashMap::new();
        let mut any = false;
        for row in rows {
            let (table, id, op) = row.map_err(|e| e.to_string())?;
            any = true;
            let entry = seen.entry((table, id)).or_insert((false, false));
            match op.as_str() {
                "INSERT" => entry.0 = true,
                "DELETE" => entry.1 = true,
                _ => {}
            }
        }

        let mut lines = Vec::new();
        let mut total = 0;
        for (table, one, many) in RECORD_TABLES {
            let (mut added, mut edited, mut deleted) = (0i64, 0i64, 0i64);
            for ((t, _), (ins, del)) in &seen {
                if t != table {
                    continue;
                }
                match (ins, del) {
                    (true, true) => {} // created and removed since the last backup
                    (true, false) => added += 1,
                    (false, true) => deleted += 1,
                    (false, false) => edited += 1,
                }
            }
            total += added + edited + deleted;
            if added > 0 {
                lines.push(format!("{} added", plural(added, one, many)));
            }
            if edited > 0 {
                lines.push(format!("{} edited", plural(edited, one, many)));
            }
            if deleted > 0 {
                lines.push(format!("{} deleted", plural(deleted, one, many)));
            }
        }
        Ok(PendingChanges { total, lines, any })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_success(
        conn: &Connection,
        started_at: &str,
        seq: i64,
        file_id: &str,
        file_name: &str,
        size_bytes: i64,
        sha256: &str,
        md5: &str,
        schema_version: i32,
        summary: &[String],
    ) -> Result<BackupRun, String> {
        conn.execute(
            r#"INSERT INTO backup_runs (started_at, finished_at, status, change_seq_upto, drive_file_id, file_name,
                   size_bytes, sha256, md5, schema_version, summary_json)
               VALUES (?1, datetime('now', 'localtime'), 'SUCCESS', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
            params![
                started_at,
                seq,
                file_id,
                file_name,
                size_bytes,
                sha256,
                md5,
                schema_version,
                serde_json::to_string(summary).unwrap_or_else(|_| "[]".to_string())
            ],
        )
        .map_err(|e| format!("Could not save backup history: {}", e))?;
        Self::get_run(conn, conn.last_insert_rowid())
    }

    pub fn record_failure(conn: &Connection, started_at: &str, error: &str) -> Result<(), String> {
        conn.execute(
            "INSERT INTO backup_runs (started_at, finished_at, status, error) VALUES (?1, datetime('now', 'localtime'), 'FAILED', ?2)",
            params![started_at, error],
        )
        .map_err(|e| format!("Could not save backup history: {}", e))?;
        Ok(())
    }

    pub fn get_run(conn: &Connection, id: i64) -> Result<BackupRun, String> {
        conn.query_row(
            &format!("SELECT {} FROM backup_runs WHERE id = ?1", Self::RUN_COLUMNS),
            params![id],
            Self::map_run,
        )
        .map_err(|e| e.to_string())
    }

    pub fn last_run(conn: &Connection, only_success: bool) -> Result<Option<BackupRun>, String> {
        let filter = if only_success { "WHERE status = 'SUCCESS'" } else { "" };
        conn.query_row(
            &format!("SELECT {} FROM backup_runs {} ORDER BY id DESC LIMIT 1", Self::RUN_COLUMNS, filter),
            [],
            Self::map_run,
        )
        .optional()
        .map_err(|e| e.to_string())
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
        (dir, conn)
    }

    fn add_customer(conn: &Connection, name: &str) -> i64 {
        conn.execute(
            "INSERT INTO customers (name, is_favorite, created_at, updated_at) VALUES (?1, 0, 'x', 'x')",
            params![name],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn triggers_log_insert_edit_and_delete() {
        let (_d, conn) = setup();
        let id = add_customer(&conn, "A");
        conn.execute("UPDATE customers SET name = 'B' WHERE id = ?1", params![id]).unwrap();
        let ops: Vec<String> = conn
            .prepare("SELECT op FROM change_log WHERE table_name = 'customers' ORDER BY seq")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(ops, vec!["INSERT", "UPDATE"]);

        conn.execute("DELETE FROM customers WHERE id = ?1", params![id]).unwrap();
        let last: String = conn
            .query_row("SELECT op FROM change_log ORDER BY seq DESC LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(last, "DELETE");
    }

    #[test]
    fn pending_summary_nets_out_changes() {
        let (_d, conn) = setup();
        let before = BackupRepository::max_seq(&conn).unwrap();
        let kept = add_customer(&conn, "Kept");
        let gone = add_customer(&conn, "Gone");
        conn.execute("DELETE FROM customers WHERE id = ?1", params![gone]).unwrap();
        let p = BackupRepository::pending_changes(&conn, before).unwrap();
        assert_eq!(p.total, 1);
        assert_eq!(p.lines, vec!["1 customer added"]);

        let mark = BackupRepository::max_seq(&conn).unwrap();
        conn.execute("UPDATE customers SET name = 'Renamed' WHERE id = ?1", params![kept]).unwrap();
        let p = BackupRepository::pending_changes(&conn, mark).unwrap();
        assert_eq!(p.lines, vec!["1 customer edited"]);
        assert!(!BackupRepository::pending_changes(&conn, BackupRepository::max_seq(&conn).unwrap()).unwrap().any);
    }

    #[test]
    fn pending_summary_counts_quotations() {
        let (_d, conn) = setup();
        let c = add_customer(&conn, "A");
        let before = BackupRepository::max_seq(&conn).unwrap();
        conn.execute(
            "INSERT INTO quotations (customer_id, quotation_number, quotation_date, created_at, updated_at) VALUES (?1, 'Q-1', '2026-10-01', 'x', 'x')",
            params![c],
        )
        .unwrap();
        let p = BackupRepository::pending_changes(&conn, before).unwrap();
        assert_eq!(p.lines, vec!["1 quotation added"]);
    }

    #[test]
    fn pending_summary_counts_supplier_bills_and_payments() {
        let (_d, conn) = setup();
        let c = add_customer(&conn, "A");
        let before = BackupRepository::max_seq(&conn).unwrap();
        conn.execute(
            "INSERT INTO supplier_bills (supplier_id, bill_number, bill_date, total_amount, created_at, updated_at) VALUES (?1, 'B-1', '2026-10-01', 100, 'x', 'x')",
            params![c],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO supplier_payments (payment_number, supplier_id, payment_date, created_at, updated_at) VALUES ('SP/26-27/001', ?1, '2026-10-02', 'x', 'x')",
            params![c],
        )
        .unwrap();
        let p = BackupRepository::pending_changes(&conn, before).unwrap();
        assert_eq!(p.lines, vec!["1 supplier bill added", "1 supplier payment added"]);
    }

    #[test]
    fn pending_summary_counts_rentals() {
        let (_d, conn) = setup();
        let before = BackupRepository::max_seq(&conn).unwrap();
        conn.execute("INSERT INTO rental_places (name, monthly_rent, created_at, updated_at) VALUES ('Flat 2B', 5000, 'x', 'x')", []).unwrap();
        let place = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO rental_tenants (place_id, name, whatsapp_number, monthly_rent, created_at, updated_at) VALUES (?1, 'Ravi', '+919876543210', 5000, 'x', 'x')",
            params![place],
        )
        .unwrap();
        let tenant = conn.last_insert_rowid();
        conn.execute("INSERT INTO rent_months (tenant_id, month, created_at, updated_at) VALUES (?1, '2026-10', 'x', 'x')", params![tenant]).unwrap();
        let p = BackupRepository::pending_changes(&conn, before).unwrap();
        assert_eq!(p.lines, vec!["1 rental place added", "1 tenant added", "1 rent month added"]);
    }

    #[test]
    fn sequence_only_advances_on_success() {
        let (_d, conn) = setup();
        assert_eq!(BackupRepository::last_success_seq(&conn).unwrap(), None);
        add_customer(&conn, "A");
        BackupRepository::record_failure(&conn, "t0", "offline").unwrap();
        assert_eq!(BackupRepository::last_success_seq(&conn).unwrap(), None);

        let seq = BackupRepository::max_seq(&conn).unwrap();
        BackupRepository::record_success(&conn, "t1", seq, "fid", "f.db.gz", 10, "s", "m", 8, &["1 customer added".into()])
            .unwrap();
        assert_eq!(BackupRepository::last_success_seq(&conn).unwrap(), Some(seq));
        BackupRepository::record_failure(&conn, "t2", "quota").unwrap();
        assert_eq!(BackupRepository::last_success_seq(&conn).unwrap(), Some(seq));
        assert_eq!(BackupRepository::last_run(&conn, false).unwrap().unwrap().status, "FAILED");
    }
}
