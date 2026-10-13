# Purchase orders — design

Date: 2026-10-13. Status: draft for the owner's review (not yet approved to build).

## Goal

The owner receives purchase orders from customers as photos (JPG/PNG), PDF or Word files. The app should store each one, let the owner view it later, track whether the order is done, keep an internal note, and link the order to the invoices raised against it. One purchase order can have several invoices. Linking works from both sides: pick the purchase order while making an invoice, or attach existing invoices while making the purchase order (invoice first, purchase order later).

## Decisions made with the owner

- A purchase order holds only: customer, PO number, PO date, status, internal note, and its files. The app does not read the files or record items, quantities or values.
- Status is set by the owner only: Not started, Partially completed, Completed (default Not started). The app never changes it.
- Files are stored **inside the database** (separate table), up to **10 MB each**, several per order. Allowed types: JPG/JPEG, PNG, PDF, DOC, DOCX.
- The Google Drive backup is out of scope for now. It will be discussed after the other planned features. Because files live in the database, the existing backup already includes them; only its size will grow.
- Linking is by internal record id, not by typed number. The PO number is a label (searchable, shown on the invoice).

## Assumptions to confirm (owner has not objected)

1. An invoice belongs to at most one purchase order; a purchase order has many invoices.
2. Linking fills the invoice's existing text field `po_number_and_date` (`number & dd-mm-yyyy`) so the printed invoice is unchanged. Unlinking leaves the text as it is.

## Data (migration 12, `012_purchase_orders`)

Never edit an applied migration; this is a new numbered one.

- `purchase_orders`: `id`, `customer_id` (NOT NULL, FK customers), `po_number` (NOT NULL), `po_date` (TEXT `YYYY-MM-DD`, NULL allowed), `status` (`NOT_STARTED` | `PARTIAL` | `COMPLETED`, default `NOT_STARTED`), `notes`, `created_at`, `updated_at`. Index on `customer_id`.
- `purchase_order_files`: `id`, `purchase_order_id` (FK, `ON DELETE CASCADE`), `file_name`, `mime_type`, `size_bytes`, `data` (BLOB), `created_at`. Index on `purchase_order_id`.
- `invoices.purchase_order_id`: nullable INTEGER, FK to `purchase_orders(id)`. Index. Existing invoices stay unlinked.
- Insert/update/delete triggers into `change_log` for `purchase_orders` and `purchase_order_files`, in the same style as migration 8, so a backup is not skipped after a change that only touched these tables. Add `purchase_orders` to the table list in `backup/repository.rs` that feeds the "what changed" summary.

The file contents are never selected by list queries; lists read `file_name`, `mime_type`, `size_bytes` only. The blob is read only when one file is opened.

## Rules (enforced in Rust, in new `purchase_orders/repository.rs` and in the invoice `save`)

- PO number required. Duplicate check per customer, case-insensitive, same shape as `check_duplicate_number` for invoices. It is a **warning only**: the form shows it, and the owner can still save (a customer may re-send a revised order under the same number). It is not a hard error.
- An invoice can link only to a purchase order of the same customer. The invoice `save` rejects a different-customer link and rejects changing `customer_id` while `purchase_order_id` is set.
- From the purchase-order side, attaching invoices lists that customer's invoices with no purchase order; unlinking sets `purchase_order_id` to NULL.
- When an invoice is linked, `po_number_and_date` is set to `<po_number> & <dd-mm-yyyy>` (just the number if the PO has no date).
- A purchase order with linked invoices cannot be deleted; unlink first. Deleting an unlinked one deletes its files (cascade).
- The customer delete guard (`customers/repository.rs`) also counts purchase orders.
- Deleting an invoice needs no new rule (the link is a column on the invoice).
- File checks in Rust, not only in the UI: size at most 10 MB (10 × 1024 × 1024 bytes), extension in the allowed list, and the leading bytes match the type (JPEG, PNG, `%PDF`, OLE for `.doc`, ZIP for `.docx`). Reject anything else with a plain message.

