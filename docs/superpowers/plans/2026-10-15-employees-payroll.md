# Employees and Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Employees screen where the owner keeps employees, types each person's days and OT hours once a month, records advances and salary, and finishes each month exactly or with a round-off.

**Architecture:** A new Rust module `payroll/` in the same shape as `rentals/`. `calc.rs` holds the pure maths and date rules (no SQL), `repository.rs` holds the business rules and SQL, and `commands.rs` is a thin Tauri layer. Migration 22 adds four tables. The React side adds `EmployeesPage` with a Pay sheet tab and an Employees tab, the details windows, and wages added to the dashboard's "Paid out" bars.

**Tech Stack:** Rust (rusqlite 0.32, chrono, serde), Tauri 2, React 19 + TypeScript + Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-15-employees-payroll-design.md`. Read it first; rule numbers below ("rule 7") refer to it.

## Global Constraints

- Dates are stored `YYYY-MM-DD` and shown `DD-MM-YYYY`; months are `YYYY-MM`. Money is rounded to the paisa with `util::round2` (Rust) or `round2` from `src/lib/format.ts` (UI).
- Schema changes go only in the new migration 22 in `src-tauri/src/db/migrations.rs`. Never edit an applied migration's SQL.
- Business rules live in `payroll/repository.rs`, not only in the UI. The UI previews numbers; Rust decides.
- Repository functions that need "today" take `today: &str` (`YYYY-MM-DD`), and commands pass `util::today().format("%Y-%m-%d").to_string()`. Tests use `const TODAY: &str = "2026-10-15";`.
- The error strings quoted in tests are the exact user-facing text. Keep them word for word.
- Don't read the real database in `%APPDATA%\com.manonmani.app\`. Use sample data only.
- UI: components are default exports; use double quotes for strings with apostrophes; reuse `src/components/ui.tsx` (Modal, Button, Field, Badge, ConfirmDialog, useToast, rowProps, theadClass), `MonthFilter`, `usePageShortcuts`, `useFileAttachments`, `FileAttachmentsField`, `FileViewer`.
- Payment methods come from `PAYMENT_METHODS` in `src/types/payment.ts`; wages default to `"Cash"`.
- Rust tests run with `tools\test-harness\test.bat <filter>` (plain `cargo test` can't start on this machine). `cargo check` needs MinGW on PATH, as in `test.bat`:
  `set "PATH=C:\Users\Asus\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;%PATH%" && cargo check --manifest-path src-tauri/Cargo.toml`
  If `app.bat dev` is running, add `--target-dir %TEMP%\mww-check` so the running app's build folder isn't locked.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on a new branch `feature/payroll` created from `feature/dashboard` (Task 1, Step 1).

## Review Focus

1. **Leftover floating-point fractions leave a settled month showing "To pay ₹0.00".** Sums of rounded lines (433.33 × 3 + 1.75 × 66.67, minus advances of 0.10 and 0.20) must give a balance of exactly `0.0` and status `PAID`. Pinned in Task 2 (`status_ignores_float_dust`) and Task 5 (`float_dust_does_not_leave_a_paisa_open`).
2. **Text, a negative number or an empty box typed in Enter days.** An empty Days box skips the row; text, a negative number or a quarter day shows an inline error on that box and disables Save. Nothing is ever sent to Rust as `NaN` or `null`. Pinned in Task 10, Step 4 (manual checks a–c).
3. **Editing the payment that finished a month.** Changing its amount recalculates the round-off as if the payment weren't there, so the month stays Paid. Changing an earlier advance instead reopens the month. Pinned in Task 5 (`editing_the_finishing_payment_keeps_the_month_paid`).
4. **Saving the whole sheet when one row is wrong, or names someone who isn't on that month.** Nothing is saved, and the error names the employee. Pinned in Task 4 (`saving_the_whole_sheet_is_all_or_nothing`).
5. **A badly formed month ("2026-13", "2026-1", "") from a stale UI or a typo.** It gives the clear error `Month must look like 2026-11.`, never a crash or a wrong month. Pinned in Task 2 (`months_are_checked_and_stepped`) and Task 4 (`pay_sheet` with "2026-13").

---

### Task 1: Migration 22 and backup summary

**Files:**
- Modify: `src-tauri/src/db/migrations.rs` (add `PAYROLL_SQL`, add `Migration { version: 22, name: "022_payroll", sql: PAYROLL_SQL }`; in test `migration_21_adds_whatsapp_columns_and_leaves_data_alone` change `assert_eq!(latest_version(), 21)` to `assert!(latest_version() >= 21)`; add tests)
- Modify: `src-tauri/src/backup/repository.rs` (`RECORD_TABLES` plus a test)

**Interfaces:**
- Produces: tables `employees`, `pay_months`, `employee_payments` and `employee_files`, exactly as in the spec's Data section, with `GLOB` checks on dates (`'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`) and months (`'[0-9][0-9][0-9][0-9]-[0-9][0-9]'`) like `reminders`, the spec's indexes, and `change_log` insert/update/delete triggers on all four tables (copy the `trg_reminders_*_log` pattern). `employee_files.employee_id` is `ON DELETE CASCADE`; `pay_months` and `employee_payments` reference `employees(id)` without cascade.
- Produces: `RECORD_TABLES` gains, appended at the end in this order: `("employees", "employee", "employees")`, `("pay_months", "pay month", "pay months")`, `("employee_payments", "wage payment", "wage payments")`.

- [ ] **Step 1: Create the branch**

Run: `git switch -c feature/payroll`
Expected: `Switched to a new branch 'feature/payroll'`

- [ ] **Step 2: Write the failing tests in `migrations.rs`'s test module**

```rust
#[test]
fn migration_22_adds_payroll_tables_and_leaves_data_alone() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open(&database_at_version_15(dir.path()));
    assert_eq!(latest_version(), 22);
    for table in ["employees", "pay_months", "employee_payments", "employee_files"] {
        let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "{}", table);
    }
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM customers", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn payroll_rules_in_the_tables() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open(&database_at_version_15(dir.path()));
    conn.execute("INSERT INTO employees (name, joined_on, daily_wage, ot_rate, created_at, updated_at) VALUES ('Murugan', '2026-01-01', 600, 80, 'x', 'x')", []).unwrap();
    let pm = "INSERT INTO pay_months (employee_id, month, days_worked, daily_wage, created_at, updated_at) VALUES (1, '2026-10', 26, 600, 'x', 'x')";
    conn.execute(pm, []).unwrap();
    assert!(conn.execute(pm, []).is_err(), "one row per employee per month");
    let pay = |kind: &str, round_off: f64, carried_to: Option<&str>, amount: f64| {
        conn.execute(
            "INSERT INTO employee_payments (employee_id, month, kind, entry_date, amount, round_off, carried_to, created_at, updated_at)
             VALUES (1, '2026-10', ?1, '2026-10-15', ?2, ?3, ?4, 'x', 'x')",
            params![kind, amount, round_off, carried_to],
        )
    };
    assert!(pay("LOAN", 0.0, None, 100.0).is_err());
    assert!(pay("CARRIED", 0.0, None, 100.0).is_err());
    assert!(pay("ADVANCE", 0.0, Some("2026-11"), 100.0).is_err());
    assert!(pay("ADVANCE", 5.0, None, 100.0).is_err());
    assert!(pay("ADVANCE", 0.0, None, 0.0).is_err());
    assert!(pay("SALARY", -40.0, None, 100.0).is_ok());
    assert!(pay("CARRIED", 0.0, Some("2026-11"), 100.0).is_ok());
    conn.execute("INSERT INTO employee_files (employee_id, file_name, mime_type, size_bytes, data, created_at) VALUES (1, 'a.pdf', 'application/pdf', 1, x'00', 'x')", []).unwrap();
    assert!(conn.execute("DELETE FROM employees WHERE id = 1", []).is_err(), "pay records keep the employee");
    conn.execute_batch("DELETE FROM employee_payments; DELETE FROM pay_months; DELETE FROM employees;").unwrap();
    let files: i64 = conn.query_row("SELECT COUNT(*) FROM employee_files", [], |r| r.get(0)).unwrap();
    assert_eq!(files, 0, "files go with the employee");
}

#[test]
fn payroll_tables_log_changes() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open(&database_at_version_15(dir.path()));
    conn.execute_batch(
        "INSERT INTO employees (name, joined_on, daily_wage, created_at, updated_at) VALUES ('Murugan', '2026-01-01', 600, 'x', 'x');
         INSERT INTO pay_months (employee_id, month, days_worked, daily_wage, created_at, updated_at) VALUES (1, '2026-10', 26, 600, 'x', 'x');
         INSERT INTO employee_payments (employee_id, month, kind, entry_date, amount, created_at, updated_at) VALUES (1, '2026-10', 'ADVANCE', '2026-10-15', 500, 'x', 'x');
         INSERT INTO employee_files (employee_id, file_name, mime_type, size_bytes, data, created_at) VALUES (1, 'a.pdf', 'application/pdf', 1, x'00', 'x');
         UPDATE employees SET notes = 'n'; UPDATE pay_months SET note = 'n'; UPDATE employee_payments SET note = 'n'; UPDATE employee_files SET file_name = 'b.pdf';
         DELETE FROM employee_files; DELETE FROM employee_payments; DELETE FROM pay_months; DELETE FROM employees;",
    )
    .unwrap();
    for table in ["employees", "pay_months", "employee_payments", "employee_files"] {
        let ops: Vec<String> = conn
            .prepare("SELECT op FROM change_log WHERE table_name = ?1 ORDER BY seq").unwrap()
            .query_map(params![table], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(ops, vec!["INSERT", "UPDATE", "DELETE"], "{}", table);
    }
}
```

- [ ] **Step 3: Write the failing test in `backup/repository.rs`**

