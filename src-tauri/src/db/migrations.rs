use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::ops::Deref;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

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
    Migration {
        version: 10,
        name: "010_payment_writeoff",
        sql: r#"
            -- Short amount the owner accepted as full payment (counts towards settling the invoices).
            ALTER TABLE payments ADD COLUMN writeoff_amount REAL NOT NULL DEFAULT 0.0;
        "#,
    },
    Migration {
        version: 11,
        name: "011_exact_invoice_totals",
        sql: EXACT_TOTALS_SQL,
    },
    Migration {
        version: 12,
        name: "012_purchase_orders",
        sql: PURCHASE_ORDERS_SQL,
    },
    Migration {
        version: 13,
        name: "013_quotations",
        sql: QUOTATIONS_SQL,
    },
    Migration {
        version: 14,
        name: "014_party_type",
        sql: PARTY_TYPE_SQL,
    },
    Migration {
        version: 15,
        name: "015_supplier_tables",
        sql: SUPPLIER_TABLES_SQL,
    },
    Migration {
        version: 16,
        name: "016_rentals",
        sql: RENTALS_SQL,
    },
    Migration {
        version: 17,
        name: "017_rent_reminders",
        sql: RENT_REMINDERS_SQL,
    },
    Migration {
        version: 18,
        name: "018_reminders_count_as_sent",
        sql: REMINDERS_COUNT_AS_SENT_SQL,
    },
    Migration {
        version: 19,
        name: "019_remove_supplier_advances",
        sql: REMOVE_SUPPLIER_ADVANCES_SQL,
    },
    Migration {
        version: 20,
        name: "020_reminders",
        sql: REMINDERS_SQL,
    },
    Migration {
        version: 21,
        name: "021_whatsapp_number_and_payment_message",
        sql: WHATSAPP_NUMBER_AND_PAYMENT_MESSAGE_SQL,
    },
    Migration {
        version: 22,
        name: "022_payroll",
        sql: PAYROLL_SQL,
    },
    Migration {
        version: 23,
        name: "023_reminder_snooze",
        sql: REMINDER_SNOOZE_SQL,
    },
    Migration {
        version: 24,
        name: "024_log_settings_and_supplier_allocations",
        sql: LOG_SETTINGS_AND_SUPPLIER_ALLOCATIONS_SQL,
    },
    Migration {
        version: 25,
        name: "025_list_order_indexes",
        sql: LIST_ORDER_INDEXES_SQL,
    },
    Migration {
        version: 26,
        name: "026_document_vault",
        sql: DOCUMENT_VAULT_SQL,
    },
    Migration {
        version: 27,
        name: "027_pay_incentives",
        sql: PAY_INCENTIVES_SQL,
    },
    Migration {
        version: 28,
        name: "028_opening_balance",
        sql: OPENING_BALANCE_SQL,
    },
];

