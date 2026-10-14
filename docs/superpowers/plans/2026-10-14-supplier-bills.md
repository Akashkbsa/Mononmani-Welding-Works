# Supplier Bills and Supplier Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every company a type (Customer / Supplier / Both), record the bills suppliers send (with files and a calculated status), and record supplier payments that can settle several bills, write off a short amount, round off or keep an extra, and hold advances, with no limits on write-off or round-off.

**Architecture:** `customers.party_type` plus a Rust guard (`require_party`) decides which companies each screen and save may use. Two new Rust modules, `supplier_bills/` and `supplier_payments/`, mirror `quotations/` and the customer `payments/` rules, written fresh; all supplier tables arrive in one migration. File handling reuses `attachments.rs` and `components/attachments/`. Customer Payments code is not changed.

**Tech Stack:** Rust (Tauri 2, rusqlite), React 19 + TypeScript + Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-14-supplier-bills-design.md` (read it first; it leans on `2026-10-13-quotations-design.md` for files and on the customer `payments/` module for settlement).

## Global Constraints

- Names: sidebar **Supplier bills** (icon `ReceiptText`), **Supplier payments** (icon `HandCoins`), **Customers & suppliers** (icon stays `Users`). Sidebar order: Dashboard, Invoices, Quotations, Purchase orders, Payments, Supplier bills, Supplier payments, Customers & suppliers, Settings.
- `party_type` values are exactly `CUSTOMER`, `SUPPLIER`, `BOTH`; default `CUSTOMER`.
- Bill status values `NOT_PAID`, `PARTIAL`, `PAID`; labels "Not paid", "Partially paid", "Fully paid". Status is calculated from allocations, never stored.
- Supplier payment `excess_action` is `NONE`, `CREDIT` or `ROUNDOFF`; the extra defaults to `CREDIT`; there is no refund option. Payment number format `SP/26-27/001` via `doc_number("SP", n, fy)` / `doc_sequence`.
- **No limit and no warning on write-off or round-off, in Rust or in the screens.** The only write-off rule: it cannot exceed the shortfall.
- Dates stored `YYYY-MM-DD`, shown `DD-MM-YYYY`. Money is REAL rounded with `round2`; tolerance `MONEY_EPS = 0.005` (new, in `util.rs`). No due dates.
- Files: inside the database, 10 MB each, JPG/JPEG, PNG, PDF, DOC, DOCX, via `attachments.rs`. Temp copies of bill files use kind `"supplier_bill"` (`supplier_bill_<id>_<name>`).
- Schema changes only in new numbered migrations (14 and 15); never edit an applied one.
- Customer `payments/repository.rs` gets exactly two kinds of edit: one `require_party` call in `save`, and `party_type: None,` in its test struct literals. Nothing else.
- Never read the real database (`%APPDATA%\com.manonmani.app\Database\manonmani.db`); tests use temp databases.
- Rust tests run through the harness crate (plain `cargo test` cannot start on this machine). Per PowerShell session:
  `$env:PATH = "C:\Users\Asus\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;" + $env:PATH`
  then `cargo test --manifest-path tools/test-harness/Cargo.toml [filter]` (Task 1 creates it). Before Task 1 the existing scratchpad harness at `C:\Users\Asus\AppData\Local\Temp\claude\C--Users-Asus-Downloads-Monomani-welding-works\a6815f9b-c0b1-4f45-90ef-b3fca42312ea\scratchpad\harness\Cargo.toml` can be used. **Baseline: 109 passed.**
- Crate check `cargo check --manifest-path src-tauri/Cargo.toml` must show no warnings. UI checks: `npx tsc --noEmit -p .` and `npm run build`.
- Work on branch `feature/supplier-bills`. Commit locally after each task, message ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **Do not push.**

## Plan Notes (decisions made while planning; the owner can overrule)

1. The spec was amended to match what the code needs: one supplier migration (15) instead of two, a **New** supplier button on the bill form, and the meaning of the filter chips (Customers = Customer + Both, Suppliers = Supplier + Both, Both = Both only).
2. Task 1 moves the Rust test harness from a scratch folder into the repo (`tools/test-harness/`) so the tests can be run by anyone.
3. `get_unpaid_bills_for_supplier` and `get_supplier_credits` take an optional `exclude_payment_id`, as the customer versions do, so editing a payment keeps its own bills and advance available.
4. "Use advance" is a checkbox, exactly as on the customer payment form (the spec called it a button).
5. A `REFUND` or unknown excess action is refused instead of being guessed.
6. Because limits are dropped, the one-click "Settle in full" shortcut is offered for any remaining balance, whatever its size.

## Review Focus

Input classes the spec implies and the tasks' main tests do not cover by themselves. Each has a named test in the owning task.

1. **A company of the wrong type slipping through** a picker or a save (a supplier-only company on an invoice, a customer-only company on a bill, via the Rust saves and the lists). Tasks 3, 4, 9.
2. **Paise rounding** leaving a bill "Partially paid" with ₹0.00 due, or inventing a ₹0.01 advance (three instalments of ₹333.37/333.37/333.36 on ₹1,000.10; `0.1 + 0.2` against ₹0.30). Task 12.
3. **Changing a company's type while it holds records on both sides** (a "Both" company with invoices and supplier bills can go neither way). Tasks 3, 8.
4. **Editing or deleting after later activity:** lowering a bill's total below what is settled; deleting or shrinking a payment whose advance a later payment used. Tasks 9, 13.
5. **Large amounts:** a ₹60,000 write-off and a ₹50,000 round-off are accepted without any warning text, while a write-off larger than the shortfall is refused. Tasks 12, 16.

## File Structure

Create:
- `tools/test-harness/{Cargo.toml,Cargo.lock,.gitignore,test.bat,src/lib.rs}`
- `src-tauri/src/supplier_bills/{mod,models,repository,commands}.rs`
- `src-tauri/src/supplier_payments/{mod,models,repository,commands}.rs`
- `src/types/{supplierBill,supplierPayment}.ts`
- `src/components/supplierBills/{SupplierBillFormModal,SupplierBillDetailsModal,SupplierBillStatusBadge}.tsx`
- `src/components/supplierPayments/{SupplierPaymentFormModal,SupplierPaymentDetailsModal}.tsx`
- `src/pages/{SupplierBillsPage,SupplierPaymentsPage}.tsx`

Modify: `src-tauri/src/{lib,util}.rs`, `db/migrations.rs`, `backup/repository.rs`, `customers/{models,repository,commands}.rs`, the saves in `invoices/`, `payments/`, `purchase_orders/`, `quotations/` repositories, `src/types/customer.ts`, `src/services/api.ts`, `src/App.tsx`, `src/components/CustomerPicker.tsx`, `src/components/customers/*`, `src/pages/CustomersPage.tsx`, the four existing forms that list customers, `docs/PROJECT_STRUCTURE.md`, `AGENTS.md`.

---

# Stage 1: Company type

### Task 1: Test harness inside the repo

**Files:** Create `tools/test-harness/Cargo.toml`, `Cargo.lock`, `.gitignore`, `test.bat`, `src/lib.rs`.

**Interfaces:** Produces the command `cargo test --manifest-path tools/test-harness/Cargo.toml`, running the same 109 tests as the scratchpad harness.

- [ ] **Step 1: Create the crate.** `Cargo.toml` (package `harness`, edition 2021, `[lib] path = "src/lib.rs"`) with exactly these dependencies: `serde` 1 (derive), `serde_json` 1, `rusqlite` 0.32 (bundled), `chrono` 0.4 (default-features off; `clock`, `std`, `serde`), `sha2` 0.10, `md-5` 0.10, `flate2` 1, `base64` 0.22, `tempfile` 3. Copy `Cargo.lock` from the scratchpad harness folder (same path as above, without `\Cargo.toml`). `.gitignore` contains `target/`. `test.bat` sets `PATH` from the `MINGW` line in `app.bat` and runs `cargo test --manifest-path "%~dp0Cargo.toml" %*`.
- [ ] **Step 2: Write `src/lib.rs`** as the scratchpad harness `src/lib.rs` with every absolute path rewritten relative to the repo. Rule, checked with a throwaway crate: a `#[path]` at the crate root is relative to `tools/test-harness/src`, so it starts `../../../src-tauri/src/`; a `#[path]` inside an inline `pub mod x { }` gets one more `..` (`../../../../src-tauri/src/`). Modules, in order: `util`, `attachments` (root level, `#![allow(dead_code)]` first), then inline `db` (migrations, plus `pub use migrations::{latest_version, DatabaseManager, DbStatusInfo};`), `customers`, `invoices`, `payments`, `backup` (models, repository, snapshot), `purchase_orders`, `quotations` (each of these with models + repository).
- [ ] **Step 3: Run the baseline.** Run: `cargo test --manifest-path tools/test-harness/Cargo.toml --target-dir <scratchpad harness>\target` (the shared `--target-dir` reuses the compiled dependencies; omit it for a clean 5-minute build). Expected: `test result: ok. 109 passed; 0 failed`.
- [ ] **Step 4: Commit** `build: run the Rust data-layer tests from the repo`.

---

### Task 2: Migration 14, company type column

**Files:** Modify `src-tauri/src/db/migrations.rs`. Test: same file.

**Interfaces:** Produces `customers.party_type TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (party_type IN ('CUSTOMER','SUPPLIER','BOTH'))`, index `idx_customers_party_type`, `latest_version() == 14`, const `PARTY_TYPE_SQL`.

- [ ] **Step 1: Write failing tests** (a `database_at_version_13` helper next to `database_at_version_12`, building all migrations ≤ 13 and inserting one customer and one invoice): `migration_14_makes_existing_companies_customers` (after opening through `DatabaseManager`: `latest_version() == 14`; the customer's `party_type == 'CUSTOMER'`; the invoice still readable), and `party_type_must_be_one_of_the_three_values` (updating to `SUPPLIER` and `BOTH` works; `'VENDOR'` is an error). Relax the existing `assert_eq!(latest_version(), 13)` in the quotation migration test to `assert!(latest_version() >= 13)`.
- [ ] **Step 2: Run** `cargo test ... migration` → FAIL (`no such column: party_type` / version 13).
- [ ] **Step 3: Implement** `PARTY_TYPE_SQL` (`ALTER TABLE customers ADD COLUMN ...` plus the index) and register `Migration { version: 14, name: "014_party_type", sql: PARTY_TYPE_SQL }`.
- [ ] **Step 4: Run the full suite.** Expected: all pass (109 + 2 new).
- [ ] **Step 5: Commit** `feat: migration 14 for company type`.

---

### Task 3: Company type in the customer repository

**Files:** Modify `src-tauri/src/customers/models.rs`, `customers/repository.rs`; test-literal patches in `customers/repository.rs`, `invoices/repository.rs`, `payments/repository.rs`.

**Interfaces:**
- Produces in `customers::models`: `pub const PARTY_TYPES: [&str; 3]`; `#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum PartyRole { Customer, Supplier }`; `Customer.party_type: String`; `CustomerCreateInput.party_type` and `CustomerUpdateInput.party_type`, both `#[serde(default)] Option<String>` (None = `CUSTOMER` on create, unchanged on update).
- Produces in `CustomerRepository`: `list_by_party(conn: &Connection, party: Option<&str>) -> Result<Vec<Customer>, String>` and `search_by_party(conn, query: &str, party: Option<&str>) -> Result<Vec<Customer>, String>` (party `None`/`"ALL"` = everyone; `"CUSTOMER"` = Customer + Both; `"SUPPLIER"` = Supplier + Both; anything else → `Err("Unknown company type.")`); `find_all` and `search` become wrappers passing `None`. `require_party(conn, id: i64, role: PartyRole) -> Result<(), String>`.
- Messages (exact): invalid type `"Choose Customer, Supplier or Both."`; missing company `"Customer not found."` (role Customer) / `"Supplier not found."` (role Supplier); wrong type, role Customer: `"This company is a supplier only, so it can't be used for invoices, payments, purchase orders or quotations."`; role Supplier: `"This company is a customer only, so it can't be used for supplier bills or supplier payments."`; type change to Supplier-only: `format!("This company has {} customer record(s) (invoices, payments, purchase orders, quotations or advances), so it can't be changed to Supplier only.", n)`.

- [ ] **Step 1: Write failing tests** in `customers/repository.rs`:
  - `new_companies_default_to_customer_and_keep_the_type_chosen`: `None` → `CUSTOMER`; `Some("supplier")` → `SUPPLIER` (normalised to upper case); `Some("BOTH")` → `BOTH`; `Some("VENDOR")` → the invalid-type message.
  - `lists_and_searches_filter_by_party`: Alpha Traders (CUSTOMER), Beta Steel (SUPPLIER), Gamma Works (BOTH). `list_by_party(None)` has 3; `"CUSTOMER"` gives Alpha + Gamma; `"SUPPLIER"` gives Beta + Gamma; `search_by_party("Steel","SUPPLIER")` gives Beta; `search_by_party("Steel","CUSTOMER")` is empty; an empty query equals the list; `Some("VENDOR")` → `"Unknown company type."`. (Review Focus 1.)
  - `require_party_refuses_the_wrong_type`: exact messages above; `BOTH` passes for both roles; id 9999 gives the two "not found" messages.
  - `a_company_with_customer_records_cannot_become_supplier_only`: a `CUSTOMER` company; insert, one at a time with raw SQL and delete afterwards, one row each in `invoices`, `payments`, `purchase_orders`, `quotations`, `customer_credits`; each time `update` with `party_type: Some("SUPPLIER")` fails with the exact message and `n = 1`; changing to `BOTH` works; with no records, changing to `SUPPLIER` works. (Review Focus 3.)
  - `editing_without_a_type_keeps_the_current_type`.
- [ ] **Step 2: Patch every existing struct literal.** Add `party_type: None,` to all `CustomerCreateInput` and `CustomerUpdateInput` literals (about 23: `customers/repository.rs`, `invoices/repository.rs`, `payments/repository.rs`); the compiler's `E0063` list finds each one.
- [ ] **Step 3: Run** `cargo test ... customers` → FAIL (new functions and column missing).
- [ ] **Step 4: Implement.** Add `party_type` as column 14 of all five customer `SELECT` lists and `map_row`; persist it in `create` and in the same `UPDATE` in `update`; the guard runs in `update` before writing; `list_by_party`/`search_by_party` add `AND party_type IN (...)`; normalise type text with `trim().to_uppercase()`.
- [ ] **Step 5: Run the full suite** → all pass. `cargo check --manifest-path src-tauri/Cargo.toml` clean.
- [ ] **Step 6: Commit** `feat: company type in the customer repository`.

---

### Task 4: Wrong-type companies refused by the existing saves

**Files:** Modify `invoices/repository.rs` (`save`), `payments/repository.rs` (`save`), `purchase_orders/repository.rs` (`clean_input`), `quotations/repository.rs` (`clean_input`). Tests in each file.

**Interfaces:** Consumes `CustomerRepository::require_party(conn, id, PartyRole::Customer)`.

- [ ] **Step 1: Write failing tests**, one per module, each creating a `SUPPLIER` company (via `CustomerRepository::create` with `party_type: Some("SUPPLIER")`, or raw SQL in the order/quotation modules) and expecting `Err` containing `supplier only`; then a `BOTH` company succeeds: `an_invoice_cannot_be_raised_for_a_supplier_only_company` (use the existing `link_input` helper), `a_payment_cannot_be_recorded_for_a_supplier_only_company`, `an_order_cannot_be_raised_for_a_supplier_only_company`, `a_quotation_cannot_be_raised_for_a_supplier_only_company`.
- [ ] **Step 2: Run** each → FAIL.
- [ ] **Step 3: Implement.** Invoices: after the stored-order check, `if let Some(cid) = input.customer_id { require_party(conn, cid, PartyRole::Customer)?; }`. Payments: right after the customer name is read. Purchase orders and quotations: right after the existing "Customer not found." check.
- [ ] **Step 4: Run the full suite** → all pass.
- [ ] **Step 5: Commit** `feat: only customers can be used on invoices, payments, orders and quotations`.

---

### Task 5: Company type through the commands, types and API

**Files:** Modify `customers/commands.rs`; `src/types/customer.ts`; `src/services/api.ts`; `InvoiceFormModal.tsx`, `PaymentFormModal.tsx`, `PurchaseOrderFormModal.tsx`, `QuotationFormModal.tsx`; `src/components/customers/CustomerFormModal.tsx` (state only).

**Interfaces:**
- Produces Rust commands `list_customers(party: Option<String>)`, `search_customers(query: String, party: Option<String>)` calling `list_by_party` / `search_by_party`.
- Produces TS: `export type PartyType = "CUSTOMER" | "SUPPLIER" | "BOTH"`; `PARTY_TYPE_LABEL: Record<PartyType, string>` (Customer, Supplier, Both); `Customer.party_type: PartyType`; `CustomerCreateInput.party_type: PartyType`; in `api.ts`: `export type PartyFilter = "CUSTOMER" | "SUPPLIER"`, `listCustomers(party?: PartyFilter)` and `searchCustomers(query: string, party?: PartyFilter)` sending `{ party: party ?? null }`.

- [ ] **Step 1: Implement** the commands and the TS types/API. The four existing forms call `listCustomers("CUSTOMER")`.
- [ ] **Step 2:** In `CustomerFormModal`, add `party_type` to the form state (initial `customer?.party_type ?? "CUSTOMER"`) and send it in the input (the visible control comes in Task 6).
- [ ] **Step 3: Verify.** `cargo check` clean; `npx tsc --noEmit -p .` exit 0.
- [ ] **Step 4: Commit** `feat: company type through commands, types and API`.

---

### Task 6: Company type screens (Stage 1 gate)

**Files:** Modify `CustomerPicker.tsx`, `CustomerFormModal.tsx`, `CustomerDetailsModal.tsx`, `CustomersPage.tsx`, `InvoiceFormModal.tsx`, `App.tsx`.

**Interfaces:**
- `CustomerPicker` gains optional `ariaLabel?: string` (default "Customer") and `noun?: string` (default "customer"; used in the placeholder and the empty text "No {noun} matches. Try another name, phone or GSTIN, or add a new {noun}.").
- `CustomerFormModal` gains optional `allowedPartyTypes?: PartyType[]` (default all three), `defaultPartyType?: PartyType` (default `"CUSTOMER"`), `noun?: "customer" | "supplier" | "company"` (default `"company"`: title "New company" / "Edit company", button "Add company").

- [ ] **Step 1: Form.** Add a **Type** `Field` (a select over `allowedPartyTypes` with `PARTY_TYPE_LABEL`; hidden when only one type is allowed). The duplicate alert gains, when the existing company's `party_type` differs from the form's: "{name} already exists as a {type}. Open it and set its type to Both instead of adding it again, or choose Save anyway."
- [ ] **Step 2: Invoice form.** Its inline add passes `allowedPartyTypes={["CUSTOMER","BOTH"]}`, `defaultPartyType="CUSTOMER"`, `noun="customer"`.
- [ ] **Step 3: Customers page.** Title "Customers & suppliers", description "Companies you invoice or buy from.", button "New company". A **Type** column with a badge (Customer neutral, Supplier blue, Both green). Filter chips All / Customers / Suppliers / Both (Customers = Customer + Both; Suppliers = Supplier + Both; Both = Both only), applied client-side to the full list; search still shows everyone. "Balance due" shows "—" for Supplier-only rows. Toasts say "Company updated".
- [ ] **Step 4: Details window.** The subtitle shows the type label and GSTIN; for `SUPPLIER` the Balance due, Advance held and Invoices sections are hidden; the delete button reads "Delete company" and its text says companies with invoices, payments or supplier records can't be deleted.
- [ ] **Step 5: Sidebar.** The Customers item reads "Customers & suppliers".
- [ ] **Step 6: Stage 1 gate.** Run the full harness suite, `cargo check` (no warnings), `npx tsc --noEmit -p .`, `npm run build`. All must pass.
- [ ] **Step 7: Commit** `feat: company type screens`.

---

# Stage 2: Supplier bills

### Task 7: Migration 15, all supplier tables

**Files:** Modify `db/migrations.rs`, `backup/repository.rs`. Tests in both.

**Interfaces:** Produces const `SUPPLIER_TABLES_SQL`; `latest_version() == 15`; tables below; `RECORD_TABLES` entries `("supplier_bills","supplier bill","supplier bills")` and `("supplier_payments","supplier payment","supplier payments")` (after `quotations`).
- `supplier_bills(id, supplier_id NOT NULL REFERENCES customers(id), bill_number NOT NULL, bill_date NOT NULL, total_amount REAL NOT NULL CHECK (total_amount > 0), notes, created_at, updated_at)`; indexes on `supplier_id` and `bill_number COLLATE NOCASE`.
- `supplier_bill_files(id, bill_id NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE, file_name, mime_type, size_bytes, data BLOB NOT NULL, created_at)`; index on `bill_id`.
- `supplier_payments(id, payment_number TEXT NOT NULL UNIQUE, supplier_id NOT NULL REFERENCES customers(id), payment_date NOT NULL, payment_method NOT NULL DEFAULT 'Bank Transfer', reference_number, bank_name, amount_paid REAL NOT NULL DEFAULT 0, total_settled REAL NOT NULL DEFAULT 0, credit_applied REAL NOT NULL DEFAULT 0, excess_amount REAL NOT NULL DEFAULT 0, excess_action TEXT NOT NULL DEFAULT 'NONE' CHECK (excess_action IN ('NONE','CREDIT','ROUNDOFF')), writeoff_amount REAL NOT NULL DEFAULT 0, remarks, created_at, updated_at)`; indexes on `supplier_id` and `payment_date`.
- `supplier_payment_allocations(id, payment_id NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE, bill_id NOT NULL REFERENCES supplier_bills(id), amount_allocated REAL NOT NULL, created_at)`; indexes on both ids.
- `supplier_credits(id, supplier_id NOT NULL REFERENCES customers(id), source_payment_id REFERENCES supplier_payments(id) ON DELETE CASCADE, original_amount, remaining_amount, notes, created_at, updated_at)`; index on `supplier_id`.
- `supplier_credit_applications(id, payment_id NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE, credit_id NOT NULL REFERENCES supplier_credits(id) ON DELETE CASCADE, amount REAL NOT NULL, created_at)`.
- Insert/update/delete `change_log` triggers for `supplier_bills`, `supplier_bill_files`, `supplier_payments`, written like migration 13.

- [ ] **Step 1: Write failing tests.** Migrations (a `database_at_version_14` helper holding a customer, an invoice, a payment, a purchase order and a quotation): `migration_15_adds_supplier_tables_and_leaves_existing_data_alone` (version 15; existing rows unchanged; the customer is still `CUSTOMER`); `supplier_tables_log_changes_and_files_follow_their_bill`; `database_protects_supplier_records` (a bill with total 0 is refused; a bill with an allocation cannot be deleted; a company with a bill cannot be deleted; `payment_number` is unique; `excess_action = 'REFUND'` is refused). Backup: `pending_summary_counts_supplier_bills_and_payments` expects `"1 supplier bill added"` and `"1 supplier payment added"`. Relax earlier `latest_version()` equalities to `>=`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the SQL, the migration entry and the two `RECORD_TABLES` entries.
- [ ] **Step 4: Run the full suite** → all pass.
- [ ] **Step 5: Commit** `feat: migration 15 for supplier bills and payments`.

---

### Task 8: Supplier records guard a company's type and deletion

**Files:** Modify `customers/repository.rs`. Test: same file.

**Interfaces:** Consumes the Task 7 tables. Messages (exact): type change to Customer-only: `format!("This company has {} supplier record(s) (bills, payments or advances), so it can't be changed to Customer only.", n)`; delete: `format!("This company has {} supplier bill(s) and {} supplier payment(s), so it can't be deleted.", bills, payments)`. `n` counts supplier bills + supplier payments + supplier credits.

- [ ] **Step 1: Write failing tests:** `a_company_with_supplier_records_cannot_become_customer_only` (raw-insert one row at a time into `supplier_bills`, `supplier_payments`, `supplier_credits`; `SUPPLIER` or `BOTH` to `CUSTOMER` fails with `n = 1`; `BOTH` is allowed); `a_company_with_records_on_both_sides_can_go_neither_way` (a `BOTH` company with one invoice and one supplier bill: to `SUPPLIER` fails with the customer message, to `CUSTOMER` fails with the supplier message; Review Focus 3); `a_company_with_supplier_records_cannot_be_deleted` (bill only, payment only; exact messages).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** a private `supplier_record_count(conn, id)`, the guard in `update` (when the new type is `CUSTOMER` and the current one is `SUPPLIER` or `BOTH`), and the delete guard after the quotation check.
- [ ] **Step 4: Run the full suite** → all pass.
- [ ] **Step 5: Commit** `feat: supplier records protect a company's type and deletion`.

---

### Task 9: Supplier bills repository

**Files:** Create `supplier_bills/{mod,models,repository}.rs`; modify `lib.rs` (`pub mod supplier_bills;`), `util.rs` (`pub const MONEY_EPS: f64 = 0.005;`), `tools/test-harness/src/lib.rs` (inline `supplier_bills` module with models + repository). `mod.rs` for now is `pub mod models; pub mod repository;`.

**Interfaces (produces):** models (`Debug, Clone, Serialize, Deserialize`): `SupplierBill { id, supplier_id, supplier_name, bill_number, bill_date, total_amount, notes: Option<String>, created_at, updated_at }`; `SupplierBillListItem { id, supplier_id, supplier_name, bill_number, bill_date, total_amount, settled_amount, outstanding_amount, status: String, file_count: i64 }`; `SupplierBillFileInfo { id, file_name, mime_type, size_bytes }`; `BillPayment { payment_id, payment_number, payment_date, payment_method, reference_number: Option<String>, amount_settled }`; `SupplierBillDetail { bill, settled_amount, outstanding_amount, status, files, payments }`; `SupplierBillInput { supplier_id, bill_number, bill_date, total_amount, notes }`; `SupplierBillFilter { query, supplier_id, status }` (`Default`); `DuplicateBillCheck { has_duplicate, existing_id: Option<i64> }`; `SupplierBillsSummary { total_outstanding: f64, open_bills_count: i64, advances_held: f64 }`.
`SupplierBillRepository` (unit struct): `create(conn, input) -> Result<SupplierBillDetail, String>`, `update(conn, id: i64, input)`, `delete(conn, id) -> Result<(), String>`, `get(conn, id) -> Result<Option<SupplierBillDetail>, String>`, `list(conn, filter) -> Result<Vec<SupplierBillListItem>, String>` (order `bill_date DESC, id DESC`; `status` filter `ALL|NOT_PAID|PARTIAL|PAID`), `check_duplicate(conn, supplier_id: i64, bill_number: &str, exclude_id: Option<i64>) -> Result<DuplicateBillCheck, String>`, `summary(conn) -> Result<SupplierBillsSummary, String>`, `add_file(conn, bill_id, file_name: &str, bytes: &[u8])`, `remove_file(conn, file_id)`, `read_file(conn, file_id) -> Result<(String, String, Vec<u8>), String>`, and `pub fn status_for(total: f64, settled: f64) -> &'static str`.
`settled` is `COALESCE(SUM(amount_allocated), 0)` over the bill's `supplier_payment_allocations`; status is `NOT_PAID` when settled ≤ `MONEY_EPS`, `PAID` when `total - settled` ≤ `MONEY_EPS`, else `PARTIAL`.
Exact messages: `"Bill number is required."`, `"Bill date is required."` (then `normalize_date(d, "Bill date")`), `"Bill total must be more than zero."`, `"Bill not found."`, `"The supplier can't be changed once payments are recorded against this bill."`, `format!("The total can't be less than {} already settled on this bill.", rupees(settled))`, `format!("This bill has {} payment(s). Remove or edit them first.", n)`; the supplier is checked with `require_party(conn, supplier_id, PartyRole::Supplier)`. Files use `attachments::{validate_file, clean_file_name}` and return `"That file is no longer there."` when missing.

- [ ] **Step 1: Write failing tests** (helpers: `company(conn, name, party)` creating a company of a type; `payment_row(conn, supplier, number)` and `allocate(conn, payment, bill, amount)` inserting raw rows):
  - `create_requires_number_date_total_and_a_supplier`: each message; a customer-only company → `customer only`; `BOTH` accepted; `" B-1 "` stored as `B-1`; `"05-10-2026"` stored `2026-10-05`; total `100.456` stored `100.46`; whitespace-only note stored as none. (Review Focus 1.)
  - `duplicate_bill_numbers_warn_for_the_same_supplier_only`: case- and space-insensitive; excludes itself; another supplier may reuse the number; a duplicate can still be saved.
  - `status_follows_the_allocations`: 0 → `NOT_PAID`; part → `PARTIAL`; full → `PAID`; `settled = total - 0.004` → `PAID`.
  - `the_total_cannot_drop_below_what_is_settled`: exact message; raising it, or lowering it to the settled amount, works. (Review Focus 4.)
  - `the_supplier_is_locked_once_payments_exist`: exact message; changing it with no payments works.
  - `delete_is_blocked_with_payments_and_cascades_files_otherwise`: exact count message; unlinked delete removes files; a stale id gives `"Bill not found."`; `get` of a missing id is `None`.
  - `list_searches_filters_and_reports_amounts`: query matches bill number or supplier name; `supplier_id` and `status` filters; each row's `settled_amount`, `outstanding_amount`, `status`, `file_count`.
  - `detail_lists_the_payments_settling_the_bill`.
  - `files_follow_the_shared_rules`: add, read, remove (second remove → `"That file is no longer there."`), fake PDF refused, `"Bill not found."` for a missing bill.
  - `summary_totals`: only bills with money still due count; `advances_held` is the sum of `supplier_credits.remaining_amount`.
- [ ] **Step 2: Run** `... supplier_bills` → FAIL (does not compile).
- [ ] **Step 3: Implement** models and repository, following `quotations/repository.rs` for structure and `payments/repository.rs::get_invoice_payment_summary` for the settled/outstanding arithmetic. Register the module in `lib.rs` and the harness.
- [ ] **Step 4: Run the full suite** → all pass. `cargo check` clean.
- [ ] **Step 5: Commit** `feat: supplier bill records, files and status`.

---

### Task 10: Supplier bills commands, types and API

**Files:** Create `supplier_bills/commands.rs`; modify `supplier_bills/mod.rs` (`pub mod commands; pub use commands::*;`), `lib.rs` (register), `src/types/supplierBill.ts` (new), `src/services/api.ts`.

**Interfaces:** Produces Tauri commands `list_supplier_bills(filter: Option<SupplierBillFilter>)`, `get_supplier_bill(id)`, `create_supplier_bill(input)`, `update_supplier_bill(id, input)`, `delete_supplier_bill(id)`, `check_duplicate_supplier_bill_number(supplier_id, bill_number, exclude_id: Option<i64>)`, `add_supplier_bill_file(bill_id, file_name, data_base64)`, `remove_supplier_bill_file(file_id)`, `get_supplier_bill_file_preview(file_id)`, `open_supplier_bill_file(file_id)` (uses `prepare_temp_copy(..., "supplier_bill", ...)`), `get_supplier_bills_summary()`. TS interfaces mirroring the Rust models (`BillStatus = "NOT_PAID" | "PARTIAL" | "PAID"`, `BILL_STATUS_LABEL`), and API functions `listSupplierBills(filter = {})`, `getSupplierBill`, `createSupplierBill`, `updateSupplierBill`, `deleteSupplierBill`, `checkDuplicateSupplierBillNumber(supplierId, billNumber, excludeId?)`, `addSupplierBillFile(billId, fileName, dataBase64)`, `removeSupplierBillFile`, `getSupplierBillFilePreview`, `openSupplierBillFile`, `getSupplierBillsSummary`. Tauri arguments are camelCase in JS.

- [ ] **Step 1: Implement** the commands (thin wrappers like `quotations/commands.rs`), register them, write types and API.
- [ ] **Step 2: Verify.** `cargo check` no warnings; `npx tsc --noEmit -p .` exit 0.
- [ ] **Step 3: Commit** `feat: supplier bill commands, types and API`.

---

### Task 11: Supplier bills screens (Stage 2 gate)

**Files:** Create `SupplierBillsPage.tsx`, `SupplierBillFormModal.tsx`, `SupplierBillDetailsModal.tsx`, `SupplierBillStatusBadge.tsx`; modify `CustomerDetailsModal.tsx`, `App.tsx`.

**Interfaces:**
- `SupplierBillsPage()` (no props yet): `PageHeader` "Supplier bills", "Bills you receive from suppliers and what you still owe." with a "New supplier bill" button; a 3-cell `StatStrip` from `getSupplierBillsSummary` ("You owe suppliers" with `tone="attention"`, "Open bills", "Advances paid to suppliers"); search "Search bill number or supplier   ( / )"; tabs All / Not paid / Partially paid / Fully paid with counts and the sliding marker, copied from `PurchaseOrdersPage`, filtered client-side; columns Bill number, Supplier, Date, Total, Balance due, Status, Files.
- `SupplierBillFormModal({ billId?, onClose, onSaved })`: supplier `CustomerPicker` (`ariaLabel="Supplier"`, `noun="supplier"`, fed by `listCustomers("SUPPLIER")`) with a **New** button opening `CustomerFormModal` (`allowedPartyTypes={["SUPPLIER","BOTH"]}`, `defaultPartyType="SUPPLIER"`, `noun="supplier"`); "Bill number" with the duplicate warning "{number} is already used by this supplier." (amber, never blocks); "Bill date" (default today); "Total amount (₹)"; "Internal note"; `FileAttachmentsField` + `useFileAttachments` with `addSupplierBillFile`; the supplier is locked, with the hint "Supplier cannot be changed once payments are recorded against this bill.", when the bill has payments; save errors "Choose a supplier.", "Enter the bill number.", "Choose the bill date.", "Enter the bill total."; the partial-file-failure toast follows `QuotationFormModal`.
- `SupplierBillDetailsModal({ id, onClose, onChanged })`: title "Supplier bill {number}" with the status badge; fields Supplier, Bill number, Date, Total, Settled, Balance due; note; `FileViewer`; a Payments table (number, date, method · reference, amount settled; not clickable yet); Delete (confirm "This supplier bill and its attached files will be deleted. This cannot be undone."), Close, Edit; a missing bill shows `Alert` "This supplier bill no longer exists."
- `SupplierBillStatusBadge({ status })`: Fully paid green with tick, Partially paid blue, Not paid amber.
- `CustomerDetailsModal`: for `SUPPLIER` and `BOTH`, a Supplier section with an "Amount you owe" tile (sum of balance due of that supplier's bills) and a table of their bills (`listSupplierBills({ supplier_id })`).
- `App.tsx`: `Page` gains `"supplierBills"`; nav item "Supplier bills" (`ReceiptText`) after Payments.

- [ ] **Step 1: Write the components and wiring** per the interfaces, using `docs/BRAND.md` tokens and the shared kit as `QuotationFormModal`/`PurchaseOrdersPage` do.
- [ ] **Step 2: Stage 2 gate.** Full harness suite, `cargo check` (no warnings), `npx tsc --noEmit -p .`, `npm run build`: all pass.
- [ ] **Step 3: Commit** `feat: supplier bills screens`.

---

# Stage 3: Supplier payments

### Task 12: Supplier payments, recording a payment (settlement and advances)

**Files:** Create `supplier_payments/{mod,models,repository}.rs` (`mod.rs`: `pub mod models; pub mod repository;`); modify `lib.rs` (`pub mod supplier_payments;`), `tools/test-harness/src/lib.rs`.

**Interfaces (produces):** models: `SupplierPayment { id, payment_number, supplier_id, supplier_name, payment_date, payment_method, reference_number: Option<String>, bank_name: Option<String>, amount_paid, writeoff_amount, total_settled, credit_applied, excess_amount, excess_action: String, advance_used, remarks: Option<String>, created_at, updated_at }`; `SupplierAllocationDetail { bill_id, bill_number, bill_date, bill_total_amount, allocated_amount }`; `SupplierPaymentWithAllocations { payment, allocations }`; `SupplierAllocationInput { bill_id, allocated_amount }`; `SupplierPaymentInput { payment_number: Option<String>, supplier_id, payment_date, payment_method: Option<String>, reference_number, bank_name, amount_paid, #[serde(default)] credit_to_apply: f64, remarks, #[serde(default)] allocations, excess_action: Option<String>, #[serde(default)] writeoff_amount: f64 }`.
`SupplierPaymentRepository`: `next_payment_number(conn) -> Result<String, String>`; `create(conn, input) -> Result<SupplierPaymentWithAllocations, String>`; `get(conn, id) -> Result<Option<SupplierPaymentWithAllocations>, String>`; private `save(conn, id: Option<i64>, input)`, `bill_balance`, `available_credit`, `consume_credits`, `release_credit_applications`, `advance_used`, `sync_own_advance` (Task 13 adds the rest).
**Algorithm:** follow `payments/repository.rs::save` and its helpers step by step, with these differences: no TDS and no verification flag; the party is the supplier (`require_party(..., PartyRole::Supplier)`); `total_settled = amount_paid + writeoff`; no invoice-status check; bills instead of invoices; `excess_action` accepts only `CREDIT`/`ROUNDOFF` (case-insensitive) or none (= `CREDIT`), anything else → `"Choose how to keep the extra: advance or round-off."`; numbers `SP/..` via `doc_number("SP", ..)`/`doc_sequence`. Exact messages: `"Select a supplier."`, `"Amounts cannot be negative."`, `"Enter the amount paid."`, `"The same bill is listed twice."`, `format!("Bill {} belongs to a different supplier.", n)`, `format!("{} is more than the {} still due on bill {}.", rupees(a), rupees(due), n)`, `format!("{} written off is more than the shortfall. Only {} is short.", ...)`, `format!("Allocated {} is more than the {} paid.", ...)` (the advance variant: `"Allocated {}, but only {} paid plus {} advance is available."`), `"Not enough advance is available."`, `format!("Payment number {} is already used.", n)`. There is no limit on `writeoff_amount` or on a round-off extra.

- [ ] **Step 1: Write failing tests** (helpers: `company`, `bill(conn, supplier, number, total)` via `SupplierBillRepository::create`, `pay(supplier, paid, allocs, credit, action)`, `status(conn, bill)`, `advance(conn, supplier)`):
  - `the_owners_three_cases_on_an_11550_bill`: (a) paid 11,500, allocation 11,550, write-off 50 → payment `total_settled 11550`, `writeoff_amount 50`, `excess_action NONE`, bill `PAID`, no advance; (b) paid 11,600, allocation 11,550, `ROUNDOFF` → `excess_amount 50`, `excess_action ROUNDOFF`, `PAID`, no advance; (c) paid 11,600, allocation 11,550, `CREDIT` → `PAID`, advance 50; then a ₹1,000 bill paid 950 with `credit_to_apply 50` → `credit_applied 50`, `PAID`, advance 0.
  - `write_off_and_round_off_have_no_limit`: bill 100,000: paid 40,000 + write-off 60,000 → `PAID`; paid 150,000 `ROUNDOFF` → `PAID`, `excess_amount 50000`. (Review Focus 5.)
  - `a_write_off_cannot_exceed_the_shortfall`: bill 1,000, paid 900, allocation 1,000, write-off 150 → `"₹150.00 written off is more than the shortfall. Only ₹100.00 is short."`; write-off 100 works.
  - `a_shortfall_without_write_off_or_advance_is_refused`: `"Allocated ₹1,000.00 is more than the ₹900.00 paid."`.
  - `allocation_rules`: above the balance (`"₹1,500.00 is more than the ₹1,000.00 still due on bill T/1."`), another supplier's bill, a bill listed twice, a customer-only company (`customer only`), nothing entered (`"Enter the amount paid."`). (Review Focus 1.)
  - `one_payment_can_settle_two_bills`.
  - `a_payment_with_no_bills_becomes_an_advance`: paid 5,000, no allocations → `excess_amount 5000`, `CREDIT`, advance 5,000.
  - `advances_are_used_oldest_first`: two advances (300 then 500); paying a 400 bill with `credit_to_apply 1000` and `amount_paid 0` leaves 0 and 400 and records the applications.
  - `payment_numbers_run_on_and_must_be_unique`: first `SP/{fy}/001` (`financial_year_label()`), then `002`; an explicit duplicate (different case) → `"Payment number ... is already used."`; a `PAY/..` number is not counted.
  - `pennies_never_leave_a_bill_part_paid_or_invent_an_advance`: bill 1,000.10 settled by 333.37, 333.37, 333.36 → `PAID`, advance 0; paid `0.1 + 0.2` against a ₹0.30 bill → `PAID`, no advance row. (Review Focus 2.)
  - `the_extra_defaults_to_advance_and_refund_is_refused`: no action → `CREDIT`; `"REFUND"` → the "Choose how to keep the extra" message.
- [ ] **Step 2: Run** `... supplier_payments` → FAIL (does not compile).
- [ ] **Step 3: Implement** per the algorithm note. Register the module in `lib.rs` and the harness.
- [ ] **Step 4: Run the full suite** → all pass. `cargo check` clean.
- [ ] **Step 5: Commit** `feat: supplier payments, recording and settlement`.

---

### Task 13: Supplier payments, editing, deleting, lists, advances, summary

**Files:** Modify `supplier_payments/models.rs`, `supplier_payments/repository.rs`.

**Interfaces (produces):** models `SupplierPaymentListItem { id, payment_number, supplier_id, supplier_name, payment_date, payment_method, reference_number, amount_paid, writeoff_amount, total_settled, credit_applied, excess_amount, excess_action, bills_covered: Vec<String> }`; `SupplierPaymentFilter { query, supplier_id, date_from, date_to, payment_method }` (`Default`); `UnpaidBill { bill_id, bill_number, bill_date, total_amount, total_settled, outstanding_amount }`; `SupplierCredit { id, supplier_id, source_payment_id, source_payment_number, original_amount, remaining_amount, created_at }`; `SupplierPaymentsSummary { total_paid, paid_this_month, advances_held }`.
Repository: `update(conn, id: i64, input) -> Result<SupplierPaymentWithAllocations, String>`; `delete(conn, id) -> Result<(), String>`; `list(conn, filter) -> Result<Vec<SupplierPaymentListItem>, String>` (order `payment_date DESC, id DESC`; `query` matches number, supplier, reference, remarks and bill numbers); `unpaid_bills_for_supplier(conn, supplier_id: i64, exclude_payment_id: Option<i64>) -> Result<Vec<UnpaidBill>, String>` (oldest first; a bill the excluded payment covers stays listed, its outstanding computed without that payment); `supplier_credits(conn, supplier_id, exclude_payment_id: Option<i64>) -> Result<Vec<SupplierCredit>, String>` (as `get_customer_credits`: leaves out the payment's own advance, counts the part it used); `summary(conn) -> Result<SupplierPaymentsSummary, String>`.
Edit and delete follow `update_payment`, `delete_payment` and `sync_own_advance` in the customer module. Messages: `"Payment not found."`; delete blocked by a used advance: `format!("{} of the advance from this payment has already been used by a later payment. Remove that payment first.", rupees(used))`; shrinking: `format!("{} of this payment's advance has already been used by a later payment, so at least that much must stay as advance.", rupees(used))`. On edit the supplier and number never change (the input's are ignored).

- [ ] **Step 1: Write failing tests:**
  - `editing_recalculates_as_if_never_recorded`: bill 1,000 paid in full → `PAID`; edit to paid 400 with allocation 400 → `PARTIAL`, outstanding 600; the bill is absent from `unpaid_bills_for_supplier(s, None)` before the edit and present (with its own allocation counted as free) when the payment id is excluded.
  - `the_supplier_and_number_are_fixed_when_editing`.
  - `deleting_reopens_bills_and_gives_back_the_advance_used`: payment 1 leaves an advance of 50; payment 2 uses it on a bill; deleting payment 2 restores the advance and reopens the bill; then payment 1 can be deleted.
  - `a_used_advance_blocks_delete_and_cannot_shrink`: payment 1 makes a 500 advance, payment 2 uses 300; deleting payment 1 fails with the exact message (`₹300.00`); editing it to leave only 200 as advance fails; leaving 300 works. (Review Focus 4.)
  - `lists_filter_and_name_the_bills_covered`: filters by query (number, supplier, reference, bill number), `supplier_id`, method, date range; an advance-only payment has no bills covered.
  - `unpaid_bills_are_oldest_first_and_only_the_open_ones`.
  - `credits_and_summary_add_up`: `supplier_credits` excludes the payment's own advance when editing and counts the part it used; `summary` gives `total_paid` (sum of `amount_paid`), `paid_this_month`, `advances_held`.
  - `deleting_or_reading_a_missing_payment_is_a_plain_message`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suite** → all pass. `cargo check` clean.
- [ ] **Step 5: Commit** `feat: supplier payments, edit, delete, lists and advances`.

---

### Task 14: Supplier payments commands, types and API

**Files:** Create `supplier_payments/commands.rs`, `src/types/supplierPayment.ts`; modify `supplier_payments/mod.rs`, `lib.rs`, `api.ts`.

**Interfaces:** Tauri commands `list_supplier_payments(filter: Option<SupplierPaymentFilter>)`, `get_supplier_payment(id)`, `create_supplier_payment(input)`, `update_supplier_payment(id, input)`, `delete_supplier_payment(id)`, `get_next_supplier_payment_number()`, `get_unpaid_bills_for_supplier(supplier_id, exclude_payment_id: Option<i64>)`, `get_supplier_credits(supplier_id, exclude_payment_id: Option<i64>)`, `get_supplier_payments_summary()`. TS: `SupplierExcessAction = "CREDIT" | "ROUNDOFF" | "NONE"`, interfaces mirroring the models, and API functions `listSupplierPayments(filter = {})`, `getSupplierPayment`, `createSupplierPayment`, `updateSupplierPayment`, `deleteSupplierPayment`, `getNextSupplierPaymentNumber`, `getUnpaidBillsForSupplier(supplierId, excludePaymentId?)`, `getSupplierCredits(supplierId, excludePaymentId?)`, `getSupplierPaymentsSummary`. `PAYMENT_METHODS` is reused from `types/payment.ts`.

- [ ] **Step 1: Implement** commands, registration, types, API.
- [ ] **Step 2: Verify.** `cargo check` no warnings; `npx tsc --noEmit -p .` exit 0.
- [ ] **Step 3: Commit** `feat: supplier payment commands, types and API`.

---

### Task 15: Supplier payments page and details window

**Files:** Create `SupplierPaymentsPage.tsx`, `SupplierPaymentDetailsModal.tsx`; modify `SupplierBillsPage.tsx`, `SupplierBillDetailsModal.tsx`, `App.tsx`.

**Interfaces:**
- `SupplierPaymentsPage({ openPaymentId?: number | null, onOpenHandled?: () => void })`: `PageHeader` "Supplier payments", "Money you pay to suppliers." (the "Record payment" button is added in Task 16, once the form exists); a `StatStrip cols={3}` from `getSupplierPaymentsSummary` (Paid this month, Paid in total, Advances held with suppliers); search "Search supplier, number, reference"; a method filter; columns Payment, Date, Supplier, Method, Bills (or "Advance"), Amount paid with sub-lines "Written off ₹X" and "Round-off ₹X". Opens `openPaymentId` once, like `InvoicesPage`.
- `SupplierPaymentDetailsModal({ paymentId, onClose, onChanged })`: items Amount paid, Method · reference, Bank, Advance used, the extra ("Round-off kept" / "Kept as advance" with "(₹X since used)"), "Written off (accepted as full payment)"; an "Applied to" table; remarks; Delete (confirm "The bills it was applied to will show as unpaid again, and any advance it used is given back to the supplier."). The Edit button is added in Task 16.
- `App.tsx`: `Page` gains `"supplierPayments"`; nav item "Supplier payments" (`HandCoins`) after Supplier bills; `openSupplierPaymentId` handoff as for invoices.
- `SupplierBillDetailsModal` gains `onOpenPayment: (paymentId: number) => void`; its Payments rows become clickable. `SupplierBillsPage` gains the prop `onOpenPayment: (paymentId: number) => void`, closes the details window and calls it; `App` supplies a handler that sets `openSupplierPaymentId` and switches to the Supplier payments page.

- [ ] **Step 1: Write the components and wiring.** Leave the page's "Record payment" button and the details window's Edit button out of this task; Task 16 adds both once the form exists.
- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .` exit 0; `npm run build`.
- [ ] **Step 3: Commit** `feat: supplier payments page and details window`.

---

### Task 16: Supplier payment form, Record payment from a bill, advance on company details (Stage 3 gate)

**Files:** Create `SupplierPaymentFormModal.tsx`; modify `SupplierPaymentsPage.tsx`, `SupplierPaymentDetailsModal.tsx`, `SupplierBillDetailsModal.tsx`, `CustomerDetailsModal.tsx`.

**Interfaces:** `SupplierPaymentFormModal({ payment?: SupplierPaymentWithAllocations | null, initialSupplierId?: number, initialBillId?: number, onClose, onSaved })`. Model it on `PaymentFormModal.tsx` with these differences:
- Supplier picker from `listCustomers("SUPPLIER")` (`ariaLabel="Supplier"`, `noun="supplier"`); supplier and number disabled on edit; number from `getNextSupplierPaymentNumber()`.
- Fields: "Amount paid (₹)", "Date paid", "Method" (`PAYMENT_METHODS`), "Cheque number" or "Reference / UTR", "Bank (optional)", "Remarks". **No TDS block, no "money is in the bank" checkbox.**
- "Apply to bills" table (Bill, Date, Balance, Apply (₹)) from `getUnpaidBillsForSupplier(supplierId, existing?.id)`, with "Fill oldest first"; `initialBillId` pre-ticks that bill with its full balance and fills the amount.
- Advance: checkbox "Use advance paid earlier (₹X available)" from `getSupplierCredits(supplierId, existing?.id)`; sends `credit_to_apply`.
- Summary rows: Paid, Advance used, Written off, Applied to bills. **Short:** checkbox "Accept as full payment: write off ₹X" with the text "You paid less than the bills total and the supplier accepts it as full payment. The bills show as fully paid." **Left over:** radios "Keep as round-off" (text "Counted as paid, not held as an advance and not owed back.") and "Keep as advance with this supplier" (default). A line "Bill {n} will still show ₹X due." with a **Settle in full** button for any remaining balance.
- Save errors: "Choose the supplier you paid.", "Enter the payment date.", "Amounts cannot be negative.", "Enter the amount paid.", "The amount for bill {n} is more than its balance.", and for a shortfall not accepted: `You've applied ₹X more than was paid. Tick "Accept as full payment" to write it off, or lower the amounts.`
- **No thresholds of any kind:** none of the customer form's `SETTLE_SUGGEST_LIMIT`, `ADJUSTMENT_WARN`, `ADJUSTMENT_SUGGEST`, and no "large amount" text.
- `SupplierPaymentsPage` gets the "Record payment" button; the details window gets Edit; `SupplierBillDetailsModal` gets a **Record payment** button (hidden when the bill is Fully paid) opening the form with `initialSupplierId` and `initialBillId`, refreshing the bill on save. `CustomerDetailsModal`'s Supplier section adds an "Advance paid" tile from `getSupplierCredits`.

- [ ] **Step 1: Write the form and the wiring** per the interfaces.
- [ ] **Step 2: Check there are no limits in the UI.** Run: `grep -rn "ADJUSTMENT_WARN\|SETTLE_SUGGEST_LIMIT\|ADJUSTMENT_SUGGEST\|large amount" src/components/supplierPayments src/pages/SupplierPaymentsPage.tsx`. Expected: no output. (Review Focus 5.)
- [ ] **Step 3: Stage 3 gate.** Full harness suite, `cargo check` (no warnings), `npx tsc --noEmit -p .`, `npm run build`: all pass.
- [ ] **Step 4: Commit** `feat: supplier payment form and links from bills`.

---

### Task 17: Documentation and final verification

**Files:** Modify `docs/PROJECT_STRUCTURE.md`, `AGENTS.md`.

- [ ] **Step 1: Update `docs/PROJECT_STRUCTURE.md`:** the screens table (Supplier bills, Supplier payments, Customers & suppliers); the business rules (company type and its guards; supplier bills; supplier payments with write-off, round-off and advances, "no limit, a write-off cannot exceed the shortfall"); the code layout (`supplier_bills/`, `supplier_payments/`, new component folders); migrations 001–015; temp names `supplier_bill_<id>_<name>`; the Tests section and the Drive-backup test note, which now point at `tools/test-harness` (run with `tools\test-harness\test.bat`). Add the same command to `AGENTS.md` under Commands.
- [ ] **Step 2: Full verification.** Harness suite (report the count; 0 failed), `cargo check --manifest-path src-tauri/Cargo.toml` (no warnings), `npx tsc --noEmit -p .`, `npm run build`.
- [ ] **Step 3: Self-review the whole branch** (`git diff 9491c81..HEAD`) against the spec: every rule 1–23 has a test or a stated reason; no leftover references to a scratch harness path in the docs; the customer `payments/repository.rs` diff contains only the `require_party` call and `party_type: None,` literals; user-visible wording matches the spec.
- [ ] **Step 4: Commit** `docs: supplier bills and supplier payments in the project guide`. Do not push.