```rust
#[test]
fn pending_summary_counts_payroll() {
    let (_d, conn) = setup();
    let before = BackupRepository::max_seq(&conn).unwrap();
    conn.execute_batch(
        "INSERT INTO employees (name, joined_on, daily_wage, created_at, updated_at) VALUES ('Murugan', '2026-01-01', 600, 'x', 'x');
         INSERT INTO pay_months (employee_id, month, days_worked, daily_wage, created_at, updated_at) VALUES (1, '2026-10', 26, 600, 'x', 'x');
         INSERT INTO employee_payments (employee_id, month, kind, entry_date, amount, created_at, updated_at) VALUES (1, '2026-10', 'ADVANCE', '2026-10-15', 500, 'x', 'x');",
    )
    .unwrap();
    let p = BackupRepository::pending_changes(&conn, before).unwrap();
    assert_eq!(p.lines, vec!["1 employee added", "1 pay month added", "1 wage payment added"]);
}
```

- [ ] **Step 4: Run them to make sure they fail**

Run: `tools\test-harness\test.bat payroll` and `tools\test-harness\test.bat pending_summary_counts_payroll`
Expected: FAIL (`latest_version()` is 21; `no such table: employees`).

- [ ] **Step 5: Add `PAYROLL_SQL`, migration 22 and the `RECORD_TABLES` lines; relax the migration 21 assertion**

- [ ] **Step 6: Run all the tests**

Run: `tools\test-harness\test.bat`
Expected: all pass (210 existing + 4 new).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/migrations.rs src-tauri/src/backup/repository.rs
git commit -m "feat: payroll tables (migration 22) in the backup summary" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pay maths and month rules (`payroll/calc.rs`)

**Files:**
- Create: `src-tauri/src/payroll/mod.rs` (for now `pub mod calc; pub mod models;`)
- Create: `src-tauri/src/payroll/models.rs` (the full set of types below; Tasks 3–5 use them)
- Create: `src-tauri/src/payroll/calc.rs` (functions + `#[cfg(test)] mod tests`)
- Modify: `src-tauri/src/lib.rs` (`pub mod payroll;` after `pub mod payments;`)
- Modify: `tools/test-harness/src/lib.rs` (add `pub mod payroll { #[path = "../../../../src-tauri/src/payroll/models.rs"] pub mod models; #[path = "../../../../src-tauri/src/payroll/calc.rs"] pub mod calc; }`)

**Interfaces:**
- Produces, in `models.rs`, all `#[derive(Debug, Clone, Serialize, Deserialize)]`; `f64` money; `Option<String>` for optional text:
  - `Employee { id: i64, name: String, role, phone, address: Option<String>, joined_on: String, left_on: Option<String>, daily_wage: f64, ot_rate: f64, notes: Option<String>, created_at: String, updated_at: String }`
  - `EmployeeInput { name: String, role, phone, address: Option<String>, joined_on: String, daily_wage: f64, ot_rate: f64, notes: Option<String> }`
  - `EmployeeListItem { id: i64, name: String, role, phone: Option<String>, daily_wage: f64, ot_rate: f64, joined_on: String, left_on: Option<String>, file_count: i64 }`
  - `EmployeeFileInfo { id: i64, file_name: String, mime_type: String, size_bytes: i64 }`
  - `EmployeeDetail { employee: Employee, files: Vec<EmployeeFileInfo> }`
  - `PayRow { id: i64, employee_id: i64, month: String, days_worked: f64, daily_wage: f64, ot_hours: f64, ot_rate: f64, bonus_amount: f64, bonus_note: Option<String>, note: Option<String> }`
  - `PayMonthInput { days_worked: f64, ot_hours: f64, daily_wage: Option<f64>, ot_rate: Option<f64>, bonus_amount: f64, bonus_note: Option<String>, note: Option<String> }`. `None` rates mean "copy the employee's on first save, otherwise keep the row's".
  - `MonthFigures { wages: f64, ot_amount: f64, bonus: f64, earned: f64, given: f64, cleared: f64, rounded_off: f64, balance: f64 }` (also `PartialEq`, `Default`)
  - `EmployeePayment { id: i64, employee_id: i64, month: String, kind: String, entry_date: String, amount: f64, round_off: f64, carried_to: Option<String>, payment_method: Option<String>, note: Option<String>, created_at: String, updated_at: String }`
  - `EmployeePaymentInput { employee_id: i64, month: String, kind: String, entry_date: String, amount: f64, #[serde(default)] finish: bool, payment_method: Option<String>, note: Option<String> }`
  - `PayMonthDetail { employee: Employee, month: String, row: Option<PayRow>, figures: MonthFigures, status: String, editable: bool, entries: Vec<EmployeePayment>, carried_in: Vec<EmployeePayment> }`. `entries` have `month = M`; `carried_in` are CARRIED rows with `carried_to = M`.
  - `PaySheetRow { employee_id: i64, name: String, role: Option<String>, row: Option<PayRow>, figures: MonthFigures, status: String, current_wage: f64, current_ot_rate: f64 }`
  - `PaySheet { month: String, first_month: String, last_month: String, rows: Vec<PaySheetRow>, total_earned: f64, total_given: f64, total_to_pay: f64, not_entered: i64 }`
  - `PaySheetEntry { employee_id: i64, days_worked: f64, ot_hours: f64 }`
  - `PayMonthSummary { month: String, row: Option<PayRow>, figures: MonthFigures, status: String }`
