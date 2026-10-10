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

- **Numbers:** `MWW/26-27/001` for invoices, `PAY/26-27/001` for payments, by Indian financial year (April–March), local time.
- **Dates** are stored as `YYYY-MM-DD` and shown as `DD-MM-YYYY`.
- **Tax:** CGST + SGST for customers in Puducherry (state code 34), IGST otherwise. The state code comes from the GSTIN or the customer's state. Totals are rounded to the rupee with a round-off line.
- **Invoice edits:** an invoice with payments cannot drop below what has been paid, cannot become Draft or Cancelled, and cannot be deleted.
- **Customers** with invoices or payments cannot be deleted.
- **Payment allocation:** a payment can only be applied to the same customer's Issued invoices, and never more than each invoice's balance or the money available.
- **Leftover money** is either kept as an **advance** or marked **refunded**. Advances are used oldest-first by later payments ("Use advance" in the payment form). Deleting or editing a payment gives back any advance it used. A payment whose advance has already been used cannot be deleted until the later payment is removed.

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