## Backend structure

New module `src-tauri/src/purchase_orders/` with `models.rs`, `repository.rs`, `commands.rs`, `mod.rs`, mirroring `payments/`. File storage and file opening sit in one small unit (`files.rs`) so the storage choice can change later without touching the rest.

Commands: `list_purchase_orders`, `get_purchase_order`, `create_purchase_order`, `update_purchase_order`, `delete_purchase_order`, `check_duplicate_po_number`, `add_purchase_order_file`, `remove_purchase_order_file`, `get_purchase_order_file_preview` (returns base64 for images), `open_purchase_order_file`, `list_unlinked_invoices_for_customer`, `set_invoice_purchase_order` (link/unlink). Register them in `lib.rs`.

The invoice commands and models gain `purchase_order_id` on input and output, plus the PO number on list and detail output via a join. The positional parameter lists in `invoices/repository.rs` `save` must be extended with care.

File transport: the browser file picker reads the file; the UI sends it to Rust as a base64 string with the file name. No new Tauri plugin. Images are shown in the app as `data:` URLs (the existing CSP already allows `data:` images). PDFs and Word files are written to a new `Temp` folder inside the app data folder, opened with `tauri_plugin_opener::open_path` after checking the path is inside that folder, and the folder is cleared at app start.

## Screens

- New sidebar page **Purchase Orders** after Invoices (`Page` type and `NAV` in `App.tsx`). Search by PO number or customer; tabs All / Not started / Partially completed / Completed. Rows: PO number, customer, PO date, status badge, file count, linked-invoice count.
- **Purchase order form** (modal): `CustomerPicker`, PO number (with duplicate warning), PO date, status, note, file area (add, remove), and "Attach invoices" (that customer's unlinked invoices; after saving, linked ones can be unlinked). Uses `useDiscardGuard` like the other forms.
- **Details window**: fields, files (image previews that enlarge on click; PDF/Word as a named row that opens in the default app), linked invoices (number, date, amount, payment status; click opens the invoice), Edit and Delete.
- **Invoice form**: a Purchase order picker (`SearchSelect`) limited to the chosen customer's orders, with a clear button and a link to view the order's files. **Invoice details** shows the linked order with a link to open it.
- Follow `docs/BRAND.md` and the shared kit in `components/ui.tsx`; dates shown `DD-MM-YYYY`.

## Errors

Plain-language messages in the existing style: file over 10 MB, file type not allowed, invoice belongs to a different customer, purchase order has linked invoices, customer has purchase orders, could not open the file (for example no Word installed). If adding several files fails partway, the order still saves and the message names the files that failed.

## Testing

Rust unit tests next to the code, run through the standalone-crate method in `docs/PROJECT_STRUCTURE.md` (`cargo test` cannot start on this machine): same-customer rule, one purchase order per invoice, unlink, delete guards (purchase order, customer), duplicate PO number, file size and type checks, `po_number_and_date` fill, and migration 12 applied to a database that already has invoices (a copy, never the real database). UI: `npx tsc --noEmit -p .` and `npm run build`. The owner checks the screens by hand once; the screens are not clicked through by the assistant.

## Build order (minimodel)

1. Migration 12 and tests (lead).
2. Purchase-order repository, rules and tests; invoice `save` changes (lead), then a read-only review by a different model family.
3. Commands, `lib.rs` registration, `api.ts` and TypeScript types.
4. Purchase Orders page, form and details window (a worker may write these; the lead reviews the diff and runs the checks).
5. Invoice form and details changes (lead).
6. Update `docs/PROJECT_STRUCTURE.md`.

Each stage on a branch, checked before the next. Delegated workers get only code and sample data, never the real database.

## Out of scope

Reading or extracting data from the files, item or value tracking, automatic status changes, PDF viewing inside the app, many-to-many invoice links, and any change to the Drive backup.
