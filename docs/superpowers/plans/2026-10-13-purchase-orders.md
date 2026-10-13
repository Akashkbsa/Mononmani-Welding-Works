# Purchase Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store customers' purchase orders (photo, PDF or Word), track their status, and link them to invoices from both sides, without changing the printed invoice.

**Architecture:** A new Rust module `purchase_orders/` (models, repository with the rules, commands, file handling) mirroring `payments/`. Migration 12 adds two tables and one nullable column on `invoices`. The React side gets a Purchase Orders page, a form and a details window, and small additions to the invoice form and details.

**Tech Stack:** Rust, Tauri 2, rusqlite (bundled SQLite), React 19, TypeScript, Tailwind v4, `base64` crate (already a dependency).

**Spec:** `docs/superpowers/specs/2026-10-13-purchase-orders-design.md`

## Global Constraints

- **The printed invoice must not change.** Do not edit `src/template/*` or `src-tauri/src/pdf/renderer.rs`. The renderer builds its data from `inv.po_number_and_date` and other named fields; adding fields to the `Invoice` struct must not alter it. Task 7 proves this.
- Dates stored `YYYY-MM-DD`, shown `DD-MM-YYYY` (`util::display_date`, `formatDate`).
- Business rules are enforced in Rust repositories, not only the UI.
- Never edit an applied migration; this one is `012_purchase_orders`, version 12.
- File limit: 10 MB = `10 * 1024 * 1024` bytes per file. Allowed: JPG/JPEG, PNG, PDF, DOC, DOCX.
- Status values: `NOT_STARTED` (default), `PARTIAL`, `COMPLETED`. Only the owner sets them.
- Never read the real database (`%APPDATA%\com.manonmani.app\Database\manonmani.db`). Tests use temp databases and sample data. Business name is "Mononmani Welding Works".
- No new Tauri plugin or crate. UI follows `docs/BRAND.md` and `components/ui.tsx`.
- `cargo test` cannot start on this machine. Run Rust tests with the standalone-crate method in `docs/PROJECT_STRUCTURE.md` (Task 1 builds that harness). Also run `cargo check --manifest-path src-tauri/Cargo.toml` (WinLibs `bin` first on PATH, see `app.bat`).
- Work on a branch `feature/purchase-orders` created from the commit that holds the settled optimization work (see Task 0 note). Commit after each task.

## Review Focus

1. A purchase order with **no date** linked to an invoice: the invoice text becomes just the PO number, with no trailing ` & `.
2. An invoice already linked is **edited without changing its customer** (must still save) versus edited **with a different customer** (must be rejected); clearing the picker unlinks and leaves the text.
3. Cancelled and draft invoices: they appear in the "attach invoices" list and in a purchase order's linked list, marked by their status; they can be linked.
4. Files: exactly 10 MB accepted, 10 MB + 1 byte rejected; zero bytes rejected; a `.pdf` whose bytes are not a PDF rejected; file names with path separators, quotes or very long names are cleaned before use on disk.
5. Opening a file that no longer exists, a purchase order id that does not exist, or when no Word is installed gives a plain message and never crashes or opens a path outside the `Temp` folder.

---

### Task 0: Branch and baseline

- [ ] **Step 1:** `git status` shows the optimization changes (Cargo.toml/Cargo.lock/package*.json/format.ts) uncommitted on `minimodel/optimize-size`. Ask the owner whether to commit them first. After that is settled, `git switch -c feature/purchase-orders`.
- [ ] **Step 2:** Run `npx tsc --noEmit -p .` and `cargo check --manifest-path src-tauri/Cargo.toml`. Expected: both pass. This is the baseline.

### Task 1: Migration 12 and the test harness

**Files:**
- Modify: `src-tauri/src/db/migrations.rs` (add `Migration { version: 12, name: "012_purchase_orders", sql: PURCHASE_ORDERS_SQL }` after version 11; add `pub const PURCHASE_ORDERS_SQL`)
- Create: `src-tauri/src/purchase_orders/mod.rs` (declares `commands`, `models`, `repository`, `files`; re-exports `commands::*`) with empty modules for now
- Modify: `src-tauri/src/lib.rs` (`pub mod purchase_orders;`)
- Modify: `src-tauri/src/backup/repository.rs` (add `("purchase_orders", "purchase order", "purchase orders")` to the table list at the top, matching the existing tuple shape)
- Test: in `src-tauri/src/db/migrations.rs` test module (or the standalone crate)

