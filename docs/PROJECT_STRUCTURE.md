# Mononmani Welding Works — project guide

Windows desktop app for GST tax invoices, customer records and payments. React + TypeScript + Tailwind v4 (Vite) for the window, Rust + Tauri 2 + SQLite for storage and logic. Everything runs offline on one computer.

## Screens

| Screen | What it does |
|---|---|
| Dashboard | Four figures, each with a small picture: customers owe you and you owe suppliers (a bar split by age: up to 30, 31 to 90, over 90 days), received this month (a 6-month trend line) and rent this month (a progress bar). A 6-month bar chart that switches between money in and out and invoiced and received (point at a month for exact amounts) beside a Needs attention list; rings for the biggest customers and suppliers this financial year; and the oldest invoices to chase and supplier bills to pay. Everything opens the record or screen behind it. |
| Invoices | Search and status tabs (awaiting payment, overdue, paid, drafts, cancelled). Click a row for details: print Original / Duplicate / Triplicate, edit, record payment, delete. |
| Quotations | Quotations sent to companies: number, date, company, an internal note and the file that was sent (photo, PDF or Word), with the purchase orders that followed. Click a row for details; open a file, edit, delete. |
| Purchase orders | Customers' purchase orders (photo, PDF or Word file), their status (Not started, Partially completed, Completed), an internal note, and the invoices raised against each. Click a row for details; open a file, edit, delete. |
| Payments | Monthly and total receipts, advances held, cheques not yet cleared. Click a row for details, edit or delete. |
| Supplier bills | Bills received from suppliers: number, date, supplier, total, files, and a status worked out from the payments (Not paid, Partially paid, Fully paid). Click a row for details, files and the payments that settled it; record a payment from there. |
| Supplier payments | Money paid to suppliers, one payment across several bills, with write-off and round-off. There are no supplier advances. Click a row for details, edit or delete. |
| Rentals | Three tabs. **This month**: each tenant marked Paid or Not paid for a month (with date, amount and note), totals, and a **Send reminders** window that opens WhatsApp with a fixed message for each tenant who has not paid. **Tenants**: name, place, WhatsApp number, rent, move-in date, files, moved out / back in. **Places**: the properties you rent out, with files. |
| Reminders | Things to do on a date: what, when, how many days before to start showing it, an optional repeat (week, month, last day of the month, year) and an optional link to a record. Tabs Due now / Upcoming / Done. Due reminders also show in a coloured banner at the top of every screen until Done or Dismiss. |
| Customers & suppliers | Every company with a type (Customer, Supplier or Both) and a filter for it; search, frequent star, details with balance due and advance held (customers) or amount owed and supplier bills (suppliers). |
| Settings | Where the data folder is, with a button to open it for backups. |

## Business rules (enforced in Rust)

