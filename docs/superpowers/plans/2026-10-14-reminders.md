# Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Reminders" feature: reminders with a date, "remind me N days before", repeat and an optional link to a record, shown in a coloured banner at the top of every screen until Done or Dismiss.

**Architecture:** One new table `reminders` (migration 20) and a Rust `reminders/` module: pure date rules in `schedule.rs`, SQL and rules in `repository.rs`, thin `commands.rs`. React: a `ReminderBanner` in `App.tsx`, a `RemindersPage`, a shared `ReminderFormModal`, and a `RecordReminders` block ("Remind me" + list) dropped into each record's details window or form.

**Tech Stack:** Rust (Tauri 2, rusqlite, chrono), React 19 + TypeScript + Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-14-reminders-design.md`

## Global Constraints

- Inside the app only: no Windows notifications, no Google Calendar, nothing sent anywhere.
- Banner buttons are exactly **Done** and **Dismiss**; no snooze.
- Remind-before choices: 0 ("On the day"), 1, 2, 3, 7, or custom 0–365. Repeat: `NONE`, `WEEKLY`, `MONTHLY`, `YEARLY`; monthly has "last day of the month".
- States: `WAITING` (T < D−N), `COMING_UP` (D−N ≤ T < D, amber), `DUE_TODAY` (T = D, orange), `OVERDUE` (T > D, red). Banner order: overdue first, then by date, then id; shows 3 then "and N more".
- Link kinds: `INVOICE`, `QUOTATION`, `PURCHASE_ORDER`, `PAYMENT`, `SUPPLIER_BILL`, `SUPPLIER_PAYMENT`, `COMPANY`, `TENANT`, `PLACE`. A missing record shows "link removed"; the reminder stays.
- Dates stored `YYYY-MM-DD`, shown `DD-MM-YYYY`; "today" is the PC's local date (`util::today()`, `todayISO()`).
- Schema change only in a new migration 20; never edit an applied one. Table tracked in `change_log`; `RECORD_TABLES` gains `("reminders", "reminder", "reminders")`.
- Never read the real database; tests use temp databases. Rust tests through `tools/test-harness` (add the module there). Baseline: 188 passed. `cargo check` shows no warnings; `npx tsc --noEmit -p .` and `npm run build` pass.
- Branch `feature/reminders`; commit after each task ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push unless asked.

## Review Focus

1. **Month ends and leap years:** monthly from 31 January goes 28/29 February, 31 March; "last day of month" always lands on the last day; yearly 29 February → 28 February, back to 29 in a leap year. Task 2 tests.
2. **Done on a repeating reminder that is weeks overdue** moves to the next date after the *current* due date (one step), not skipping to after today; it shows again next time it is due. Task 3 test `done_moves_a_repeating_reminder_one_step`.
3. **Dismissed repeating reminder** stays off the banner only for that date; Done brings the next one back. Task 3 test.
4. **Linked record deleted** shows "link removed" and never breaks the banner or page. Task 3 test.
5. **Remind-before larger than the gap** (e.g. 7 days before a date 2 days away, or before a past date) shows immediately with the right state; negative or > 365 refused. Tasks 2 and 3 tests.

## File Structure

Create: `src-tauri/src/reminders/{mod,models,schedule,repository,commands}.rs`; `src/types/reminder.ts`; `src/pages/RemindersPage.tsx`; `src/components/reminders/{ReminderBanner,ReminderFormModal,RecordReminders}.tsx`.
Modify: `db/migrations.rs`, `backup/repository.rs`, `lib.rs`, `tools/test-harness/src/lib.rs`, `src/services/api.ts`, `src/App.tsx`, the pages that open records (`PaymentsPage`, `SupplierBillsPage`, `CustomersPage`, `RentalsPage`, `TenantsTab`, `PlacesTab`), the details windows and the tenant/place forms, `docs/PROJECT_STRUCTURE.md`, `AGENTS.md`.

---

### Task 1: Migration 20 and backup tracking

**Files:** Modify `db/migrations.rs`, `backup/repository.rs`.

**Interfaces (produces):** const `REMINDERS_SQL`, `latest_version() == 20`, table:
`reminders(id INTEGER PK AUTOINCREMENT, title TEXT NOT NULL, note TEXT NULL, due_date TEXT NOT NULL CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), remind_days INTEGER NOT NULL DEFAULT 0 CHECK (remind_days BETWEEN 0 AND 365), repeat TEXT NOT NULL DEFAULT 'NONE' CHECK (repeat IN ('NONE','WEEKLY','MONTHLY','YEARLY')), repeat_day INTEGER NULL CHECK (repeat_day BETWEEN 1 AND 31), month_end INTEGER NOT NULL DEFAULT 0 CHECK (month_end IN (0,1)), link_kind TEXT NULL CHECK (link_kind IN (...the nine kinds...)), link_id INTEGER NULL, dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0,1)), done_on TEXT NULL, last_done_on TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`, indexes on `due_date` and `(link_kind, link_id)`, insert/update/delete `change_log` triggers like migration 16.

- [ ] **Step 1: Failing tests** in `db/migrations.rs`: `migration_20_adds_reminders_and_leaves_data_alone` (from `database_at_version_15`: earlier rows counted unchanged, `reminders` empty, `latest_version() == 20`; relax the migration-19 test's `== 19` to `>= 19`); `reminder_rules_in_the_table` (bad date text, `remind_days` 400, repeat `DAILY`, link kind `CAR` each refused; a valid row inserts). In `backup/repository.rs`: `pending_summary_counts_reminders` expects `"1 reminder added"`.
- [ ] **Step 2: Run** `tools\test-harness\test.bat` → FAIL.
- [ ] **Step 3: Implement** the SQL, migration entry `020_reminders`, and the `RECORD_TABLES` line (after rent months).
- [ ] **Step 4: Run** the full suite → all pass.
- [ ] **Step 5: Commit** `feat: migration 20 for reminders`.

---

### Task 2: Date rules (pure)

**Files:** Create `reminders/schedule.rs`, `reminders/mod.rs` (`pub mod schedule;` for now); add the `reminders` module to the test harness and `pub mod reminders;` to `lib.rs`.

**Interfaces (produces):**
- `pub enum Repeat { None, Weekly, Monthly, Yearly }` with `Repeat::parse(&str) -> Result<Repeat, String>` (message `"Choose how often it repeats."`) and `as_str()`.
- `pub fn next_date(current: NaiveDate, repeat: Repeat, repeat_day: u32, month_end: bool) -> Option<NaiveDate>` (`None` for `Repeat::None`; weekly +7 days; monthly to the next month on `repeat_day` capped at the month's last day, or the last day when `month_end`; yearly to the same month next year on `repeat_day` capped).
- `pub enum State { Waiting, ComingUp, DueToday, Overdue }` with `as_str()` = `"WAITING" | "COMING_UP" | "DUE_TODAY" | "OVERDUE"`.
- `pub fn state(due: NaiveDate, remind_days: i64, today: NaiveDate) -> State`.
- `pub fn days_away(due: NaiveDate, today: NaiveDate) -> i64` (negative when late).

- [ ] **Step 1: Failing tests** (`schedule.rs` `mod tests`): `monthly_keeps_its_day_and_caps_short_months` (31 Jan → 28 Feb 2027 → 31 Mar 2027 with `repeat_day` 31; 2028: 31 Jan → 29 Feb); `last_day_of_month_always_lands_on_the_last_day` (30 Apr → 31 May → 30 Jun; 31 Dec 2026 → 31 Jan 2027); `weekly_and_yearly` (+7 days across a month end; 29 Feb 2028 yearly → 28 Feb 2029, `repeat_day` 29 → 29 Feb 2032 after four steps); `no_repeat_has_no_next_date`; `states_follow_the_table` (due 10 Nov, remind 2: 7 Nov `Waiting`, 8 Nov `ComingUp`, 9 Nov `ComingUp`, 10 Nov `DueToday`, 11 Nov `Overdue`; remind 0: 9 Nov `Waiting`; remind 7 on a date 2 days away → `ComingUp`); `repeat_parse` (`"monthly"` ok case-insensitive, `"DAILY"` gives the message).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → all pass. **Step 5: Commit** `feat: reminder date rules`.

---

### Task 3: Reminder repository

**Files:** Create `reminders/models.rs`, `reminders/repository.rs`; `mod.rs` adds them.

**Interfaces (produces):** models (`Debug, Clone, Serialize, Deserialize`):
- `ReminderInput { title: String, note: Option<String>, due_date: String, remind_days: i64, repeat: String, month_end: bool, link_kind: Option<String>, link_id: Option<i64> }`.
- `Reminder { id, title, note, due_date, remind_days, repeat, month_end, link_kind, link_id, link_label: Option<String>, link_missing: bool, dismissed: bool, done_on: Option<String>, last_done_on: Option<String>, state: String, days_away: i64, created_at, updated_at }` (`state` is `"DONE"` for finished one-time reminders).
- `ReminderTab` = `"DUE" | "UPCOMING" | "DONE"` passed as `&str`.

`ReminderRepository`: `create(conn, ReminderInput) -> Result<Reminder, String>`, `update(conn, id, ReminderInput)`, `delete(conn, id) -> Result<(), String>`, `get(conn, id, today: NaiveDate) -> Result<Option<Reminder>, String>`, `list(conn, tab: &str, today) -> Result<Vec<Reminder>, String>` (DUE: not done, state ≠ WAITING, dismissed included, overdue first then date; UPCOMING: not done and WAITING, by date; DONE: one-time finished, newest `done_on` first), `banner(conn, today) -> Result<Vec<Reminder>, String>` (DUE minus dismissed), `for_record(conn, kind: &str, id: i64, today) -> Result<Vec<Reminder>, String>` (not done, by date), `mark_done(conn, id, today) -> Result<Reminder, String>` (one-time: `done_on = today`; repeating: `due_date = next_date(due_date)`, `last_done_on = today`, `dismissed = 0`), `mark_not_done(conn, id)` (clears `done_on`), `set_dismissed(conn, id, dismissed: bool)`.
Rules and exact messages: title trimmed, `"Enter what the reminder is for."`; date via `normalize_date(.., "Date")`; `remind_days` outside 0–365 → `"Remind me can be 0 to 365 days before."`; repeat via `Repeat::parse`; `month_end` only kept for MONTHLY; `repeat_day` = day of `due_date` (31 when `month_end`); link kind outside the nine → `"That record type can't have a reminder."`; a kind without an id or an id without a kind → `"Choose the record to link."`; a link to a missing record on save → `"That record no longer exists."`; unknown id → `"Reminder not found."`. Link labels: INVOICE `invoice_number`, QUOTATION `quotation_number`, PURCHASE_ORDER `po_number`, PAYMENT `payment_number`, SUPPLIER_BILL `bill_number`, SUPPLIER_PAYMENT `payment_number`, COMPANY `customers.name`, TENANT `rental_tenants.name`, PLACE `rental_places.name`; a missing row gives `link_label: None, link_missing: true`.

- [ ] **Step 1: Failing tests:** `create_checks_every_field` (each message above; note and title trimmed; `DD-MM-YYYY` accepted); `states_and_tabs` (fixed `today`; one reminder per state lands in the right tab and `days_away` is right; banner order overdue → today → coming up); `done_finishes_a_one_time_reminder_and_undo_brings_it_back`; `done_moves_a_repeating_reminder_one_step` (monthly due 6 Sep, today 20 Oct: after Done due 6 Oct, still OVERDUE, `last_done_on` today; Done again → 6 Nov, COMING_UP with remind 30 or WAITING with remind 2); `dismiss_hides_from_the_banner_only` (dismissed reminder absent from `banner`, present in DUE with `dismissed: true`; Done on a repeating dismissed one clears `dismissed`; `set_dismissed(false)` returns it); `links_show_a_label_and_survive_deletion` (link to a supplier bill and a tenant: labels; raw-delete the tenant row (no rent records): `link_missing` true, banner still loads; `for_record` returns only that record's open reminders); `month_end_only_for_monthly` (yearly with `month_end` true saves false).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** following `rentals/repository.rs` style. **Step 4: Run** the full suite → all pass; `cargo check` clean. **Step 5: Commit** `feat: reminders repository`.

---

### Task 4: Commands, types, API

**Files:** Create `reminders/commands.rs`, `src/types/reminder.ts`; modify `mod.rs` (`pub mod commands; pub use commands::*;`), `lib.rs`, `src/services/api.ts`.

**Interfaces:** commands (today from `util::today()`): `list_reminders(tab)`, `get_reminder_banner()`, `get_reminders_for_record(link_kind, link_id)`, `create_reminder(input)`, `update_reminder(id, input)`, `delete_reminder(id)`, `mark_reminder_done(id)`, `mark_reminder_not_done(id)`, `set_reminder_dismissed(id, dismissed)`. TS: `ReminderLinkKind` union of the nine kinds, `ReminderRepeat`, `ReminderState`, `ReminderInput`, `Reminder` mirroring Rust; `REMIND_BEFORE_CHOICES = [0, 1, 2, 3, 7]`; API functions `listReminders`, `getReminderBanner`, `getRemindersForRecord`, `createReminder`, `updateReminder`, `deleteReminder`, `markReminderDone`, `markReminderNotDone`, `setReminderDismissed`.

- [ ] **Step 1: Implement.** **Step 2: Verify** `cargo check` no warnings; `npx tsc --noEmit -p .` exit 0. **Step 3: Commit** `feat: reminder commands, types and API`.

---

### Task 5: Reminders page and form

**Files:** Create `src/pages/RemindersPage.tsx`, `src/components/reminders/ReminderFormModal.tsx`; modify `src/App.tsx` (`Page` gains `"reminders"`; nav item "Reminders", icon `BellRing`, after Rentals).

**Interfaces:** `ReminderFormModal({ reminder?: Reminder, link?: { kind: ReminderLinkKind; id: number; label: string }, suggestedTitle?: string, onClose, onSaved })`: What to do (title), Date (default today), Remind me (select: On the day / 1 day before / 2 days before / 3 days before / 1 week before / Custom… with a number field 0–365), Repeat (Does not repeat / Every week / Every month / Every year), "On the last day of each month" checkbox shown for monthly, Note, the linked record shown read-only with a "Remove link" button. Uses `useDiscardGuard`, size `"md"`. `RemindersPage()`: header "Reminders", description "Things to do on a date, shown at the top of the app when they are due."; **New reminder** button; tabs Due now (count) / Upcoming / Done with the sliding-marker pattern; table: State chip (amber/orange/red per Global Constraints, "Dismissed" muted), What, Date + "in 2 days" / "today" / "3 days late", Repeat, Linked to (label, or "link removed"); row actions Done / Not done (Done tab) / Show on banner (dismissed) / Edit / Delete (confirm). Empty states per tab.

- [ ] **Step 1: Write** the page, form and nav. **Step 2: Verify** `tsc` exit 0; `npm run build`. **Step 3: Commit** `feat: reminders page and form`.

---

### Task 6: Top banner and opening linked records

**Files:** Create `src/components/reminders/ReminderBanner.tsx`; modify `src/App.tsx`, `PaymentsPage`, `SupplierBillsPage`, `CustomersPage`, `RentalsPage`, `TenantsTab`, `PlacesTab`.

**Interfaces:** `ReminderBanner({ refreshKey: number, onOpenRecord(kind, id), onOpenAll() })` loads `getReminderBanner()` on mount, when `refreshKey` changes, and every 60 s (so it appears when midnight passes); renders above the page inside `<main>`, `role="region" aria-label="Reminders"`; up to 3 rows (bell icon, state colour stripe, title, `DD-MM-YYYY`, state text, linked label as a link button, **Done**, **Dismiss**), then "and N more" → `onOpenAll`. Done/Dismiss call the API, toast, reload. `App.tsx`: `openRecord(kind, id)` sets the page and a pending id: INVOICE → existing `openInvoiceId`, QUOTATION → `openQuotationId`, PURCHASE_ORDER → `openPurchaseOrderId`, SUPPLIER_PAYMENT → `openSupplierPaymentId`; new props `openId` + `onOpenHandled` for PaymentsPage (payment details), SupplierBillsPage (bill details), CustomersPage (company details), and RentalsPage `openTenantId` / `openPlaceId` (switches to that tab and opens the form). A `remindersVersion` counter in App increments on page change and after any reminder save so the banner refreshes.

- [ ] **Step 1: Write** the banner and the handoffs. **Step 2: Verify** `tsc` exit 0; `npm run build`. **Step 3: Commit** `feat: reminder banner at the top of every screen`.

---

### Task 7: "Remind me" on records

**Files:** Create `src/components/reminders/RecordReminders.tsx`; modify `InvoiceDetailsModal`, `QuotationDetailsModal`, `PurchaseOrderDetailsModal`, `PaymentDetailsModal`, `SupplierBillDetailsModal`, `SupplierPaymentDetailsModal`, `CustomerDetailsModal`, `TenantFormModal` (saved tenants only), `PlaceFormModal` (saved places only).

**Interfaces:** `RecordReminders({ kind, id, label, suggestedTitle, onChanged? })`: a section "Reminders" with a **Remind me** button (bell icon) that opens `ReminderFormModal` with the link and title; lists `getRemindersForRecord` (title, date, state chip, Done). Suggested titles: INVOICE "Follow up payment for {number}", QUOTATION "Follow up quotation {number}", PURCHASE_ORDER "Purchase order {number}", PAYMENT "Payment {number}", SUPPLIER_BILL "Pay supplier bill {number}", SUPPLIER_PAYMENT "Supplier payment {number}", COMPANY "{name}", TENANT "Collect rent from {name}", PLACE "{name}". Saving or Done anywhere bumps the App's `remindersVersion` (pass a callback down through a small React context `RemindersContext { changed(): void; openRecord(kind,id) }` created in App).

- [ ] **Step 1: Write** the component and add it to the nine windows. **Step 2: Verify** `tsc` exit 0; `npm run build`. **Step 3: Commit** `feat: remind me on every record`.

---

### Task 8: Docs and final verification

**Files:** Modify `docs/PROJECT_STRUCTURE.md` (screen row, rules, migrations 001–020, `reminders/` in the layout, test list), `AGENTS.md` (layout + "reminders live only inside the app; no notifications or calendar sync").

- [ ] **Step 1: Update the docs.** **Step 2: Full verification:** harness suite (report count, 0 failed), `cargo check` no warnings, `npx tsc --noEmit -p .`, `npm run build`. **Step 3: Self-review** against the spec and Review Focus; fix what is found. **Step 4: Commit** `docs: reminders in the project guide`. Do not push.