- Produces, in `calc.rs` (month text is checked with `crate::rentals::reminder::month_label`, whose error is `Month must look like 2026-11.`):
  - `pub fn check_month(month: &str) -> Result<(), String>`
  - `pub fn next_month(month: &str) -> Result<String, String>`
  - `pub fn days_in_month(month: &str) -> Result<u32, String>`
  - `pub fn employed_days(month: &str, joined_on: &str, left_on: Option<&str>) -> Result<u32, String>`: from the joining day if it falls inside the month (otherwise day 1, including months before joining) to the leaving day if it falls inside the month (otherwise the month's end).
  - `pub fn in_window(month: &str, joined_on: &str, left_on: Option<&str>, current_month: &str) -> bool`: `joined month ≤ month ≤ (leaving month or ∞)` and `month ≤ current_month`.
  - `pub fn check_days(days: f64, max_days: u32) -> Result<f64, String>`
  - `pub fn check_ot_hours(hours: f64, month_days: u32) -> Result<f64, String>`: cap is `24 × month_days`.
  - `pub fn figures(row: Option<&PayRow>, given: f64, cleared: f64, rounded_off: f64) -> MonthFigures`: each line is `round2`-ed, and `earned` and `balance` are `round2`-ed again after adding.
  - `pub fn status(has_row: bool, balance: f64) -> &'static str`: `"NOT_ENTERED"` without a row; otherwise `"TO_PAY"` (> 0), `"PAID"` (= 0) or `"OVERPAID"` (< 0), comparing the `round2`-ed balance.

- [ ] **Step 1: Write the failing tests in `calc.rs`**

```rust
fn row(days: f64, wage: f64, hours: f64, rate: f64, bonus: f64) -> PayRow {
    PayRow { id: 1, employee_id: 1, month: "2026-10".into(), days_worked: days, daily_wage: wage, ot_hours: hours, ot_rate: rate, bonus_amount: bonus, bonus_note: None, note: None }
}

#[test]
fn months_are_checked_and_stepped() {
    assert!(check_month("2026-10").is_ok());
    for bad in ["2026-13", "2026-1", "", "2026-00", "26-10", "2026/10"] {
        assert_eq!(check_month(bad).unwrap_err(), "Month must look like 2026-11.", "{}", bad);
    }
    assert_eq!(next_month("2026-12").unwrap(), "2027-01");
    assert_eq!(next_month("2026-10").unwrap(), "2026-11");
    assert_eq!(days_in_month("2026-02").unwrap(), 28);
    assert_eq!(days_in_month("2028-02").unwrap(), 29);
    assert_eq!(days_in_month("2026-04").unwrap(), 30);
    assert_eq!(days_in_month("2026-10").unwrap(), 31);
}

#[test]
fn employed_days_follow_joining_and_leaving_inside_the_month() {
    assert_eq!(employed_days("2026-10", "2026-10-20", None).unwrap(), 12);
    assert_eq!(employed_days("2026-10", "2026-01-01", Some("2026-10-10")).unwrap(), 10);
    assert_eq!(employed_days("2026-10", "2026-10-05", Some("2026-10-05")).unwrap(), 1);
    assert_eq!(employed_days("2026-10", "2026-12-01", None).unwrap(), 31, "a month before the joining date kept by records");
    assert_eq!(employed_days("2026-10", "2025-06-01", None).unwrap(), 31);
}

#[test]
fn the_window_runs_from_joining_to_leaving_and_never_past_this_month() {
    assert!(in_window("2026-10", "2026-10-20", None, "2026-11"));
    assert!(!in_window("2026-09", "2026-10-20", None, "2026-11"));
    assert!(!in_window("2026-12", "2026-10-20", None, "2026-11"));
    assert!(in_window("2026-10", "2026-01-01", Some("2026-10-10"), "2026-12"));
    assert!(!in_window("2026-11", "2026-01-01", Some("2026-10-10"), "2026-12"));
}

#[test]
fn days_take_half_steps_up_to_the_limit() {
    assert_eq!(check_days(25.5, 31).unwrap(), 25.5);
    assert_eq!(check_days(0.0, 31).unwrap(), 0.0);
    assert_eq!(check_days(31.0, 31).unwrap(), 31.0);
    for bad in [31.5, -1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(check_days(bad, 31).unwrap_err(), "Days must be between 0 and 31.");
    }
    assert_eq!(check_days(25.25, 31).unwrap_err(), "Days must be in steps of half a day.");
}

#[test]
fn ot_hours_allow_two_decimals_up_to_a_full_day_each_day() {
    assert_eq!(check_ot_hours(1.75, 31).unwrap(), 1.75);
    assert_eq!(check_ot_hours(744.0, 31).unwrap(), 744.0);
    for bad in [744.5, -0.5, f64::NAN] {
        assert_eq!(check_ot_hours(bad, 31).unwrap_err(), "OT hours must be between 0 and 744.");
    }
    assert_eq!(check_ot_hours(1.255, 31).unwrap_err(), "OT hours can have at most two decimals.");
}

#[test]
fn figures_round_each_line_then_add() {
    let f = figures(Some(&row(25.5, 600.0, 12.0, 80.0, 500.0)), 3000.0, 0.0, 0.0);
    assert_eq!((f.wages, f.ot_amount, f.bonus, f.earned, f.given, f.balance), (15300.0, 960.0, 500.0, 16760.0, 3000.0, 13760.0));
    let f = figures(Some(&row(3.0, 433.33, 1.75, 66.67, 0.0)), 0.0, 0.0, 0.0);
    assert_eq!((f.wages, f.ot_amount, f.earned), (1299.99, 116.67, 1416.66));
    let f = figures(None, 500.0, 0.0, 0.0);
    assert_eq!((f.earned, f.balance), (0.0, -500.0));
    let f = figures(Some(&row(10.0, 400.0, 0.0, 0.0, 0.0)), 5000.0, 600.0, 0.0);
    assert_eq!(f.balance, -400.0, "cash returned or written off counts back towards zero");
    let f = figures(Some(&row(10.0, 400.0, 0.0, 0.0, 0.0)), 3990.0, 0.0, 10.0);
    assert_eq!(f.balance, 0.0, "a round-off finishes the month");
}

#[test]
fn status_ignores_float_dust() {
    let f = figures(Some(&row(1.0, 0.3, 0.0, 0.0, 0.0)), 0.1 + 0.2, 0.0, 0.0);
    assert_eq!(f.balance, 0.0);
    assert_eq!(status(true, f.balance), "PAID");
    assert_eq!(status(true, 10.0), "TO_PAY");
    assert_eq!(status(true, -40.0), "OVERPAID");
    assert_eq!(status(false, -500.0), "NOT_ENTERED");
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `tools\test-harness\test.bat calc`
Expected: FAIL to compile (`cannot find function check_month`).

- [ ] **Step 3: Write `models.rs` and the `calc.rs` functions with the signatures above**

Days step check: `((days * 2.0).round() - days * 2.0).abs() < 1e-9`. Two-decimal check: `((h * 100.0).round() - h * 100.0).abs() < 1e-6`. Any non-finite value gives the range error. `check_days` and `check_ot_hours` return the value `round2`-ed.

- [ ] **Step 4: Run the tests**

Run: `tools\test-harness\test.bat calc`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/payroll src-tauri/src/lib.rs tools/test-harness/src/lib.rs
git commit -m "feat: payroll maths and month rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Employees in the repository (records, leaving, rejoining, files)

**Files:**
- Create: `src-tauri/src/payroll/repository.rs` (`pub struct PayrollRepository;` + tests)
- Modify: `src-tauri/src/payroll/mod.rs` (`pub mod repository;`)
- Modify: `tools/test-harness/src/lib.rs` (add `repository.rs` to the `payroll` module)

**Interfaces:**
- Consumes: `models.rs` types and `calc::*` from Task 2; `crate::attachments::{validate_file, clean_file_name}`; `crate::util::{normalize_date, display_date, round2}`; `crate::rentals::reminder::month_label`.
- Produces (`impl PayrollRepository`, all `-> Result<_, String>`):
  - `create_employee(conn: &Connection, input: EmployeeInput) -> EmployeeDetail`
  - `update_employee(conn, id: i64, input: EmployeeInput) -> EmployeeDetail`
  - `get_employee(conn, id) -> Option<EmployeeDetail>`
  - `list_employees(conn) -> Vec<EmployeeListItem>`: everyone, by name (`COLLATE NOCASE`)
  - `find_by_name(conn, name: &str, exclude_id: i64) -> Vec<EmployeeListItem>`: trimmed, case-insensitive exact match; an empty name gives an empty list
  - `mark_left(conn, id, left_on: &str) -> EmployeeDetail`
  - `rejoin(conn, id, joined_on: &str) -> EmployeeDetail`
  - `delete_employee(conn, id) -> ()`
  - `add_file(conn, employee_id: i64, file_name: &str, bytes: &[u8]) -> EmployeeFileInfo`, `remove_file(conn, file_id: i64) -> ()`, `read_file(conn, file_id) -> (String, String, Vec<u8>)`: copy the rentals file functions with one owner.
  - private `last_record_month(conn, id) -> Option<String>`: the max of `pay_months.month`, `employee_payments.month` and `employee_payments.carried_to`
  - private `has_record(conn, id, month: &str) -> bool`: a pay row, an entry with `month = M`, or a CARRIED entry with `carried_to = M`
- Input clean-up: name, role, address and notes are trimmed, and an empty optional becomes `None`. Phone is trimmed and must match `^[0-9 +\-]{1,20}$`. Wage and OT rate go through `round2`. `joined_on` goes through `normalize_date(_, "Joining date")`, which accepts `DD-MM-YYYY` too.

- [ ] **Step 1: Write the failing tests** (helpers `setup()` and `const PDF` as in `rentals/repository.rs`; `input(name, joined) -> EmployeeInput` with role `Some("Welder")`, wage 600, OT rate 80; `emp(conn, name, joined) -> i64`; `raw_payment(conn, id, month, kind, carried_to: Option<&str>)` inserting one `employee_payments` row of ₹500 dated `2026-10-15`; `raw_row(conn, id, month)` inserting a 20-day `pay_months` row at ₹600)

```rust
#[test]
fn employees_need_a_name_a_wage_and_sensible_details() {
    let (_d, conn) = setup();
    let err = |i: EmployeeInput| PayrollRepository::create_employee(&conn, i).unwrap_err();
    assert_eq!(err(input("  ", "2026-10-01")), "Employee name is required.");
    let mut i = input("Murugan", "2026-10-01"); i.daily_wage = 0.0;
    assert_eq!(err(i), "Daily wage must be more than 0.");
    let mut i = input("Murugan", "2026-10-01"); i.ot_rate = -1.0;
    assert_eq!(err(i), "OT rate can't be negative.");
    let mut i = input("Murugan", "2026-10-01"); i.phone = Some("98765 43210 ext 5".into());
    assert_eq!(err(i), "Phone can have only digits, spaces, + and -, up to 20 characters.");
    assert_eq!(err(input("Murugan", "31-02-2026")), "Joining date is not a valid date.");
    let mut i = input(" Murugan ", "01-10-2026"); i.daily_wage = 600.004; i.role = Some("  ".into());
    let e = PayrollRepository::create_employee(&conn, i).unwrap().employee;
    assert_eq!((e.name.as_str(), e.daily_wage, e.joined_on.as_str(), e.role), ("Murugan", 600.0, "2026-10-01", None));
}

#[test]
fn same_name_is_found_but_never_refused() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Murugan", "2026-01-01");
    emp(&conn, "murugan ", "2026-01-01");
    assert_eq!(PayrollRepository::find_by_name(&conn, "MURUGAN", -1).unwrap().len(), 2);
    assert_eq!(PayrollRepository::find_by_name(&conn, "Murugan", a).unwrap().len(), 1);
    assert!(PayrollRepository::find_by_name(&conn, "  ", -1).unwrap().is_empty());
}

#[test]
fn leaving_and_rejoining() {
    let (_d, conn) = setup();
    let id = emp(&conn, "Murugan", "2026-03-01");
    assert_eq!(PayrollRepository::mark_left(&conn, id, "2026-02-28").unwrap_err(), "The leaving date can't be before the joining date.");
    let e = PayrollRepository::mark_left(&conn, id, "2026-03-31").unwrap().employee;
    assert_eq!(e.left_on.as_deref(), Some("2026-03-31"));
    assert_eq!(PayrollRepository::mark_left(&conn, id, "2026-04-30").unwrap_err(), "Murugan is already marked as left.");
    let mut i = input("Murugan", "2026-04-05");
    assert_eq!(PayrollRepository::update_employee(&conn, id, i.clone()).unwrap_err(), "The joining date can't be after the leaving date.");
    i.joined_on = "2026-03-01".into();
    PayrollRepository::update_employee(&conn, id, i).unwrap();
    assert_eq!(PayrollRepository::rejoin(&conn, id, "2026-03-31").unwrap_err(), "The rejoining date must be after the leaving date (31-03-2026).");
    let e = PayrollRepository::rejoin(&conn, id, "2026-09-01").unwrap().employee;
    assert_eq!((e.joined_on.as_str(), e.left_on), ("2026-09-01", None));
    assert_eq!(PayrollRepository::rejoin(&conn, id, "2026-10-01").unwrap_err(), "Murugan hasn't left.");
}

#[test]
fn leaving_cannot_hide_pay_records() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    raw_row(&conn, a, "2026-10");
    assert_eq!(PayrollRepository::mark_left(&conn, a, "2026-09-30").unwrap_err(), "There are pay records for October 2026, after this leaving date.");
    PayrollRepository::mark_left(&conn, a, "2026-10-05").unwrap();
    let r = emp(&conn, "Ravi", "2026-01-01");
    raw_payment(&conn, r, "2026-09", "CARRIED", Some("2026-10"));
    assert_eq!(PayrollRepository::mark_left(&conn, r, "2026-09-30").unwrap_err(), "There are pay records for October 2026, after this leaving date.");
}

