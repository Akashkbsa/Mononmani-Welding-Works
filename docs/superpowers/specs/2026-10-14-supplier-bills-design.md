# Supplier bills and supplier payments — design

Date: 2026-10-14. Status: draft for the owner's review (not yet approved to build).

## Goal

Mononmani Welding Works receives bills from other companies for raw material. The app should record each bill (supplier, the supplier's bill number, date, total, files), show whether it is Not paid, Partially paid or Fully paid, and record the payments made to suppliers, including paying several bills with one payment, settling a bill for a little less or more than its total, and keeping an advance with a supplier.

This is the buying side. It is separate from invoices, payments, purchase orders and quotations, which are the selling side. The chain here is **Supplier bill ← Supplier payment**.

## Decisions made with the owner

- **Names:** sidebar items **Supplier bills** and **Supplier payments** (not "Purchase bills", which sits too close to "Purchase orders", which are orders received from customers). The Customers item becomes **Customers & suppliers**.
- **Companies live in one list.** Each company has a type: **Customer**, **Supplier** or **Both**. Existing companies become Customer. The Customers page shows everyone with a type badge. Invoice, payment, purchase order and quotation pickers show customers (Customer and Both) only. Supplier bill and supplier payment pickers show suppliers (Supplier and Both) only.
- **Supplier bill** holds: supplier, bill number **typed by the owner**, bill date, **total amount** (one figure, no GST split), internal note, files (PDF, Word, photos). **Status is calculated, never typed.**
- **Supplier payments are a separate screen** (like customer Payments): one payment can settle several bills of the same supplier.
- **Built separately and mirrored.** New tables and modules follow the customer Payments rules, written fresh. The customer Payments code is not changed. File rules and file screens are reused from `attachments.rs` and `components/attachments/`.
- **No write-off limit and no round-off limit**, in Rust or in the screens. No warning at any amount. The only rule on a write-off is that it cannot be larger than what is actually short (see Settlement).
- Files are stored inside the database, up to 10 MB each, JPG/JPEG, PNG, PDF, DOC, DOCX, checked in Rust (same as quotations).
- The Google Drive backup behaviour is unchanged; the new tables are included in the existing change log and backup.

## Left out on purpose

Refunds from a supplier, TDS on what is paid, GST or input-credit breakdown, due dates and overdue, a "money is in the bank" flag on supplier payments, a Dashboard tile, reading the files, and printing supplier documents.

## Data

Never edit an applied migration. Two migrations: 14 (company type) and 15 (all supplier tables, so a bill's status can be calculated from the payments as soon as bills exist).

### Migration 14, `014_party_type`
- `customers.party_type TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (party_type IN ('CUSTOMER','SUPPLIER','BOTH'))`, plus an index. Existing rows come out `CUSTOMER`.

### Migration 15, `015_supplier_tables`

Holds the bill tables and the payment tables below.

#### Bills
- `supplier_bills`: `id`, `supplier_id` (NOT NULL, FK customers), `bill_number` (NOT NULL), `bill_date` (TEXT `YYYY-MM-DD`, NOT NULL), `total_amount` (REAL NOT NULL, CHECK > 0), `notes`, `created_at`, `updated_at`. Indexes on `supplier_id` and `bill_number COLLATE NOCASE`.
- `supplier_bill_files`: `id`, `bill_id` (FK `supplier_bills`, `ON DELETE CASCADE`), `file_name`, `mime_type`, `size_bytes`, `data` (BLOB), `created_at`. Index on `bill_id`.
- Insert/update/delete `change_log` triggers for both tables, written like migration 12/13.

#### Payments
- `supplier_payments`: `id`, `payment_number` (TEXT NOT NULL UNIQUE), `supplier_id` (NOT NULL, FK customers), `payment_date`, `payment_method` (default `Bank Transfer`), `reference_number`, `bank_name`, `amount_paid`, `total_settled` (amount paid + written off), `credit_applied`, `excess_amount`, `excess_action` (`NONE` | `CREDIT` | `ROUNDOFF`, CHECK), `writeoff_amount`, `remarks`, `created_at`, `updated_at`.
- `supplier_payment_allocations`: `id`, `payment_id` (FK, `ON DELETE CASCADE`), `bill_id` (FK `supplier_bills`, no cascade), `amount_allocated` (the amount settled on that bill, including any written-off share), `created_at`.
- `supplier_credits` (advances paid to a supplier): `id`, `supplier_id`, `source_payment_id`, `original_amount`, `remaining_amount`, `notes`, `created_at`, `updated_at`.
- `supplier_credit_applications`: `id`, `payment_id` (FK, cascade), `credit_id` (FK, cascade), `amount`, `created_at`.
- Triggers for `supplier_payments`. `supplier_bills` and `supplier_payments` are added to the backup summary list ("supplier bill" / "supplier bills", "supplier payment" / "supplier payments").

Money is REAL, rounded to paise in Rust (`round2`) and compared with the same tolerance the customer payments use. File contents are never selected by list queries.

## Rules (enforced in Rust)

### Company type
1. `party_type` is one of the three values. New companies default to Customer; the company form has a **Type** choice.
2. `list_customers` and `search_customers` take an optional `party` filter: `CUSTOMER` returns Customer and Both, `SUPPLIER` returns Supplier and Both, none returns everyone.
3. **`require_party(conn, company_id, role)`** (in `customers/repository.rs`) refuses a company of the wrong type. It is called by the invoice, payment, purchase order and quotation saves (role customer) and by the supplier bill and supplier payment saves (role supplier). Messages: "This company is a supplier only, so it can't be used for invoices, payments, purchase orders or quotations." and "This company is a customer only, so it can't be used for supplier bills or supplier payments."
4. **Changing the type is guarded.** Removing the customer role (to Supplier) is refused if the company has invoices, payments, purchase orders, quotations or a customer advance. Removing the supplier role (to Customer) is refused if it has supplier bills, supplier payments or a supplier advance. The message names what blocks it and how many.
5. A company with supplier bills or supplier payments cannot be deleted (added to the existing customer delete guard).
6. Adding a company whose name already exists (the existing duplicate check) tells the owner, when the existing one has a different type, to open it and set the type to Both instead of adding it again.

### Supplier bill
7. Bill number required (trimmed). Bill date required, valid, stored `YYYY-MM-DD` (the form defaults to today). Total required, greater than zero, rounded to paise.
8. The supplier must be a Supplier or Both (rule 3).
9. **Duplicate bill number is a warning only**, checked **for the same supplier**, case-insensitive, trimmed, excluding the bill itself. A different supplier may use the same number.
10. **Status is calculated:** `settled` = sum of the bill's allocations. Not paid when `settled` is zero; Fully paid when `total - settled` is within tolerance of zero or less; otherwise Partially paid.
11. The total cannot be lowered below what is already settled ("The total can't be less than ₹X already settled on this bill."). The supplier cannot change once any payment is allocated to the bill.
12. A bill with payments cannot be deleted ("This bill has N payment(s). Remove or edit them first."). A bill with none is deleted with its files.
13. File checks (size, type, real contents), partial-failure behaviour and temp copies follow `attachments.rs`; temp copies are named `supplier_bill_<id>_<name>`.

### Supplier payment (mirrors customer payments)
14. The supplier must be a Supplier or Both. The supplier and payment number cannot change once saved.
15. Payment number: auto `SP/26-27/001` (prefix `SP`, financial year, running number via `doc_number` / `doc_sequence`), editable when creating, unique case-insensitively ("Payment number X is already used.").
16. Fields: date (required), amount paid (≥ 0), method (default Bank Transfer; same list as customer payments), reference or cheque number, bank name, remarks, optional advance to use, optional write-off amount, and the action for any extra.
17. **Allocations:** only the same supplier's bills; amount above zero; not above that bill's outstanding; the same bill not twice. Error texts mirror the customer ones with "bill" for "invoice".
18. **Settlement.** `total_settled = amount_paid + writeoff`. `allocated = sum of allocations`. `credit_needed = max(allocated - total_settled, 0)` must be covered by the supplier's advance (up to the amount the owner chose to use), otherwise "Allocated ₹X is more than the ₹Y paid." (or the advance variant). If `total_settled` and `credit_needed` are both zero: "Enter the amount paid."
19. **Short payment, "accept as full payment" (write-off).** `writeoff` may not exceed the shortfall (`allocated - amount_paid`): "₹X written off is more than the shortfall. Only ₹Y is short." Apart from that there is **no limit and no warning**. Any shortfall not written off must be covered by advance, or the payment is refused.
20. **Extra payment.** `excess = max(total_settled - allocated, 0)`. If there is an extra, the owner chooses `ROUNDOFF` (counted as paid, nothing owed back, no advance) or `CREDIT` (kept as advance with the supplier). The default is `CREDIT`. **No size limit on either.** There is no refund option. With no extra the action is `NONE`.
21. **Advances.** A `CREDIT` extra creates a `supplier_credits` row for that supplier. Later payments use advances oldest first (`supplier_credit_applications` record what was used). A payment with **no bills ticked** is allowed: the whole amount becomes an advance (paying before the bill arrives).
22. **Edit** recalculates as if the payment had never been recorded: its allocations are cleared and its used advances are returned before validation, so the bills it covered stay available. A payment cannot be edited so that its advance falls below what later payments already used.
23. **Delete** removes the payment, its allocations, its advance and returns advances it used; the covered bills go back to Not paid or Partially paid by calculation. It is refused while a later payment has used part of its advance ("₹X of the advance from this payment has already been used by a later payment. Remove that payment first.").

## Backend structure

- **`customers/`**: `Customer`, `CustomerCreateInput`, `CustomerUpdateInput` gain `party_type` (create/update default `CUSTOMER` when absent, so older callers still work). `find_all` / `search` take the party filter. New `require_party`, the type-change guards and the extended delete guard. Commands: `list_customers(party: Option<String>)`, `search_customers(query, party: Option<String>)`.
- **`supplier_bills/`** (`models.rs`, `repository.rs`, `commands.rs`, `mod.rs`): create, update, delete, get, list, duplicate check, summary, file add/remove/read. List row: id, supplier id and name, bill number, date, total, settled, outstanding, status, file count. Filter: query (bill number or supplier), supplier id, status (`ALL`, `NOT_PAID`, `PARTIAL`, `PAID`). Detail: the bill, its files, and the payments settling it (payment id and number, date, method, reference, amount settled). Summary: total outstanding across bills, advances held with suppliers.
- **`supplier_payments/`**: create, update, delete, get, list, next number, unpaid bills for a supplier (on edit, the bills this payment covers stay in the list, with outstanding computed without this payment), the supplier's advances, summary (paid this month, paid in total, advances held). It reads bill balances with its own SQL; `supplier_bills` and `supplier_payments` do not import each other's repositories.
- Commands registered in `lib.rs`: `list_supplier_bills`, `get_supplier_bill`, `create_supplier_bill`, `update_supplier_bill`, `delete_supplier_bill`, `check_duplicate_supplier_bill_number(supplier_id, bill_number, exclude_id)`, `add_supplier_bill_file`, `remove_supplier_bill_file`, `get_supplier_bill_file_preview`, `open_supplier_bill_file`, `get_supplier_bills_summary`, `list_supplier_payments`, `get_supplier_payment`, `create_supplier_payment`, `update_supplier_payment`, `delete_supplier_payment`, `get_next_supplier_payment_number`, `get_unpaid_bills_for_supplier(supplier_id, exclude_payment_id)`, `get_supplier_credits(supplier_id)`, `get_supplier_payments_summary`.

## Screens

- **Customers & suppliers** (the existing Customers page): type badge on each row, a type filter (All; Customers = Customer and Both; Suppliers = Supplier and Both; Both = Both only), the form's Type choice, and in the details window a Supplier section (bills, amount payable, advance paid) for Supplier and Both companies. The invoice section stays for Customer and Both. Search shows everyone.
- **Pickers:** the invoice, payment, purchase order and quotation forms request `CUSTOMER`; the supplier forms request `SUPPLIER`. The shared `CustomerPicker` takes an `ariaLabel` and empty-state text so the supplier pickers say "supplier".
- **Supplier bills page** (sidebar, after Payments): search; tabs All / Not paid / Partially paid / Fully paid; a summary line (total you owe suppliers, advances paid); rows: bill number, supplier, date, total, outstanding, status badge, files.
- **Supplier bill form**: supplier picker with a **New** button (opens the company form with type Supplier or Both, like the invoice form's customer button), bill number with the duplicate warning, date, total, internal note, files (the shared file components). Uses `useDiscardGuard`. Supplier locked once payments exist.
- **Supplier bill details**: fields, files, the payments settling it (click opens the payment), Edit, Delete, and **Record payment** (opens the payment form with the supplier and this bill already chosen).
- **Supplier payments page** (sidebar, after Supplier bills): summary strip, search by number or supplier, list; rows: number, supplier, date, method, amount paid, written off, bills covered. Details: allocations, settlement summary (paid, written off, advance used, extra kept as round-off or advance), Edit, Delete.
- **Supplier payment form**: supplier picker, number, date, amount paid, method, reference or cheque number, bank name; the supplier's open bills with an amount per bill; **Use advance**; a summary (paid, written off, advance used, applied to bills, extra); "Accept as full payment" when short, with the amount filled in and **no warning at any size**; the Round-off / Advance choice when there is an extra; remarks.
- Follow `docs/BRAND.md` and the shared kit in `components/ui.tsx`. Dates shown `DD-MM-YYYY`.
- Sidebar order: Dashboard, Invoices, Quotations, Purchase orders, Payments, Supplier bills, Supplier payments, Customers & suppliers, Settings.

## Errors

Plain-language messages in the existing style: the wrong company type, a type change blocked by records, a company with supplier records cannot be deleted, bill total below what is settled, bill has payments, allocation above the outstanding, other supplier's bill, bill listed twice, write-off more than the shortfall, not enough advance, advance already used, payment number taken, plus the existing file messages.

## Testing

Rust unit tests next to the code, run through the standalone-crate method in `docs/PROJECT_STRUCTURE.md` (plain `cargo test` cannot start on this machine; the harness crate needs `supplier_bills` and `supplier_payments`). Key cases:

- The owner's three cases on a ₹11,550 bill: pay ₹11,500 with a ₹50 write-off → Fully paid; pay ₹11,600 as round-off → Fully paid, no advance; pay ₹11,600 as advance → Fully paid and ₹50 usable on the next bill of that supplier. Larger amounts (₹50,000 write-off, ₹50,000 round-off) are accepted: no limit.
- A write-off larger than the shortfall is refused; a shortfall without write-off or advance is refused.
- Allocation rules: above outstanding, other supplier's bill, same bill twice, one payment across two bills.
- Status: Not paid → Partially paid → Fully paid as payments are added, edited and deleted; deleting a payment reopens its bills.
- Advances: created by `CREDIT`, used oldest first, returned on edit and delete; a used advance blocks deleting its payment; a payment with no bills makes an advance.
- Company type: default Customer; filter results; `require_party` refusal in the invoice, payment, order, quotation, bill and supplier-payment saves; type-change guards both ways; delete guard; duplicate-name hint.
- Bill rules: duplicate number warns per supplier only; total cannot drop below settled; supplier locked after payments; delete blocked with payments, cascades files otherwise; stale ids give "not found" messages.
- Migrations 14 and 15 applied to a **copy** of a database that already has customers, invoices, payments, orders and quotations (never the real database): existing rows unchanged, existing companies are Customer, change-log triggers fire.
- UI: `npx tsc --noEmit -p .` and `npm run build`. The owner checks the screens by hand once.

## Build order

Branch `feature/supplier-bills`. Each stage ends with the full Rust suite, `cargo check`, `tsc` and `npm run build` passing, and a local commit. Nothing is pushed unless the owner asks.

1. **Company type.** Migration 14 and tests; repository rules (filter, `require_party`, guards) and tests; call `require_party` from the existing saves; commands; UI (form Type, page badge and filter, details Supplier section, picker filter).
2. **Supplier bills.** Migration 15 (all supplier tables) and tests; models, repository and tests; commands and `api.ts`; types; page, form and details window; sidebar.
3. **Supplier payments.** Repository (settlement, advances, edit, delete) and tests; commands and `api.ts`; types; page, form and details window; "Record payment" from a bill; sidebar.
4. Update `docs/PROJECT_STRUCTURE.md`.

Delegated workers, if used, get only code and sample data, never the real database.
