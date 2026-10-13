# Quotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the owner chose native, in-session execution, no per-task approval). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Quotations (number, date, company, note, files) that link to the purchase orders raised from them, from either side, reusing one shared file module.

**Architecture:** A new `quotations/` Rust module mirrors `purchase_orders/` (models, repository with the business rules, commands). `purchase_orders/files.rs` moves to a shared `attachments.rs`. The link is `purchase_orders.quotation_id` (one quotation, many orders). The UI shares one file-upload hook/field and one file viewer between purchase orders and quotations.

**Tech Stack:** Rust (Tauri 2, rusqlite), React 19 + TypeScript + Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-13-quotations-design.md` (read it first; it also leans on `2026-10-13-purchase-orders-design.md`).

## Global Constraints

- Dates stored `YYYY-MM-DD`, shown `DD-MM-YYYY`. Quotation date is required; the form defaults it to today.
- Schema change = new migration 13 `013_quotations` in `db/migrations.rs`; never edit an applied one.
- Files: stored in the database, at most 10 MB (10 × 1024 × 1024 bytes) each; JPG/JPEG, PNG, PDF, DOC, DOCX; type checked from leading bytes.
- Business rules live in the Rust repositories, not only the UI.
- Duplicate quotation number is a **warning only**, checked across **all customers**, case-insensitive.
- The invoice PDF template and `pdf/renderer.rs` must not change. Linking a quotation changes nothing printed.
- Business name is **Mononmani Welding Works**; keep Tauri identifier `com.manonmani.app`.
- Never read the real database (`%APPDATA%\com.manonmani.app\Database\manonmani.db`); tests use temp databases.
- Rust tests run through the harness crate (plain `cargo test` cannot start on this machine). Set once per shell (PowerShell):
  `$env:PATH = "C:\Users\Asus\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;" + $env:PATH`
  `$H = "C:\Users\Asus\AppData\Local\Temp\claude\C--Users-Asus-Downloads-Monomani-welding-works\a6815f9b-c0b1-4f45-90ef-b3fca42312ea\scratchpad\harness\Cargo.toml"`
  then `cargo test --manifest-path $H [filter]`. Baseline before any change: **87 passed**.
- UI checks: `npx tsc --noEmit -p .` and `npm run build`. Crate check: `cargo check --manifest-path src-tauri/Cargo.toml`.
- Commit locally after each task (message ends with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` line). **Do not push** (owner has not asked).

## Review Focus

Input classes the spec implies; each has a test in the owning task.

1. Numbers differing only by case or surrounding spaces (`" q-14 "` vs `Q-14`) must warn as duplicates, including across customers. (Task 3)
2. Creating a quotation with an attach list containing a bad order (other customer, or already on another quotation) must fail **without leaving a half-saved quotation**. (Task 3)
3. Pointing an order at a different quotation (A → B) or removing it must leave both quotations' counts right and never be blocked by the delete guard. (Task 4)
4. A quotation file and a purchase order file with the same id and same name must not share a temp copy. (Task 1)
5. A record deleted while a window for it is open (or a stale id) must give "no longer exists"/"not found" messages, not a crash or blank window. (Tasks 3, 7)

## File Structure

Create:
- `src-tauri/src/attachments.rs` — shared file rules (moved from `purchase_orders/files.rs`) plus `prepare_temp_copy`.
- `src-tauri/src/quotations/{mod,models,repository,commands}.rs`
- `src/types/attachment.ts`, `src/types/quotation.ts`
- `src/components/attachments/{FileViewer.tsx,useFileAttachments.ts,FileAttachmentsField.tsx}`
- `src/components/quotations/{QuotationFormModal.tsx,QuotationDetailsModal.tsx}`
- `src/pages/QuotationsPage.tsx`

Modify: `src-tauri/src/lib.rs`, `db/migrations.rs`, `backup/repository.rs`, `customers/repository.rs`, `purchase_orders/{mod,models,repository,commands}.rs` (delete `files.rs`), `invoices/repository.rs` (tests only), `src/types/purchaseOrder.ts`, `src/services/api.ts`, `src/lib/format.ts`, `src/App.tsx`, `src/pages/{PurchaseOrdersPage,InvoicesPage}.tsx`, `src/components/purchaseOrders/*`, `src/components/invoices/InvoiceDetailsModal.tsx`, `docs/PROJECT_STRUCTURE.md`; and the harness `src/lib.rs` (outside the repo, scratchpad).

