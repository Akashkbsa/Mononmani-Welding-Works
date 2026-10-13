# Quotations — design

Date: 2026-10-13. Status: draft for the owner's review (not yet approved to build).

## Goal

Mononmani Welding Works sends quotations to companies; a company that accepts then sends a purchase order. The app should keep a record of each quotation sent (its number, date, company, an internal note and the file that was actually sent), and connect it to the purchase orders that came from it, from either side. This mirrors purchase orders (see `2026-10-13-purchase-orders-design.md`) and reuses their file handling.

The chain after this feature: **Quotation → Purchase order → Invoices.**

## Decisions made with the owner

- Name: **Quotation** (sidebar: "Quotations", placed before "Purchase orders").
- A quotation holds only: customer, quotation number, quotation date, internal note, and its files. **No status**, no amounts, no items. The app does not read the files.
- The quotation number is **typed by the owner** (it is the number printed on the quotation that was sent). The app does not generate numbers.
- **One quotation can have many purchase orders; a purchase order has at most one quotation.** Not many-to-many. A purchase order may have no quotation (a customer who orders without one).
- Files: stored inside the database in a separate `quotation_files` table, up to 10 MB each, several per quotation. Allowed: JPG/JPEG, PNG, PDF, DOC, DOCX. Same checks as purchase order files.
- Build approach C: purchase order data and behaviour stay untouched; the file rules move to one shared module and the file screens become shared components.
- Google Drive backup behaviour is unchanged. Files live in the database, so the existing backup already includes them; backups grow in size.

## Data (migration 13, `013_quotations`)

Never edit an applied migration; this is a new numbered one.

- `quotations`: `id`, `customer_id` (NOT NULL, FK customers), `quotation_number` (NOT NULL), `quotation_date` (TEXT `YYYY-MM-DD`, NOT NULL), `notes`, `created_at`, `updated_at`. Index on `customer_id`.
- `quotation_files`: `id`, `quotation_id` (FK, `ON DELETE CASCADE`), `file_name`, `mime_type`, `size_bytes`, `data` (BLOB), `created_at`. Index on `quotation_id`.
- `purchase_orders.quotation_id`: nullable INTEGER, FK to `quotations(id)`. Index. Existing purchase orders stay unlinked.
- Insert/update/delete triggers into `change_log` for `quotations` and `quotation_files`, in the style of migration 12, so a backup is not skipped after a change that touched only these tables. Add `quotations` to `RECORD_TABLES` in `backup/repository.rs` (singular "quotation", plural "quotations").

List queries never select file contents; they read `file_name`, `mime_type`, `size_bytes` only. The blob is read only when one file is opened or previewed.

## Rules (enforced in Rust: new `quotations/repository.rs`, and the purchase order `save`)

1. Quotation number required (trimmed). Quotation date required, valid, normalised to `YYYY-MM-DD`. The form defaults the date to today.
2. **Duplicate number is a warning only**, checked **across all customers**, case-insensitive. The result names the customer who already has it. A revised quotation may be re-sent under the same number, so saving is never blocked.
3. A purchase order links only to a quotation **of the same customer**. The purchase order save rejects a different-customer link, and rejects changing `customer_id` while `quotation_id` is set. A quotation's `customer_id` cannot change while purchase orders are linked to it (same shape as the existing purchase-order rule for invoices).
4. **Delete:** a quotation with linked purchase orders cannot be deleted ("unlink them first"). An unlinked one is deleted together with its files (cascade).
5. Deleting a purchase order needs no new rule (the link is a column on the purchase order). The existing guard (a purchase order with invoices cannot be deleted) is unchanged.
6. The customer delete guard (`customers/repository.rs`) also counts quotations.
7. **Attaching from the quotation screen** lists only that customer's purchase orders with **no quotation yet**, of every status. An order already linked to another quotation is not offered and never moves silently; the owner unlinks it first. From the purchase order screen the owner may pick a different quotation for that order, because the order owns the link.
8. **Linking changes nothing printed.** Unlike the invoice link it does not fill any text and does not touch the invoice PDF template or `pdf/renderer.rs`. Unlinking sets `quotation_id` to NULL and leaves nothing to clean up.
9. File checks stay in Rust: size at most 10 MB, extension in the allowed list, leading bytes match the type. Same messages as for purchase orders.
10. If several files are added and some fail, the quotation still saves and the message names the failed files, as purchase orders do.
11. **Not enforced on purpose:** the quotation date being earlier than a linked order's date. Revised quotations and back-entered old records make that rule more annoying than useful.

## Backend structure

