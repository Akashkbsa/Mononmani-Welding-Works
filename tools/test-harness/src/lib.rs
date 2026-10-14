#![allow(dead_code)]
#[path = "../../../src-tauri/src/util.rs"] pub mod util;
#[path = "../../../src-tauri/src/attachments.rs"] pub mod attachments;
pub mod db { #[path = "../../../../src-tauri/src/db/migrations.rs"] pub mod migrations; pub use migrations::{latest_version, DatabaseManager, DbStatusInfo}; }
pub mod customers { #[path = "../../../../src-tauri/src/customers/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/customers/repository.rs"] pub mod repository; }
pub mod invoices { #[path = "../../../../src-tauri/src/invoices/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/invoices/repository.rs"] pub mod repository; }
pub mod payments { #[path = "../../../../src-tauri/src/payments/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/payments/repository.rs"] pub mod repository; }
pub mod backup { #[path = "../../../../src-tauri/src/backup/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/backup/repository.rs"] pub mod repository; #[path = "../../../../src-tauri/src/backup/snapshot.rs"] pub mod snapshot; }
pub mod purchase_orders { #[path = "../../../../src-tauri/src/purchase_orders/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/purchase_orders/repository.rs"] pub mod repository; }
pub mod quotations { #[path = "../../../../src-tauri/src/quotations/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/quotations/repository.rs"] pub mod repository; }