---

### Task 1: Shared `attachments` module

**Files:**
- Create: `src-tauri/src/attachments.rs` (content of `purchase_orders/files.rs`, moved with `git mv`)
- Modify: `src-tauri/src/lib.rs` (add `mod attachments;` — `pub mod` if `purchase_orders` needs it public; match the others), `purchase_orders/mod.rs` (drop `pub mod files;`), `purchase_orders/repository.rs` (`use crate::attachments::{clean_file_name, validate_file};`), `purchase_orders/commands.rs`, harness `src/lib.rs`
- Test: inside `attachments.rs`

**Interfaces:**
- Produces (all `pub`, in `crate::attachments`): `MAX_FILE_BYTES: usize`, `validate_file(file_name: &str, bytes: &[u8]) -> Result<&'static str, String>`, `clean_file_name(raw: &str) -> String`, `decode_upload(data_base64: &str) -> Result<Vec<u8>, String>`, `image_data_url(mime: &str, bytes: &[u8]) -> Result<String, String>`, `temp_copy_is_current(path: &Path, expected_len: usize) -> bool` (all unchanged), plus changed/new:
  - `temp_open_path(temp_dir: &Path, kind: &str, file_id: i64, clean_name: &str) -> PathBuf` → `<temp_dir>/<kind>_<file_id>_<clean_name>`; `kind` is `"po"` or `"quotation"`.
  - `prepare_temp_copy(temp_dir: &Path, kind: &str, file_id: i64, name: &str, bytes: &[u8]) -> Result<PathBuf, String>` — creates the folder, writes the copy unless `temp_copy_is_current`, canonicalizes, and returns the canonical path only if it is inside the canonical `temp_dir`; otherwise `Err("Only attached files can be opened.")`. Uses `std` only (no tauri), so the harness can compile it.

- [ ] **Step 1: Baseline.** Run the full harness suite. Expected: 87 passed.
- [ ] **Step 2: Write failing tests** in `attachments.rs`: update `temp_open_path_is_a_single_file_directly_inside_the_temp_folder` to call `temp_open_path(temp, "po", 7, "order.pdf")` and expect file name `po_7_order.pdf`; add `temp_names_of_the_two_kinds_never_collide` (`temp_open_path(t, "po", 7, "a.pdf") != temp_open_path(t, "quotation", 7, "a.pdf")`) — Review Focus 4; add `prepare_temp_copy_writes_once_then_reuses_and_stays_inside` (use `tempfile::tempdir()`: first call returns a file whose bytes equal the input and whose parent is the canonical temp dir; second call with the same bytes returns the same path and does not rewrite — set the file read-only or compare modified time; a name like `..\..\x.pdf` ends up as a plain file directly inside temp).
- [ ] **Step 3: Run** `cargo test --manifest-path $H attachments` → FAIL (does not compile).
- [ ] **Step 4: Move and implement.** `git mv src-tauri/src/purchase_orders/files.rs src-tauri/src/attachments.rs`; change module doc to "files attached to a record"; implement the two changed/new functions. In `purchase_orders/commands.rs` replace the body of `open_purchase_order_file` with `prepare_temp_copy(&state.storage.get_temp_dir(), "po", file_id, &name, &bytes)?` followed by `tauri_plugin_opener::open_path` (keep its error text). Fix imports. In the harness `src/lib.rs` add `#[path = "C:/Users/Asus/Downloads/Monomani_welding_works/src-tauri/src/attachments.rs"] pub mod attachments;` and remove the `files` line from `purchase_orders`.
- [ ] **Step 5: Run the full suite.** Expected: 0 failures; count = 87 + the two new tests. `cargo check --manifest-path src-tauri/Cargo.toml` clean.
- [ ] **Step 6: Commit** `refactor: shared attachments module with per-kind temp names`.

---

### Task 2: Migration 13, backup summary, change-log

**Files:**
- Modify: `src-tauri/src/db/migrations.rs` (add `Migration { version: 13, name: "013_quotations", sql: QUOTATIONS_SQL }` and `pub const QUOTATIONS_SQL`), `src-tauri/src/backup/repository.rs` (`RECORD_TABLES` gets `("quotations", "quotation", "quotations")` between purchase orders and credits)
- Test: `db/migrations.rs` tests, `backup/repository.rs` tests