/// A company's opening balance for its ledger: what it owed before its records in the app
/// (+ they owe us, − we owe them) and the date it stood on. Customers are already in `change_log`.
pub const OPENING_BALANCE_SQL: &str = r#"
    ALTER TABLE customers ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0;
    ALTER TABLE customers ADD COLUMN opening_balance_date TEXT NULL
        CHECK (opening_balance_date IS NULL OR opening_balance_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
"#;

/// Incentives: any number of extra amounts on an employee's month, each with its reason (night
/// work, site visit, ...). They add to what the month earned, like the bonus. Removed with their
/// month. Tracked in `change_log` for the backup.
pub const PAY_INCENTIVES_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS pay_incentives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pay_month_id INTEGER NOT NULL REFERENCES pay_months(id) ON DELETE CASCADE,
        reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        amount REAL NOT NULL CHECK (amount > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pay_incentives_month ON pay_incentives(pay_month_id);

    CREATE TRIGGER IF NOT EXISTS trg_pay_incentives_insert_log AFTER INSERT ON pay_incentives
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('pay_incentives', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_pay_incentives_update_log AFTER UPDATE ON pay_incentives
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('pay_incentives', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_pay_incentives_delete_log AFTER DELETE ON pay_incentives
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('pay_incentives', OLD.id, 'DELETE', datetime('now'));
    END;
"#;

/// Document Vault: the owner's own documents in two groups, Important and Keep for Future. The file
/// itself lives in the Documents folder under its SHA-256, never in the database, so the daily
/// backup stays small. `document_drive_copies` remembers which files are already on Google Drive,
/// by content, and is never emptied: a document deleted here keeps its copy on Drive, and the same
/// file added again is not uploaded twice. It is not in `change_log`, so noting an upload does not
/// start another backup.
pub const DOCUMENT_VAULT_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL CHECK (category IN ('IMPORTANT', 'FUTURE')),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        note TEXT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category, created_at);

    CREATE TABLE IF NOT EXISTS document_drive_copies (
        sha256 TEXT PRIMARY KEY,
        drive_file_id TEXT NOT NULL,
        uploaded_at TEXT NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS trg_documents_insert_log AFTER INSERT ON documents
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('documents', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_documents_update_log AFTER UPDATE ON documents
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('documents', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_documents_delete_log AFTER DELETE ON documents
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('documents', OLD.id, 'DELETE', datetime('now'));
    END;
"#;

/// Lists show the newest first and then by id. An ascending date index read backwards gives exactly
/// that order, so the list needs no extra sort; the older descending date indexes could not.
pub const LIST_ORDER_INDEXES_SQL: &str = r#"
    DROP INDEX IF EXISTS idx_invoices_date;
    DROP INDEX IF EXISTS idx_payments_date;
    DROP INDEX IF EXISTS idx_supplier_payments_date;
    CREATE INDEX IF NOT EXISTS idx_invoices_date_order ON invoices(invoice_date);
    CREATE INDEX IF NOT EXISTS idx_payments_date_order ON payments(payment_date);
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_date_order ON supplier_payments(payment_date);
    CREATE INDEX IF NOT EXISTS idx_supplier_bills_date_order ON supplier_bills(bill_date);
"#;

/// Two tables the backup's change log missed. The owner's settings (business, bank, tax, snooze
/// choices): without this, changing only them never started the daily backup. The backup's own
/// note of Drive space (`drive_space`) is not a change, and saving a value unchanged is not either.
/// And how supplier payments are shared over bills, like `payment_allocations` on the customer side.
pub const LOG_SETTINGS_AND_SUPPLIER_ALLOCATIONS_SQL: &str = r#"
    CREATE TRIGGER IF NOT EXISTS trg_app_settings_insert_log AFTER INSERT ON app_settings
    WHEN NEW.key <> 'drive_space'
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('app_settings', NEW.rowid, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_app_settings_update_log AFTER UPDATE ON app_settings
    WHEN NEW.key <> 'drive_space' AND OLD.value IS NOT NEW.value
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('app_settings', NEW.rowid, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_app_settings_delete_log AFTER DELETE ON app_settings
    WHEN OLD.key <> 'drive_space'
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('app_settings', OLD.rowid, 'DELETE', datetime('now'));
    END;

    CREATE TRIGGER IF NOT EXISTS trg_supplier_payment_allocations_insert_log AFTER INSERT ON supplier_payment_allocations
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_payment_allocations', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supplier_payment_allocations_update_log AFTER UPDATE ON supplier_payment_allocations
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_payment_allocations', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supplier_payment_allocations_delete_log AFTER DELETE ON supplier_payment_allocations
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_payment_allocations', OLD.id, 'DELETE', datetime('now'));
    END;
"#;

/// Snooze: a reminder stays off the banner until this day (YYYY-MM-DD). The reminders table is
/// already tracked in `change_log`, so the backup picks up the new column.
pub const REMINDER_SNOOZE_SQL: &str = "ALTER TABLE reminders ADD COLUMN snoozed_until TEXT NULL;";


/// Employees and payroll: employees, one pay row per employee per month (days, OT hours and the
/// rates copied when first saved), every money movement for a month's pay, and employee files.
/// Wages, balances and statuses are worked out, never stored. Tracked in `change_log` for the backup.
pub const PAYROLL_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NULL,
        phone TEXT NULL,
        address TEXT NULL,
        joined_on TEXT NOT NULL CHECK (joined_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        left_on TEXT NULL CHECK (left_on IS NULL OR left_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        daily_wage REAL NOT NULL CHECK (daily_wage > 0),
        ot_rate REAL NOT NULL DEFAULT 0 CHECK (ot_rate >= 0),
        notes TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pay_months (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
        days_worked REAL NOT NULL CHECK (days_worked >= 0 AND days_worked <= 31),
        daily_wage REAL NOT NULL CHECK (daily_wage > 0),
        ot_hours REAL NOT NULL DEFAULT 0 CHECK (ot_hours >= 0),
        ot_rate REAL NOT NULL DEFAULT 0 CHECK (ot_rate >= 0),
        bonus_amount REAL NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
        bonus_note TEXT NULL,
        note TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (employee_id, month)
    );
    CREATE INDEX IF NOT EXISTS idx_pay_months_month ON pay_months(month);

    CREATE TABLE IF NOT EXISTS employee_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
        kind TEXT NOT NULL CHECK (kind IN ('ADVANCE', 'SALARY', 'RETURNED', 'WRITE_OFF', 'CARRIED')),
        entry_date TEXT NOT NULL CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        amount REAL NOT NULL CHECK (amount > 0),
        round_off REAL NOT NULL DEFAULT 0,
        carried_to TEXT NULL CHECK (carried_to IS NULL OR carried_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
        payment_method TEXT NULL,
        note TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((kind = 'CARRIED') = (carried_to IS NOT NULL)),
        CHECK (kind = 'SALARY' OR round_off = 0)
    );
    CREATE INDEX IF NOT EXISTS idx_employee_payments_month ON employee_payments(employee_id, month);
    CREATE INDEX IF NOT EXISTS idx_employee_payments_carried ON employee_payments(carried_to);
    CREATE INDEX IF NOT EXISTS idx_employee_payments_date ON employee_payments(entry_date);

    CREATE TABLE IF NOT EXISTS employee_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_employee_files_employee ON employee_files(employee_id);

    CREATE TRIGGER IF NOT EXISTS trg_employees_insert_log AFTER INSERT ON employees
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('employees', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_employees_update_log AFTER UPDATE ON employees
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('employees', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_employees_delete_log AFTER DELETE ON employees
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('employees', OLD.id, 'DELETE', datetime('now'));
    END;

    CREATE TRIGGER IF NOT EXISTS trg_pay_months_insert_log AFTER INSERT ON pay_months
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('pay_months', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_pay_months_update_log AFTER UPDATE ON pay_months
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('pay_months', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_pay_months_delete_log AFTER DELETE ON pay_months
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('pay_months', OLD.id, 'DELETE', datetime('now'));
    END;

    CREATE TRIGGER IF NOT EXISTS trg_employee_payments_insert_log AFTER INSERT ON employee_payments
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('employee_payments', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_employee_payments_update_log AFTER UPDATE ON employee_payments
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('employee_payments', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_employee_payments_delete_log AFTER DELETE ON employee_payments
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('employee_payments', OLD.id, 'DELETE', datetime('now'));
    END;

    CREATE TRIGGER IF NOT EXISTS trg_employee_files_insert_log AFTER INSERT ON employee_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('employee_files', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_employee_files_update_log AFTER UPDATE ON employee_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('employee_files', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_employee_files_delete_log AFTER DELETE ON employee_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('employee_files', OLD.id, 'DELETE', datetime('now'));
    END;
"#;

/// A company's WhatsApp number when it is not the phone number (empty means WhatsApp the phone),
/// and the day a supplier payment's WhatsApp message was opened. Both tables are already tracked in
/// `change_log`, so the backup picks up the new columns.
pub const WHATSAPP_NUMBER_AND_PAYMENT_MESSAGE_SQL: &str = r#"
    ALTER TABLE customers ADD COLUMN whatsapp_number TEXT NULL;
    ALTER TABLE supplier_payments ADD COLUMN whatsapp_sent_on TEXT NULL;
"#;

/// Supplier payments no longer keep advances. A payment that kept its extra as an advance now counts
/// it as a round-off (paid, nothing owed back), and the advance tables go. Bills are settled by their
/// allocations, so no bill changes.
pub const REMOVE_SUPPLIER_ADVANCES_SQL: &str = r#"
    UPDATE supplier_payments SET excess_action = 'ROUNDOFF' WHERE excess_action = 'CREDIT';
    DROP TABLE IF EXISTS supplier_credit_applications;
    DROP TABLE IF EXISTS supplier_credits;
"#;

/// Reminders the owner sets: a date, how many days before to start showing it, an optional repeat
/// and an optional link to one record. Tracked in `change_log` so the backup picks up every change.
pub const REMINDERS_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        note TEXT NULL,
        due_date TEXT NOT NULL CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        remind_days INTEGER NOT NULL DEFAULT 0 CHECK (remind_days BETWEEN 0 AND 365),
        repeat TEXT NOT NULL DEFAULT 'NONE' CHECK (repeat IN ('NONE', 'WEEKLY', 'MONTHLY', 'YEARLY')),
        repeat_day INTEGER NULL CHECK (repeat_day BETWEEN 1 AND 31),
        month_end INTEGER NOT NULL DEFAULT 0 CHECK (month_end IN (0, 1)),
        link_kind TEXT NULL CHECK (link_kind IN ('INVOICE', 'QUOTATION', 'PURCHASE_ORDER', 'PAYMENT', 'SUPPLIER_BILL',
                                                 'SUPPLIER_PAYMENT', 'COMPANY', 'TENANT', 'PLACE')),
        link_id INTEGER NULL,
        dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1)),
        done_on TEXT NULL,
        last_done_on TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_date);
    CREATE INDEX IF NOT EXISTS idx_reminders_link ON reminders(link_kind, link_id);

    CREATE TRIGGER IF NOT EXISTS trg_reminders_insert_log AFTER INSERT ON reminders
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('reminders', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_reminders_update_log AFTER UPDATE ON reminders
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('reminders', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_reminders_delete_log AFTER DELETE ON reminders
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('reminders', OLD.id, 'DELETE', datetime('now'));
    END;
"#;

/// Opening WhatsApp with the reminder now counts as sending it, so reminders that were waiting
/// for a confirmation count as sent on the day they were opened.
pub const REMINDERS_COUNT_AS_SENT_SQL: &str = "UPDATE rent_reminders SET sent_on = opened_on WHERE sent_on IS NULL;";

/// One row per reminder opened in WhatsApp. `sent_on` is filled only when the owner confirms the
/// message was sent, because WhatsApp never tells the app. Dates the first rentals version kept in
/// `rent_months.reminded_on` become opened, unconfirmed reminders.
pub const RENT_REMINDERS_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS rent_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL REFERENCES rental_tenants(id) ON DELETE CASCADE,
        month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
        opened_on TEXT NOT NULL,
        sent_on TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rent_reminders_tenant_month ON rent_reminders(tenant_id, month);

    CREATE TRIGGER IF NOT EXISTS trg_rent_reminders_insert_log AFTER INSERT ON rent_reminders
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rent_reminders', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rent_reminders_update_log AFTER UPDATE ON rent_reminders
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rent_reminders', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rent_reminders_delete_log AFTER DELETE ON rent_reminders
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rent_reminders', OLD.id, 'DELETE', datetime('now'));
    END;

    -- After the triggers, so the copied rows are tracked for backup like any other change.
    INSERT INTO rent_reminders (tenant_id, month, opened_on, created_at, updated_at)
        SELECT tenant_id, month, reminded_on, datetime('now'), datetime('now') FROM rent_months WHERE reminded_on IS NOT NULL;
"#;

/// Purchase orders received from customers (with the files they came in) and the optional link
/// from an invoice to the order it was raised against. One order can have many invoices.
pub const PURCHASE_ORDERS_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        po_number TEXT NOT NULL,
        po_date TEXT NULL,
        status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'PARTIAL', 'COMPLETED')),
        notes TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_customer ON purchase_orders(customer_id);

    CREATE TABLE IF NOT EXISTS purchase_order_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_order_files_order ON purchase_order_files(purchase_order_id);

    ALTER TABLE invoices ADD COLUMN purchase_order_id INTEGER NULL REFERENCES purchase_orders(id);
    CREATE INDEX IF NOT EXISTS idx_invoices_purchase_order ON invoices(purchase_order_id);

    CREATE TRIGGER IF NOT EXISTS trg_purchase_orders_insert_log AFTER INSERT ON purchase_orders
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('purchase_orders', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_purchase_orders_update_log AFTER UPDATE ON purchase_orders
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('purchase_orders', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_purchase_orders_delete_log AFTER DELETE ON purchase_orders
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('purchase_orders', OLD.id, 'DELETE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_purchase_order_files_insert_log AFTER INSERT ON purchase_order_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('purchase_order_files', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_purchase_order_files_update_log AFTER UPDATE ON purchase_order_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('purchase_order_files', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_purchase_order_files_delete_log AFTER DELETE ON purchase_order_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('purchase_order_files', OLD.id, 'DELETE', datetime('now'));
    END;
"#;

/// Quotations sent to customers (with the files they went out as) and the optional link from a
/// purchase order to the quotation it was raised from. One quotation can have many orders.
pub const QUOTATIONS_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS quotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        quotation_number TEXT NOT NULL,
        quotation_date TEXT NOT NULL,
        notes TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id);

    CREATE TABLE IF NOT EXISTS quotation_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quotation_files_quotation ON quotation_files(quotation_id);

    ALTER TABLE purchase_orders ADD COLUMN quotation_id INTEGER NULL REFERENCES quotations(id);
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_quotation ON purchase_orders(quotation_id);

    CREATE TRIGGER IF NOT EXISTS trg_quotations_insert_log AFTER INSERT ON quotations
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('quotations', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_quotations_update_log AFTER UPDATE ON quotations
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('quotations', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_quotations_delete_log AFTER DELETE ON quotations
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('quotations', OLD.id, 'DELETE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_quotation_files_insert_log AFTER INSERT ON quotation_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('quotation_files', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_quotation_files_update_log AFTER UPDATE ON quotation_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('quotation_files', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_quotation_files_delete_log AFTER DELETE ON quotation_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('quotation_files', OLD.id, 'DELETE', datetime('now'));
    END;
"#;

/// Every company is a customer, a supplier or both. Existing companies are customers.
pub const PARTY_TYPE_SQL: &str = r#"
    ALTER TABLE customers ADD COLUMN party_type TEXT NOT NULL DEFAULT 'CUSTOMER'
        CHECK (party_type IN ('CUSTOMER', 'SUPPLIER', 'BOTH'));
    CREATE INDEX IF NOT EXISTS idx_customers_party_type ON customers(party_type);
"#;

/// Bills received from suppliers (with their files), the payments made to suppliers, how each
/// payment is shared out over bills, and advances paid to a supplier. A bill's status is worked out
/// from its allocations, never stored.
pub const SUPPLIER_TABLES_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS supplier_bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL REFERENCES customers(id),
        bill_number TEXT NOT NULL,
        bill_date TEXT NOT NULL,
        total_amount REAL NOT NULL CHECK (total_amount > 0),
        notes TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier ON supplier_bills(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_bills_number ON supplier_bills(bill_number COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS supplier_bill_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id INTEGER NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_bill_files_bill ON supplier_bill_files(bill_id);

    CREATE TABLE IF NOT EXISTS supplier_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_number TEXT NOT NULL UNIQUE,
        supplier_id INTEGER NOT NULL REFERENCES customers(id),
        payment_date TEXT NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'Bank Transfer',
        reference_number TEXT NULL,
        bank_name TEXT NULL,
        amount_paid REAL NOT NULL DEFAULT 0.0,
        total_settled REAL NOT NULL DEFAULT 0.0,
        credit_applied REAL NOT NULL DEFAULT 0.0,
        excess_amount REAL NOT NULL DEFAULT 0.0,
        excess_action TEXT NOT NULL DEFAULT 'NONE' CHECK (excess_action IN ('NONE', 'CREDIT', 'ROUNDOFF')),
        writeoff_amount REAL NOT NULL DEFAULT 0.0,
        remarks TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_date ON supplier_payments(payment_date DESC);

    CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
        bill_id INTEGER NOT NULL REFERENCES supplier_bills(id),
        amount_allocated REAL NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_allocations_payment ON supplier_payment_allocations(payment_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_allocations_bill ON supplier_payment_allocations(bill_id);

    CREATE TABLE IF NOT EXISTS supplier_credits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL REFERENCES customers(id),
        source_payment_id INTEGER NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
        original_amount REAL NOT NULL DEFAULT 0.0,
        remaining_amount REAL NOT NULL DEFAULT 0.0,
        notes TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_credits_supplier ON supplier_credits(supplier_id);

    CREATE TABLE IF NOT EXISTS supplier_credit_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
        credit_id INTEGER NOT NULL REFERENCES supplier_credits(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_credit_applications_payment ON supplier_credit_applications(payment_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_credit_applications_credit ON supplier_credit_applications(credit_id);

    CREATE TRIGGER IF NOT EXISTS trg_supplier_bills_insert_log AFTER INSERT ON supplier_bills
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_bills', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supplier_bills_update_log AFTER UPDATE ON supplier_bills
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_bills', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supplier_bills_delete_log AFTER DELETE ON supplier_bills
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_bills', OLD.id, 'DELETE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supplier_bill_files_insert_log AFTER INSERT ON supplier_bill_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_bill_files', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supplier_bill_files_update_log AFTER UPDATE ON supplier_bill_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_bill_files', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supplier_bill_files_delete_log AFTER DELETE ON supplier_bill_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_bill_files', OLD.id, 'DELETE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supplier_payments_insert_log AFTER INSERT ON supplier_payments
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_payments', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supplier_payments_update_log AFTER UPDATE ON supplier_payments
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_payments', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_supplier_payments_delete_log AFTER DELETE ON supplier_payments
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('supplier_payments', OLD.id, 'DELETE', datetime('now'));
    END;
"#;

/// Places the owner rents out, their tenants, the rent paid each month, and files for both.
/// Everything is tracked in `change_log` so the existing backup picks up every change.
pub const RENTALS_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS rental_places (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT NULL,
        monthly_rent REAL NOT NULL DEFAULT 0.0 CHECK (monthly_rent >= 0),
        notes TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_places_name ON rental_places(name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS rental_tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        place_id INTEGER NOT NULL REFERENCES rental_places(id),
        name TEXT NOT NULL,
        whatsapp_number TEXT NOT NULL,
        monthly_rent REAL NOT NULL CHECK (monthly_rent > 0),
        move_in_date TEXT NULL,
        moved_out_date TEXT NULL,
        notes TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rental_tenants_place ON rental_tenants(place_id);
    -- A place has at most one current tenant (one with no moved-out date).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_tenants_one_current ON rental_tenants(place_id) WHERE moved_out_date IS NULL;

    CREATE TABLE IF NOT EXISTS rent_months (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL REFERENCES rental_tenants(id) ON DELETE CASCADE,
        month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
        paid_on TEXT NULL,
        amount REAL NULL,
        note TEXT NULL,
        reminded_on TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, month)
    );

    CREATE TABLE IF NOT EXISTS rental_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_kind TEXT NOT NULL CHECK (owner_kind IN ('PLACE', 'TENANT')),
        owner_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rental_files_owner ON rental_files(owner_kind, owner_id);

    -- Files belong to a place or a tenant and go when it goes.
    CREATE TRIGGER IF NOT EXISTS trg_rental_places_delete_files AFTER DELETE ON rental_places
    BEGIN
        DELETE FROM rental_files WHERE owner_kind = 'PLACE' AND owner_id = OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rental_tenants_delete_files AFTER DELETE ON rental_tenants
    BEGIN
        DELETE FROM rental_files WHERE owner_kind = 'TENANT' AND owner_id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_rental_places_insert_log AFTER INSERT ON rental_places
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rental_places', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rental_places_update_log AFTER UPDATE ON rental_places
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rental_places', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rental_places_delete_log AFTER DELETE ON rental_places
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rental_places', OLD.id, 'DELETE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rental_tenants_insert_log AFTER INSERT ON rental_tenants
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rental_tenants', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rental_tenants_update_log AFTER UPDATE ON rental_tenants
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rental_tenants', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rental_tenants_delete_log AFTER DELETE ON rental_tenants
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rental_tenants', OLD.id, 'DELETE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rent_months_insert_log AFTER INSERT ON rent_months
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rent_months', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rent_months_update_log AFTER UPDATE ON rent_months
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rent_months', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rent_months_delete_log AFTER DELETE ON rent_months
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rent_months', OLD.id, 'DELETE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rental_files_insert_log AFTER INSERT ON rental_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rental_files', NEW.id, 'INSERT', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rental_files_update_log AFTER UPDATE ON rental_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rental_files', NEW.id, 'UPDATE', datetime('now'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_rental_files_delete_log AFTER DELETE ON rental_files
    BEGIN
        INSERT INTO change_log (table_name, row_id, op, changed_at) VALUES ('rental_files', OLD.id, 'DELETE', datetime('now'));
    END;
"#;

/// Invoice totals are no longer rounded to the rupee. Invoices that are not fully paid yet are
/// brought to their exact total (the round-off is folded back in). Fully paid invoices keep the
/// total they were settled at, so they don't reappear with a few paise due.
pub const EXACT_TOTALS_SQL: &str = r#"
    UPDATE invoices
    SET total_amount = ROUND(total_amount - round_off, 2),
        round_off = 0.0
    WHERE round_off != 0.0
      AND COALESCE((SELECT SUM(amount_allocated + tds_allocated)
                    FROM payment_allocations WHERE invoice_id = invoices.id), 0.0) < total_amount - 0.005;
"#;

/// Highest migration version this build knows; a backup from a newer build can't be restored.
pub fn latest_version() -> i32 {
    MIGRATIONS.iter().map(|m| m.version).max().unwrap_or(0)
}

pub struct DatabaseManager {
    db_path: String,
    /// The one connection the app's commands share, opened on first use. Commands take turns on
    /// it, as they did when they all ran on the UI thread, so two saves never collide.
    shared: Mutex<Option<Connection>>,
}

/// The shared connection, held until this is dropped.
pub struct SharedConnection<'a>(MutexGuard<'a, Option<Connection>>);

impl Deref for SharedConnection<'_> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        self.0.as_ref().expect("the shared connection is opened before it is handed out")
    }
}

impl DatabaseManager {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let db_path = path.as_ref().to_string_lossy().to_string();
        let manager = Self { db_path, shared: Mutex::new(None) };
        manager.initialize_and_migrate()?;
        Ok(manager)
    }

    /// The app's shared connection, waiting for any command still using it. Keep it only as long as needed.
    pub fn connection(&self) -> Result<SharedConnection<'_>, String> {
        let mut guard = self.shared.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_none() {
            *guard = Some(self.get_connection()?);
        }
        Ok(SharedConnection(guard))
    }

    /// Close the shared connection and keep it closed until the returned guard is dropped, so the
    /// database file can be replaced (restore). The next command opens it again.
    pub fn close_shared(&self) -> MutexGuard<'_, Option<Connection>> {
        let mut guard = self.shared.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = None;
        guard
    }

    /// A new connection of its own (migrations, backups, tests).
    pub fn get_connection(&self) -> Result<Connection, String> {
        let mut conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open SQLite database at {}: {}", self.db_path, e))?;

        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|e| format!("Failed to configure SQLite pragmas: {}", e))?;

        // A save takes the write lock when it starts, so it waits its turn (busy_timeout) instead of
        // failing with "database is locked" when another connection (the backup) wrote meanwhile.
        conn.set_transaction_behavior(TransactionBehavior::Immediate);

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

#[cfg(test)]
mod tests {
    use super::*;

    /// A database exactly as migration 11 left it, holding one customer and one invoice.
    fn database_at_version_11(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("t.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE _migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
        )
        .unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 11) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute(
                "INSERT INTO _migrations (version, name, applied_at) VALUES (?1, ?2, 'x')",
                params![m.version, m.name],
            )
            .unwrap();
        }
        conn.execute("INSERT INTO customers (name, created_at, updated_at) VALUES ('Sample Co', 'x', 'x')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, customer_name, po_number_and_date, amount_in_words, created_at, updated_at)
             VALUES ('MWW/001/26-27', '2026-10-01', 1, 'Sample Co', 'PO-OLD & 01-10-2026', 'x', 'x', 'x')",
            [],
        )
        .unwrap();
        path
    }

    /// A database exactly as migration 12 left it: one customer and one purchase order (no quotations yet).
    fn database_at_version_12(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("t12.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE _migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
        )
        .unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 12) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute(
                "INSERT INTO _migrations (version, name, applied_at) VALUES (?1, ?2, 'x')",
                params![m.version, m.name],
            )
            .unwrap();
        }
        conn.execute("INSERT INTO customers (name, created_at, updated_at) VALUES ('Sample Co', 'x', 'x')", []).unwrap();
        conn.execute(
            "INSERT INTO purchase_orders (customer_id, po_number, created_at, updated_at) VALUES (1, 'PO-OLD', 'x', 'x')",
            [],
        )
        .unwrap();
        path
    }

    /// A database exactly as migration 13 left it: one customer and one invoice.
    fn database_at_version_13(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("t13.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE _migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
        )
        .unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 13) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute(
                "INSERT INTO _migrations (version, name, applied_at) VALUES (?1, ?2, 'x')",
                params![m.version, m.name],
            )
            .unwrap();
        }
        conn.execute("INSERT INTO customers (name, created_at, updated_at) VALUES ('Sample Co', 'x', 'x')", []).unwrap();
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, customer_name, amount_in_words, created_at, updated_at)
             VALUES ('MWW/26-27/001', '2026-10-01', 1, 'Sample Co', 'x', 'x', 'x')",
            [],
        )
        .unwrap();
        path
    }

    /// A database exactly as migration 14 left it: one company with an invoice, a payment, a purchase order and a quotation.
    fn database_at_version_14(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("t14.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE _migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
        )
        .unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 14) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute(
                "INSERT INTO _migrations (version, name, applied_at) VALUES (?1, ?2, 'x')",
                params![m.version, m.name],
            )
            .unwrap();
        }
        conn.execute("INSERT INTO customers (name, created_at, updated_at) VALUES ('Sample Co', 'x', 'x')", []).unwrap();
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, customer_name, amount_in_words, created_at, updated_at)
             VALUES ('MWW/26-27/001', '2026-10-01', 1, 'Sample Co', 'x', 'x', 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO payments (payment_number, customer_id, customer_name, payment_date, created_at, updated_at)
             VALUES ('PAY/26-27/001', 1, 'Sample Co', '2026-10-02', 'x', 'x')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO purchase_orders (customer_id, po_number, created_at, updated_at) VALUES (1, 'PO-1', 'x', 'x')", []).unwrap();
        conn.execute(
            "INSERT INTO quotations (customer_id, quotation_number, quotation_date, created_at, updated_at) VALUES (1, 'Q-1', '2026-10-01', 'x', 'x')",
            [],
        )
        .unwrap();
        path
    }

    /// A database exactly as migration 15 left it: a company with an invoice and a supplier bill.
    fn database_at_version_15(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("t15.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE _migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
        )
        .unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 15) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute(
                "INSERT INTO _migrations (version, name, applied_at) VALUES (?1, ?2, 'x')",
                params![m.version, m.name],
            )
            .unwrap();
        }
        conn.execute("INSERT INTO customers (name, created_at, updated_at) VALUES ('Sample Co', 'x', 'x')", []).unwrap();
        conn.execute(
            "INSERT INTO invoices (invoice_number, invoice_date, customer_id, customer_name, amount_in_words, created_at, updated_at)
             VALUES ('MWW/26-27/001', '2026-10-01', 1, 'Sample Co', 'x', 'x', 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO supplier_bills (supplier_id, bill_number, bill_date, total_amount, created_at, updated_at)
             VALUES (1, 'B-1', '2026-10-01', 100, 'x', 'x')",
            [],
        )
        .unwrap();
        path
    }

    fn add_rental_place(conn: &Connection, name: &str) -> i64 {
        conn.execute(
            "INSERT INTO rental_places (name, monthly_rent, created_at, updated_at) VALUES (?1, 5000, 'x', 'x')",
            params![name],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn try_add_rental_tenant(conn: &Connection, place: i64, name: &str, moved_out: Option<&str>) -> rusqlite::Result<i64> {
        conn.execute(
            "INSERT INTO rental_tenants (place_id, name, whatsapp_number, monthly_rent, moved_out_date, created_at, updated_at)
             VALUES (?1, ?2, '+919876543210', 5000, ?3, 'x', 'x')",
            params![place, name, moved_out],
        )?;
        Ok(conn.last_insert_rowid())
    }

    fn add_rental_file(conn: &Connection, kind: &str, owner: i64) {
        conn.execute(
            "INSERT INTO rental_files (owner_kind, owner_id, file_name, mime_type, size_bytes, data, created_at)
             VALUES (?1, ?2, 'a.pdf', 'application/pdf', 4, x'25504446', 'x')",
            params![kind, owner],
        )
        .unwrap();
    }

    fn file_count(conn: &Connection, kind: &str) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM rental_files WHERE owner_kind = ?1", params![kind], |r| r.get(0)).unwrap()
    }

    fn add_bill(conn: &Connection, number: &str) -> i64 {
        conn.execute(
            "INSERT INTO supplier_bills (supplier_id, bill_number, bill_date, total_amount, created_at, updated_at)
             VALUES (1, ?1, '2026-10-01', 11550.0, 'x', 'x')",
            params![number],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn add_supplier_payment(conn: &Connection, number: &str) -> i64 {
        conn.execute(
            "INSERT INTO supplier_payments (payment_number, supplier_id, payment_date, created_at, updated_at)
             VALUES (?1, 1, '2026-10-02', 'x', 'x')",
            params![number],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn add_quotation(conn: &Connection, number: &str) -> i64 {
        conn.execute(
            "INSERT INTO quotations (customer_id, quotation_number, quotation_date, created_at, updated_at) VALUES (1, ?1, '2026-10-01', 'x', 'x')",
            params![number],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn open(path: &Path) -> Connection {
        DatabaseManager::new(path).unwrap().get_connection().unwrap()
    }

    fn add_order(conn: &Connection, number: &str) -> i64 {
        conn.execute(
            "INSERT INTO purchase_orders (customer_id, po_number, created_at, updated_at) VALUES (1, ?1, 'x', 'x')",
            params![number],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn migration_12_adds_tables_and_keeps_existing_invoices() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_11(dir.path()));

        assert!(latest_version() >= 12);
        let (linked, text): (Option<i64>, String) = conn
            .query_row("SELECT purchase_order_id, po_number_and_date FROM invoices", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(linked, None);
        assert_eq!(text, "PO-OLD & 01-10-2026");

        let id = add_order(&conn, "PO-1");
        let status: String = conn.query_row("SELECT status FROM purchase_orders WHERE id = ?1", params![id], |r| r.get(0)).unwrap();
        assert_eq!(status, "NOT_STARTED");
        let logged: i64 = conn
            .query_row("SELECT COUNT(*) FROM change_log WHERE table_name = 'purchase_orders' AND op = 'INSERT'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(logged, 1);

        conn.execute(
            "INSERT INTO purchase_order_files (purchase_order_id, file_name, mime_type, size_bytes, data, created_at) VALUES (?1, 'a.pdf', 'application/pdf', 4, x'25504446', 'x')",
            params![id],
        )
        .unwrap();
        let logged: i64 = conn
            .query_row("SELECT COUNT(*) FROM change_log WHERE table_name = 'purchase_order_files'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(logged, 1);

        conn.execute("DELETE FROM purchase_orders WHERE id = ?1", params![id]).unwrap();
        let files: i64 = conn.query_row("SELECT COUNT(*) FROM purchase_order_files", [], |r| r.get(0)).unwrap();
        assert_eq!(files, 0, "files go with their order");

        let bad: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
        assert_eq!(bad, 0);
    }

    #[test]
    fn status_must_be_one_of_the_three_values() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_11(dir.path()));
        let id = add_order(&conn, "PO-2");
        for ok in ["NOT_STARTED", "PARTIAL", "COMPLETED"] {
            conn.execute("UPDATE purchase_orders SET status = ?1 WHERE id = ?2", params![ok, id]).unwrap();
        }
        assert!(conn.execute("UPDATE purchase_orders SET status = 'DONE' WHERE id = ?1", params![id]).is_err());
    }

    #[test]
    fn database_refuses_to_delete_an_order_that_an_invoice_points_to() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_11(dir.path()));
        let id = add_order(&conn, "PO-3");
        conn.execute("UPDATE invoices SET purchase_order_id = ?1", params![id]).unwrap();
        assert!(conn.execute("DELETE FROM purchase_orders WHERE id = ?1", params![id]).is_err());
    }

    #[test]
    fn migration_13_adds_quotations_and_leaves_existing_orders_unlinked() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_12(dir.path()));

        assert!(latest_version() >= 13);
        let linked: Option<i64> =
            conn.query_row("SELECT quotation_id FROM purchase_orders WHERE po_number = 'PO-OLD'", [], |r| r.get(0)).unwrap();
        assert_eq!(linked, None);

        let q = add_quotation(&conn, "Q-1");
        conn.execute("UPDATE purchase_orders SET quotation_id = ?1", params![q]).unwrap();
        let bad: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
        assert_eq!(bad, 0);
    }

    #[test]
    fn quotations_and_their_files_are_logged_and_files_go_with_the_quotation() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_12(dir.path()));
        let q = add_quotation(&conn, "Q-2");
        conn.execute("UPDATE quotations SET notes = 'x' WHERE id = ?1", params![q]).unwrap();
        conn.execute(
            "INSERT INTO quotation_files (quotation_id, file_name, mime_type, size_bytes, data, created_at) VALUES (?1, 'a.pdf', 'application/pdf', 4, x'25504446', 'x')",
            params![q],
        )
        .unwrap();
        let ops = |table: &str| -> Vec<String> {
            conn.prepare("SELECT op FROM change_log WHERE table_name = ?1 ORDER BY seq")
                .unwrap()
                .query_map(params![table], |r| r.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(ops("quotations"), vec!["INSERT", "UPDATE"]);
        assert_eq!(ops("quotation_files"), vec!["INSERT"]);

        conn.execute("DELETE FROM quotations WHERE id = ?1", params![q]).unwrap();
        let files: i64 = conn.query_row("SELECT COUNT(*) FROM quotation_files", [], |r| r.get(0)).unwrap();
        assert_eq!(files, 0, "files go with their quotation");
        assert_eq!(ops("quotations"), vec!["INSERT", "UPDATE", "DELETE"]);
    }

    #[test]
    fn database_refuses_to_delete_a_quotation_that_an_order_points_to() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_12(dir.path()));
        let q = add_quotation(&conn, "Q-3");
        conn.execute("UPDATE purchase_orders SET quotation_id = ?1", params![q]).unwrap();
        assert!(conn.execute("DELETE FROM quotations WHERE id = ?1", params![q]).is_err());
        assert!(conn.execute("UPDATE purchase_orders SET quotation_id = 9999", []).is_err(), "no such quotation");
    }

    #[test]
    fn migration_14_makes_existing_companies_customers() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_13(dir.path()));
        assert!(latest_version() >= 14);
        let kind: String = conn.query_row("SELECT party_type FROM customers WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(kind, "CUSTOMER");
        let invoices: i64 = conn.query_row("SELECT COUNT(*) FROM invoices WHERE customer_id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(invoices, 1);
    }

    #[test]
    fn party_type_must_be_one_of_the_three_values() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_13(dir.path()));
        for ok in ["SUPPLIER", "BOTH", "CUSTOMER"] {
            conn.execute("UPDATE customers SET party_type = ?1 WHERE id = 1", params![ok]).unwrap();
        }
        assert!(conn.execute("UPDATE customers SET party_type = 'VENDOR' WHERE id = 1", []).is_err());
    }

    #[test]
    fn migration_15_adds_supplier_tables_and_leaves_existing_data_alone() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_14(dir.path()));
        assert!(latest_version() >= 15);
        for table in ["customers", "invoices", "payments", "purchase_orders", "quotations"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "{}", table);
        }
        let kind: String = conn.query_row("SELECT party_type FROM customers", [], |r| r.get(0)).unwrap();
        assert_eq!(kind, "CUSTOMER");
        for table in ["supplier_bills", "supplier_bill_files", "supplier_payments", "supplier_payment_allocations"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{}", table);
        }
    }

    #[test]
    fn migration_19_turns_supplier_advances_into_round_offs_and_drops_their_tables() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE _migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
        )
        .unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 18) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO _migrations (version, name, applied_at) VALUES (?1, ?2, 'x')", params![m.version, m.name]).unwrap();
        }
        conn.execute("INSERT INTO customers (name, party_type, created_at, updated_at) VALUES ('Steel Co', 'SUPPLIER', 'x', 'x')", []).unwrap();
        conn.execute("INSERT INTO supplier_payments (payment_number, supplier_id, payment_date, amount_paid, excess_amount, excess_action, created_at, updated_at) VALUES ('SP/26-27/001', 1, '2026-10-02', 500, 500, 'CREDIT', 'x', 'x')", []).unwrap();
        conn.execute("INSERT INTO supplier_credits (supplier_id, source_payment_id, original_amount, remaining_amount, created_at, updated_at) VALUES (1, 1, 500, 500, 'x', 'x')", []).unwrap();
        drop(conn);

        let conn = open(&path);
        assert!(latest_version() >= 19);
        let action: String = conn.query_row("SELECT excess_action FROM supplier_payments", [], |r| r.get(0)).unwrap();
        assert_eq!(action, "ROUNDOFF");
        for table in ["supplier_credits", "supplier_credit_applications"] {
            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1", params![table], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0, "{}", table);
        }
    }

    #[test]
    fn supplier_tables_log_changes_and_files_follow_their_bill() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_14(dir.path()));
        let bill = add_bill(&conn, "B-1");
        conn.execute(
            "INSERT INTO supplier_bill_files (bill_id, file_name, mime_type, size_bytes, data, created_at) VALUES (?1, 'a.pdf', 'application/pdf', 4, x'25504446', 'x')",
            params![bill],
        )
        .unwrap();
        let payment = add_supplier_payment(&conn, "SP/26-27/001");
        conn.execute("UPDATE supplier_payments SET remarks = 'x' WHERE id = ?1", params![payment]).unwrap();
        let ops = |table: &str| -> Vec<String> {
            conn.prepare("SELECT op FROM change_log WHERE table_name = ?1 ORDER BY seq")
                .unwrap()
                .query_map(params![table], |r| r.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(ops("supplier_bills"), vec!["INSERT"]);
        assert_eq!(ops("supplier_bill_files"), vec!["INSERT"]);
        assert_eq!(ops("supplier_payments"), vec!["INSERT", "UPDATE"]);

        conn.execute("DELETE FROM supplier_bills WHERE id = ?1", params![bill]).unwrap();
        let files: i64 = conn.query_row("SELECT COUNT(*) FROM supplier_bill_files", [], |r| r.get(0)).unwrap();
        assert_eq!(files, 0, "files go with their bill");
        assert_eq!(ops("supplier_bills"), vec!["INSERT", "DELETE"]);
    }

    #[test]
    fn database_protects_supplier_records() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_14(dir.path()));
        assert!(
            conn.execute(
                "INSERT INTO supplier_bills (supplier_id, bill_number, bill_date, total_amount, created_at, updated_at) VALUES (1, 'B-0', '2026-10-01', 0, 'x', 'x')",
                [],
            )
            .is_err(),
            "a bill must be for more than zero"
        );
        let bill = add_bill(&conn, "B-1");
        let payment = add_supplier_payment(&conn, "SP/26-27/001");
        conn.execute(
            "INSERT INTO supplier_payment_allocations (payment_id, bill_id, amount_allocated, created_at) VALUES (?1, ?2, 100, 'x')",
            params![payment, bill],
        )
        .unwrap();
        assert!(conn.execute("DELETE FROM supplier_bills WHERE id = ?1", params![bill]).is_err(), "a bill with an allocation stays");
        assert!(conn.execute("DELETE FROM customers WHERE id = 1", []).is_err(), "a company with supplier records stays");
        assert!(
            conn.execute(
                "INSERT INTO supplier_payments (payment_number, supplier_id, payment_date, created_at, updated_at) VALUES ('SP/26-27/001', 1, '2026-10-03', 'x', 'x')",
                [],
            )
            .is_err(),
            "payment numbers are unique"
        );
        assert!(
            conn.execute("UPDATE supplier_payments SET excess_action = 'REFUND' WHERE id = ?1", params![payment]).is_err(),
            "there is no refund option"
        );
        for ok in ["NONE", "CREDIT", "ROUNDOFF"] {
            conn.execute("UPDATE supplier_payments SET excess_action = ?1 WHERE id = ?2", params![ok, payment]).unwrap();
        }
    }

    #[test]
    fn migration_20_adds_reminders_and_leaves_data_alone() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        assert!(latest_version() >= 20);
        for table in ["customers", "invoices", "supplier_bills"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "{}", table);
        }
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM reminders", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn migration_21_adds_whatsapp_columns_and_leaves_data_alone() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        assert!(latest_version() >= 21);
        let (name, number): (String, Option<String>) =
            conn.query_row("SELECT name, whatsapp_number FROM customers", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert!(!name.is_empty());
        assert_eq!(number, None);
        let sent: i64 = conn
            .query_row("SELECT COUNT(*) FROM supplier_payments WHERE whatsapp_sent_on IS NOT NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sent, 0);
    }

    #[test]
    fn migration_22_adds_payroll_tables_and_leaves_data_alone() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        assert!(latest_version() >= 22);
        for table in ["employees", "pay_months", "employee_payments", "employee_files"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{}", table);
        }
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM customers", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn migration_26_adds_the_document_vault_and_leaves_data_alone() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        assert!(latest_version() >= 26);
        for table in ["documents", "document_drive_copies"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{}", table);
        }
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM customers", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn document_rules_in_the_tables() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        let sha = "a".repeat(64);
        let add = |category: &str, title: &str, size: i64, sha: &str| {
            conn.execute(
                "INSERT INTO documents (category, title, file_name, mime_type, size_bytes, sha256, created_at, updated_at)
                 VALUES (?1, ?2, 'a.pdf', 'application/pdf', ?3, ?4, 'x', 'x')",
                params![category, title, size, sha],
            )
        };
        assert!(add("IMPORTANT", "Deed", 10, &sha).is_ok());
        assert!(add("FUTURE", "Same file again", 10, &sha).is_err(), "one row per file");
        assert!(add("OTHER", "Deed", 10, &"b".repeat(64)).is_err(), "only the two groups");
        assert!(add("FUTURE", "   ", 10, &"c".repeat(64)).is_err(), "a title is needed");
        assert!(add("FUTURE", "Empty", 0, &"d".repeat(64)).is_err(), "no empty files");
        assert!(add("FUTURE", "Short hash", 10, "abc").is_err());
    }

    #[test]
    fn documents_are_logged_for_backup_but_drive_copies_are_not() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        let sha = "e".repeat(64);
        conn.execute(
            "INSERT INTO documents (category, title, file_name, mime_type, size_bytes, sha256, created_at, updated_at)
             VALUES ('IMPORTANT', 'Deed', 'a.pdf', 'application/pdf', 5, ?1, 'x', 'x')",
            params![sha],
        )
        .unwrap();
        conn.execute_batch("UPDATE documents SET note = 'n'; DELETE FROM documents;").unwrap();
        conn.execute("INSERT INTO document_drive_copies (sha256, drive_file_id, uploaded_at) VALUES (?1, 'd1', 'x')", params![sha])
            .unwrap();
        let ops: Vec<String> = conn
            .prepare("SELECT op FROM change_log WHERE table_name = 'documents' ORDER BY seq")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(ops, vec!["INSERT", "UPDATE", "DELETE"]);
        let copies: i64 = conn
            .query_row("SELECT COUNT(*) FROM change_log WHERE table_name = 'document_drive_copies'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(copies, 0);
    }

    #[test]
    fn migration_23_adds_reminder_snooze() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        assert!(latest_version() >= 23);
        conn.execute("INSERT INTO reminders (title, due_date, created_at, updated_at) VALUES ('Pay GST', '2026-10-31', 'x', 'x')", []).unwrap();
        let snoozed: Option<String> = conn.query_row("SELECT snoozed_until FROM reminders", [], |r| r.get(0)).unwrap();
        assert_eq!(snoozed, None);
    }

    #[test]
    fn payroll_rules_in_the_tables() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        conn.execute("INSERT INTO employees (name, joined_on, daily_wage, ot_rate, created_at, updated_at) VALUES ('Murugan', '2026-01-01', 600, 80, 'x', 'x')", []).unwrap();
        let pm = "INSERT INTO pay_months (employee_id, month, days_worked, daily_wage, created_at, updated_at) VALUES (1, '2026-10', 26, 600, 'x', 'x')";
        conn.execute(pm, []).unwrap();
        assert!(conn.execute(pm, []).is_err(), "one row per employee per month");
        let pay = |kind: &str, round_off: f64, carried_to: Option<&str>, amount: f64| {
            conn.execute(
                "INSERT INTO employee_payments (employee_id, month, kind, entry_date, amount, round_off, carried_to, created_at, updated_at)
                 VALUES (1, '2026-10', ?1, '2026-10-15', ?2, ?3, ?4, 'x', 'x')",
                params![kind, amount, round_off, carried_to],
            )
        };
        assert!(pay("LOAN", 0.0, None, 100.0).is_err());
        assert!(pay("CARRIED", 0.0, None, 100.0).is_err());
        assert!(pay("ADVANCE", 0.0, Some("2026-11"), 100.0).is_err());
        assert!(pay("ADVANCE", 5.0, None, 100.0).is_err());
        assert!(pay("ADVANCE", 0.0, None, 0.0).is_err());
        assert!(pay("SALARY", -40.0, None, 100.0).is_ok());
        assert!(pay("CARRIED", 0.0, Some("2026-11"), 100.0).is_ok());
        conn.execute("INSERT INTO employee_files (employee_id, file_name, mime_type, size_bytes, data, created_at) VALUES (1, 'a.pdf', 'application/pdf', 1, x'00', 'x')", []).unwrap();
        assert!(conn.execute("DELETE FROM employees WHERE id = 1", []).is_err(), "pay records keep the employee");
        conn.execute_batch("DELETE FROM employee_payments; DELETE FROM pay_months; DELETE FROM employees;").unwrap();
        let files: i64 = conn.query_row("SELECT COUNT(*) FROM employee_files", [], |r| r.get(0)).unwrap();
        assert_eq!(files, 0, "files go with the employee");
    }

    #[test]
    fn migration_27_incentives_go_with_their_month_and_log_changes() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        assert!(latest_version() >= 27);
        conn.execute_batch(
            "INSERT INTO employees (name, joined_on, daily_wage, created_at, updated_at) VALUES ('Murugan', '2026-01-01', 600, 'x', 'x');
             INSERT INTO pay_months (employee_id, month, days_worked, daily_wage, created_at, updated_at) VALUES (1, '2026-10', 26, 600, 'x', 'x');
             INSERT INTO pay_incentives (pay_month_id, reason, amount, created_at, updated_at) VALUES (1, 'Night work', 200, 'x', 'x');
             UPDATE pay_incentives SET amount = 250;",
        )
        .unwrap();
        let bad = |reason: &str, amount: f64| {
            conn.execute(
                "INSERT INTO pay_incentives (pay_month_id, reason, amount, created_at, updated_at) VALUES (1, ?1, ?2, 'x', 'x')",
                params![reason, amount],
            )
            .is_err()
        };
        assert!(bad(" ", 100.0), "a reason is needed");
        assert!(bad("Site", 0.0), "the amount is more than 0");
        conn.execute("DELETE FROM pay_months", []).unwrap();
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM pay_incentives", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0, "incentives go with their month");
        let ops: Vec<String> = conn
            .prepare("SELECT op FROM change_log WHERE table_name = 'pay_incentives' ORDER BY seq")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(ops, vec!["INSERT", "UPDATE", "DELETE"]);
    }

    #[test]
    fn payroll_tables_log_changes() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        conn.execute_batch(
            "INSERT INTO employees (name, joined_on, daily_wage, created_at, updated_at) VALUES ('Murugan', '2026-01-01', 600, 'x', 'x');
             INSERT INTO pay_months (employee_id, month, days_worked, daily_wage, created_at, updated_at) VALUES (1, '2026-10', 26, 600, 'x', 'x');
             INSERT INTO employee_payments (employee_id, month, kind, entry_date, amount, created_at, updated_at) VALUES (1, '2026-10', 'ADVANCE', '2026-10-15', 500, 'x', 'x');
             INSERT INTO employee_files (employee_id, file_name, mime_type, size_bytes, data, created_at) VALUES (1, 'a.pdf', 'application/pdf', 1, x'00', 'x');
             UPDATE employees SET notes = 'n'; UPDATE pay_months SET note = 'n'; UPDATE employee_payments SET note = 'n'; UPDATE employee_files SET file_name = 'b.pdf';
             DELETE FROM employee_files; DELETE FROM employee_payments; DELETE FROM pay_months; DELETE FROM employees;",
        )
        .unwrap();
        for table in ["employees", "pay_months", "employee_payments", "employee_files"] {
            let ops: Vec<String> = conn
                .prepare("SELECT op FROM change_log WHERE table_name = ?1 ORDER BY seq")
                .unwrap()
                .query_map(params![table], |r| r.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect();
            assert_eq!(ops, vec!["INSERT", "UPDATE", "DELETE"], "{}", table);
        }
    }

    #[test]
    fn reminder_rules_in_the_table() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        let insert = |due: &str, days: i64, repeat: &str, kind: Option<&str>| {
            conn.execute(
                "INSERT INTO reminders (title, due_date, remind_days, repeat, link_kind, link_id, created_at, updated_at)
                 VALUES ('Pay GST', ?1, ?2, ?3, ?4, 1, 'x', 'x')",
                params![due, days, repeat, kind],
            )
        };
        assert!(insert("31-10-2026", 2, "NONE", None).is_err(), "date must be YYYY-MM-DD");
        assert!(insert("2026-10-31", 400, "NONE", None).is_err(), "remind days 0 to 365");
        assert!(insert("2026-10-31", -1, "NONE", None).is_err(), "remind days 0 to 365");
        assert!(insert("2026-10-31", 2, "DAILY", None).is_err(), "repeat is one of four");
        assert!(insert("2026-10-31", 2, "NONE", Some("CAR")).is_err(), "link kind is one of nine");
        insert("2026-10-31", 3, "MONTHLY", Some("TENANT")).unwrap();
        let logged: i64 = conn
            .query_row("SELECT COUNT(*) FROM change_log WHERE table_name = 'reminders' AND op = 'INSERT'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(logged, 1, "reminders are tracked for backup");
    }

    #[test]
    fn migration_16_adds_rental_tables_and_leaves_existing_data_alone() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        assert!(latest_version() >= 16);
        for table in ["customers", "invoices", "supplier_bills"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "{}", table);
        }
        for table in ["rental_places", "rental_tenants", "rent_months", "rental_files"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{}", table);
        }
    }

    #[test]
    fn migration_17_keeps_old_reminder_dates_as_unconfirmed_openings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        // Build the database as version 16 left it, with one reminder date in the old column.
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE _migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
        )
        .unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 16) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO _migrations (version, name, applied_at) VALUES (?1, ?2, 'x')", params![m.version, m.name]).unwrap();
        }
        conn.execute("INSERT INTO rental_places (name, monthly_rent, created_at, updated_at) VALUES ('Flat', 100, 'x', 'x')", []).unwrap();
        conn.execute("INSERT INTO rental_tenants (place_id, name, whatsapp_number, monthly_rent, created_at, updated_at) VALUES (1, 'Ravi', '+919876543210', 100, 'x', 'x')", []).unwrap();
        conn.execute("INSERT INTO rent_months (tenant_id, month, reminded_on, created_at, updated_at) VALUES (1, '2026-10', '2026-10-03', 'x', 'x')", []).unwrap();
        drop(conn);

        let conn = open(&path);
        assert!(latest_version() >= 17);
        let (opened, sent): (String, Option<String>) = conn
            .query_row("SELECT opened_on, sent_on FROM rent_reminders", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((opened.as_str(), sent.as_deref()), ("2026-10-03", Some("2026-10-03")));
        let logged: i64 = conn.query_row("SELECT COUNT(*) FROM change_log WHERE table_name = 'rent_reminders'", [], |r| r.get(0)).unwrap();
        assert!(logged >= 1);
    }

    #[test]
    fn rental_tables_are_tracked_for_backup() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        let place = add_rental_place(&conn, "Flat 2B");
        let tenant = try_add_rental_tenant(&conn, place, "Ravi", None).unwrap();
        conn.execute("INSERT INTO rent_months (tenant_id, month, created_at, updated_at) VALUES (?1, '2026-10', 'x', 'x')", params![tenant]).unwrap();
        add_rental_file(&conn, "TENANT", tenant);
        for table in ["rental_places", "rental_tenants", "rent_months", "rental_files"] {
            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM change_log WHERE table_name = ?1 AND op = 'INSERT'", params![table], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1, "{} must be tracked so a backup runs after it changes", table);
        }
        conn.execute("UPDATE rent_months SET paid_on = '2026-10-03' WHERE tenant_id = ?1", params![tenant]).unwrap();
        let updates: i64 = conn
            .query_row("SELECT COUNT(*) FROM change_log WHERE table_name = 'rent_months' AND op = 'UPDATE'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(updates, 1);
    }

    #[test]
    fn only_one_current_tenant_per_place() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        let place = add_rental_place(&conn, "Flat 2B");
        try_add_rental_tenant(&conn, place, "Ravi", None).unwrap();
        assert!(try_add_rental_tenant(&conn, place, "Meena", None).is_err(), "a second current tenant is refused");
        let old = try_add_rental_tenant(&conn, place, "Old tenant", Some("2026-01-31")).unwrap();
        assert!(
            conn.execute("UPDATE rental_tenants SET moved_out_date = NULL WHERE id = ?1", params![old]).is_err(),
            "moving back in while the place is taken is refused"
        );
        let other = add_rental_place(&conn, "Shop 1");
        assert!(try_add_rental_tenant(&conn, other, "Meena", None).is_ok());
    }

    #[test]
    fn rent_month_rules() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        let place = add_rental_place(&conn, "Flat 2B");
        let tenant = try_add_rental_tenant(&conn, place, "Ravi", None).unwrap();
        let add = |month: &str| {
            conn.execute("INSERT INTO rent_months (tenant_id, month, created_at, updated_at) VALUES (?1, ?2, 'x', 'x')", params![tenant, month])
        };
        for bad in ["November", "2026-1", "2026-13x"] {
            assert!(add(bad).is_err(), "{}", bad);
        }
        assert!(add("2026-11").is_ok());
        assert!(add("2026-11").is_err(), "one row per tenant and month");
        assert!(
            conn.execute("INSERT INTO rental_tenants (place_id, name, whatsapp_number, monthly_rent, created_at, updated_at) VALUES (?1, 'Zero', '+919876543210', 0, 'x', 'x')", params![add_rental_place(&conn, "Shop 9")]).is_err(),
            "rent must be above zero"
        );
    }

    #[test]
    fn files_go_with_their_place_or_tenant() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        let place = add_rental_place(&conn, "Flat 2B");
        let tenant = try_add_rental_tenant(&conn, place, "Ravi", None).unwrap();
        add_rental_file(&conn, "PLACE", place);
        add_rental_file(&conn, "TENANT", tenant);
        conn.execute("DELETE FROM rental_tenants WHERE id = ?1", params![tenant]).unwrap();
        assert_eq!((file_count(&conn, "TENANT"), file_count(&conn, "PLACE")), (0, 1));
        conn.execute("DELETE FROM rental_places WHERE id = ?1", params![place]).unwrap();
        assert_eq!(file_count(&conn, "PLACE"), 0);
    }

    #[test]
    fn a_place_with_a_tenant_cannot_be_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&database_at_version_15(dir.path()));
        let place = add_rental_place(&conn, "Flat 2B");
        try_add_rental_tenant(&conn, place, "Ravi", Some("2026-01-31")).unwrap();
        assert!(conn.execute("DELETE FROM rental_places WHERE id = ?1", params![place]).is_err());
        assert!(
            conn.execute("INSERT INTO rental_places (name, created_at, updated_at) VALUES ('flat 2b', 'x', 'x')", []).is_err(),
            "place names are unique, ignoring case"
        );
    }
}