- **Numbers:** `MWW/26-27/001` for invoices, `PAY/26-27/001` for payments: the Indian financial year (April–March, local time), then the running number. This is the final format. Numbers issued for a while in the swapped `MWW/001/26-27` form keep their number and still count towards the running number.
- **Vehicle number:** checked as an Indian registration (e.g. `TN 09 AB 1234`, `22 BH 1234 AA`) and stored in that spaced form; an older value that fails the check can stay until it is changed.
- **Purchase orders** hold the customer, PO number, PO date, status, an internal note and attached files; the app never reads the files. Files are kept inside the database (table `purchase_order_files`), up to 10 MB each, types JPG/PNG/PDF/DOC/DOCX, checked in Rust by size, extension and the file's first bytes. Status is set only by the owner. A duplicate PO number for the same customer is a warning, not an error.
- **Quotations** hold the customer, a quotation number typed by the owner, a quotation date (required), an internal note and attached files; no status, amounts or items, and the app never reads the files. Files follow the purchase order rules (inside the database, table `quotation_files`, 10 MB, same types and checks). A duplicate quotation number is a warning, not an error, and is checked across **all customers** because the numbers are the owner's own series.
- **Quotation <-> purchase order:** `purchase_orders.quotation_id` (nullable, migration 13). One quotation can have many purchase orders; an order has at most one quotation, and it must be the same customer's. Linking changes nothing printed. An order that keeps its quotation cannot change customer (remove the quotation first, even in the same save), and a quotation with linked orders cannot change customer or be deleted. From the quotation screen only that customer's orders with no quotation yet can be attached; an order tied to another quotation is refused so it never moves silently. A customer with quotations cannot be deleted.
- **Company type:** every company is a Customer, a Supplier or Both (`customers.party_type`, migration 14; existing companies are Customers). Invoices, payments, purchase orders and quotations accept only Customer or Both; supplier bills and supplier payments accept only Supplier or Both (`CustomerRepository::require_party`, called from each save). The type can't be changed to drop a side while records of that side exist (a Both company with invoices and supplier bills can go neither way), and a company with supplier bills or payments can't be deleted.
- **Supplier bills** hold the supplier, the supplier's own bill number (typed; a repeat for the same supplier is a warning only), date, one total amount, an internal note and files (same rules as quotation files). The status is worked out from the payments allocated to the bill, never stored. The total can't go below what is already settled, the supplier can't change once a payment is allocated, and a bill with payments can't be deleted.
- **Supplier payments** (`SP/26-27/001`) mirror customer payments without TDS: one payment can be applied to several of one supplier's bills. **There are no supplier advances** (removed in migration 19, which turned any old advance into a round-off and dropped the advance tables). Paying less can be accepted as full payment (a write-off, never more than what is actually short); paying more is always a round-off (counted as paid, nothing owed back). **There is no limit on a write-off or a round-off.** A payment must be applied to at least one bill. Editing recalculates as if the payment had never been recorded; deleting reopens its bills.
- **Rentals** (migration 16; tables `rental_places`, `rental_tenants`, `rent_months`, `rental_files`) are separate from invoices and companies. A place has at most one **current** tenant (no moved-out date; a partial unique index plus a message), so a new tenant needs the old one marked as moved out first. A tenant is on a month's list from the month they moved in (the month they were added when there is no move-in date) until the month they moved out; a month already marked paid always stays listed. **Paid** means the month's row has a paid date; a month with no row is Not paid. The recorded amount of a paid month never changes when the tenant's rent is edited later. Undoing a payment clears the date, amount and note and keeps the reminder date; a month left with nothing is removed. A place that has had tenants and a tenant with any rent record cannot be deleted (mark the tenant as moved out instead); files go with their place or tenant. Files follow the shared attachment rules (`rental_files`, `owner_kind` PLACE or TENANT, 10 MB, same types and checks).
- **Rent reminders:** the text is fixed: `Hello {name}, this is a reminder for your {Month Year} rent of {amount} for {place}. Please pay at your earliest convenience. Thank you.` (`₹12,000`, but `₹12,000.50`). Numbers are stored as `+` and digits: ten digits starting 6 to 9 become `+91…`, a typed `+` number keeps its country code. The app only opens `https://wa.me/<number>?text=<message>` (percent-encoded UTF-8) in the default program; the owner presses Send in WhatsApp, and nothing is ever sent automatically. Opening the chat with the message ready counts as sending the reminder (WhatsApp never says whether Send was pressed, and the owner chose not to confirm each one): each open is stored in `rent_reminders` (migration 17; migration 18 made earlier unconfirmed ones count as sent) and numbered per tenant and month (first, second follow-up, ...). A history is shown, and asking for another on the day one was sent needs a second press. A tenant who has paid never gets a reminder. Reminders are not rent records: they go with the tenant. Rental data has no PIN or encryption; it is in the same database, so every rental change is tracked in `change_log` and the Google Drive backup includes it.
- **Reminders** (migration 20, table `reminders`) live only inside the app: no Windows notifications, no calendar sync. A reminder has a title, a date (`due_date`), `remind_days` (0–365), `repeat` (NONE/WEEKLY/MONTHLY/YEARLY, monthly with `month_end` for the last day of the month; `repeat_day` keeps the day it was set for so the 31st comes back after a short month and 29 February falls on 28 February) and an optional link (`link_kind` INVOICE, QUOTATION, PURCHASE_ORDER, PAYMENT, SUPPLIER_BILL, SUPPLIER_PAYMENT, COMPANY, TENANT or PLACE + `link_id`). On day T for date D: waiting before D − remind_days, then coming up (amber), due today (orange), overdue (red). The banner shows coming up / due / overdue ones that are not dismissed, overdue first, 3 then "and N more". **Done** finishes a one-time reminder; a repeating one moves one step to its next date (so a missed month is not skipped) and shows again. **Dismiss** only takes it off the banner. A deleted record leaves its reminder with "link removed". Every record's details window (and the tenant and place forms) has **Remind me**, which starts a reminder linked to it. Rules live in `reminders/repository.rs`; date rules in `reminders/schedule.rs`.
- **Invoice <-> purchase order:** `invoices.purchase_order_id` (nullable). One order can have many invoices; an invoice has at most one order, and it must be the same customer's. Linking fills the invoice's "PO number & date" text (`number & dd-mm-yyyy`, or just the number when the order has no date), so the printed invoice is unchanged. Unlinking, or later editing the order, leaves that text alone. An invoice that stays linked cannot change customer; removing the order first (even in the same save) allows it. An order with linked invoices cannot be deleted, and a customer with orders cannot be deleted. Cancelled and draft invoices can be linked.
- **Item descriptions** (invoice lines) can have several lines and a little formatting: select text in the box for a small bar with smaller, larger, bold and italic. They are stored in `invoice_items.description` as text with only `<b>`, `<i>`, `<font size="1-7">` and `<br>`; `util::sanitize_rich_text` (mirrored by `src/lib/richText.ts`) enforces that on save and again when printing, and shows any other `<` as plain text. The PDF template styles those tags.
- **PO / DC numbers** are entered as a number and a date and stored as `number & dd-mm-yyyy`; left empty they print as a dash.
- **TDS** can be entered as a percentage (0.1, 1, 2, 5, 10 or another rate) taken on the amount before GST or on the invoice total, worked out per invoice from the part each invoice is paid; or as a rupee amount. The payment still stores one `tds_amount`.
- **Printing** an invoice: any one copy, all three copies in one PDF, or original + duplicate in one PDF (`generate_invoice_copies_pdf`).
- **Customers** are picked with a type-to-search box (name, city, phone, GSTIN). An invoice shows its customer's details read-only; they are fixed when the customer is created or edited.
- **Tax state** comes from the GSTIN prefix when there is one; the forms warn when it disagrees with the state chosen.
- **Dates** are stored as `YYYY-MM-DD` and shown as `DD-MM-YYYY`.
- **Tax:** CGST + SGST for customers in Puducherry (state code 34), IGST otherwise. The state code comes from the GSTIN or the customer's state. Totals are exact to the paisa, with no round-off to the rupee, and the amount in words includes paise. Migration 11 brought older invoices that were not fully paid to their exact total; fully paid ones keep the total they were settled at, so they do not reopen for a few paise.
- **Invoice edits:** an invoice with payments cannot drop below what has been paid, cannot become Draft or Cancelled, and cannot be deleted.
- **Customers** with invoices or payments cannot be deleted.
- **Payment allocation:** a payment can only be applied to the same customer's Issued invoices, and never more than each invoice's balance or the money available.
- **Leftover money** is kept as an **advance**, marked **refunded**, or **kept as a round-off** (counted as received, nothing owed back, no advance). There is no size limit; the owner chooses.
- **Short payments:** the owner can accept a payment that is a little short as full payment ("Settle in full"). The shortfall is stored on the payment as `writeoff_amount` (migration 10), counts towards settling the invoices like recognised TDS, and has no size limit (the form warns above ₹100). It must equal what is actually short after money received, TDS and any advance used. Deleting the payment reopens the invoices. Advances are used oldest-first by later payments ("Use advance" in the payment form). Deleting or editing a payment gives back any advance it used. A payment whose advance has already been used cannot be deleted until the later payment is removed.