**Interfaces:**
- Produces tables: `quotations(id, customer_id NOT NULL REFERENCES customers(id), quotation_number TEXT NOT NULL, quotation_date TEXT NOT NULL, notes TEXT NULL, created_at, updated_at)` + index `idx_quotations_customer`; `quotation_files(id, quotation_id NOT NULL REFERENCES quotations(id) ON DELETE CASCADE, file_name, mime_type, size_bytes, data BLOB, created_at)` + index `idx_quotation_files_quotation`; `ALTER TABLE purchase_orders ADD COLUMN quotation_id INTEGER NULL REFERENCES quotations(id)` + index `idx_purchase_orders_quotation`; insert/update/delete `change_log` triggers for both new tables, written exactly like migration 12's.

- [ ] **Step 1: Write failing tests**, modelled on the existing migration-12 tests in `migrations.rs` (use the same helper that builds a database at version 12 with data): `migration_13_leaves_existing_orders_unlinked` (a database with a customer and a purchase order at v12, migrated, has `quotation_id IS NULL` for the order and `latest_version() == 13`), `quotation_triggers_log_changes` (insert a quotation and a file → `change_log` rows `quotations`/`quotation_files` with op INSERT), `deleting_a_quotation_removes_its_files`. In `backup/repository.rs` add `pending_summary_counts_quotations` (insert a customer and a quotation after `max_seq`, expect the lines to contain `"1 quotation added"`).
- [ ] **Step 2: Run** `cargo test --manifest-path $H migration` and `pending_summary` → FAIL.
- [ ] **Step 3: Implement** the SQL and the `RECORD_TABLES` entry.
- [ ] **Step 4: Run the full suite.** Expected: all pass (some existing tests assert `latest_version()` or the migration count — update those numbers 12 → 13 only where they test the latest version).
- [ ] **Step 5: Commit** `feat: migration 13 for quotations`.

---

### Task 3: Quotation models and repository

**Files:**
- Create: `src-tauri/src/quotations/{mod.rs,models.rs,repository.rs}` (`mod.rs`: `pub mod commands; pub mod models; pub mod repository; pub use commands::*;` — commands file arrives in Task 5, so create `commands.rs` as an empty stub now or add the line then)
- Modify: `src-tauri/src/lib.rs` (`pub mod quotations;`), `customers/repository.rs` (delete guard), harness `src/lib.rs` (add `quotations` with `models` and `repository`)
- Test: `quotations/repository.rs` tests, `customers/repository.rs` tests

**Interfaces:**
- Produces in `quotations::models` (all `#[derive(Debug, Clone, Serialize, Deserialize)]`; `QuotationFilter` also `Default`):
  `Quotation { id, customer_id, customer_name, quotation_number, quotation_date: String, notes: Option<String>, created_at, updated_at }`,
  `QuotationListItem { id, customer_id, customer_name, quotation_number, quotation_date: String, file_count: i64, order_count: i64 }`,
  `QuotationFileInfo { id, file_name, mime_type, size_bytes: i64 }`,
  `LinkedOrder { id, po_number, po_date: Option<String>, status: String, invoice_count: i64 }`,
  `QuotationDetail { quotation: Quotation, files: Vec<QuotationFileInfo>, orders: Vec<LinkedOrder> }`,
  `QuotationInput { customer_id: i64, quotation_number: String, quotation_date: String, notes: Option<String>, #[serde(default)] purchase_order_ids: Vec<i64> }`,
  `QuotationFilter { query: Option<String>, customer_id: Option<i64> }`,
  `DuplicateQuotationCheck { has_duplicate: bool, existing_id: Option<i64>, existing_customer_name: Option<String> }`.