**Interfaces:**
- Produces: tables `purchase_orders(id, customer_id, po_number, po_date, status, notes, created_at, updated_at)`, `purchase_order_files(id, purchase_order_id, file_name, mime_type, size_bytes, data, created_at)`, column `invoices.purchase_order_id`; triggers `trg_purchase_orders_{insert,update,delete}_log` and `trg_purchase_order_files_{insert,update,delete}_log` writing to `change_log` in the migration 8 style.

- [ ] **Step 1: Write the failing test** `migration_12_adds_tables_and_keeps_invoices`: build a temp database through `DatabaseManager::new` after inserting a customer and an invoice with raw SQL at version 11 state (or insert after migrating and assert nothing changes), then assert: tables exist; `invoices.purchase_order_id` is NULL for the existing invoice; inserting a purchase order writes a `change_log` row with `table_name = 'purchase_orders'`; deleting a purchase order cascades its files; `PRAGMA foreign_key_check` returns no rows; `latest_version() == 12`.
- [ ] **Step 2:** Run it through the standalone harness. Expected: FAIL (tables missing).
- [ ] **Step 3: Implement the migration SQL.** `status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','PARTIAL','COMPLETED'))`; `po_date TEXT NULL`; indexes on `purchase_orders(customer_id)`, `purchase_order_files(purchase_order_id)`, `invoices(purchase_order_id)`; `ALTER TABLE invoices ADD COLUMN purchase_order_id INTEGER NULL REFERENCES purchase_orders(id)`.
- [ ] **Step 4:** Create the standalone harness crate in the scratchpad (not the repo) that compiles `db`, `util`, and the `models.rs`/`repository.rs` of customers, invoices, payments, backup and purchase_orders through `#[path]` modules, per `docs/PROJECT_STRUCTURE.md`. Run the test. Expected: PASS.
- [ ] **Step 5:** `cargo check`; commit `feat: migration 12 for purchase orders`.

### Task 2: Purchase order records, files and link rules

**Files:**
- Create: `src-tauri/src/purchase_orders/models.rs`, `repository.rs`, `files.rs`
- Test: `#[cfg(test)]` module in `repository.rs`

**Interfaces:**
- Consumes: Task 1 schema; `util::{normalize_date, display_date}`.
- Produces (all in `models.rs`, `Serialize`/`Deserialize`):
  - `PurchaseOrder { id, customer_id, customer_name, po_number, po_date: Option<String>, status, notes: Option<String>, created_at, updated_at }`
  - `PurchaseOrderListItem { id, customer_id, customer_name, po_number, po_date, status, file_count: i64, invoice_count: i64 }`
  - `PurchaseOrderFileInfo { id, file_name, mime_type, size_bytes }`
  - `LinkedInvoice { id, invoice_number, invoice_date, total_amount, status, payment_status }`
  - `PurchaseOrderDetail { order: PurchaseOrder, files: Vec<PurchaseOrderFileInfo>, invoices: Vec<LinkedInvoice> }`
  - `PurchaseOrderInput { customer_id: i64, po_number: String, po_date: Option<String>, status: String, notes: Option<String>, invoice_ids: Vec<i64> }`
  - `PurchaseOrderFilter { query: Option<String>, status: Option<String>, customer_id: Option<i64> }`
  - `DuplicatePoCheck { has_duplicate: bool, existing_id: Option<i64> }`
- Produces (`repository.rs`, `impl PurchaseOrderRepository`, all take `conn: &Connection`):
  - `list(conn, PurchaseOrderFilter) -> Result<Vec<PurchaseOrderListItem>, String>`
  - `get(conn, id: i64) -> Result<Option<PurchaseOrderDetail>, String>`
  - `create(conn, PurchaseOrderInput) -> Result<PurchaseOrderDetail, String>` and `update(conn, id, PurchaseOrderInput)` (customer cannot change once invoices are linked)
  - `delete(conn, id: i64) -> Result<(), String>`
  - `check_duplicate(conn, customer_id: i64, po_number: &str, exclude_id: Option<i64>) -> Result<DuplicatePoCheck, String>`
  - `unlinked_invoices_for_customer(conn, customer_id: i64) -> Result<Vec<LinkedInvoice>, String>` (all statuses)
  - `set_invoice_link(conn, invoice_id: i64, purchase_order_id: Option<i64>) -> Result<(), String>`
  - `po_reference_text(po_number: &str, po_date: Option<&str>) -> String` returns `"<number> & dd-mm-yyyy"` or just `"<number>"`