#[test]
fn an_employee_with_records_cannot_be_deleted() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    raw_payment(&conn, a, "2026-10", "ADVANCE", None);
    assert_eq!(PayrollRepository::delete_employee(&conn, a).unwrap_err(), "This employee has pay records and can't be deleted. Mark them as left instead.");
    let fresh = emp(&conn, "Bala", "2026-01-01");
    PayrollRepository::add_file(&conn, fresh, "id.pdf", PDF).unwrap();
    PayrollRepository::delete_employee(&conn, fresh).unwrap();
    let files: i64 = conn.query_row("SELECT COUNT(*) FROM employee_files", [], |r| r.get(0)).unwrap();
    assert_eq!(files, 0);
    assert_eq!(PayrollRepository::delete_employee(&conn, fresh).unwrap_err(), "Employee not found.");
}

#[test]
fn employee_files_follow_the_shared_rules() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    let f = PayrollRepository::add_file(&conn, a, "..\\aadhaar.pdf", PDF).unwrap();
    assert_eq!((f.file_name.as_str(), f.mime_type.as_str()), ("aadhaar.pdf", "application/pdf"));
    assert!(PayrollRepository::add_file(&conn, a, "fake.pdf", b"just text").is_err());
    assert_eq!(PayrollRepository::add_file(&conn, 9999, "a.pdf", PDF).unwrap_err(), "Employee not found.");
    assert_eq!(PayrollRepository::get_employee(&conn, a).unwrap().unwrap().files.len(), 1);
    assert_eq!(PayrollRepository::list_employees(&conn).unwrap()[0].file_count, 1);
    PayrollRepository::remove_file(&conn, f.id).unwrap();
    assert_eq!(PayrollRepository::read_file(&conn, f.id).unwrap_err(), "That file is no longer there.");
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `tools\test-harness\test.bat payroll::repository`
Expected: FAIL to compile (`PayrollRepository` not found).

- [ ] **Step 3: Implement the functions above**

`mark_left` checks, in order: found ("Employee not found."), not already left, `left_on ≥ joined_on`, then the leaving month against `last_record_month`, naming it with `month_label`. `rejoin` checks the date with `display_date` in the message. `update_employee` checks `joined_on ≤ left_on` when the employee has left.

- [ ] **Step 4: Run the tests**