- Produces `QuotationRepository` (unit struct) associated fns:
  `create(conn: &Connection, input: QuotationInput) -> Result<QuotationDetail, String>`,
  `update(conn, id: i64, input: QuotationInput) -> Result<QuotationDetail, String>`,
  `delete(conn, id: i64) -> Result<(), String>`,
  `get(conn, id: i64) -> Result<Option<QuotationDetail>, String>`,
  `list(conn, filter: QuotationFilter) -> Result<Vec<QuotationListItem>, String>` (search matches number or customer name `LIKE`; order `quotation_date DESC, id DESC`),
  `check_duplicate(conn, quotation_number: &str, exclude_id: Option<i64>) -> Result<DuplicateQuotationCheck, String>` (trim, `COLLATE NOCASE`, all customers),
  `unlinked_orders_for_customer(conn, customer_id: i64) -> Result<Vec<LinkedOrder>, String>` (orders with `quotation_id IS NULL`, every status, newest first),
  `set_purchase_order_link(conn, purchase_order_id: i64, quotation_id: Option<i64>) -> Result<(), String>` (None unlinks; Some requires same customer),
  `add_file(conn, quotation_id: i64, file_name: &str, bytes: &[u8]) -> Result<QuotationFileInfo, String>`, `remove_file(conn, file_id: i64) -> Result<(), String>`, `read_file(conn, file_id: i64) -> Result<(String, String, Vec<u8>), String>` — file fns identical in behaviour to the purchase order ones, using `crate::attachments`.
- Exact error texts: `"Quotation number is required."`, `"Quotation date is required."`, date via `normalize_date(d, "Quotation date")`, `"Customer not found."`, `"Quotation not found."`, `"Unlink this quotation's purchase orders before changing its customer."`, delete: `format!("This quotation has {} linked purchase order(s). Unlink them first.", n)`, link: `"This purchase order belongs to a different customer."`, attach: `format!("Purchase order {} is already linked to another quotation.", po_number)`, customer guard: `format!("This customer has {} quotation(s), so they can't be deleted.", n)` (placed after the purchase order check).
- Behaviour: `create`/`update` run in one transaction; the purchase-order attach list is processed inside it, rejecting any order whose `quotation_id` is set to a different quotation, then calling `set_purchase_order_link`; any error rolls the whole save back (no quotation row remains).

- [ ] **Step 1: Write failing tests** (helpers mirror the purchase order tests: `setup`, `add_customer`, an `add_order(conn, customer, number) -> i64` that inserts into `purchase_orders`, `input(customer, number, date)`), named and asserting:
  - `create_requires_number_date_and_a_known_customer` — blank number → `"Quotation number is required."`; blank date → `"Quotation date is required."`; unknown customer → contains `"Customer"`; `" Q-1 "` with date `"05-10-2026"` stores number `"Q-1"` and date `"2026-10-05"`; whitespace-only notes stored as `None`.
  - `duplicate_check_ignores_case_and_spaces_and_spans_customers_but_only_warns` — **(Review Focus 1)** `a` has `Q-14`; `check_duplicate(" q-14 ", None)` → has_duplicate, `existing_customer_name == Some("A")`, also true when asked in the context of customer B (the check takes no customer); excluding its own id → false; a second `create` with the same number succeeds.
  - `one_quotation_can_have_many_orders_and_an_order_has_one_quotation` — create a quotation with two attached orders; `get` lists both with their `invoice_count`; `file_count`/`order_count` correct in `list`.
  - `attaching_an_order_of_another_customer_is_refused_and_nothing_is_saved` — **(Review Focus 2)** create for A with `purchase_order_ids = [order of B]` → err contains `"different customer"`; `SELECT COUNT(*) FROM quotations` is 0.
  - `attaching_an_order_that_has_another_quotation_is_refused` — error text exact; first quotation still holds the order; second quotation not saved.
  - `the_attach_list_only_offers_orders_without_a_quotation_of_that_customer` — includes COMPLETED orders; excludes linked orders and other customers' orders.
  - `customer_cannot_change_while_orders_are_linked` — update with another customer → exact error; after `set_purchase_order_link(order, None)` the change succeeds.
  - `delete_is_blocked_while_orders_are_linked_and_removes_files_otherwise` — exact count text; after unlinking, delete succeeds and `quotation_files` is empty; a second `delete` → `"Quotation not found."` (Review Focus 5); `get` of a missing id → `Ok(None)`.
  - `files_follow_the_shared_rules` — `add_file` with a real `%PDF-` byte string returns mime `application/pdf` and appears in `get().files`; `fake.pdf` with text bytes errors; `remove_file` twice → second returns `"That file is no longer there."`; `read_file` returns the stored bytes.
  - In `customers/repository.rs`: `customer_with_quotations_cannot_be_deleted` (mirror the purchase order one) with the exact text above.