1. **Shared file module first.** Move the contents of `purchase_orders/files.rs` to `src-tauri/src/attachments.rs`: `validate_file`, `clean_file_name`, `decode_upload`, `image_data_url`, `temp_open_path`, `temp_copy_is_current`, constants, and their tests. `purchase_orders` imports from it; `purchase_orders/files.rs` is removed. Register `pub mod attachments;` in `lib.rs`. Before any quotation code exists, the full test suite must still pass with the same count (87).
2. **Temp file names must not collide between kinds.** Purchase order files and quotation files have separate id counters, and an existing temp copy is reused when its size matches. `temp_open_path` therefore takes a kind prefix and names the copy `po_<id>_<name>` or `quotation_<id>_<name>`. The "only open files inside Temp" guard stays. The error text becomes "Only attached files can be opened." The Temp folder is still cleared at app start.
3. New module `src-tauri/src/quotations/` with `models.rs`, `repository.rs`, `commands.rs`, `mod.rs`, mirroring `purchase_orders/`.
4. Commands (registered in `lib.rs`): `list_quotations`, `get_quotation`, `create_quotation`, `update_quotation`, `delete_quotation`, `check_duplicate_quotation_number`, `add_quotation_file`, `remove_quotation_file`, `get_quotation_file_preview`, `open_quotation_file`, `list_unlinked_purchase_orders_for_customer`, `set_purchase_order_quotation` (link/unlink).
5. Purchase order models and queries gain `quotation_id` and `quotation_number` on input and output (list, detail), by join, the way invoices gained `purchase_order_number`. `PurchaseOrderInput` carries `quotation_id`. The positional parameter lists in the purchase order `create`/`update` must be extended with care.
6. Quotation list rows: id, customer, number, date, file count, linked purchase order count. Quotation detail: the quotation, its files, and its linked purchase orders (id, number, date, status, invoice count).

File transport is unchanged: the browser reads the file and sends base64 plus the file name; photos return as `data:` URLs; PDF/Word are written to the Temp folder and opened with the default program.

## Screens

- **Shared components** (new, in `src/components/`): a file list for forms (add, remove, upload progress, pending files for a record not yet saved, failure messages) and a file viewer for details windows (photo grid, enlarge on click, Open for documents). Purchase order form and details switch to them; no visible change there. They take the API calls as props, so each record type supplies its own.
- **Quotations page** (new sidebar item before Purchase orders; `Page` type and `NAV` in `App.tsx`): search by quotation number or company; no status tabs. Columns: quotation number, company, date, files, purchase orders. Empty states in the existing style.
- **Quotation form** (modal): `CustomerPicker`, number (with the duplicate warning), date, internal note, files, and "Attach purchase orders" (that customer's orders without a quotation); once saved, linked orders can be unlinked. Uses `useDiscardGuard`. The customer is locked while orders are linked.
- **Quotation details window**: fields, files, linked purchase orders (number, date, status, invoice count; click opens the order), Edit and Delete.
- **Purchase order form**: a Quotation picker (`SearchSelect`) limited to that customer's quotations, with a Remove button. **Purchase order details** shows the linked quotation (number, date) with a link to open it.
- **Opening across screens** uses the handoff `App.tsx` already uses for invoices: `App` holds the id to open and switches page; the target page opens it once. Quotation → order, and order → quotation, both go through `App`. `InvoicesPage` (where a purchase order opens from invoice details) gets the same prop so the quotation link there works. The two details modals never import each other, to avoid a circular import.
- Follow `docs/BRAND.md` and the shared kit in `components/ui.tsx`; dates shown `DD-MM-YYYY`.

## Errors

Plain-language messages in the existing style: quotation has linked purchase orders (unlink first); purchase order belongs to a different customer; purchase order is already linked to another quotation; unlink the quotation's orders before changing its customer; customer has quotations; quotation number and date required; plus the existing file messages (over 10 MB, type not allowed, could not open the file).

## Testing

Rust unit tests next to the code, run through the standalone-crate method in `docs/PROJECT_STRUCTURE.md` (`cargo test` cannot start on this machine). The harness crate needs `attachments.rs` and `quotations/` added.

- After the file-module move: the same 87 tests pass.
- Same-customer rule on link, on purchase order save, and on customer change in both directions; one quotation per order; many orders per quotation; unlink.
- Delete guards: quotation with linked orders, customer with quotations; cascade of files on delete.
- Duplicate number across customers, case-insensitive, warning only; excludes itself on edit.
- Attach list excludes orders that already have a quotation.
- File size/type/contents checks (moved tests); temp names for the two kinds never collide.
- Migration 13 applied to a copy of a database that already has customers, invoices and purchase orders (never the real database); existing orders come out with `quotation_id` NULL; change-log triggers fire.
- UI: `npx tsc --noEmit -p .` and `npm run build`. The owner checks the screens by hand once; the screens are not clicked through by the assistant.

## Build order

1. Move file rules to `attachments.rs`, Temp prefixes, re-run the suite (same count).
2. Migration 13 and tests.
3. Quotation repository, rules and tests; purchase order changes (`quotation_id` in input, output, same-customer rules).
4. Commands, `lib.rs` registration, `api.ts` and TypeScript types.
5. Shared file components (purchase orders switched over), then the Quotations page, form and details window.
6. Purchase order form picker and details link; cross-screen opening in `App.tsx` and `InvoicesPage`.
7. Update `docs/PROJECT_STRUCTURE.md`.

Each stage is checked before the next. Delegated workers get only code and sample data, never the real database.

## Out of scope

Quotation status or validity dates, amounts or items, reading or extracting data from the files, generating quotation numbers or quotation PDFs, many-to-many links, any change to the invoice PDF, and any change to the Drive backup.