Run: `tools\test-harness\test.bat payroll`
Expected: all payroll tests pass (Task 2's 7 + these 6).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/payroll tools/test-harness/src/lib.rs
git commit -m "feat: employees: records, leaving, rejoining and files" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pay rows, the pay sheet and pay history

**Files:**
- Modify: `src-tauri/src/payroll/repository.rs`

**Interfaces:**
- Consumes: Task 3's `has_record` and `get_employee`; `calc::{check_month, days_in_month, employed_days, in_window, check_days, check_ot_hours, figures, status}`.
- Produces (`impl PayrollRepository`, all `-> Result<_, String>`):
  - `pay_month(conn, employee_id: i64, month: &str, today: &str) -> PayMonthDetail`: allowed when the month is open, or is later than the current month and has a carried-in advance. `editable` is true only when the month is open. Errors: a later month with no carried-in advance gives `"{Month Year} hasn't started yet."`; any other month that isn't open gives `"{name} isn't on the pay sheet for {Month Year}."`.
  - `save_pay_month(conn, employee_id, month, input: PayMonthInput, today) -> PayMonthDetail`: insert or update the row. The future-month error is `"{Month Year} hasn't started yet."` and is checked before the window. Days use `employed_days`. A bonus < 0 gives `"Bonus can't be negative."`; a rate in the input goes through the employee rules (`"Daily wage must be more than 0."`, `"OT rate can't be negative."`).
  - `delete_pay_month(conn, employee_id, month) -> ()`: blocked by any entry counting on the month (`"Payments are recorded against {Month Year}. Delete or move them first."`); no row gives `"No days are entered for {Month Year}."`.
  - `pay_sheet(conn, month: &str, today) -> PaySheet`: lists everyone whose month is open or who has a carried-in advance there, by name. `first_month` is the earliest of every `joined_on` month and every record month (the current month when there are none); `last_month` is the later of the current month and the latest `carried_to`. `total_to_pay` sums positive balances only; `not_entered` counts rows without a pay row.
  - `save_pay_sheet(conn, month, rows: Vec<PaySheetEntry>, today) -> PaySheet`: one `unchecked_transaction()`. Each row is checked as `save_pay_month` with `daily_wage`/`ot_rate` `None`, and an existing row's bonus and note are kept. The first error rolls back everything and is returned as `"{name}: {error}"`. A repeated employee gives `"{name} is in the list twice."`.
  - `pay_history(conn, employee_id, today, limit: usize) -> Vec<PayMonthSummary>`: the months from joining (or the earliest record) to the leaving month or the current month, plus record months, newest first, at most `limit`.
  - private `month_figures(conn, employee_id, month, exclude_entry: Option<i64>) -> (Option<PayRow>, MonthFigures)`: given / cleared / rounded off are summed from `employee_payments` as in the spec's Pay maths, leaving out `exclude_entry`. Task 5 uses it.
  - private `check_open(conn, emp: &Employee, month, today) -> Result<(), String>`: the spec's "Which months are open".

- [ ] **Step 1: Write the failing tests** (helpers: `days(d) -> PayMonthInput` with everything else zero or `None`; `entry(id, days, hours) -> PaySheetEntry`)

```rust
#[test]
fn saving_a_month_copies_the_rates_once() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Murugan", "2026-01-01");
    let d = PayrollRepository::save_pay_month(&conn, a, "2026-09", PayMonthInput { ot_hours: 12.0, ..days(25.5) }, TODAY).unwrap();
    let r = d.row.clone().unwrap();
    assert_eq!((r.daily_wage, r.ot_rate, d.figures.wages, d.figures.ot_amount, d.figures.earned, d.status.as_str()), (600.0, 80.0, 15300.0, 960.0, 16260.0, "TO_PAY"));
    let mut i = input("Murugan", "2026-01-01"); i.daily_wage = 650.0;
    PayrollRepository::update_employee(&conn, a, i).unwrap();
    let d = PayrollRepository::save_pay_month(&conn, a, "2026-09", days(26.0), TODAY).unwrap();
    assert_eq!((d.row.unwrap().daily_wage, d.figures.wages), (600.0, 15600.0), "a raise does not touch an entered month");
    let d = PayrollRepository::save_pay_month(&conn, a, "2026-09", PayMonthInput { daily_wage: Some(650.0), ..days(26.0) }, TODAY).unwrap();
    assert_eq!(d.figures.wages, 16900.0, "unless changed on that month");
    assert_eq!(PayrollRepository::save_pay_month(&conn, a, "2026-10", days(10.0), TODAY).unwrap().row.unwrap().daily_wage, 650.0);
    let d = PayrollRepository::save_pay_month(&conn, a, "2026-10", PayMonthInput { bonus_amount: 500.0, bonus_note: Some("Diwali".into()), ..days(10.0) }, TODAY).unwrap();
    assert_eq!(d.figures.earned, 7000.0);
    assert_eq!(PayrollRepository::save_pay_month(&conn, a, "2026-10", PayMonthInput { bonus_amount: -1.0, ..days(10.0) }, TODAY).unwrap_err(), "Bonus can't be negative.");
    assert_eq!(PayrollRepository::save_pay_month(&conn, a, "2026-10", PayMonthInput { daily_wage: Some(0.0), ..days(10.0) }, TODAY).unwrap_err(), "Daily wage must be more than 0.");
}

#[test]
fn days_and_hours_are_checked_against_the_month() {
    let (_d, conn) = setup();
    let b = emp(&conn, "Bala", "2026-10-20");
    assert_eq!(PayrollRepository::save_pay_month(&conn, b, "2026-10", days(13.0), TODAY).unwrap_err(), "Days must be between 0 and 12.");
    PayrollRepository::save_pay_month(&conn, b, "2026-10", days(12.0), TODAY).unwrap();
    assert_eq!(PayrollRepository::save_pay_month(&conn, b, "2026-10", PayMonthInput { ot_hours: 744.5, ..days(1.0) }, TODAY).unwrap_err(), "OT hours must be between 0 and 744.");
    let a = emp(&conn, "Anbu", "2026-01-01");
    assert_eq!(PayrollRepository::save_pay_month(&conn, a, "2026-02", days(28.5), TODAY).unwrap_err(), "Days must be between 0 and 28.");
}

#[test]
fn months_outside_employment_or_in_the_future_are_refused() {
    let (_d, conn) = setup();
    let b = emp(&conn, "Bala", "2026-10-20");
    assert_eq!(PayrollRepository::save_pay_month(&conn, b, "2026-09", days(1.0), TODAY).unwrap_err(), "Bala isn't on the pay sheet for September 2026.");
    assert_eq!(PayrollRepository::save_pay_month(&conn, b, "2026-11", days(1.0), TODAY).unwrap_err(), "November 2026 hasn't started yet.");
    assert_eq!(PayrollRepository::pay_month(&conn, b, "2026-09", TODAY).unwrap_err(), "Bala isn't on the pay sheet for September 2026.");
    PayrollRepository::mark_left(&conn, b, "2026-10-25").unwrap();
    assert_eq!(PayrollRepository::save_pay_month(&conn, b, "2026-11", days(1.0), "2026-12-05").unwrap_err(), "Bala isn't on the pay sheet for November 2026.");
}

#[test]
fn the_pay_sheet_lists_who_worked_that_month() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    emp(&conn, "Bala", "2026-10-20");
    let c = emp(&conn, "Chandran", "2026-01-01");
    PayrollRepository::mark_left(&conn, c, "2026-09-15").unwrap();
    emp(&conn, "Dinesh", "2026-11-02");
    PayrollRepository::save_pay_month(&conn, a, "2026-10", days(26.0), TODAY).unwrap();
    let s = PayrollRepository::pay_sheet(&conn, "2026-10", TODAY).unwrap();
    let names: Vec<&str> = s.rows.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["Anbu", "Bala"]);
    assert_eq!((s.total_earned, s.total_to_pay, s.total_given, s.not_entered), (15600.0, 15600.0, 0.0, 1));
    assert_eq!((s.rows[1].status.as_str(), s.rows[1].current_wage), ("NOT_ENTERED", 600.0));
    assert_eq!((s.first_month.as_str(), s.last_month.as_str()), ("2026-01", "2026-10"));
    assert_eq!(PayrollRepository::pay_sheet(&conn, "2026-13", TODAY).unwrap_err(), "Month must look like 2026-11.");
}

#[test]
fn a_month_with_records_stays_listed_and_editable_after_a_rejoin() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    PayrollRepository::save_pay_month(&conn, a, "2026-03", days(20.0), TODAY).unwrap();
    PayrollRepository::mark_left(&conn, a, "2026-03-31").unwrap();
    PayrollRepository::rejoin(&conn, a, "2026-09-01").unwrap();
    assert_eq!(PayrollRepository::pay_sheet(&conn, "2026-03", TODAY).unwrap().rows.len(), 1);
    PayrollRepository::save_pay_month(&conn, a, "2026-03", days(31.0), TODAY).unwrap();
    assert!(PayrollRepository::pay_sheet(&conn, "2026-05", TODAY).unwrap().rows.is_empty());
    assert_eq!(PayrollRepository::save_pay_month(&conn, a, "2026-05", days(1.0), TODAY).unwrap_err(), "Anbu isn't on the pay sheet for May 2026.");
}

#[test]
fn saving_the_whole_sheet_is_all_or_nothing() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    let b = emp(&conn, "Bala", "2026-10-20");
    let c = emp(&conn, "Chandran", "2026-01-01");
    PayrollRepository::mark_left(&conn, c, "2026-09-15").unwrap();
    let save = |rows| PayrollRepository::save_pay_sheet(&conn, "2026-10", rows, TODAY);
    assert_eq!(save(vec![entry(a, 26.0, 4.0), entry(b, 40.0, 0.0)]).unwrap_err(), "Bala: Days must be between 0 and 12.");
    assert!(PayrollRepository::pay_month(&conn, a, "2026-10", TODAY).unwrap().row.is_none(), "nothing saved");
    assert_eq!(save(vec![entry(a, 26.0, 0.0), entry(c, 5.0, 0.0)]).unwrap_err(), "Chandran: Chandran isn't on the pay sheet for October 2026.");
    assert_eq!(save(vec![entry(a, 26.0, 0.0), entry(a, 25.0, 0.0)]).unwrap_err(), "Anbu is in the list twice.");
    save(vec![entry(a, 26.0, 4.0), entry(b, 12.0, 0.0)]).unwrap();
    PayrollRepository::save_pay_month(&conn, a, "2026-10", PayMonthInput { daily_wage: Some(650.0), bonus_amount: 500.0, ot_hours: 4.0, ..days(26.0) }, TODAY).unwrap();
    let s = save(vec![entry(a, 25.0, 2.0)]).unwrap();
    let r = s.rows[0].row.clone().unwrap();
    assert_eq!((r.days_worked, r.ot_hours, r.daily_wage, r.bonus_amount), (25.0, 2.0, 650.0, 500.0));
}

#[test]
fn a_month_with_payments_cannot_be_deleted() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    PayrollRepository::save_pay_month(&conn, a, "2026-10", days(26.0), TODAY).unwrap();
    raw_payment(&conn, a, "2026-10", "ADVANCE", None);
    assert_eq!(PayrollRepository::delete_pay_month(&conn, a, "2026-10").unwrap_err(), "Payments are recorded against October 2026. Delete or move them first.");
    PayrollRepository::save_pay_month(&conn, a, "2026-09", days(20.0), TODAY).unwrap();
    raw_payment(&conn, a, "2026-08", "CARRIED", Some("2026-09"));
    assert_eq!(PayrollRepository::delete_pay_month(&conn, a, "2026-09").unwrap_err(), "Payments are recorded against September 2026. Delete or move them first.");
    PayrollRepository::save_pay_month(&conn, a, "2026-07", days(20.0), TODAY).unwrap();
    PayrollRepository::delete_pay_month(&conn, a, "2026-07").unwrap();
    assert_eq!(PayrollRepository::delete_pay_month(&conn, a, "2026-07").unwrap_err(), "No days are entered for July 2026.");
}

#[test]
fn pay_history_shows_the_last_months_newest_first() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2025-08-01");
    PayrollRepository::save_pay_month(&conn, a, "2026-10", days(26.0), TODAY).unwrap();
    let h = PayrollRepository::pay_history(&conn, a, TODAY, 12).unwrap();
    assert_eq!(h.len(), 12);
    assert_eq!((h[0].month.as_str(), h[0].status.as_str()), ("2026-10", "TO_PAY"));
    assert_eq!((h[1].month.as_str(), h[1].status.as_str()), ("2026-09", "NOT_ENTERED"));
    assert_eq!(h[11].month, "2025-11");
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `tools\test-harness\test.bat payroll::repository`
Expected: FAIL to compile (`no function or associated item named save_pay_month`).

- [ ] **Step 3: Implement the functions above**

- [ ] **Step 4: Run the tests**

Run: `tools\test-harness\test.bat payroll`
Expected: all payroll tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/payroll/repository.rs
git commit -m "feat: monthly pay rows, the pay sheet and pay history" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Advances, salary, round-off and overpaid months

**Files:**
- Modify: `src-tauri/src/payroll/repository.rs`

**Interfaces:**
- Consumes: Task 4's `month_figures(.., exclude_entry)`, `check_open` and `pay_month`; `calc::next_month`, `calc::in_window`; `util::rupees` (`"₹1,000.00"`).
- Produces (`impl PayrollRepository`, all `-> Result<_, String>`):
  - `create_payment(conn, input: EmployeePaymentInput, today: &str) -> PayMonthDetail` (the month's refreshed detail)
  - `update_payment(conn, id: i64, input: EmployeePaymentInput, today) -> PayMonthDetail`: checked as if the entry were not there (`exclude_entry = Some(id)`). The kind can't change (`"A payment's kind can't be changed."`), and neither can the employee (same message pattern: `"A payment's employee can't be changed."`).
  - `delete_payment(conn, id) -> ()`: always allowed; `"That payment is no longer there."` when missing.
  - `list_wage_payments(conn, from: &str, to: &str) -> Vec<EmployeePayment>`: ADVANCE and SALARY with `entry_date` between the dates (inclusive), by date.
- Rules, in order: kind in the five values (`"Unknown payment kind."`); `amount > 0` after `round2` (`"Amount must be more than 0."`); date through `normalize_date(_, "Date")`; the month open (`check_open`); a method required for ADVANCE, SALARY and RETURNED (`"Choose how it was paid."`) and stored `None` for WRITE_OFF and CARRIED; `finish` only on SALARY (`"Only a salary payment can be rounded off."`) and only with a pay row (`"Enter the days for {Month Year} before rounding off."`), setting `round_off = round2(balance_before − amount)`; RETURNED, WRITE_OFF and CARRIED need a pay row (`"Enter the days for {Month Year} first."`), an overpaid month (`"{Month Year} is not overpaid."`) and `amount ≤ overpaid` (`"That is more than the {rupees} overpaid."`); for CARRIED, `carried_to = next_month(month)` must be in the employee's window, ignoring the current-month cap (`"{name} isn't working in {Month Year}. Use Cash returned or Write off."`).

- [ ] **Step 1: Write the failing tests** (helper `pay(id, month, kind, amount) -> EmployeePaymentInput` dated `2026-10-15`, `finish: false`, method `Some("Cash")`, note `None`; `murugan_october(conn) -> i64` creates Murugan joined `2026-01-01` and saves October with 25.5 days and 12 OT hours, earning ₹16,260)

```rust
#[test]
fn paying_exactly_finishes_the_month() {
    let (_d, conn) = setup();
    let a = murugan_october(&conn);
    let d = PayrollRepository::create_payment(&conn, pay(a, "2026-10", "ADVANCE", 3000.0), TODAY).unwrap();
    assert_eq!((d.status.as_str(), d.figures.balance), ("TO_PAY", 13260.0));
    let d = PayrollRepository::create_payment(&conn, pay(a, "2026-10", "SALARY", 13260.0), TODAY).unwrap();
    assert_eq!((d.status.as_str(), d.figures.balance, d.entries.len()), ("PAID", 0.0, 2));
}

#[test]
fn rounding_off_down_and_up_finishes_the_month() {
    let (_d, conn) = setup();
    let a = murugan_october(&conn);
    PayrollRepository::create_payment(&conn, pay(a, "2026-10", "ADVANCE", 3000.0), TODAY).unwrap();
    let d = PayrollRepository::create_payment(&conn, EmployeePaymentInput { finish: true, ..pay(a, "2026-10", "SALARY", 13250.0) }, TODAY).unwrap();
    let salary = d.entries.iter().find(|e| e.kind == "SALARY").unwrap().clone();
    assert_eq!((salary.round_off, d.status.as_str(), d.figures.rounded_off), (10.0, "PAID", 10.0));
    PayrollRepository::delete_payment(&conn, salary.id).unwrap();
    assert_eq!(PayrollRepository::pay_month(&conn, a, "2026-10", TODAY).unwrap().figures.balance, 13260.0);
    let d = PayrollRepository::create_payment(&conn, EmployeePaymentInput { finish: true, ..pay(a, "2026-10", "SALARY", 13300.0) }, TODAY).unwrap();
    assert_eq!((d.figures.rounded_off, d.status.as_str()), (-40.0, "PAID"));
}

#[test]
fn rounding_off_needs_a_salary_and_the_days() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    assert_eq!(PayrollRepository::create_payment(&conn, EmployeePaymentInput { finish: true, ..pay(a, "2026-10", "SALARY", 100.0) }, TODAY).unwrap_err(), "Enter the days for October 2026 before rounding off.");
    PayrollRepository::save_pay_month(&conn, a, "2026-10", days(1.0), TODAY).unwrap();
    assert_eq!(PayrollRepository::create_payment(&conn, EmployeePaymentInput { finish: true, ..pay(a, "2026-10", "ADVANCE", 100.0) }, TODAY).unwrap_err(), "Only a salary payment can be rounded off.");
}

