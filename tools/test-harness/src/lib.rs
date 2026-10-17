#![allow(dead_code)]
#[path = "../../../src-tauri/src/util.rs"] pub mod util;
#[path = "../../../src-tauri/src/attachments.rs"] pub mod attachments;
#[path = "../../../src-tauri/src/startup.rs"] pub mod startup;
pub mod db { #[path = "../../../../src-tauri/src/db/migrations.rs"] pub mod migrations; pub use migrations::{latest_version, DatabaseManager, DbStatusInfo}; }
pub mod customers { #[path = "../../../../src-tauri/src/customers/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/customers/repository.rs"] pub mod repository; }
pub mod invoices { #[path = "../../../../src-tauri/src/invoices/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/invoices/repository.rs"] pub mod repository; }
pub mod payments { #[path = "../../../../src-tauri/src/payments/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/payments/repository.rs"] pub mod repository; }
pub mod backup { #[path = "../../../../src-tauri/src/backup/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/backup/repository.rs"] pub mod repository; #[path = "../../../../src-tauri/src/backup/snapshot.rs"] pub mod snapshot; #[path = "../../../../src-tauri/src/backup/schedule.rs"] pub mod schedule; }
pub mod purchase_orders { #[path = "../../../../src-tauri/src/purchase_orders/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/purchase_orders/repository.rs"] pub mod repository; }
pub mod quotations { #[path = "../../../../src-tauri/src/quotations/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/quotations/repository.rs"] pub mod repository; }
pub mod supplier_bills { #[path = "../../../../src-tauri/src/supplier_bills/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/supplier_bills/repository.rs"] pub mod repository; }
pub mod supplier_payments { #[path = "../../../../src-tauri/src/supplier_payments/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/supplier_payments/repository.rs"] pub mod repository; }
pub mod rentals { #[path = "../../../../src-tauri/src/rentals/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/rentals/reminder.rs"] pub mod reminder; #[path = "../../../../src-tauri/src/rentals/repository.rs"] pub mod repository; }
pub mod reminders { #[path = "../../../../src-tauri/src/reminders/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/reminders/repository.rs"] pub mod repository; #[path = "../../../../src-tauri/src/reminders/schedule.rs"] pub mod schedule; }
pub mod payroll { #[path = "../../../../src-tauri/src/payroll/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/payroll/calc.rs"] pub mod calc; #[path = "../../../../src-tauri/src/payroll/repository.rs"] pub mod repository; #[path = "../../../../src-tauri/src/payroll/slip.rs"] pub mod slip; }
pub mod ledger { #[path = "../../../../src-tauri/src/ledger/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/ledger/repository.rs"] pub mod repository; #[path = "../../../../src-tauri/src/ledger/print.rs"] pub mod print; }
pub mod messages { #[path = "../../../../src-tauri/src/messages/templates.rs"] pub mod templates; }
pub mod settings { #[path = "../../../../src-tauri/src/settings/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/settings/repository.rs"] pub mod repository; }
pub mod pdf { #[path = "../../../../src-tauri/src/pdf/renderer.rs"] pub mod renderer; }
pub mod documents { #[path = "../../../../src-tauri/src/documents/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/documents/files.rs"] pub mod files; #[path = "../../../../src-tauri/src/documents/repository.rs"] pub mod repository; #[path = "../../../../src-tauri/src/documents/sync.rs"] pub mod sync; }
