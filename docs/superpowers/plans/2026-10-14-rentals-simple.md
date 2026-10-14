# Rentals (simple version) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Rentals" menu where the owner keeps places and tenants (with files), marks each tenant Paid or Not paid for a month, and sends the same rent reminder on WhatsApp to each tenant who has not paid.

**Architecture:** Four new tables in the existing database (migration 16), so the existing backup covers them. A `rentals/` Rust module (models, pure reminder helpers, repository, commands) like `quotations/`. Files reuse `attachments.rs` and `components/attachments/`. WhatsApp reminders are `https://wa.me/<number>?text=<message>` links opened with the system opener; the owner presses Send in WhatsApp.

**Tech Stack:** Rust (Tauri 2, rusqlite), React 19 + TypeScript + Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-14-rentals-simple-design.md`

## Global Constraints

- One sidebar item **Rentals** (icon `House`), placed after Supplier payments and before Customers & suppliers, with three tabs: **This month**, **Tenants**, **Places**. Page title "Rentals", description "Places you rent out, your tenants, and who has paid this month."
- **No PIN, no lock, no encryption.** Rental data sits in the existing database and is backed up by the existing backup. Tracking must exist so a backup runs after any rental change: change-log triggers on all four tables and backup summary lines for places, tenants and rent months.
- The reminder text is fixed: `Hello {name}, this is a reminder for your {Month Year} rent of {amount} for {place}. Please pay at your earliest convenience. Thank you.` where `{amount}` is rupees with the trailing `.00` dropped (`₹12,000`, but `₹12,000.50`).
- WhatsApp numbers are stored as `+` and digits. Ten digits starting 6 to 9 are Indian (`+91`); a typed `+` number keeps its country code. The app never sends anything by itself: it opens the link and the owner presses Send.
- A place has at most one **current** tenant (a tenant with no moved-out date). Guaranteed by a partial unique index and a repository message.
- A tenant is listed for a month `M` (`YYYY-MM`) when their start month (month of move-in date, else the month they were created) is on or before `M`, and they have not moved out before `M`.
- **Paid** means the month's row has a paid date. A month with no row is Not paid.
- Dates `YYYY-MM-DD` stored, `DD-MM-YYYY` shown. Money rounded with `round2`. Files: 10 MB, JPG/PNG/PDF/DOC/DOCX, via `attachments.rs`; temp copies use kind `"rental"`.
- Designed and tested for up to ten tenants; no hard limit, no search or paging needed.
- Never read the real database (`%APPDATA%\com.manonmani.app\Database\manonmani.db`); tests use temp databases.
- Rust tests: `tools\test-harness\test.bat` (PowerShell: put the MinGW `bin` folder from `app.bat` first on PATH, then `cargo test --manifest-path tools/test-harness/Cargo.toml [filter]`). **Baseline: 156 passed.** Crate check `cargo check --manifest-path src-tauri/Cargo.toml` must show no warnings. UI: `npx tsc --noEmit -p .` and `npm run build`.
- Branch `feature/rentals`. Commit locally after each task, message ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **Do not push.**

## Review Focus

1. **A backup must run after a rental change** (triggers on every rental table). Task 1 test.
2. **Month boundaries:** a tenant who moved in mid-year or moved out mid-year appears only in their months; February and year changes (`2026-12` to `2027-01`). Task 4 tests.
3. **Phone numbers:** spaces, dashes, `0` prefix, `+91`, other countries, wrong lengths; Tamil and `₹` in the link are percent-encoded. Task 2 tests.
4. **Already-paid tenants never get a reminder; marking paid twice or undoing leaves a clean state.** Task 4 tests.
5. **Deleting:** a place that has had tenants and a tenant with payments cannot be deleted; files go with what they belong to. Tasks 1, 3 tests.

## File Structure

Create: `src-tauri/src/rentals/{mod,models,reminder,repository,commands}.rs`; `src/types/rental.ts`; `src/pages/RentalsPage.tsx`; `src/components/rentals/{ThisMonthTab,TenantsTab,PlacesTab,TenantFormModal,PlaceFormModal,MarkPaidModal,SendRemindersModal}.tsx`.
Modify: `db/migrations.rs`, `backup/repository.rs`, `lib.rs`, `src/services/api.ts`, `src/App.tsx`, `tools/test-harness/src/lib.rs`, `docs/PROJECT_STRUCTURE.md`.

---

### Task 1: Migration 16 and backup tracking

**Files:** Modify `db/migrations.rs`, `backup/repository.rs`. Tests in both.

**Interfaces:** Produces const `RENTALS_SQL`, `latest_version() == 16`, and:
- `rental_places(id, name NOT NULL, address, monthly_rent REAL NOT NULL DEFAULT 0 CHECK (monthly_rent >= 0), notes, created_at, updated_at)` with a unique index on `name COLLATE NOCASE`.
- `rental_tenants(id, place_id NOT NULL REFERENCES rental_places(id), name NOT NULL, whatsapp_number NOT NULL, monthly_rent REAL NOT NULL CHECK (monthly_rent > 0), move_in_date, moved_out_date, notes, created_at, updated_at)`; index on `place_id`; **partial unique index on `place_id` where `moved_out_date IS NULL`**.
- `rent_months(id, tenant_id NOT NULL REFERENCES rental_tenants(id) ON DELETE CASCADE, month NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'), paid_on, amount, note, reminded_on, created_at, updated_at, UNIQUE(tenant_id, month))`.
- `rental_files(id, owner_kind NOT NULL CHECK (owner_kind IN ('PLACE','TENANT')), owner_id NOT NULL, file_name, mime_type, size_bytes, data BLOB NOT NULL, created_at)` with an index on `(owner_kind, owner_id)`, and triggers that delete a place's or tenant's files when that place or tenant row is deleted.
- Insert/update/delete `change_log` triggers for all four tables, like migration 15. `RECORD_TABLES` gains `("rental_places","rental place","rental places")`, `("rental_tenants","tenant","tenants")`, `("rent_months","rent month","rent months")`.

- [ ] **Step 1: Write failing tests** (a `database_at_version_15` helper holding a customer, an invoice and a supplier bill): `migration_16_adds_rental_tables_and_leaves_existing_data_alone`; `rental_tables_are_tracked_for_backup` (insert a place, a tenant, a rent month and a file; `change_log` has an INSERT row for each table; Review Focus 1); `only_one_current_tenant_per_place` (a second tenant with no moved-out date on the same place fails; one with a moved-out date works; clearing a moved-out date into a clash fails); `rent_month_rules` (a month like `2026-13x` or `November` is refused; the same tenant and month twice is refused); `files_go_with_their_place_or_tenant`; `a_place_with_a_tenant_cannot_be_deleted` (foreign key). Backup: `pending_summary_counts_rentals` expects `"1 rental place added"`, `"1 tenant added"`, `"1 rent month added"` in that order. Relax earlier `latest_version()` equalities to `>=`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the SQL, the migration entry and the three summary entries (after supplier payments).
- [ ] **Step 4: Run the full suite** → all pass.
- [ ] **Step 5: Commit** `feat: migration 16 for rentals`.

---

### Task 2: Reminder helpers (pure functions)

**Files:** Create `rentals/mod.rs` (`pub mod models; pub mod reminder; pub mod repository;` — add repository/models when they exist; start with `pub mod reminder;`), `rentals/reminder.rs`; modify `lib.rs` (`pub mod rentals;`), `tools/test-harness/src/lib.rs` (inline `rentals` module listing `reminder` now, `models` and `repository` as they arrive).

**Interfaces (produces, all `pub`):**
- `normalize_whatsapp_number(raw: &str) -> Result<String, String>` → `"+919876543210"`. Exact error: `"Enter a 10-digit mobile number, or include the country code, like +971 50 123 4567."`
- `month_label(month: &str) -> Result<String, String>` → `"November 2026"`; error `"Month must look like 2026-11."`
- `rent_amount_text(amount: f64) -> String`
- `rent_reminder_text(name: &str, month_label: &str, amount: f64, place: &str) -> String` (the fixed message)
- `whatsapp_link(number: &str, message: &str) -> String` → `https://wa.me/<digits only>?text=<percent-encoded UTF-8>`

- [ ] **Step 1: Write failing tests:** `numbers_are_normalised` (`"98765 43210"`, `"098765-43210"`, `"+91 98765 43210"`, `"919876543210"`, `"(98765) 43210"` all give `+919876543210`; `"+971 50 123 4567"` gives `+971501234567`; `"12345"`, `"5876543210"` (starts with 5), `"+0123456789"`, `""`, `"abcdefghij"` and 16 digits are refused with the exact message; Review Focus 3); `month_labels` (`2026-11` → `November 2026`, `2027-01` → `January 2027`, `2026-13`, `2026-00`, `26-11`, `2026-1` refused); `amounts_drop_empty_paise` (`12000.0` → `₹12,000`, `12000.5` → `₹12,000.50`, `1250000.0` → `₹12,50,000`); `the_message_is_fixed` (exact full sentence for `"Ravi"`, `"November 2026"`, `12000.0`, `"Flat 2B"`); `links_are_percent_encoded` (starts `https://wa.me/919876543210?text=`, contains no space, `+`, `₹`, `#` or newline; spaces are `%20`; a Tamil name round-trips by percent-decoding to the original UTF-8 text; the number part has no `+`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Percent-encode every byte not in `A-Za-z0-9-_.~`. Use `util::indian_number` for amounts.
- [ ] **Step 4: Run the full suite** → all pass. `cargo check` clean.
- [ ] **Step 5: Commit** `feat: rent reminder message and WhatsApp link helpers`.

---

### Task 3: Places, tenants and files (repository)

**Files:** Create `rentals/models.rs`, `rentals/repository.rs`; update `mod.rs` and the harness entry.

**Interfaces (produces):** models (`Debug, Clone, Serialize, Deserialize`): `Place { id, name, address: Option<String>, monthly_rent, notes: Option<String>, created_at, updated_at }`; `PlaceInput { name, address, monthly_rent, notes }`; `PlaceListItem { id, name, address, monthly_rent, current_tenant: Option<String>, file_count: i64 }`; `PlaceDetail { place, files: Vec<RentalFileInfo> }`; `Tenant { id, place_id, place_name, name, whatsapp_number, monthly_rent, move_in_date: Option<String>, moved_out_date: Option<String>, notes, created_at, updated_at }`; `TenantInput { place_id, name, whatsapp_number, monthly_rent, move_in_date: Option<String>, notes }`; `TenantListItem { id, place_id, place_name, name, whatsapp_number, monthly_rent, move_in_date, moved_out_date, file_count }`; `TenantDetail { tenant, files }`; `RentalFileInfo { id, file_name, mime_type, size_bytes }`.
`RentalRepository` (unit struct): `create_place(conn, PlaceInput) -> Result<PlaceDetail, String>`, `update_place(conn, id, PlaceInput)`, `delete_place(conn, id) -> Result<(), String>`, `get_place(conn, id) -> Result<Option<PlaceDetail>, String>`, `list_places(conn) -> Result<Vec<PlaceListItem>, String>` (by name); `create_tenant(conn, TenantInput) -> Result<TenantDetail, String>`, `update_tenant(conn, id, TenantInput)`, `set_moved_out(conn, id, moved_out_date: Option<&str>) -> Result<TenantDetail, String>` (`None` moves them back in), `delete_tenant(conn, id)`, `get_tenant(conn, id) -> Result<Option<TenantDetail>, String>`, `list_tenants(conn, include_moved_out: bool) -> Result<Vec<TenantListItem>, String>` (current first, then by name); `add_file(conn, owner_kind: &str, owner_id: i64, file_name: &str, bytes: &[u8]) -> Result<RentalFileInfo, String>`, `remove_file(conn, file_id)`, `read_file(conn, file_id) -> Result<(String, String, Vec<u8>), String>`.
Exact messages: `"Place name is required."`, `"A place with this name already exists."`, `"Monthly rent can't be negative."`, `"Place not found."`, `"Tenant name is required."`, `"Choose the place."`, `"Monthly rent must be more than zero."`, `"Move-in date is not a valid date."`, `"This place already has a current tenant. Mark that tenant as moved out first."`, `"Tenant not found."`, `"Moved-out date is not a valid date."`, `"The moved-out date can't be before the move-in date."`, `"This place has had tenants, so it can't be deleted."`, `"This tenant has rent records, so they can't be deleted. Mark them as moved out instead."`, `"That file is no longer there."`, `"Owner must be PLACE or TENANT."`. Tenants' numbers use `normalize_whatsapp_number`; names, address and notes are trimmed; blank address/notes become none.

- [ ] **Step 1: Write failing tests** (helpers `place(conn, name, rent)`, `tenant_input(place_id, name, number, rent)`): `places_need_a_unique_name_and_a_sensible_rent`; `tenants_need_a_name_place_number_and_rent` (all messages; number stored as `+91…`; move-in `"05-10-2026"` stored `2026-10-05`); `one_current_tenant_per_place` (exact message; allowed after the first moves out; moving back in while the place is taken gives the same message; changing a tenant's place to a taken one is refused); `moving_out_and_back` (date validated and not before move-in; `None` clears it); `list_places_shows_the_current_tenant_and_vacancy`; `a_place_that_has_had_tenants_cannot_be_deleted` (also when the tenant has moved out; an empty place deletes with its files); `a_tenant_with_rent_records_cannot_be_deleted` (raw-insert a `rent_months` row; a tenant with none deletes with their files; Review Focus 5); `files_follow_the_shared_rules` (PLACE and TENANT, add/read/remove, a fake PDF refused, a bad owner kind refused, a missing owner gives its "not found" message, second remove gives `"That file is no longer there."`, counts show in lists).
- [ ] **Step 2: Run** → FAIL (does not compile).
- [ ] **Step 3: Implement**, following `quotations/repository.rs` for structure and files.
- [ ] **Step 4: Run the full suite** → all pass. `cargo check` clean.
- [ ] **Step 5: Commit** `feat: rental places, tenants and files`.

---

### Task 4: Rent months, paid status and reminders

**Files:** Modify `rentals/models.rs`, `rentals/repository.rs`.

**Interfaces (produces):** models: `MonthRow { tenant_id, tenant_name, place_name, whatsapp_number, rent_amount: f64, paid: bool, paid_on: Option<String>, paid_amount: Option<f64>, note: Option<String>, reminded_on: Option<String> }`; `MonthSummary { paid_count: i64, total_count: i64, collected: f64, pending: f64 }`; `MonthOverview { month: String, rows: Vec<MonthRow>, summary: MonthSummary }`; `MarkPaidInput { tenant_id, month, paid_on: String, amount: Option<f64>, note: Option<String> }`; `RentReminder { tenant_id, tenant_name, number: String, message: String, link: String }`.
`RentalRepository`: `month_overview(conn, month: &str) -> Result<MonthOverview, String>` (rows by tenant name; `rent_amount` is the recorded amount for a paid month, else the tenant's current rent; `collected` = sum of paid amounts; `pending` = sum of unpaid rents), `mark_paid(conn, MarkPaidInput) -> Result<(), String>` (amount defaults to the tenant's rent; upsert), `undo_paid(conn, tenant_id, month) -> Result<(), String>` (clears paid date, amount and note; keeps `reminded_on`), `reminder_for(conn, tenant_id, month) -> Result<RentReminder, String>`, `stamp_reminded(conn, tenant_id, month, date: &str) -> Result<(), String>`.
Messages: `"That tenant is not on the list for that month."`, `"Amount must be more than zero."`, `"Date paid is not a valid date."`, `format!("{} has already paid for {}.", name, month_label)`; month text via `month_label` (`"Month must look like 2026-11."`).

- [ ] **Step 1: Write failing tests:** `a_tenant_is_listed_only_for_their_months` (moves in 2026-09-10, moves out 2026-10-05: listed in 2026-09 and 2026-10, not 2026-08 or 2026-11; one with no move-in date appears from the month they were created, i.e. via a created-at set to a known month; December to January works; Review Focus 2); `new_months_start_unpaid` (no rows; `paid_count 0`, `pending` = sum of rents); `mark_paid_records_date_amount_and_note` (default amount = rent; custom amount kept; `collected` and `pending` follow; marking twice replaces, never duplicates); `undo_returns_to_not_paid_and_keeps_the_reminder_date`; `marking_a_month_the_tenant_is_not_on_is_refused`; `later_rent_changes_do_not_rewrite_paid_months` (update the tenant's rent; the paid month shows the old recorded amount, an unpaid month shows the new rent); `reminders_are_for_unpaid_tenants_only` (`reminder_for` on a paid tenant gives the exact "has already paid" message; unpaid gives the fixed message, the `+91…` number and a `wa.me` link; after `undo_paid` it works again; Review Focus 4); `stamping_a_reminder_sets_the_date_without_marking_paid`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** "Start month" is `substr(COALESCE(move_in_date, created_at), 1, 7)`; the end month is `substr(moved_out_date, 1, 7)`. Create the `rent_months` row on first mark or stamp.
- [ ] **Step 4: Run the full suite** → all pass. `cargo check` clean.
- [ ] **Step 5: Commit** `feat: rent months, paid status and reminders`.

---

### Task 5: Commands, TypeScript types and API

**Files:** Create `rentals/commands.rs`, `src/types/rental.ts`; modify `rentals/mod.rs` (`pub mod commands; pub use commands::*;`), `lib.rs` (register), `src/services/api.ts`.

**Interfaces:** Tauri commands (thin wrappers over `RentalRepository`, errors pass through): `list_rental_places`, `get_rental_place(id)`, `create_rental_place(input)`, `update_rental_place(id, input)`, `delete_rental_place(id)`, `list_rental_tenants(include_moved_out: bool)`, `get_rental_tenant(id)`, `create_rental_tenant(input)`, `update_rental_tenant(id, input)`, `set_rental_tenant_moved_out(id, moved_out_date: Option<String>)`, `delete_rental_tenant(id)`, `get_rent_month_overview(month)`, `mark_rent_paid(input)`, `undo_rent_paid(tenant_id, month)`, `get_rent_reminder(tenant_id, month) -> RentReminder`, `open_rent_reminder(tenant_id, month) -> RentReminder` (builds the reminder, refuses unless the link starts with `https://wa.me/`, opens it with `tauri_plugin_opener::open_url`, then stamps today's date), `add_rental_file(owner_kind, owner_id, file_name, data_base64)`, `remove_rental_file(file_id)`, `get_rental_file_preview(file_id)`, `open_rental_file(file_id)` (`prepare_temp_copy(..., "rental", ...)`).
TS interfaces mirror the Rust models (`RentalFileInfo = AttachmentInfo`); API functions: `listRentalPlaces`, `getRentalPlace`, `createRentalPlace`, `updateRentalPlace`, `deleteRentalPlace`, `listRentalTenants(includeMovedOut = false)`, `getRentalTenant`, `createRentalTenant`, `updateRentalTenant`, `setRentalTenantMovedOut(id, date | null)`, `deleteRentalTenant`, `getRentMonthOverview(month)`, `markRentPaid(input)`, `undoRentPaid(tenantId, month)`, `getRentReminder(tenantId, month)`, `openRentReminder(tenantId, month)`, `addRentalFile(ownerKind, ownerId, fileName, dataBase64)`, `removeRentalFile`, `getRentalFilePreview`, `openRentalFile`. Tauri arguments are camelCase in JS.

- [ ] **Step 1: Implement** commands, registration, types and API.
- [ ] **Step 2: Verify.** `cargo check` no warnings; `npx tsc --noEmit -p .` exit 0.
- [ ] **Step 3: Commit** `feat: rental commands, types and API`.

---

### Task 6: Rentals page and the This month tab

**Files:** Create `src/pages/RentalsPage.tsx`, `src/components/rentals/ThisMonthTab.tsx`, `MarkPaidModal.tsx`; modify `src/App.tsx` (`Page` gains `"rentals"`; nav item "Rentals", icon `House`, after Supplier payments).

**Interfaces:** `RentalsPage()`: header per Global Constraints; three tabs (the sliding-marker tab pattern from `SupplierBillsPage`) rendering `ThisMonthTab`, `TenantsTab`, `PlacesTab` (the last two arrive in Tasks 7 and 8; until then they render a short placeholder text, replaced in those tasks). `ThisMonthTab()`: month state `YYYY-MM` (starts at today's month); previous/next buttons; heading like "November 2026"; a 3-cell `StatStrip` (Paid "2 of 4", Collected, Pending); a table (Tenant, Place, Rent, Status, actions). Status is a green "Paid" with the date or an amber "Not paid" plus "Reminder opened 3 Nov" in small text when `reminded_on` is set. Actions: **Mark paid** (opens `MarkPaidModal`) or **Undo**. The header button **Send reminders (N)** is added in Task 9. Empty state when there are no tenants: "No tenants yet. Add places and tenants in the other tabs." `MarkPaidModal({ row, month, onClose, onSaved })`: Date paid (today), Amount (the rent), Note; error text from the backend.

- [ ] **Step 1: Write the components and wiring**, using the shared kit as the other pages do.
- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .` exit 0; `npm run build`.
- [ ] **Step 3: Commit** `feat: rentals page and this month tab`.

---

### Task 7: Tenants tab

**Files:** Create `src/components/rentals/TenantsTab.tsx`, `TenantFormModal.tsx`; modify `RentalsPage.tsx`.

**Interfaces:** `TenantsTab()`: list (Name, Place, WhatsApp number shown as `+91 98765 43210`, Rent, Move-in date, Files, a "Moved out" badge), a "Show moved out" checkbox, a **New tenant** button, rows open the form. Empty state. `TenantFormModal({ tenantId?, onClose, onSaved })`: Place (select of all places; shows "(has a tenant)" on taken ones), Name, WhatsApp number (hint "10-digit mobile, or +country code"), Monthly rent (fills from the place's rent when a place is chosen and the field is empty), Move-in date, Notes, **Files** (`FileAttachmentsField` + `useFileAttachments` with `addRentalFile("TENANT", ...)`), and for a saved tenant: **Mark moved out** (a date, default today) or **Move back in**, and **Delete** (confirm; shows the backend message if refused). Uses `useDiscardGuard`. Partial file failure toast as in the other forms.

- [ ] **Step 1: Write the components and wiring.**
- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .` exit 0; `npm run build`.
- [ ] **Step 3: Commit** `feat: rentals tenants tab`.

---

### Task 8: Places tab

**Files:** Create `src/components/rentals/PlacesTab.tsx`, `PlaceFormModal.tsx`; modify `RentalsPage.tsx`.

**Interfaces:** `PlacesTab()`: list (Name, Address, Rent, Current tenant or "Vacant", Files), **New place**, rows open the form. `PlaceFormModal({ placeId?, onClose, onSaved })`: Name, Address, Usual monthly rent, Notes, **Files** (`addRentalFile("PLACE", ...)`), **Delete** for a saved place (confirm; backend refusal shown). Same discard guard and file behaviour as the tenant form.

- [ ] **Step 1: Write the components and wiring.**
- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .` exit 0; `npm run build`.
- [ ] **Step 3: Commit** `feat: rentals places tab`.

---

### Task 9: Send reminders

**Files:** Create `src/components/rentals/SendRemindersModal.tsx`; modify `ThisMonthTab.tsx`.

**Interfaces:** `SendRemindersModal({ month, rows, onClose, onChanged })`: lists the unpaid rows. Each row shows the tenant, their number and the message preview, with **Send on WhatsApp** (calls `openRentReminder`, then shows "Opened ✓" and the date, and calls `onChanged` to refresh) and **Copy message** (clipboard, toast "Message copied"). Text at the top: "WhatsApp opens with the message ready. Press Send in WhatsApp for each tenant." If WhatsApp cannot be opened the backend error is shown in the row. `ThisMonthTab`'s header button reads `Send reminders (N)` with N unpaid; with none it reads "Everyone has paid" and is disabled. For a past month it still works for that month (the message names that month).

- [ ] **Step 1: Write the component and wiring.**
- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .` exit 0; `npm run build`.
- [ ] **Step 3: Commit** `feat: send rent reminders on WhatsApp`.

---

### Task 10: Docs and final verification

**Files:** Modify `docs/PROJECT_STRUCTURE.md` (Rentals in the screens table and rules; migration range 001–016; `rentals/` in the layout; temp name `rental_<id>_<name>`; test harness note lists `rentals`).

- [ ] **Step 1: Update the docs.**
- [ ] **Step 2: Full verification:** harness suite (report the count, 0 failed), `cargo check` (no warnings), `npx tsc --noEmit -p .`, `npm run build`.
- [ ] **Step 3: Self-review the branch** against the spec and Review Focus; fix anything found.
- [ ] **Step 4: Commit** `docs: rentals in the project guide`. Do not push.