#[test]
fn paying_more_without_rounding_off_shows_overpaid() {
    let (_d, conn) = setup();
    let a = murugan_october(&conn);
    let d = PayrollRepository::create_payment(&conn, pay(a, "2026-10", "SALARY", 16300.0), TODAY).unwrap();
    assert_eq!((d.status.as_str(), d.figures.balance), ("OVERPAID", -40.0));
}

#[test]
fn editing_the_finishing_payment_keeps_the_month_paid() {
    let (_d, conn) = setup();
    let a = murugan_october(&conn);
    let adv = PayrollRepository::create_payment(&conn, pay(a, "2026-10", "ADVANCE", 3000.0), TODAY).unwrap().entries[0].id;
    let d = PayrollRepository::create_payment(&conn, EmployeePaymentInput { finish: true, ..pay(a, "2026-10", "SALARY", 13250.0) }, TODAY).unwrap();
    let sal = d.entries.iter().find(|e| e.kind == "SALARY").unwrap().id;
    let d = PayrollRepository::update_payment(&conn, sal, EmployeePaymentInput { finish: true, ..pay(a, "2026-10", "SALARY", 13200.0) }, TODAY).unwrap();
    assert_eq!((d.figures.rounded_off, d.status.as_str()), (60.0, "PAID"));
    let d = PayrollRepository::update_payment(&conn, adv, pay(a, "2026-10", "ADVANCE", 2500.0), TODAY).unwrap();
    assert_eq!((d.status.as_str(), d.figures.balance), ("TO_PAY", 500.0));
    assert_eq!(PayrollRepository::update_payment(&conn, adv, pay(a, "2026-10", "SALARY", 2500.0), TODAY).unwrap_err(), "A payment's kind can't be changed.");
}

#[test]
fn editing_a_paid_month_reopens_it() {
    let (_d, conn) = setup();
    let a = murugan_october(&conn);
    PayrollRepository::create_payment(&conn, pay(a, "2026-10", "SALARY", 16260.0), TODAY).unwrap();
    let d = PayrollRepository::save_pay_month(&conn, a, "2026-10", PayMonthInput { ot_hours: 12.0, ..days(26.5) }, TODAY).unwrap();
    assert_eq!((d.status.as_str(), d.figures.balance), ("TO_PAY", 600.0));
}

#[test]
fn an_overpaid_month_is_finished_three_ways() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    let mut i = input("Anbu", "2026-01-01"); i.daily_wage = 400.0;
    PayrollRepository::update_employee(&conn, a, i).unwrap();
    PayrollRepository::save_pay_month(&conn, a, "2026-09", days(10.0), TODAY).unwrap();
    let d = PayrollRepository::create_payment(&conn, pay(a, "2026-09", "ADVANCE", 5000.0), TODAY).unwrap();
    assert_eq!((d.status.as_str(), d.figures.balance), ("OVERPAID", -1000.0));
    assert_eq!(PayrollRepository::create_payment(&conn, pay(a, "2026-09", "RETURNED", 1200.0), TODAY).unwrap_err(), "That is more than the ₹1,000.00 overpaid.");
    PayrollRepository::create_payment(&conn, pay(a, "2026-09", "RETURNED", 400.0), TODAY).unwrap();
    let d = PayrollRepository::create_payment(&conn, EmployeePaymentInput { payment_method: None, ..pay(a, "2026-09", "WRITE_OFF", 600.0) }, TODAY).unwrap();
    assert_eq!(d.status, "PAID");

    PayrollRepository::save_pay_month(&conn, a, "2026-10", days(10.0), TODAY).unwrap();
    PayrollRepository::create_payment(&conn, pay(a, "2026-10", "ADVANCE", 5000.0), TODAY).unwrap();
    let d = PayrollRepository::create_payment(&conn, EmployeePaymentInput { payment_method: None, ..pay(a, "2026-10", "CARRIED", 1000.0) }, TODAY).unwrap();
    let carried = d.entries.iter().find(|e| e.kind == "CARRIED").unwrap().clone();
    assert_eq!((d.status.as_str(), carried.carried_to.as_deref(), carried.payment_method), ("PAID", Some("2026-11"), None));
    let next = PayrollRepository::pay_month(&conn, a, "2026-11", TODAY).unwrap();
    assert_eq!((next.carried_in.len(), next.figures.given, next.editable), (1, 1000.0, false));
    assert_eq!(PayrollRepository::pay_sheet(&conn, "2026-11", TODAY).unwrap().rows.len(), 1, "a carried-in advance shows next month");
    PayrollRepository::delete_payment(&conn, carried.id).unwrap();
    assert_eq!(PayrollRepository::pay_month(&conn, a, "2026-10", TODAY).unwrap().status, "OVERPAID");
}

#[test]
fn cleared_entries_need_an_overpaid_month_with_days() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    let w = |amount| EmployeePaymentInput { payment_method: None, ..pay(a, "2026-10", "WRITE_OFF", amount) };
    PayrollRepository::create_payment(&conn, pay(a, "2026-10", "ADVANCE", 500.0), TODAY).unwrap();
    assert_eq!(PayrollRepository::create_payment(&conn, w(100.0), TODAY).unwrap_err(), "Enter the days for October 2026 first.");
    PayrollRepository::save_pay_month(&conn, a, "2026-10", days(10.0), TODAY).unwrap();
    assert_eq!(PayrollRepository::create_payment(&conn, w(100.0), TODAY).unwrap_err(), "October 2026 is not overpaid.");
}

#[test]
fn taking_from_next_month_needs_the_employee_there() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Murugan", "2026-01-01");
    PayrollRepository::save_pay_month(&conn, a, "2026-10", days(1.0), TODAY).unwrap();
    PayrollRepository::create_payment(&conn, pay(a, "2026-10", "ADVANCE", 5000.0), TODAY).unwrap();
    PayrollRepository::mark_left(&conn, a, "2026-10-20").unwrap();
    let c = EmployeePaymentInput { payment_method: None, ..pay(a, "2026-10", "CARRIED", 100.0) };
    assert_eq!(PayrollRepository::create_payment(&conn, c, TODAY).unwrap_err(), "Murugan isn't working in November 2026. Use Cash returned or Write off.");
}

#[test]
fn entries_need_an_amount_a_method_and_an_open_month() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    let err = |i| PayrollRepository::create_payment(&conn, i, TODAY).unwrap_err();
    assert_eq!(err(pay(a, "2026-10", "LOAN", 100.0)), "Unknown payment kind.");
    assert_eq!(err(pay(a, "2026-10", "ADVANCE", 0.0)), "Amount must be more than 0.");
    assert_eq!(err(EmployeePaymentInput { payment_method: Some("  ".into()), ..pay(a, "2026-10", "ADVANCE", 100.0) }), "Choose how it was paid.");
    assert_eq!(err(pay(a, "2026-11", "ADVANCE", 100.0)), "November 2026 hasn't started yet.");
    assert_eq!(err(pay(a, "2025-12", "ADVANCE", 100.0)), "Anbu isn't on the pay sheet for December 2025.");
}

#[test]
fn the_dashboard_gets_only_money_handed_over() {
    let (_d, conn) = setup();
    let a = emp(&conn, "Anbu", "2026-01-01");
    PayrollRepository::save_pay_month(&conn, a, "2026-10", days(1.0), TODAY).unwrap();
    PayrollRepository::create_payment(&conn, pay(a, "2026-10", "ADVANCE", 1000.0), TODAY).unwrap();
    PayrollRepository::create_payment(&conn, EmployeePaymentInput { payment_method: None, ..pay(a, "2026-10", "WRITE_OFF", 400.0) }, TODAY).unwrap();
    let list = PayrollRepository::list_wage_payments(&conn, "2026-10-01", "2026-10-31").unwrap();
    assert_eq!(list.iter().map(|p| (p.kind.as_str(), p.amount)).collect::<Vec<_>>(), vec![("ADVANCE", 1000.0)]);
    assert!(PayrollRepository::list_wage_payments(&conn, "2026-11-01", "2026-11-30").unwrap().is_empty());
}