## Code layout

```text
src/                          React UI
  App.tsx                     sidebar + page switching
  components/ui.tsx           Button, Modal, Field, Badge, ConfirmDialog, Toast, ...
  components/invoices/        InvoiceFormModal, InvoiceDetailsModal
  components/payments/        PaymentFormModal, PaymentDetailsModal
  components/customers/       CustomerFormModal, CustomerDetailsModal
  components/purchaseOrders/  PurchaseOrderFormModal, PurchaseOrderDetailsModal, PurchaseOrderStatusBadge
  components/quotations/      QuotationFormModal, QuotationDetailsModal
  components/dashboard/       charts (BarChart, Sparkline, SegmentBar, ProgressBar, ShareRing), ListCard
  components/rentals/         ThisMonthTab, TenantsTab, PlacesTab, MarkPaidModal, TenantFormModal, PlaceFormModal, SendRemindersModal
  components/reminders/       ReminderBanner, ReminderFormModal, RecordReminders, RemindersContext
  components/attachments/     useFileAttachments, FileAttachmentsField, FileViewer (shared by purchase orders, quotations, supplier bills and rentals)
  components/supplierBills/   SupplierBillFormModal, SupplierBillDetailsModal, SupplierBillStatusBadge
  components/supplierPayments/ SupplierPaymentFormModal, SupplierPaymentDetailsModal
  pages/                      Dashboard, Invoices, Quotations, PurchaseOrders, Payments, SupplierBills, SupplierPayments, Rentals, Reminders, Customers, Settings
  services/api.ts             every Tauri command, one function each
  lib/format.ts, lib/gst.ts   money/date formatting, GST state codes
  lib/dashboardStats.ts       monthly sums, age buckets, top names for the dashboard charts
  template/                   invoice HTML + CSS used for the PDF
src-tauri/src/
  lib.rs                      app setup, command list, open PDF / data folder
  util.rs                     dates, rounding, Indian number formatting
  attachments.rs              file rules shared by purchase orders, quotations, supplier bills and rentals (size/type/name checks, upload decoding, temp copies)
  db/migrations.rs            schema migrations 001–020 (each in a transaction)
  customers/ invoices/ payments/   models, repository (rules + SQL), commands
  purchase_orders/ quotations/ supplier_bills/ supplier_payments/   models, repository (rules + SQL), commands
  reminders/                  schedule.rs (dates, repeats, states), models, repository, commands
  rentals/                    models, repository (rules + SQL), commands, plus reminder.rs (the fixed message, number clean-up and WhatsApp link; no SQL)
  pdf/renderer.rs             fills the template and prints it with Edge/Chrome
```