- Produces (`files.rs`): `MAX_FILE_BYTES: usize`, `validate_file(file_name: &str, bytes: &[u8]) -> Result<&'static str, String>` (returns the mime type), `clean_file_name(raw: &str) -> String`, and repository methods `add_file(conn, po_id, file_name, bytes) -> Result<PurchaseOrderFileInfo, String>`, `remove_file(conn, file_id)`, `read_file(conn, file_id) -> Result<(String, String, Vec<u8>), String>` (name, mime, bytes).

- [ ] **Step 1: Write failing tests** (names and assertions):
  - `create_requires_customer_and_po_number`: empty number errors "PO number is required."
  - `duplicate_check_is_per_customer_and_case_insensitive`: same number, other customer → no duplicate; `"po-1"` vs `"PO-1"` → duplicate; it is only reported, `create` still succeeds.
  - `link_rejects_other_customers_invoice`: error text contains "different customer".
  - `link_fills_invoice_reference_text`: after `set_invoice_link`, `invoices.po_number_and_date == "PO-1045 & 05-10-2026"`; with no PO date it equals `"PO-1045"`.
  - `unlink_keeps_reference_text`: `purchase_order_id` becomes NULL, the text is unchanged.
  - `one_invoice_one_order`: linking an already-linked invoice to a second order moves the link (single column), and the first order's `invoice_count` drops.
  - `delete_blocked_while_invoices_linked` (message contains "linked invoice") and `delete_removes_files_when_unlinked`.
  - `unlinked_list_includes_cancelled_and_draft_invoices`.
  - `validate_file` cases: 10 MB accepted, 10 MB + 1 rejected, empty rejected, `.pdf` with non-`%PDF` bytes rejected, `.docx` needs ZIP header, `.doc` needs OLE header, `.exe` rejected, JPEG/PNG accepted.
  - `clean_file_name` strips `..`, `\`, `/`, quotes and caps the length at 120 characters while keeping the extension.
- [ ] **Step 2:** Run them in the harness. Expected: FAIL (nothing implemented).
- [ ] **Step 3:** Implement models, repository and files to make them pass. List queries must never select the `data` column. `update` and `create` run in one transaction and apply `invoice_ids` through `set_invoice_link`.
- [ ] **Step 4:** Run the harness. Expected: all PASS.
- [ ] **Step 5:** `cargo check`; commit `feat: purchase order records, files and link rules`.

### Task 3: Invoice side and customer guard

**Files:**
- Modify: `src-tauri/src/invoices/models.rs`, `src-tauri/src/invoices/repository.rs`, `src-tauri/src/customers/repository.rs`
- Test: `#[cfg(test)]` modules in those repositories

**Interfaces:**
- Consumes: `PurchaseOrderRepository::{set_invoice_link, po_reference_text}`.
- Produces: `InvoiceCreateInput.purchase_order_id: Option<i64>` (serde default, so older callers still work); `Invoice.purchase_order_id: Option<i64>` and `Invoice.purchase_order_number: Option<String>`; `InvoiceListItem.purchase_order_id` and `purchase_order_number`.

- [ ] **Step 1: Write failing tests:**
  - `edit_linked_invoice_with_same_customer_still_saves` and `edit_linked_invoice_with_new_customer_is_rejected` (message contains "linked to a purchase order").
  - `clearing_the_purchase_order_unlinks_and_keeps_text`.
  - `saving_with_other_customers_order_is_rejected`.
  - `unlinked_invoice_output_is_unchanged`: for an invoice saved with no order, every existing field, including `po_number_and_date`, equals what it was before this change.
  - `customer_with_purchase_orders_cannot_be_deleted` (customers repository; message mentions purchase orders).
