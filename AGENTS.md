# Mononmani Welding Works — agent instructions

This folder is a **Tauri 2 desktop app** (Rust + SQLite backend, React 19 + TypeScript + Tailwind v4 frontend) for GST invoicing, customers and payments. It is **not** the Figma Make / Vite project described in `../AGENTS.md`; ignore that file here.

## Commands

- Type-check UI: `npm run typecheck`
- Build UI: `npm run build`
- Check Rust: `cargo check --manifest-path src-tauri/Cargo.toml` (needs the WinLibs MinGW `bin` folder first on PATH; see `app.bat`)
- Run app in dev: `app.bat dev` (Vite on port 1420 + Tauri)
- UI unit tests: `npm test` (Vitest + Testing Library, `*.test.ts(x)` next to the code; mock `services/api` rather than Tauri).
- Rust tests: `npm run test:rust` (runs `tools\test-harness\test.bat`; plain `cargo test` builds but the test exe can't start on this machine, MinGW manifest issue; see `docs/PROJECT_STRUCTURE.md`). Add new data-layer modules to `tools/test-harness/src/lib.rs`.
- Load, stress and abuse tests (ten years of sample data, concurrent saves, hostile input): `tools\test-harness\test.bat --release --test load -- --ignored --nocapture --test-threads=1` (`LOAD_SCALE=2` doubles the data).
- Commands run off the UI thread (`#[tauri::command(async)]`) and share one connection: use `state.db.connection()` in commands and keep it only as long as needed (drop it before slow work such as PDF printing).

## Layout

- `src/` React UI: `App.tsx` (sidebar), `pages/`, `components/` (`ui.tsx` is the shared kit), `services/api.ts` (all Tauri commands), `types/`, `lib/` (format, gst, period, payroll, reminders, ...).
- `src-tauri/src/` Rust: `customers/`, `invoices/`, `payments/`, `purchase_orders/`, `quotations/`, `supplier_bills/`, `supplier_payments/`, `rentals/`, `reminders/`, `payroll/`, `documents/` (models, repository with business rules, commands), `db/migrations.rs`, `pdf/renderer.rs`, `util.rs`. The invoice PDF HTML/CSS is in `src-tauri/templates/`.
- Full description and business rules: `docs/PROJECT_STRUCTURE.md`.

## Rules that must hold

- Dates are stored `YYYY-MM-DD`, shown `DD-MM-YYYY`. Money is rounded to paise. Invoice totals are exact to the paisa (no round-off to the rupee); migration 11 brought unpaid older invoices to their exact total; fully paid ones keep the total they were settled at.
- Business rules live in the Rust repositories, not only the UI: allocation limits, advances (credit/refund), round-off and write-off, invoice edit/delete guards, customer delete guard.
- Purchase orders link to invoices through `invoices.purchase_order_id` (same customer only). Linking fills the invoice's `po_number_and_date` text; the invoice PDF template and `pdf/renderer.rs` must not change for it.
- Every company is a Customer, a Supplier or Both (`customers.party_type`). Invoices, payments, purchase orders and quotations accept only Customer or Both; supplier bills and supplier payments only Supplier or Both (`CustomerRepository::require_party`). Supplier write-off and round-off have no size limit; a write-off can never exceed what is actually short. Supplier payments have no advances (removed in migration 19): money paid beyond the bills is a round-off, and a payment must be applied to a bill.
- Rent reminders only open a `https://wa.me/` link with the message typed in; the owner presses Send in WhatsApp. Never add code that sends WhatsApp messages by itself (it breaks WhatsApp's terms). Rental data has no PIN or encryption by the owner's choice and is backed up with the rest of the database (migration 16 and 17 tables are in `change_log` and the backup summary).
- Reminders (the Reminders page and the top banner) live only inside the app: no Windows notifications and no calendar sync. Done on a repeating reminder moves it one step; Dismiss only hides it from the banner; Snooze hides it until a later day (lengths set in Settings, Tomorrow by default).
- Payroll: pay = days × daily wage + OT hours × OT rate + bonus, with the rates copied onto each month. Each month stands alone: paid exactly, or rounded off and finished; an overpaid month is finished by taking it from next month, cash returned or a write-off. No loans, PF/ESI or pay slips. Rules in `payroll/repository.rs`, maths in `payroll/calc.rs`.
- Google Drive backup runs by itself once a day while the app is open and online (`backup/schedule.rs`). Backups from the last two years are never deleted; older ones keep the newest of each month. When Drive is full the app only warns; the owner deletes the oldest backups himself.
- Document Vault (`documents/`, migration 26): the owner's own files in two groups, Important and Keep for Future; any type up to 25 MB except programs and scripts. Files live in the `Documents` folder named by SHA-256, never in the database; the same file is kept once. Each backup uploads new ones first, once each, to the **Mononmani Documents** Drive folder. The app must never delete anything there: `DocumentStore` (`documents/sync.rs`) has no delete on purpose, and `document_drive_copies` is never emptied (not in `change_log`, so noting an upload does not start another backup). Deleting a document removes it from this computer only. Restore, or opening a document missing here, fetches it from Drive and checks its SHA-256.
- Client PCs: only one copy of the app runs (single-instance plugin); a start-up failure or panic shows a Windows message box and writes `%TEMP%\mww_startup_error.log` (`startup.rs`). The installer carries `WebView2Loader.dll` (`src-tauri/windows/`, needed by the MinGW build) and the WebView2 offline installer. Invoice PDFs print through headless Edge, then Chrome, each with its own profile and a 60-second limit; the browser's messages from a failed print go to `%TEMP%\mww_pdf_error.log`. Windows and SQLite errors such as disk full, access denied or file in use get a plain sentence in front on the screen (`src/lib/errors.ts`, applied in `services/api.ts`).
- Puducherry (state code 34) → CGST + SGST; other states → IGST.
- Business name is **Mononmani Welding Works**. Keep the Tauri identifier `com.manonmani.app` (it locates the user's data folder).
- Schema changes go in a new numbered migration in `db/migrations.rs`; never edit an applied one.

## Data and privacy

- The real database lives in `%APPDATA%\com.manonmani.app\Database\manonmani.db` and holds customer details. Don't read it or paste its rows into prompts; use sample data.
- Never commit or print secrets.