## Data on disk

`%APPDATA%\com.manonmani.app\` — `Database\manonmani.db` (also holds purchase order, quotation, supplier bill and rental files), `Invoices\<year>\<number>_<copy>.pdf`, `Temp\` (short-lived copies of attached files made so they can be opened, named `po_<id>_<name>`, `quotation_<id>_<name>`, `supplier_bill_<id>_<name>` or `rental_<id>_<name>` so the kinds never mix; emptied each time the app starts). The folder name comes from the Tauri identifier; don't change the identifier or the app will start with an empty database.

## Building and running

- `app.bat` — the only launcher: shows a menu, or use `app.bat dev` (`npm run tauri dev`), `app.bat build` (release build), `app.bat open` (start the built app).
- `npm run build` — type-check and build the UI only.

PDF creation needs Microsoft Edge (installed with Windows) or Google Chrome.

## Tests

Rust unit tests live next to the code (`customers/repository.rs`, `invoices/repository.rs`, `payments/repository.rs`, `purchase_orders/repository.rs`, `quotations/repository.rs`, `supplier_bills/repository.rs`, `supplier_payments/repository.rs`, `rentals/repository.rs`, `rentals/reminder.rs`, `reminders/schedule.rs`, `reminders/repository.rs`, `attachments.rs`, `db/migrations.rs`, `util.rs`, `pdf/renderer.rs`). They cover tax maths, number-to-words, migrations, allocation limits, advances, and the delete/edit guards.

On this machine plain `cargo test` builds but the test executable cannot start (`STATUS_ENTRYPOINT_NOT_FOUND`): the MinGW linker can't merge Tauri's Windows manifest into test binaries. Run the Rust tests with `tools\test-harness\test.bat` instead: it compiles the data-layer modules (`db`, `util`, `attachments`, and the `models.rs`/`repository.rs` files of customers, invoices, payments, purchase_orders, quotations, supplier_bills, supplier_payments, rentals, reminders and backup, plus `rentals/reminder.rs` and `backup/snapshot.rs`) in a small crate without Tauri, using `#[path]` modules. Add a new module there when you add one to the app.

## Google Drive backup

- `src-tauri/src/backup/`: `snapshot.rs` (VACUUM INTO copy, integrity check, gzip, hashes), `repository.rs` (change log summary, run history), `drive.rs` (OAuth with PKCE, Credential Manager storage, Drive calls), `commands.rs`.
- Migration 8 adds `change_log` (filled by triggers on every record table) and `backup_runs`. A backup is skipped when nothing changed after the last successful run; the change number only advances after the upload is verified (size and MD5), so interrupted backups lose nothing.
- Every backup is a complete compressed copy and is never overwritten, so earlier versions stay restorable. Restore keeps a `before-restore-*.db` copy in the Backups folder.
- The Google Client ID/secret and refresh token live in Windows Credential Manager, not in the database.
- The data-layer tests run through `tools/test-harness` (see Tests above).