- [ ] **Step 2:** Run in the harness. Expected: FAIL.
- [ ] **Step 3:** In `Self::save` (`invoices/repository.rs`), after the existing checks and inside the transaction: reject a changed `customer_id` when the stored `purchase_order_id` is not null; when `input.purchase_order_id` is set, call `set_invoice_link` (which validates the customer and fills the text, overriding the typed `po_number_and_date`); when it is None and the invoice had a link, unlink. Extend the positional `params![...]` lists, `find_by_id` and `find_all` selects with a LEFT JOIN on `purchase_orders` for the number. Add the order count to the guard in `customers/repository.rs::delete`.
- [ ] **Step 4:** Run the harness. Expected: all PASS, including every earlier invoice and payment test.
- [ ] **Step 5:** `cargo check`; commit `feat: invoices can link to a purchase order`.

### Task 4: Commands, file opening and frontend service layer

**Files:**
- Create: `src-tauri/src/purchase_orders/commands.rs`, `src/types/purchaseOrder.ts`
- Modify: `src-tauri/src/lib.rs` (register commands), `src-tauri/src/storage/paths.rs` (`get_temp_dir()` and creating/clearing `Temp` at start), `src/services/api.ts`, `src/types/invoice.ts` (add `purchase_order_id`, `purchase_order_number`)

**Interfaces:**
- Consumes: Task 2 repository.
- Produces Tauri commands: `list_purchase_orders(filter: Option<PurchaseOrderFilter>)`, `get_purchase_order(id)`, `create_purchase_order(input)`, `update_purchase_order(id, input)`, `delete_purchase_order(id)`, `check_duplicate_po_number(customer_id, po_number, exclude_id)`, `add_purchase_order_file(purchase_order_id, file_name, data_base64)`, `remove_purchase_order_file(file_id)`, `get_purchase_order_file_preview(file_id) -> String` (a `data:` URL, images only), `open_purchase_order_file(file_id)`, `list_unlinked_invoices_for_customer(customer_id)`, `set_invoice_purchase_order(invoice_id, purchase_order_id: Option<i64>)`.
- Produces `api.ts` functions with the same names in camelCase, and matching TypeScript types.

- [ ] **Step 1: Write failing tests** in `files.rs`/`commands.rs` for the pure helpers: `temp_open_path(temp_dir, file_id, clean_name)` stays inside `Temp`; base64 decoding rejects invalid text with a plain message and rejects a decoded size over the limit before any database write.
- [ ] **Step 2:** Run in the harness. Expected: FAIL.
- [ ] **Step 3:** Implement the commands as thin wrappers (same pattern as `payments/commands.rs`). `open_purchase_order_file` reads the blob, writes it to `Temp\<file_id>_<clean name>`, checks the path starts with the canonical `Temp` directory, then calls `tauri_plugin_opener::open_path`. Clear `Temp` once at start in `lib.rs` setup. Register everything in `generate_handler!`.
- [ ] **Step 4:** Run the harness; run `cargo check` and `npx tsc --noEmit -p .`. Expected: pass.
- [ ] **Step 5:** Commit `feat: purchase order commands and api`.

### Task 5: Purchase Orders page, form and details

**Files:**
- Create: `src/pages/PurchaseOrdersPage.tsx`, `src/components/purchaseOrders/PurchaseOrderFormModal.tsx`, `src/components/purchaseOrders/PurchaseOrderDetailsModal.tsx`
- Modify: `src/App.tsx` (`Page` type gains `"purchaseOrders"`; `NAV` entry after Invoices with a `lucide-react` `ClipboardList` icon; render the page)

**Interfaces:**
- Consumes: Task 4 `api.ts`; `CustomerPicker`, `SearchSelect`, `Modal`, `useDiscardGuard`, `StatusBadge`/`Badge`, `ListSkeleton`, `EmptyState`, `useToast` from `components/ui.tsx`; page structure as in `pages/InvoicesPage.tsx` (tabs, search).
- Produces: default-exported `PurchaseOrdersPage`, `PurchaseOrderFormModal` (props `{ purchaseOrderId?: number; presetInvoiceId?: number; onClose; onSaved }`), `PurchaseOrderDetailsModal` (props `{ id: number; onClose; onChanged; onOpenInvoice(id: number) }`).

