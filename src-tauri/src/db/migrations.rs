use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationLog {
    pub version: i32,
    pub name: String,
    pub applied_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbStatusInfo {
    pub db_path: String,
    pub is_connected: bool,
    pub applied_migrations: Vec<MigrationLog>,
}

struct Migration {
    version: i32,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "001_initial_schema_foundation",
        sql: r#"
            CREATE TABLE IF NOT EXISTS app_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            INSERT OR REPLACE INTO app_metadata (key, value, updated_at) 
            VALUES ('schema_version', '1', datetime('now'));
        "#,
    },
    Migration {
        version: 2,
        name: "002_customers",
        sql: r#"
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                gstin TEXT NULL,
                phone TEXT NULL,
                email TEXT NULL,
                address_line1 TEXT NULL,
                address_line2 TEXT NULL,
                city TEXT NULL,
                state TEXT NULL,
                postal_code TEXT NULL,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                last_used_at TEXT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_customers_favorite_recent ON customers(is_favorite, last_used_at, created_at);
        "#,
    },
    Migration {
        version: 3,
        name: "003_invoices_and_items",
        sql: r#"
            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_number TEXT NOT NULL UNIQUE,
                invoice_date TEXT NOT NULL,
                invoice_state TEXT NOT NULL DEFAULT 'Puducherry',
                
                -- Customer snapshot at time of invoice creation (does not mutate on customer record edit)
                customer_id INTEGER NULL,
                customer_name TEXT NOT NULL,
                customer_address TEXT NULL,
                customer_phone TEXT NULL,
                customer_gstin TEXT NULL,
                customer_state TEXT NULL,
                customer_state_code TEXT NULL,
                
                -- Reference & Delivery details
                po_number_and_date TEXT NULL,
                vehicle_number TEXT NULL,
                date_of_supply TEXT NULL,
                place_of_supply TEXT NULL,
                our_dc_number_and_date TEXT NULL,
                your_dc_number_and_date TEXT NULL,
                delivery_note TEXT NULL,
                supplier_ref TEXT NULL,
                buyer_ref TEXT NULL,
                dispatch_doc_no TEXT NULL,
                delivery_note_date TEXT NULL,
                dispatch_through TEXT NULL,
                destination TEXT NULL,
                terms_of_delivery TEXT NULL,
                
                -- Tax & Totals calculation
                tax_type TEXT NOT NULL DEFAULT 'CGST_SGST',
                subtotal REAL NOT NULL DEFAULT 0.0,
                discount REAL NOT NULL DEFAULT 0.0,
                cgst_rate REAL NOT NULL DEFAULT 0.0,
                cgst_amount REAL NOT NULL DEFAULT 0.0,
                sgst_rate REAL NOT NULL DEFAULT 0.0,
                sgst_amount REAL NOT NULL DEFAULT 0.0,
                igst_rate REAL NOT NULL DEFAULT 0.0,
                igst_amount REAL NOT NULL DEFAULT 0.0,
                round_off REAL NOT NULL DEFAULT 0.0,
                total_amount REAL NOT NULL DEFAULT 0.0,
                amount_in_words TEXT NOT NULL,
                
                -- Bank details snapshot
                bank_name TEXT NOT NULL DEFAULT 'Indian Bank',
                bank_branch TEXT NOT NULL DEFAULT 'Mettupalayam (PONDY)',
                bank_account_no TEXT NOT NULL DEFAULT '498877880',
                bank_ifsc TEXT NOT NULL DEFAULT 'IDIB000M070',
                
                -- Terms & Conditions
                terms_and_conditions TEXT NULL,
                
                -- Status & Notes
                status TEXT NOT NULL DEFAULT 'ISSUED',
                notes TEXT NULL,
                pdf_path TEXT NULL,
                
                -- Audit Timestamps
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                
                FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS invoice_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_id INTEGER NOT NULL,
                sl_no INTEGER NOT NULL,
                description TEXT NOT NULL,
                hsn_sac TEXT NOT NULL DEFAULT '9954',
                qum TEXT NOT NULL DEFAULT 'NOS',
                quantity REAL NOT NULL DEFAULT 1.0,
                rate REAL NOT NULL DEFAULT 0.0,
                amount REAL NOT NULL DEFAULT 0.0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date DESC);
            CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
            CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
        "#,
    },
    Migration {
        version: 4,
        name: "004_payments_and_allocations",
        sql: r#"
            -- 1. Add due date and payment terms to invoices
            ALTER TABLE invoices ADD COLUMN due_date TEXT NULL;
            ALTER TABLE invoices ADD COLUMN payment_terms_days INTEGER NOT NULL DEFAULT 60;

            -- Populate due_date for existing invoices (default +60 days)
            UPDATE invoices SET due_date = date(
                substr(invoice_date, 7, 4) || '-' || substr(invoice_date, 4, 2) || '-' || substr(invoice_date, 1, 2),
                '+60 days'
            ) WHERE due_date IS NULL AND invoice_date LIKE '__-__-____';

            UPDATE invoices SET due_date = date(invoice_date, '+60 days')
            WHERE due_date IS NULL AND invoice_date LIKE '____-__-__';

            -- 2. Payments table
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payment_number TEXT NOT NULL UNIQUE,
                customer_id INTEGER NULL,
                customer_name TEXT NOT NULL,
                payment_date TEXT NOT NULL,
                payment_method TEXT NOT NULL DEFAULT 'Bank Transfer',
                reference_number TEXT NULL,
                amount_received REAL NOT NULL DEFAULT 0.0,
                tds_deducted REAL NOT NULL DEFAULT 0.0,
                total_settled REAL NOT NULL DEFAULT 0.0,
                is_verified INTEGER NOT NULL DEFAULT 0,
                is_important INTEGER NOT NULL DEFAULT 0,
                remarks TEXT NULL,
                excess_amount REAL NOT NULL DEFAULT 0.0,
                excess_action TEXT NOT NULL DEFAULT 'NONE',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
            );

            -- 3. Payment Allocations table
            CREATE TABLE IF NOT EXISTS payment_allocations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payment_id INTEGER NOT NULL,
                invoice_id INTEGER NOT NULL,
                amount_allocated REAL NOT NULL DEFAULT 0.0,
                tds_allocated REAL NOT NULL DEFAULT 0.0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE CASCADE,
                FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
            );

            -- 4. Customer Credits table
            CREATE TABLE IF NOT EXISTS customer_credits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                source_payment_id INTEGER NULL,
                original_amount REAL NOT NULL DEFAULT 0.0,
                remaining_amount REAL NOT NULL DEFAULT 0.0,
                notes TEXT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY(source_payment_id) REFERENCES payments(id) ON DELETE SET NULL
            );

            -- 5. Indexes
            CREATE INDEX IF NOT EXISTS idx_payments_number ON payments(payment_number COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date DESC);
            CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
            CREATE INDEX IF NOT EXISTS idx_payments_verified ON payments(is_verified);
            CREATE INDEX IF NOT EXISTS idx_payments_important ON payments(is_important);
            CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id);
            CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON payment_allocations(invoice_id);
            CREATE INDEX IF NOT EXISTS idx_customer_credits_customer ON customer_credits(customer_id);
            CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
        "#,
    },
    Migration {
        version: 5,
        name: "005_iso_dates_and_customer_advances",
        sql: r#"
            -- Store dates as YYYY-MM-DD so they sort and filter correctly.
            UPDATE invoices SET invoice_date = substr(invoice_date, 7, 4) || '-' || substr(invoice_date, 4, 2) || '-' || substr(invoice_date, 1, 2)
            WHERE invoice_date LIKE '__-__-____';
            UPDATE invoices SET due_date = substr(due_date, 7, 4) || '-' || substr(due_date, 4, 2) || '-' || substr(due_date, 1, 2)
            WHERE due_date LIKE '__-__-____';
            UPDATE payments SET payment_date = substr(payment_date, 7, 4) || '-' || substr(payment_date, 4, 2) || '-' || substr(payment_date, 1, 2)
            WHERE payment_date LIKE '__-__-____';

            ALTER TABLE payments ADD COLUMN bank_name TEXT NULL;
            ALTER TABLE payments ADD COLUMN credit_applied REAL NOT NULL DEFAULT 0.0;

            -- Advances consumed by later payments, so edits and deletes can restore them.
            CREATE TABLE IF NOT EXISTS credit_applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payment_id INTEGER NOT NULL,
                credit_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE CASCADE,
                FOREIGN KEY(credit_id) REFERENCES customer_credits(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_credit_applications_payment ON credit_applications(payment_id);
            CREATE INDEX IF NOT EXISTS idx_credit_applications_credit ON credit_applications(credit_id);

            -- Credits left behind by deleted payments (their link was set to NULL).
            DELETE FROM customer_credits WHERE source_payment_id IS NULL;

            -- Overpayments used to allow "no action"/"reallocate", which did nothing.
            -- Keep that money visible as a customer advance.
            INSERT INTO customer_credits (customer_id, source_payment_id, original_amount, remaining_amount, notes, created_at, updated_at)
            SELECT customer_id, id, excess_amount, excess_amount, 'Advance from ' || payment_number, datetime('now'), datetime('now')
            FROM payments
            WHERE excess_amount > 0 AND customer_id IS NOT NULL
              AND excess_action NOT IN ('CREDIT', 'REFUND')
              AND id NOT IN (SELECT source_payment_id FROM customer_credits WHERE source_payment_id IS NOT NULL);
            UPDATE payments SET excess_action = 'CREDIT' WHERE excess_amount > 0 AND excess_action NOT IN ('CREDIT', 'REFUND');
            UPDATE payments SET excess_action = 'NONE' WHERE excess_amount <= 0;
        "#,
    },
    Migration {
        version: 6,
        name: "006_customer_bank_details",
        sql: r#"
            ALTER TABLE customers ADD COLUMN bank_name TEXT NULL;
            ALTER TABLE customers ADD COLUMN bank_branch TEXT NULL;
            ALTER TABLE customers ADD COLUMN bank_account_no TEXT NULL;
            ALTER TABLE customers ADD COLUMN bank_ifsc TEXT NULL;
        "#,
    },
    Migration {
        version: 7,
        name: "007_tds_recognized",
        sql: r#"
            -- 1 = TDS counts towards the invoices; 0 = recorded only (e.g. no certificate yet).
            ALTER TABLE payments ADD COLUMN tds_recognized INTEGER NOT NULL DEFAULT 1;
        "#,
    },
    Migration {
        version: 8,
        name: "008_backup_change_log",
        sql: r#"
            -- Every insert, edit and delete is recorded so a backup knows what changed since the last good one.
            CREATE TABLE IF NOT EXISTS change_log (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                row_id INTEGER NOT NULL,
                op TEXT NOT NULL,
                changed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS backup_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL,
                finished_at TEXT NOT NULL,
                status TEXT NOT NULL,
                change_seq_upto INTEGER NOT NULL DEFAULT 0,
                drive_file_id TEXT NULL,
                file_name TEXT NULL,
                size_bytes INTEGER NULL,
                sha256 TEXT NULL,
                md5 TEXT NULL,
                schema_version INTEGER NULL,
                summary_json TEXT NULL,
                error TEXT NULL
            );

            CREATE TRIGGER IF NOT EXISTS trg_customers_insert_log AFTER INSERT ON customers
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('customers', NEW.id, 'INSERT', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_customers_update_log AFTER UPDATE ON customers
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('customers', NEW.id, 'UPDATE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_customers_delete_log AFTER DELETE ON customers
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('customers', OLD.id, 'DELETE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_invoices_insert_log AFTER INSERT ON invoices
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('invoices', NEW.id, 'INSERT', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_invoices_update_log AFTER UPDATE ON invoices
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('invoices', NEW.id, 'UPDATE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_invoices_delete_log AFTER DELETE ON invoices
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('invoices', OLD.id, 'DELETE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_invoice_items_insert_log AFTER INSERT ON invoice_items
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('invoice_items', NEW.id, 'INSERT', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_invoice_items_update_log AFTER UPDATE ON invoice_items
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('invoice_items', NEW.id, 'UPDATE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_invoice_items_delete_log AFTER DELETE ON invoice_items
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('invoice_items', OLD.id, 'DELETE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_payments_insert_log AFTER INSERT ON payments
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('payments', NEW.id, 'INSERT', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_payments_update_log AFTER UPDATE ON payments
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('payments', NEW.id, 'UPDATE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_payments_delete_log AFTER DELETE ON payments
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('payments', OLD.id, 'DELETE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_payment_allocations_insert_log AFTER INSERT ON payment_allocations
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('payment_allocations', NEW.id, 'INSERT', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_payment_allocations_update_log AFTER UPDATE ON payment_allocations
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('payment_allocations', NEW.id, 'UPDATE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_payment_allocations_delete_log AFTER DELETE ON payment_allocations
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('payment_allocations', OLD.id, 'DELETE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_customer_credits_insert_log AFTER INSERT ON customer_credits
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('customer_credits', NEW.id, 'INSERT', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_customer_credits_update_log AFTER UPDATE ON customer_credits
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('customer_credits', NEW.id, 'UPDATE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_customer_credits_delete_log AFTER DELETE ON customer_credits
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('customer_credits', OLD.id, 'DELETE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_credit_applications_insert_log AFTER INSERT ON credit_applications
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('credit_applications', NEW.id, 'INSERT', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_credit_applications_update_log AFTER UPDATE ON credit_applications
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('credit_applications', NEW.id, 'UPDATE', datetime('now'));
            END;
            CREATE TRIGGER IF NOT EXISTS trg_credit_applications_delete_log AFTER DELETE ON credit_applications
            BEGIN
                INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('credit_applications', OLD.id, 'DELETE', datetime('now'));
            END;
        "#,
    },
    Migration {
        version: 9,
        name: "009_app_settings",
        sql: r#"
            -- The owner's own details (business, bank, tax rates, terms), editable in Settings.
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        "#,
    },
];

/// Highest migration version this build knows; a backup from a newer build can't be restored.
pub fn latest_version() -> i32 {
    MIGRATIONS.iter().map(|m| m.version).max().unwrap_or(0)
}

pub struct DatabaseManager {
    db_path: String,
}

impl DatabaseManager {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let db_path = path.as_ref().to_string_lossy().to_string();
        let manager = Self { db_path };
        manager.initialize_and_migrate()?;
        Ok(manager)
    }

    pub fn get_connection(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open SQLite database at {}: {}", self.db_path, e))?;

        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|e| format!("Failed to configure SQLite pragmas: {}", e))?;

        Ok(conn)
    }

    pub fn initialize_and_migrate(&self) -> Result<(), String> {
        let conn = self.get_connection()?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version INTEGER NOT NULL UNIQUE,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
            [],
        )
        .map_err(|e| format!("Failed to create _migrations table: {}", e))?;

        for m in MIGRATIONS {
            let mut stmt = conn
                .prepare("SELECT COUNT(*) FROM _migrations WHERE version = ?1")
                .map_err(|e| format!("Failed to prepare migration query: {}", e))?;

            let count: i64 = stmt
                .query_row(params![m.version], |row| row.get(0))
                .map_err(|e| format!("Failed to check migration status: {}", e))?;

            if count == 0 {
                println!("[SQLite] Applying migration {}: {}", m.version, m.name);

                // Each migration and its log row commit together, so a failure
                // never leaves a half-applied schema behind.
                let tx = conn
                    .unchecked_transaction()
                    .map_err(|e| format!("Failed starting migration {}: {}", m.name, e))?;

                tx.execute_batch(m.sql)
                    .map_err(|e| format!("Failed executing migration {}: {}", m.name, e))?;

                tx.execute(
                    "INSERT INTO _migrations (version, name, applied_at) VALUES (?1, ?2, datetime('now'))",
                    params![m.version, m.name],
                )
                .map_err(|e| format!("Failed recording migration {}: {}", m.name, e))?;

                tx.commit()
                    .map_err(|e| format!("Failed committing migration {}: {}", m.name, e))?;
            }
        }

        Ok(())
    }

    pub fn get_status(&self) -> Result<DbStatusInfo, String> {
        let conn = self.get_connection()?;

        let mut stmt = conn
            .prepare("SELECT version, name, applied_at FROM _migrations ORDER BY version ASC")
            .map_err(|e| format!("Failed to query migrations: {}", e))?;

        let migration_rows = stmt
            .query_map([], |row| {
                Ok(MigrationLog {
                    version: row.get(0)?,
                    name: row.get(1)?,
                    applied_at: row.get(2)?,
                })
            })
            .map_err(|e| format!("Failed to map migration rows: {}", e))?;

        let mut applied_migrations = Vec::new();
        for m in migration_rows {
            applied_migrations.push(m.map_err(|e| e.to_string())?);
        }

        Ok(DbStatusInfo {
            db_path: self.db_path.clone(),
            is_connected: true,
            applied_migrations,
        })
    }
}