- [ ] **Step 2: Run** `cargo test --manifest-path $H quotations` → FAIL (does not compile).
- [ ] **Step 3: Implement** models, repository (copy the structure of `purchase_orders/repository.rs`; share nothing but `crate::attachments` and `crate::util`), the `mod.rs`, the `lib.rs` module line, the harness module (`pub mod quotations { #[path=…/models.rs] pub mod models; #[path=…/repository.rs] pub mod repository; }`), and the customer delete guard.
- [ ] **Step 4: Run the full suite.** Expected: all pass.
- [ ] **Step 5: Commit** `feat: quotation records, files and link rules`.

---

### Task 4: Purchase orders carry their quotation

**Files:**
- Modify: `purchase_orders/models.rs`, `purchase_orders/repository.rs`, `invoices/repository.rs` (test literals only: add `quotation_id: None` to the two `PurchaseOrderInput { … }` literals at ~1072 and ~1185), `purchase_orders/repository.rs` test helper `input(...)`
- Test: `purchase_orders/repository.rs` tests

**Interfaces:**
- Consumes: `QuotationRepository::set_purchase_order_link(conn, purchase_order_id, Option<i64>)` from Task 3.
- Produces: `PurchaseOrderInput` gains `#[serde(default)] pub quotation_id: Option<i64>`; `PurchaseOrder` gains `quotation_id: Option<i64>`, `quotation_number: Option<String>`, `quotation_date: Option<String>`; `PurchaseOrderListItem` gains `quotation_id: Option<i64>`, `quotation_number: Option<String>` (read by `LEFT JOIN quotations q ON q.id = po.quotation_id` in `get` and `list`).
- Rules in `create`/`update`: after the row is written (inside the existing transaction), if `input.quotation_id` differs from the stored value call `QuotationRepository::set_purchase_order_link(&tx, id, input.quotation_id)` (create: only when `Some`). In `update`, reject when the customer changes while the order **stays on the same stored quotation**: `"Remove this order's quotation before changing its customer."` (mirrors the invoice rule: if the same save clears or replaces the quotation, the customer change is judged by the link function's same-customer check).

- [ ] **Step 1: Write failing tests:**
  - `an_order_links_to_a_quotation_of_its_customer_and_shows_its_number_and_date` — create order with `quotation_id: Some(q)` → `order.quotation_number`, `order.quotation_date` filled; `list()` row has `quotation_number`.
  - `an_order_cannot_take_a_quotation_of_another_customer` — error contains `"different customer"`, order not created.
  - `moving_an_order_to_another_quotation_or_removing_it_updates_both_sides` — **(Review Focus 3)** order on Q1 → update with `quotation_id: Some(Q2)` → Q1 `order_count` 0, Q2 1; update with `None` → Q2 0, and `QuotationRepository::delete` of Q2 now succeeds.
  - `customer_cannot_change_while_the_order_keeps_its_quotation` — exact error; clearing the quotation and changing the customer in one update succeeds only if the order has no invoices (the existing invoice rule still applies — assert both cases).
  - Existing tests keep passing (update `input()` helper with `quotation_id: None`).
- [ ] **Step 2: Run** `cargo test --manifest-path $H purchase_orders` → FAIL.
- [ ] **Step 3: Implement** the model fields, SQL joins and the two rule changes.
- [ ] **Step 4: Run the full suite** → all pass. `cargo check --manifest-path src-tauri/Cargo.toml` clean.
- [ ] **Step 5: Commit** `feat: purchase orders can link to a quotation`.

---

### Task 5: Commands and registration

**Files:**
- Create: `src-tauri/src/quotations/commands.rs`
- Modify: `src-tauri/src/lib.rs` (register in `generate_handler!`, after the purchase order block)

**Interfaces:**
- Produces Tauri commands, each `Result<…, String>` using `state.db.get_connection()?` exactly like `purchase_orders/commands.rs`: `list_quotations(filter: Option<QuotationFilter>)`, `get_quotation(id: i64) -> Option<QuotationDetail>`, `create_quotation(input)`, `update_quotation(id, input)`, `delete_quotation(id)`, `check_duplicate_quotation_number(quotation_number: String, exclude_id: Option<i64>) -> DuplicateQuotationCheck`, `add_quotation_file(quotation_id: i64, file_name: String, data_base64: String) -> QuotationFileInfo` (decode with `decode_upload`), `remove_quotation_file(file_id)`, `get_quotation_file_preview(file_id) -> String`, `open_quotation_file(file_id)` (uses `prepare_temp_copy(…, "quotation", …)` then the opener, same error text as the purchase order one), `list_unlinked_purchase_orders_for_customer(customer_id: i64) -> Vec<LinkedOrder>`, `set_purchase_order_quotation(purchase_order_id: i64, quotation_id: Option<i64>)`.

- [ ] **Step 1:** Write `commands.rs` and register all twelve in `lib.rs`.
- [ ] **Step 2: Verify:** `cargo check --manifest-path src-tauri/Cargo.toml` → no errors, no new warnings. (Commands are thin wrappers; the rules they call are already tested.)
- [ ] **Step 3: Commit** `feat: quotation commands`.

---

### Task 6: TypeScript types, API layer, shared file components

**Files:**
- Create: `src/types/attachment.ts`, `src/types/quotation.ts`, `src/components/attachments/{FileViewer.tsx,useFileAttachments.ts,FileAttachmentsField.tsx}`
- Modify: `src/types/purchaseOrder.ts`, `src/services/api.ts`, `src/lib/format.ts`, `src/components/purchaseOrders/{PurchaseOrderFormModal.tsx,PurchaseOrderDetailsModal.tsx}`

**Interfaces:**
- `attachment.ts` exports `AttachmentInfo { id; file_name; mime_type; size_bytes }`, `MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024`, `ALLOWED_ATTACHMENT_EXTENSIONS = ["jpg","jpeg","png","pdf","doc","docx"]`. `purchaseOrder.ts`: `PurchaseOrderFileInfo = AttachmentInfo`, `MAX_PO_FILE_BYTES = MAX_ATTACHMENT_BYTES`; `PurchaseOrder` gains `quotation_id: number | null; quotation_number: string | null; quotation_date: string | null`; `PurchaseOrderListItem` gains `quotation_id`, `quotation_number`; `PurchaseOrderInput` gains `quotation_id: number | null`.
- `quotation.ts` mirrors the Rust models: `Quotation`, `QuotationListItem`, `QuotationFileInfo = AttachmentInfo`, `LinkedOrder`, `QuotationDetail`, `QuotationInput`, `QuotationFilter { query?; customer_id? }`, `DuplicateQuotationCheck`.
- `format.ts`: `formatFileSize(sizeBytes: number): string` ("1.2 MB" / "34.5 KB", the same rule the two purchase order files used).
- `api.ts` adds: `listQuotations(filter = {})`, `getQuotation(id)`, `createQuotation(input)`, `updateQuotation(id, input)`, `deleteQuotation(id)`, `checkDuplicateQuotationNumber(quotationNumber, excludeId?)`, `addQuotationFile(quotationId, fileName, dataBase64)`, `removeQuotationFile(fileId)`, `getQuotationFilePreview(fileId)`, `openQuotationFile(fileId)`, `listUnlinkedPurchaseOrdersForCustomer(customerId)`, `setPurchaseOrderQuotation(purchaseOrderId, quotationId)`.
- `FileViewer({ files, getPreview, openFile }: { files: AttachmentInfo[]; getPreview: (fileId: number) => Promise<string>; openFile: (fileId: number) => Promise<void> })` — the photo grid, enlarge-on-click modal, documents with Open, and "No files attached yet." moved verbatim from `PurchaseOrderDetailsModal` (it owns `previewUrls`, `imagePreview`, `openingFileId`, and uses `useToast` for open errors).
- `useFileAttachments({ ownerId, addFile, onStoredChange, onDirty }: { ownerId?: number; addFile: (ownerId: number, fileName: string, base64: string) => Promise<unknown>; onStoredChange: () => Promise<void>; onDirty: () => void })` returns `{ pending: PendingUpload[]; uploading: boolean; busyFileName: string | null; errors: string[]; clearErrors(): void; pickFiles(event: ChangeEvent<HTMLInputElement>): Promise<void>; removePending(key: string): void; uploadPending(savedId: number): Promise<string[]> }` — the extension/size checks, `FileReader` base64 read, immediate upload when `ownerId` is set, queued as pending otherwise, and failure collection, moved verbatim from `PurchaseOrderFormModal`.
- `FileAttachmentsField({ stored, attachments, onRequestRemove, description, disabled }: { stored: AttachmentInfo[]; attachments: ReturnType<typeof useFileAttachments>; onRequestRemove: (file: AttachmentInfo) => void; description: string; disabled?: boolean })` — heading "Files", the hidden multi-file input (`accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,image/jpeg,image/png,application/pdf"`), the "Add files" button, stored rows, pending rows, and the empty text.

- [ ] **Step 1:** Add the types, `formatFileSize`, and the api functions (a typo in a Tauri argument name is only caught at run time, so camelCase every argument from its Rust snake_case name: `quotationNumber`, `excludeId`, `quotationId`, `dataBase64`, `fileName`, `purchaseOrderId`).
- [ ] **Step 2:** Create the three attachment files by moving the code out of the two purchase order modals, then make both modals use them. Behaviour and wording of the purchase order screens must not change (the form still keeps its own `ConfirmDialog` for removing a stored file and still calls `uploadPending(savedId)` inside `save`; the details window still hosts its enlarge modal via `FileViewer`).
- [ ] **Step 3: Verify:** `npx tsc --noEmit -p .` → exit 0; `npm run build` → success.
- [ ] **Step 4: Commit** `refactor: shared file components; quotation types and api`.

---

### Task 7: Quotations page, form, details, sidebar

**Files:**
- Create: `src/pages/QuotationsPage.tsx`, `src/components/quotations/QuotationFormModal.tsx`, `src/components/quotations/QuotationDetailsModal.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- `QuotationsPage({ openQuotationId, onOpenHandled, onOpenPurchaseOrder }: { openQuotationId?: number | null; onOpenHandled?: () => void; onOpenPurchaseOrder: (purchaseOrderId: number) => void })` — modelled on `PurchaseOrdersPage` without status tabs; search placeholder "Search quotation number or company   ( / )"; columns Quotation number, Company, Date, Files (right), Purchase orders (right); `PageHeader` title "Quotations", description "Quotations sent to companies and the purchase orders that follow.", action "New quotation"; empty state "No quotations yet"; footer "N quotation(s)"; opens `openQuotationId` once (same effect pattern as `InvoicesPage`).
- `QuotationFormModal({ quotationId, onClose, onSaved }: { quotationId?: number; onClose: () => void; onSaved: (id: number) => void })` — modelled on `PurchaseOrderFormModal`: `CustomerPicker` (locked with the hint "Customer cannot be changed while purchase orders are linked to this quotation." when `detail.orders.length > 0`), "Quotation number" (required, `aria-label`, on blur `checkDuplicateQuotationNumber`; warning text `"<number> is already used for <existing_customer_name>."` in amber, never blocks saving), "Quotation date" (`type="date"`, default `todayISO()` for a new one), "Internal note" textarea (placeholder "For your own reference, not sent to the company"), `FileAttachmentsField`, "Attach purchase orders" (checkbox list from `listUnlinkedPurchaseOrdersForCustomer`, rows show PO number, date, status, invoice count; "Linked purchase orders" with Unlink via `setPurchaseOrderQuotation(id, null)`), `useDiscardGuard`. Save errors: "Choose a customer.", "Enter the quotation number.", "Choose the quotation date.". Failed files after save → the toast pattern from the purchase order form.
- `QuotationDetailsModal({ id, onClose, onChanged, onOpenPurchaseOrder }: { id: number; onClose: () => void; onChanged: () => void; onOpenPurchaseOrder: (purchaseOrderId: number) => void })` — fields (Company, Quotation number, Date), Internal note, `FileViewer`, "Purchase orders" rows (number, date, status badge, `N invoice(s)`) that call `onOpenPurchaseOrder`, Edit, Delete with confirm text "This quotation and its attached files will be deleted. This cannot be undone."; if `getQuotation` returns `null` show the `Alert` "This quotation no longer exists." (Review Focus 5).
- `App.tsx`: `Page` adds `"quotations"`; `NAV` gets `{ id: "quotations", label: "Quotations", icon: FileSignature }` placed **before** Purchase orders (replace the icon with another lucide icon if `FileSignature` is not exported by the installed version); state `openQuotationId` / `openPurchaseOrderId` handled like `openInvoiceId`; page renders `QuotationsPage` with `onOpenPurchaseOrder={(id) => { setOpenPurchaseOrderId(id); setPage("purchaseOrders"); }}`.

- [ ] **Step 1:** Write the three components and the `App` wiring following the interfaces; use `docs/BRAND.md` tokens and the shared kit (`Modal`, `Field`, `Button`, `Badge`, `SectionTitle`, `ConfirmDialog`, `EmptyState`, `ListSkeleton`, `PageHeader`, `rowProps`, `rowClass`, `RowChevron`, `theadClass`) exactly as the purchase order screens use them.
- [ ] **Step 2: Verify:** `npx tsc --noEmit -p .` → exit 0; `npm run build` → success.
- [ ] **Step 3: Commit** `feat: quotations screens`.

---

### Task 8: Purchase order ↔ quotation in the order screens, and cross-screen opening

**Files:**
- Modify: `src/components/purchaseOrders/PurchaseOrderFormModal.tsx`, `PurchaseOrderDetailsModal.tsx`, `src/pages/PurchaseOrdersPage.tsx`, `src/pages/InvoicesPage.tsx`, `src/components/invoices/InvoiceDetailsModal.tsx`, `src/App.tsx`

**Interfaces:**
- `PurchaseOrderFormModal`: new "Quotation" `Field` (shown when a customer is chosen) with a `SearchSelect` (`ariaLabel="Quotation"`, options from `listQuotations({ customer_id })` labelled `"<number> — <DD-MM-YYYY>"`, search = number, `fallbackLabel={detail?.order.quotation_number ?? undefined}`) and a Remove button; hint "Optional. Pick the quotation this order came from."; empty hint "This customer has no quotations yet. You can add one under Quotations."; sends `quotation_id` in the input; the customer picker is locked while the stored quotation is still selected (hint "Remove the quotation to change the customer.", mirroring `InvoiceFormModal`).
- `PurchaseOrderDetailsModal` gains a required prop `onOpenQuotation: (quotationId: number) => void`; a "Quotation" `Item` row shows `"<number> — <date>"` as a button calling it, or "-" when none.
- `PurchaseOrdersPage({ onOpenInvoice, onOpenQuotation, openPurchaseOrderId, onOpenHandled })`: opens `openPurchaseOrderId` once (same effect pattern as `InvoicesPage`) and passes `onOpenQuotation` down; list gets a "Quotation" column showing the number or "-".
- `InvoicesPage` gains `onOpenQuotation: (quotationId: number) => void` and passes it to `InvoiceDetailsModal`, which passes it to the embedded `PurchaseOrderDetailsModal`.
- `App` supplies `onOpenQuotation={(id) => { setOpenQuotationId(id); setPage("quotations"); }}` to both pages and the `openPurchaseOrderId` handoff to `PurchaseOrdersPage`.

- [ ] **Step 1:** Make the changes above (the two details modals never import each other).
- [ ] **Step 2: Verify:** `npx tsc --noEmit -p .` → exit 0; `npm run build` → success.
- [ ] **Step 3: Commit** `feat: link purchase orders to quotations in the screens`.

---

### Task 9: Docs and final verification

**Files:** Modify `docs/PROJECT_STRUCTURE.md`.

- [ ] **Step 1:** Update the project guide: layout (`attachments.rs`, `quotations/`, new pages/components), the Quotation → Purchase order → Invoices chain and its rules (same customer, one quotation per order, duplicate-number warning across customers, delete guards, nothing printed), migration 13, the test counts, and the harness note (`attachments.rs` and `quotations` modules).
- [ ] **Step 2: Full verification**, all must pass: harness full suite (0 failed; report the count), `cargo check --manifest-path src-tauri/Cargo.toml`, `npx tsc --noEmit -p .`, `npm run build`.
- [ ] **Step 3: Self-review the whole diff** (`git diff bf4b7cf..HEAD` for this feature's commits) against the spec: every rule 1–11 has a test or an explicit reason; no leftover references to `purchase_orders::files`; user-visible wording matches the spec; no unrelated edits. Fix anything found.
- [ ] **Step 4: Commit** `docs: quotations in the project guide`. Do not push.