- [ ] **Step 1:** Implement the page: search box, tabs All / Not started / Partially completed / Completed with counts, rows with PO number, customer, `formatDate(po_date)`, status badge, file count, invoice count; New button; empty state text.
- [ ] **Step 2:** Implement the form per the spec: customer picker (disabled after invoices are linked), PO number with the duplicate warning (calls `checkDuplicatePoNumber` on blur, never blocks), date, status select, note, file area (browser file input, read with `FileReader`, base64, size/type pre-check with the same 10 MB rule, per-file result list), and "Attach invoices" checkboxes from `listUnlinkedInvoicesForCustomer`.
- [ ] **Step 3:** Implement the details window: fields, image thumbnails (click to enlarge) via `getPurchaseOrderFilePreview`, PDF/Word rows calling `openPurchaseOrderFile`, linked invoices (click calls `onOpenInvoice`), Edit, Delete with `ConfirmDialog` and the Rust error shown when linked invoices exist.
- [ ] **Step 4:** Run `npx tsc --noEmit -p .` and `npm run build`. Expected: both pass with no new warnings. Check the new files for apostrophes in single-quoted strings and default exports.
- [ ] **Step 5:** Commit `feat: purchase orders screens`.

### Task 6: Invoice form and details integration

**Files:**
- Modify: `src/components/invoices/InvoiceFormModal.tsx`, `src/components/invoices/InvoiceDetailsModal.tsx`, `src/pages/InvoicesPage.tsx` (pass the open-purchase-order callback), `src/App.tsx` if page switching is needed

**Interfaces:**
- Consumes: `listPurchaseOrders({ customer_id })`, `getPurchaseOrder`, `Invoice.purchase_order_id/number`.
- Produces: the form sends `purchase_order_id` in `InvoiceCreateInput`.

- [ ] **Step 1:** In the form, below the customer section, add a "Purchase order" `SearchSelect` showing only the chosen customer's orders (label `PO number — dd-mm-yyyy`), with a clear button and a "View files" link that opens the details window. When the customer changes on an unlinked draft form, clear the picker. When the invoice is already linked, the customer field is read-only with a short hint. Choosing an order shows the reference text it will fill (read-only preview); the existing `RefDateField` for PO stays editable only when no order is chosen.
- [ ] **Step 2:** In the details window, show the linked order (number, status badge) with a button that opens it.
- [ ] **Step 3:** Run `npx tsc --noEmit -p .` and `npm run build`. Expected: both pass.
- [ ] **Step 4:** Commit `feat: pick a purchase order in the invoice form`.

### Task 7: Proof the invoice PDF is unchanged, docs and final checks

**Files:**
- Modify: `docs/PROJECT_STRUCTURE.md` (screens table, business rules, code layout, data on disk: the `Temp` folder; schema list 001–012)
- Test: a renderer-input test in `src-tauri/src/pdf/renderer.rs` tests is **not** added (the file must not change); the proof is by diff and by a harness test of the data builder if it is public, otherwise by the checks below.

- [ ] **Step 1:** Run `git diff --stat main -- src/template src-tauri/src/pdf`. Expected: empty (no output).
- [ ] **Step 2:** Using a copy of a sample database (never the real one), generate a PDF for one unlinked invoice on `main` and on the feature branch and compare the HTML data passed to the renderer, or the rendered text; they must be identical. If PDF generation cannot run here, say so in the report instead of claiming it passed.
- [ ] **Step 3:** Full checks: `cargo check`, harness tests, `npx tsc --noEmit -p .`, `npm run build`. Update `PROJECT_STRUCTURE.md`.
- [ ] **Step 4:** Report what was and was not verified, including that the screens were not clicked through. Commit `docs: purchase orders`.

---

## Execution notes (minimodel)

Tasks 0–3 and 7 are done by the lead because they touch money-adjacent invoice rules and the migration. Task 2's diff gets a read-only review by `gpt` (GPT-5.4). Tasks 4–6 can go to a worker on a build route, one at a time, because they share `api.ts`, `lib.rs` and `App.tsx`; the lead reviews each diff, runs the checks, and rewrites anything that is wrong. Workers get only code and sample data.
