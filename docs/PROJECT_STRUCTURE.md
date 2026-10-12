# Mononmani Welding Works — project guide

Windows desktop app for GST tax invoices, customer records and payments. React + TypeScript + Tailwind v4 (Vite) for the window, Rust + Tauri 2 + SQLite for storage and logic. Everything runs offline on one computer.

## Screens

| Screen | What it does |
|---|---|
| Dashboard | Balance due, overdue, invoiced and received this month; invoices waiting for payment; recent payments. |
| Invoices | Search and status tabs (awaiting payment, overdue, paid, drafts, cancelled). Click a row for details: print Original / Duplicate / Triplicate, edit, record payment, delete. |
| Payments | Monthly and total receipts, advances held, cheques not yet cleared. Click a row for details, edit or delete. |
| Customers | Search, frequent-customer star, details with balance due, advance held and invoice list. |
| Settings | Where the data folder is, with a button to open it for backups. |

## Business rules (enforced in Rust)

- **Numbers:** `MWW/001/26-27` for invoices, `PAY/001/26-27` for payments: running number, then the Indian financial year (April–March), local time. Numbers issued in the older `MWW/26-27/001` form keep their number and still count towards the running number.
- **Vehicle number:** checked as an Indian registration (e.g. `TN 09 AB 1234`, `22 BH 1234 AA`) and stored in that spaced form; an older value that fails the check can stay until it is changed.
- **PO / DC numbers** are entered as a number and a date and stored as `number & dd-mm-yyyy`; left empty they print as a dash.
- **Tax state** comes from the GSTIN prefix when there is one; the forms warn when it disagrees with the state chosen.
- **Dates** are stored as `YYYY-MM-DD` and shown as `DD-MM-YYYY`.
- **Tax:** CGST + SGST for customers in Puducherry (state code 34), IGST otherwise. The state code comes from the GSTIN or the customer's state. Totals are exact to the paisa, with no round-off to the rupee, and the amount in words includes paise. Migration 11 brought older invoices that were not fully paid to their exact total; fully paid ones keep the total they were settled at, so they do not reopen for a few paise.
- **Invoice edits:** an invoice with payments cannot drop below what has been paid, cannot become Draft or Cancelled, and cannot be deleted.
- **Customers** with invoices or payments cannot be deleted.
- **Payment allocation:** a payment can only be applied to the same customer's Issued invoices, and never more than each invoice's balance or the money available.
- **Leftover money** is kept as an **advance**, marked **refunded**, or **kept as a round-off** (counted as received, nothing owed back, no advance). A round-off is limited to ₹500 per payment.
- **Short payments:** the owner can accept a payment that is a little short as full payment ("Settle in full"). The shortfall is stored on the payment as `writeoff_amount` (migration 10), counts towards settling the invoices like recognised TDS, and is limited to ₹500 per payment. It must equal what is actually short after money received, TDS and any advance used. Deleting the payment reopens the invoices. Advances are used oldest-first by later payments ("Use advance" in the payment form). Deleting or editing a payment gives back any advance it used. A payment whose advance has already been used cannot be deleted until the later payment is removed.

## Code layout

```text
src/                          React UI
  App.tsx                     sidebar + page switching
  components/ui.tsx           Button, Modal, Field, Badge, ConfirmDialog, Toast, ...
  components/invoices/        InvoiceFormModal, InvoiceDetailsModal
  components/payments/        PaymentFormModal, PaymentDetailsModal
  components/customers/       CustomerFormModal, CustomerDetailsModal
  pages/                      Dashboard, Invoices, Payments, Customers, Settings
  services/api.ts             every Tauri command, one function each
  lib/format.ts, lib/gst.ts   money/date formatting, GST state codes
  template/                   invoice HTML + CSS used for the PDF
src-tauri/src/
  lib.rs                      app setup, command list, open PDF / data folder
  util.rs                     dates, rounding, Indian number formatting
  db/migrations.rs            schema migrations 001–005 (each in a transaction)
  customers/ invoices/ payments/   models, repository (rules + SQL), commands
  pdf/renderer.rs             fills the template and prints it with Edge/Chrome
```

## Data on disk

`%APPDATA%\com.manonmani.app\` — `Database\manonmani.db`, `Invoices\<year>\<number>_<copy>.pdf`. The folder name comes from the Tauri identifier; don't change the identifier or the app will start with an empty database.

## Building and running

- `app.bat` — the only launcher: shows a menu, or use `app.bat dev` (`npm run tauri dev`), `app.bat build` (release build), `app.bat open` (start the built app).
- `npm run build` — type-check and build the UI only.

PDF creation needs Microsoft Edge (installed with Windows) or Google Chrome.

## Tests

Rust unit tests live next to the code (`customers/repository.rs`, `invoices/repository.rs`, `payments/repository.rs`, `util.rs`, `pdf/renderer.rs`). They cover tax maths, number-to-words, migrations, allocation limits, advances, and the delete/edit guards.

On this machine `cargo test` builds but the test executable cannot start (`STATUS_ENTRYPOINT_NOT_FOUND`): the MinGW linker can't merge Tauri's Windows manifest into test binaries. The tests pass when the data-layer modules are compiled on their own without Tauri.

## Google Drive backup

- `src-tauri/src/backup/`: `snapshot.rs` (VACUUM INTO copy, integrity check, gzip, hashes), `repository.rs` (change log summary, run history), `drive.rs` (OAuth with PKCE, Credential Manager storage, Drive calls), `commands.rs`.
- Migration 8 adds `change_log` (filled by triggers on every record table) and `backup_runs`. A backup is skipped when nothing changed after the last successful run; the change number only advances after the upload is verified (size and MD5), so interrupted backups lose nothing.
- Every backup is a complete compressed copy and is never overwritten, so earlier versions stay restorable. Restore keeps a `before-restore-*.db` copy in the Backups folder.
- The Google Client ID/secret and refresh token live in Windows Credential Manager, not in the database.
- To run the data-layer tests despite the Tauri test-exe problem, compile `db`, `util`, and the `models.rs`/`repository.rs` files of customers, invoices, payments and backup (plus `backup/snapshot.rs`) in a small crate using `#[path]` modules, then `cargo test` there.