#[test]
fn float_dust_does_not_leave_a_paisa_open() {
    let (_d, conn) = setup();
    let mut i = input("Anbu", "2026-01-01"); i.daily_wage = 433.33; i.ot_rate = 66.67;
    let a = PayrollRepository::create_employee(&conn, i).unwrap().employee.id;
    PayrollRepository::save_pay_month(&conn, a, "2026-10", PayMonthInput { ot_hours: 1.75, ..days(3.0) }, TODAY).unwrap();
    PayrollRepository::create_payment(&conn, pay(a, "2026-10", "ADVANCE", 0.1), TODAY).unwrap();
    PayrollRepository::create_payment(&conn, pay(a, "2026-10", "ADVANCE", 0.2), TODAY).unwrap();
    let d = PayrollRepository::create_payment(&conn, pay(a, "2026-10", "SALARY", 1416.36), TODAY).unwrap();
    assert_eq!((d.figures.balance, d.status.as_str()), (0.0, "PAID"));
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `tools\test-harness\test.bat payroll::repository`
Expected: FAIL to compile (`no function or associated item named create_payment`).

- [ ] **Step 3: Implement the functions above**

- [ ] **Step 4: Run the tests**

Run: `tools\test-harness\test.bat payroll`
Expected: all payroll tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/payroll/repository.rs
git commit -m "feat: advances, salary with round-off, and finishing overpaid months" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tauri commands

**Files:**
- Create: `src-tauri/src/payroll/commands.rs`
- Modify: `src-tauri/src/payroll/mod.rs` (`pub mod commands; pub use commands::*;`)
- Modify: `src-tauri/src/lib.rs` (register every command in `generate_handler!`, after the `rentals::` group)

**Interfaces:**
- Consumes: every `PayrollRepository` function from Tasks 3–5.
- Produces (thin wrappers in the shape of `rentals/commands.rs`; `today` = `today().format("%Y-%m-%d").to_string()`):
  `list_employees()`, `get_employee(id)`, `create_employee(input)`, `update_employee(id, input)`, `delete_employee(id)`, `mark_employee_left(id, left_on)`, `rejoin_employee(id, joined_on)`, `find_employees_by_name(name, exclude_id: Option<i64>)` (None → -1), `add_employee_file(employee_id, file_name, data_base64)` (`decode_upload`), `remove_employee_file(file_id)`, `get_employee_file_preview(file_id)` (`image_data_url`), `open_employee_file(file_id)` (`prepare_temp_copy(.., "employee", ..)`), `get_employee_pay_history(employee_id)` (limit 12), `get_pay_sheet(month)`, `save_pay_sheet(month, rows)`, `get_pay_month(employee_id, month)`, `save_pay_month(employee_id, month, input)`, `delete_pay_month(employee_id, month)`, `create_employee_payment(input)`, `update_employee_payment(id, input)`, `delete_employee_payment(id)`, `list_wage_payments(from, to)`.

- [ ] **Step 1: Write `commands.rs` and register the commands**

- [ ] **Step 2: Check the app compiles with no warnings**

Run: the `cargo check` command from Global Constraints
Expected: `Finished` with no `warning:` lines.

- [ ] **Step 3: Run the full Rust test suite**

Run: `tools\test-harness\test.bat`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/payroll src-tauri/src/lib.rs
git commit -m "feat: payroll commands" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: UI types, API calls and the shared pay helpers

**Files:**
- Create: `src/types/payroll.ts`
- Modify: `src/services/api.ts`
- Create: `src/lib/payroll.ts`

**Interfaces:**
- Consumes: Task 6's command names and the `models.rs` shapes.
- Produces:
  - `src/types/payroll.ts`: one interface per `models.rs` struct, field for field in snake_case (`Employee`, `EmployeeInput`, `EmployeeListItem`, `EmployeeFileInfo`, `EmployeeDetail`, `PayRow`, `PayMonthInput`, `MonthFigures`, `EmployeePayment`, `EmployeePaymentInput`, `PayMonthDetail`, `PaySheetRow`, `PaySheet`, `PaySheetEntry`, `PayMonthSummary`), plus `export type PayStatus = "NOT_ENTERED" | "TO_PAY" | "PAID" | "OVERPAID";` and `export type WageKind = "ADVANCE" | "SALARY" | "RETURNED" | "WRITE_OFF" | "CARRIED";`, used for the `status` and `kind` fields.
  - `api.ts`, one function per command, args in camelCase: `listEmployees()`, `getEmployee(id)`, `createEmployee(input)`, `updateEmployee(id, input)`, `deleteEmployee(id)`, `markEmployeeLeft(id, leftOn)`, `rejoinEmployee(id, joinedOn)`, `findEmployeesByName(name, excludeId?)`, `addEmployeeFile(employeeId, fileName, dataBase64)`, `removeEmployeeFile(fileId)`, `getEmployeeFilePreview(fileId)`, `openEmployeeFile(fileId)`, `getEmployeePayHistory(employeeId)`, `getPaySheet(month)`, `savePaySheet(month, rows)`, `getPayMonth(employeeId, month)`, `savePayMonth(employeeId, month, input)`, `deletePayMonth(employeeId, month)`, `createEmployeePayment(input)`, `updateEmployeePayment(id, input)`, `deleteEmployeePayment(id)`, `listWagePayments(from, to)`.
  - `src/lib/payroll.ts`:
    - `payLine(qty: number, rate: number): number` (`round2(qty * rate)`)
    - `parseQuantity(text: string, kind: "days" | "hours"): { value: number | null; error: string | null }`: `""` (after trim) gives `{ value: null, error: null }`; not a number or negative gives `"Enter a number"`; days not in half steps gives `"Half days only, e.g. 25.5"`; hours with more than two decimals gives `"Up to two decimals"`
    - `STATUS_LABEL: Record<PayStatus, string>` = Not entered / To pay / Paid / Overpaid; `STATUS_TONE: Record<PayStatus, "neutral" | "amber" | "green" | "red">` = neutral / amber / green / red for `Badge` (the `Tone` type in `ui.tsx` isn't exported, so spell out the union)
    - `statusText(status: PayStatus, f: MonthFigures): string` gives `"To pay ₹13,260.00"`, `"Paid"`, `"Paid · rounded off ₹10.00"`, `"Paid · ₹40.00 extra"`, `"Overpaid ₹1,000.00"`, `"Not entered"` or `"Not entered · ₹3,000.00 given"` (money through `formatMoney`)
    - `WAGE_KIND_LABEL: Record<WageKind, string>` = Advance / Salary / Cash returned / Written off / Taken from next month; `carriedInLabel(fromMonth: string)` gives `"Advance carried from October 2026"`

- [ ] **Step 1: Write the three files**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/types/payroll.ts src/services/api.ts src/lib/payroll.ts
git commit -m "feat: payroll types, API calls and pay helpers for the UI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Employees page, Employees tab, employee form and window

**Files:**
- Create: `src/pages/EmployeesPage.tsx`
- Create: `src/components/employees/EmployeesTab.tsx`, `EmployeeFormModal.tsx`, `EmployeeDetailsModal.tsx`
- Modify: `src/App.tsx` (`Page` gains `"employees"`; `NAV_GROUPS` gains `[{ id: "employees", label: "Employees", icon: HardHat }]` right after the Customers & suppliers group; render `{page === "employees" && <EmployeesPage />}`; import `HardHat` from `lucide-react`)

**Interfaces:**
- Consumes: Task 7's API calls and helpers.
- Produces:
  - `EmployeesPage()`: the RentalsPage tab bar (slider included) with `Tab = "sheet" | "employees"`, labels "Pay sheet" and "Employees", opening on "sheet"; `PageHeader title="Employees" description="Who works here, their days and overtime each month, and what has been paid."`. Until Task 10, the "sheet" tab shows `EmptyState` text "Pay sheet coming next.".
  - `EmployeeFormModal({ existing, onClose, onSaved }: { existing?: EmployeeDetail; onClose: () => void; onSaved: (d: EmployeeDetail) => void })`: fields name*, role, phone, address, joined on* (today by default), daily wage*, OT rate per hour (0 by default, hint "0 if no overtime pay"), notes, files (`useFileAttachments` with `addEmployeeFile`, the same as `TenantFormModal`). On name blur, `findEmployeesByName` shows an amber line `There is already an employee named Murugan (Welder). Saving adds another.` (the matches' names and roles); Save is still allowed. `useDiscardGuard` as in other forms.
  - `EmployeeDetailsModal({ employeeId, onClose, onChanged, onOpenMonth }: { employeeId: number; onClose: () => void; onChanged: () => void; onOpenMonth?: (month: string) => void })`: details; `FileViewer` with `getEmployeeFilePreview` / `openEmployeeFile`; a "Last 12 months" table (Month, Days, OT hrs, Earned, Paid, Status via `statusText`) from `getEmployeePayHistory`, where clicking a row calls `onOpenMonth`; footer buttons Edit, Mark as left (a small modal with a date, today by default) or Rejoin (a date) when left, and Delete (`ConfirmDialog`; a Rust error shows in an `Alert`).
  - `EmployeesTab()`: search (name, role, phone) with `/`, filter buttons Working / Left / All (Working by default; "Left" = `left_on !== null`), table Name · Role · Phone · Daily wage · OT rate/hr · Joined (with a "Left 31-03-2026" badge when left), `rowProps` to open `EmployeeDetailsModal`, **Ctrl+N** and a "New employee" button to open `EmployeeFormModal`; `EmptyState` "No employees yet." with the button.

- [ ] **Step 1: Write the components and wire `App.tsx`**

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both succeed.

- [ ] **Step 3: Check in the app** (`app.bat dev`, sample names only)

Expected: Employees shows in the sidebar with the hard hat; adding "Murugan" twice shows the amber same-name line and still saves; a file attaches and previews; Mark as left moves him under "Left" with the badge; Rejoin brings him back with the new joining date; Delete works for a new employee; `/` and Ctrl+N work, and do nothing while a window is open.

- [ ] **Step 4: Commit**

```bash
git add src/pages/EmployeesPage.tsx src/components/employees src/App.tsx
git commit -m "feat: employees screen with details window, files, leaving and rejoining" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Month window and wage entry form

**Files:**
- Create: `src/components/employees/PayMonthModal.tsx`, `src/components/employees/WageEntryFormModal.tsx`
- Modify: `src/components/employees/EmployeesTab.tsx` (pass `onOpenMonth` so a month in the employee window opens `PayMonthModal` on top; closing it reloads the employee window)

**Interfaces:**
- Consumes: Task 7's `getPayMonth`, `savePayMonth`, `deletePayMonth`, `createEmployeePayment`, `updateEmployeePayment`, `deleteEmployeePayment`, `payLine`, `parseQuantity`, `statusText`, `WAGE_KIND_LABEL`, `carriedInLabel`, and `PAYMENT_METHODS`.
- Produces:
  - `PayMonthModal({ employeeId, month, onClose, onChanged }: { employeeId: number; month: string; onClose: () => void; onChanged: () => void })`. Title `"{name} · {Month Year}"`, with a status badge in the header.
    - **Working:** `25.5 days × ₹600.00 = ₹15,300.00`, `12 h × ₹80.00 = ₹960.00`, `Bonus (Diwali) ₹500.00`, **Earned**, then each entry, Paid, and the status line.
    - **Month form** (when `editable`): days, OT hours, daily wage, OT rate, bonus, bonus reason, note. "Save month" calls `savePayMonth`. If the status before saving was PAID and earned changes, a `ConfirmDialog` first: `"{Month Year} is already paid. Changing it will show the difference to pay or overpaid."`. An OT-rate-0-with-hours warning appears in amber. Without a row, the button reads "Enter the days".
    - **Entries table:** Date · Kind (`WAGE_KIND_LABEL`) · Method · Amount, with the round-off shown under a salary that has one; carried-in rows read `carriedInLabel`. Clicking an entry opens `WageEntryFormModal` with `existing`; delete is inside that form.
    - **Buttons** (only when `editable`): Pay salary, Give advance; when OVERPAID also Take from next month, Cash returned, Write off; "Delete month" (`ConfirmDialog`, the Rust error in an `Alert`). When not editable (a future month holding a carried advance), the window is read-only with the note `"You can enter this month once it starts."`.
  - `WageEntryFormModal({ detail, kind, existing, employeeChoices, month, onClose, onSaved }: { detail: PayMonthDetail | null; kind: WageKind; existing?: EmployeePayment; employeeChoices?: { id: number; name: string }[]; month: string; onClose: () => void; onSaved: (d: PayMonthDetail) => void })`. When `detail` is null it first shows a `SearchSelect` of `employeeChoices` and loads `getPayMonth(id, month)` on pick.
    - Titles: "Give advance", "Pay salary", "Cash returned", "Write off", "Take from next month"; with `existing`, "Edit " + label.
    - Fields: amount; date (today); method (`PAYMENT_METHODS`, "Cash" by default) for ADVANCE, SALARY and RETURNED; note.
    - **Prefill:** SALARY = the balance when > 0; RETURNED, WRITE_OFF and CARRIED = the overpaid amount.
    - **SALARY:** when there is a pay row and the amount differs from the balance, show a "Round off and finish" checkbox. Ticked, it shows `"Rounded off ₹10.00 (paid less)"` or `"₹40.00 extra, counted as paid"`, and above ₹100 adds an amber `"That's a round-off of more than ₹100. Check the amount."`. Unticked with amount > balance shows `"This pays ₹40.00 more than is due. The month will show Overpaid."`.
    - **CARRIED:** shows `"It will show as an advance on {next Month Year} pay."`.
    - With `existing`: a Delete button (`ConfirmDialog`). Errors from Rust show in an `Alert`.

- [ ] **Step 1: Write both components and wire the employee window**

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both succeed.

- [ ] **Step 3: Check in the app**

Expected, using a sample employee at ₹600/day and ₹80/h: entering 25.5 days and 12 hours shows ₹16,260.00 earned; a ₹3,000 advance leaves "To pay ₹13,260.00"; paying ₹13,250 with Round off and finish gives "Paid · rounded off ₹10.00"; editing the days to 26.5 asks first, then shows "To pay ₹600.00"; a ₹5,000 advance on a ₹4,000 month offers the three overpaid buttons, and "Take from next month" puts "Advance carried from …" on next month's window, which is read-only.

- [ ] **Step 4: Commit**

```bash
git add src/components/employees
git commit -m "feat: month window with salary, advances, round-off and overpaid months" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Pay sheet tab with Enter days

**Files:**
- Create: `src/components/employees/PaySheetTab.tsx`
- Modify: `src/components/MonthFilter.tsx` (optional prop `allowAll?: boolean`, true by default; when false the "All months" option is left out)
- Modify: `src/pages/EmployeesPage.tsx` (render `PaySheetTab` in the "sheet" tab)

**Interfaces:**
- Consumes: `getPaySheet`, `savePaySheet`, `PayMonthModal`, `WageEntryFormModal`, `EmployeeFormModal`, `parseQuantity`, `payLine`, `statusText`, `MonthFilter`, `shiftMonth`, `currentMonth`.
- Produces: `PaySheetTab()`.
  - **Month picker:** `MonthFilter` with `allowAll={false}`, `value` = month (`currentMonth()` at first), `dates` = every month from `sheet.first_month` to `sheet.last_month` as `YYYY-MM-01`.
  - **Table:** Name (role) · Days · OT hrs · Wages · OT · Bonus · Earned · Paid (`figures.given`) · Status (`Badge` + `statusText`); `rowProps` opens `PayMonthModal`.
  - **Footer:** Earned total, Paid total, Still to pay, and "N not entered" when N > 0.
  - **Top buttons:** "Enter days" (disabled for a month after the current one) and "Give advance" (opens `WageEntryFormModal` with `detail={null}`, `kind="ADVANCE"`, `employeeChoices` = the sheet's rows). **Ctrl+N** opens `EmployeeFormModal`. With no employees: `EmptyState` "Add your employees first." with a "New employee" button.
  - **Enter days mode:** Days and OT hrs become `<input type="text" inputMode="decimal">` boxes filled from the rows, read with `parseQuantity`, each error shown in red under its box; Wages / OT / Earned preview with `payLine` (the row's rates, or `current_wage` / `current_ot_rate` for new rows).
    - An empty Days box on a row without a pay row skips it. An empty Days box on a saved row gives `"Enter days (0 if absent)"`. OT hours typed with empty Days gives `"Enter days first"`. Empty OT hrs counts as 0.
    - Save is disabled while any box has an error. Save calls `savePaySheet(month, entries)`, shows a toast `Saved days for N employees`, and leaves the mode. A Rust error shows in an `Alert` and keeps the boxes.
    - Cancel with changes asks `ConfirmDialog` "Discard the days you typed?".

- [ ] **Step 1: Write `PaySheetTab`, add `allowAll` to `MonthFilter`, and render the tab**

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both succeed. Other screens' month filters are unchanged (the default `allowAll` is true).

- [ ] **Step 3: Check in the app**

Expected: the sheet opens on this month and lists only who is employed then; Enter days for three sample employees saves in one go and the totals update; going back to last month works; a mid-month joiner can't be given more days than they were employed (the Rust error names them and nothing saves).

- [ ] **Step 4: Manual checks for Review Focus 2**

Expected: (a) leaving a new row's Days empty and saving skips that row; (b) typing `abc`, `-2` or `25.25` in Days shows the inline error and disables Save; (c) typing `1.255` in OT hrs shows "Up to two decimals". In none of these does a request reach Rust: no error toast, and the other rows are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/employees/PaySheetTab.tsx src/components/MonthFilter.tsx src/pages/EmployeesPage.tsx
git commit -m "feat: pay sheet with Enter days for the whole month" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Wages in the dashboard, and docs

**Files:**
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `docs/PROJECT_STRUCTURE.md`, `AGENTS.md`, `README.md`

**Interfaces:**
- Consumes: `listWagePayments(from, to)`.
- Produces:
  - **Dashboard:** `load` adds `listWagePayments(`${shiftMonth(currentMonth(), -5)}-01`, todayISO())` to its `Promise.allSettled`, and stores `wages: ok(wages, [])` (type `EmployeePayment[]`). `paidOut` becomes `monthlySums([...supplier payments as now, ...data.wages.map((w) => ({ date: w.entry_date, amount: w.amount }))], months)`. The label stays "Paid out".
  - **`PROJECT_STRUCTURE.md`:**
    - an **Employees** row in the Screens table (Pay sheet tab with Enter days; Employees tab; the month window; the employee window)
    - an **Employees and payroll (migration 22)** bullet under Business rules, summarising the spec's maths and rules 1–16 in the existing bullet style
    - the dashboard row now says Paid out includes wages
    - `components/employees/` and `payroll/` (`calc.rs`, models, repository, commands) in Code layout
    - `payroll/calc.rs` and `payroll/repository.rs` in the Tests list and the harness module list
    - `employee_<id>_<name>` in the Temp naming under Data on disk
    - "employee" in the Ctrl+N list
  - **`AGENTS.md`:** add `payroll/` to the Rust layout line and one rule bullet: `Payroll: pay = days × daily wage + OT hours × OT rate + bonus, with the rates copied onto each month. Each month stands alone: paid exactly, or rounded off and finished; an overpaid month is finished by taking it from next month, cash returned or a write-off. No loans, PF/ESI or pay slips. Rules in payroll/repository.rs, maths in payroll/calc.rs.`
  - **`README.md`:** add "employees and payroll" to the feature sentence on line 3.

- [ ] **Step 1: Make the dashboard change**

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both succeed.

- [ ] **Step 3: Check in the app**

Expected: after a ₹1,000 sample advance this month, the dashboard's "Paid out" bar for this month rises by ₹1,000 (hover shows the new total); a write-off or a carried advance doesn't change it.

- [ ] **Step 4: Update the three docs**

- [ ] **Step 5: Final verification**

Run: `tools\test-harness\test.bat`, the `cargo check` command from Global Constraints, `npx tsc --noEmit -p .`, `npm run build`
Expected: all tests pass, no Rust warnings, no type errors, and the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/pages/DashboardPage.tsx docs/PROJECT_STRUCTURE.md AGENTS.md README.md
git commit -m "feat: wages in the dashboard's paid out; docs for employees and payroll" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
