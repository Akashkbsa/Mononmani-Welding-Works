# Employees and payroll — design

Date: 2026-10-15. Status: agreed in conversation, waiting for review of this written spec.

## Goal

The owner keeps a list of employees and pays each one monthly by the day. At month end they type each person's days worked and overtime hours. The app works out the pay (days × that person's daily wage + OT hours × that person's OT rate + an occasional bonus), keeps the advances given during the month, and records the salary paid, exactly or rounded off. Everything lives inside the app for the owner only, on this one computer, like the rest.

## Decisions taken

| Question | Decision |
|---|---|
| How days are recorded | Month-end totals typed once a month (no daily register). Half days allowed. |
| Overtime | OT hours × the employee's own hourly OT rate. |
| Money before month end | Advances only. No loans. |
| Other pay items | An occasional bonus with a reason. No allowances, incentives or other deductions. |
| Statutory | No PF, ESI or TDS. |
| Record for the employee | None: no pay slip, no WhatsApp message. Pay is shown only in the app. |
| Structure | A monthly pay sheet with the rates copied onto each month. |
| Between months | Each month stands alone and nothing carries over automatically. A month is paid exactly or rounded off and finished. |
| Advances more than earned | The owner picks each time: take it from next month, cash returned, or write off. |
| Files | Yes, on employees (for example an ID proof photo); used rarely. No PIN, the same as rentals. |
| Dashboard | Wages paid count in the "Paid out" bars of the money in/out chart. |

## Data (migration 22, `022_payroll`)

All new tables get `change_log` insert/update/delete triggers, so the Google Drive backup includes them.

```sql
CREATE TABLE employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NULL,                       -- e.g. Welder, Helper
    phone TEXT NULL,
    address TEXT NULL,
    joined_on TEXT NOT NULL,              -- YYYY-MM-DD
    left_on TEXT NULL,                    -- set by "Mark as left", cleared by "Rejoin"
    daily_wage REAL NOT NULL CHECK (daily_wage > 0),
    ot_rate REAL NOT NULL DEFAULT 0 CHECK (ot_rate >= 0),   -- per hour; 0 = no OT pay
    notes TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- One row per employee per month once days are entered.
CREATE TABLE pay_months (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    month TEXT NOT NULL,                  -- YYYY-MM
    days_worked REAL NOT NULL CHECK (days_worked >= 0 AND days_worked <= 31),
    daily_wage REAL NOT NULL CHECK (daily_wage > 0),        -- copied from the employee on first save
    ot_hours REAL NOT NULL DEFAULT 0 CHECK (ot_hours >= 0),
    ot_rate REAL NOT NULL DEFAULT 0 CHECK (ot_rate >= 0),   -- copied from the employee on first save
    bonus_amount REAL NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
    bonus_note TEXT NULL,
    note TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (employee_id, month)
);

-- Every money movement for a month's pay.
CREATE TABLE employee_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    month TEXT NOT NULL,                  -- YYYY-MM the entry counts against
    kind TEXT NOT NULL CHECK (kind IN ('ADVANCE', 'SALARY', 'RETURNED', 'WRITE_OFF', 'CARRIED')),
    entry_date TEXT NOT NULL,             -- YYYY-MM-DD
    amount REAL NOT NULL CHECK (amount > 0),
    round_off REAL NOT NULL DEFAULT 0,    -- SALARY only: + paid less and accepted, - paid more
    carried_to TEXT NULL,                 -- CARRIED only: the month after `month`
    payment_method TEXT NULL,             -- ADVANCE, SALARY, RETURNED; NULL for WRITE_OFF and CARRIED
    note TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((kind = 'CARRIED') = (carried_to IS NOT NULL)),
    CHECK (kind = 'SALARY' OR round_off = 0)
);

CREATE TABLE employee_files (             -- same columns as rental_files, one owner kind
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL
);
```

Indexes: `pay_months(month)`, `employee_payments(employee_id, month)`, `employee_payments(carried_to)`, `employee_payments(entry_date)`, `employee_files(employee_id)`. Date and month columns use the same `GLOB` checks as the reminders table.

Nothing derived is stored: wages, OT amount, earned, balance and status are always worked out.

## Pay maths

For employee E and month M (all money rounded to the paisa with `util::round2`; each line is rounded before adding):

- **Wages** = days_worked × daily_wage
- **OT** = ot_hours × ot_rate
- **Earned** = wages + OT + bonus_amount (0 when there is no pay row)
- **Given** = ADVANCE + SALARY amounts with `month = M`, plus CARRIED amounts with `carried_to = M` (an advance carried in from the month before)
- **Cleared** = RETURNED + WRITE_OFF + CARRIED amounts with `month = M`
- **Rounded off** = sum of `round_off` on SALARY entries with `month = M`
- **Balance** = earned − given + cleared − rounded off

| Status | When |
|---|---|
| Not entered | no pay row (shown as "Not entered · ₹X given" when entries exist) |
| To pay ₹X | balance > 0 |
| Paid | balance = 0 ("Paid · rounded off ₹10" or "Paid · ₹40 extra" when there is a round-off) |
| Overpaid ₹X | balance < 0 |

Example: wage ₹600, OT rate ₹80. October: 25.5 days, 12 OT hours, an advance of ₹3,000 on 15-10. Wages ₹15,300 + OT ₹960 = ₹16,260 earned; balance ₹13,260. A ₹13,250 salary with "Round off and finish" stores `round_off = 10`, and the month is Paid · rounded off ₹10.

## Rules (enforced in `payroll/repository.rs`)

**Employees**
1. Name is required (trimmed). The same name as another employee (any case) is a **warning**, not an error: the form asks to confirm, the same way duplicate purchase order numbers work.
2. Daily wage > 0, OT rate ≥ 0, both rounded to the paisa. Phone is optional: digits, spaces, `+` and `-`, at most 20 characters.
3. `left_on` ≥ `joined_on`, and the leaving month can't be before the last month that has any record for the employee (a pay row, an entry, or a carried-in advance). Marking as left with a balance open is allowed; the window says what is still open.
4. **Rejoin** asks for a date after `left_on`, sets `joined_on` to it and clears `left_on`.
5. An employee with any pay row or entry can't be deleted ("Mark as left instead"). Files go with the employee.
6. Changing the wage or OT rate changes only months not yet entered.

**Which months are open.** Month M is open for E when (M is from E's joining month to E's leaving month, or to the current month if E hasn't left) and M ≤ the current month, **or** E already has a record in M. Open months are the ones that list E on the pay sheet and accept pay rows and entries. The one exception is the target of "Take from next month", which can be the month after the current month (rule 15).

**Pay rows**
7. Days: 0 up to the days E was employed in M, in steps of 0.5. That is the whole month (28–31), except that a joining date or leaving date inside M limits it to the days from joining or up to leaving. For a month before the current joining date (kept because it has records), the whole month counts. 0 is allowed and means absent all month.
8. OT hours: 0 or more, up to two decimals, at most 24 × days in the month. Hours can't be saved without days. A warning shows when hours are typed and the OT rate is 0.
9. On first save the row copies the employee's daily wage and OT rate. The month window can change them for that month (a raise that applies to that month). A raise in the middle of a month isn't split; the owner picks the month's rate.
10. Bonus ≥ 0 with an optional reason.
11. Editing a month that is Paid is allowed. The month just shows the new difference (To pay or Overpaid) and the window warns first. Nothing moves to another month.
12. A pay row can't be deleted while any entry counts on that month (`month = M`, or `carried_to = M`).

**Entries**
13. **ADVANCE / SALARY:** amount > 0, a payment method (Cash by default, from the app's `PAYMENT_METHODS`) and a date. An advance can be given before the month's days are entered. Paying more than the balance is allowed with a warning; without a round-off, the month then shows Overpaid.
14. **Round off and finish** (SALARY only, the month must have a pay row): `round_off` is set so the balance after this payment is exactly 0, positive when paid less and negative when paid more. There's no size limit; the form warns above ₹100.
15. **When a month is Overpaid**, three ways to finish it, and each amount must be > 0 and no more than the overpaid amount:
    - **Take from next month** (CARRIED): `carried_to` = M + 1, which must be open for E (not after E's leaving month, and at most one month after the current month). It counts as cleared on M and as an advance ("carried from October") on M + 1. It's one row, so deleting it undoes both sides at once.
    - **Cash returned** (RETURNED): with a payment method.
    - **Write off** (WRITE_OFF): the owner forgives it.
16. Editing an entry is checked as if the entry were not there yet; changing its month must land on an open month. Deleting an entry is always allowed, and deleting a SALARY with a round-off reopens the month.

## Screens

**Sidebar:** a new **Employees** item (`HardHat` icon) in its own group under Customers & suppliers. `Page` gains `"employees"`.

**Employees page, two tabs:**

1. **Pay sheet** — a month picker that opens on this month. It offers every month from the earliest joining date to the current month, plus any month with records, and has no "All months" (`MonthFilter` gains a prop to hide it).
   - Columns: Name (role) · Days · OT hrs · Wages · OT · Bonus · Earned · Paid · Status. Paid is "given" from the maths: advances and salary, including an advance carried in.
   - **Enter days** turns Days and OT hrs into input boxes for every row. Tab moves through them, and **Save** stores all rows in one transaction (all or nothing, with errors naming the employee). Empty rows stay Not entered; existing rows change only days and hours, never the copied rates.
   - **Give advance** (top): pick an employee open in the month; the amount, date (today) and method.
   - Footer: total earned, total paid, total still to pay, and how many are not entered.
   - **Click a row** to open the **month window** for that employee and month: the working (25.5 days × ₹600 = ₹15,300 …), the copied rates (editable), bonus and reason, note, and the entries (date, kind, method, amount; click one to edit or delete it). Buttons: **Pay salary** (the balance filled in, with the **Round off and finish** tick), **Give advance**, and when Overpaid **Take from next month / Cash returned / Write off**. **Delete month** follows rule 12.

2. **Employees** — search, a Working / Left / All filter, and columns Name · Role · Phone · Daily wage · OT rate/hr · Joined.
   - **Click a row** to open the **employee window**: details, files (with the photo preview from `FileViewer`), and the last 12 months (days, OT hrs, earned, paid, status; click one to open its month window). Buttons: Edit, Mark as left or Rejoin, Delete (rule 5).
   - **Employee form:** name, role, phone, address, joined on, daily wage, OT rate per hour, notes, files.

**Keyboard** (`usePageShortcuts`): `/` jumps to the search box on the Employees tab; **Ctrl+N** opens a new employee on both tabs. Both keys are ignored while typing or while a window is open.

Dates show as DD-MM-YYYY and money as ₹ with Indian grouping, like everywhere else.

## Dashboard

`paidOut` in `DashboardPage.tsx` adds ADVANCE and SALARY amounts by `entry_date` month to the supplier payments. CARRIED and WRITE_OFF move no money and aren't counted. Cash returned is rare and isn't subtracted. The label stays "Paid out".

## Code layout

**Rust:** `src-tauri/src/payroll/`
- `models.rs`: Employee, EmployeeInput, EmployeeListItem, EmployeeDetail, PayMonth, PayMonthInput, PaySheet / PaySheetRow, PayMonthDetail, EmployeePayment, EmployeePaymentInput, EmployeeFileInfo.
- `repository.rs`: the rules above, the maths (one function shared by the sheet, the month window and the employee's 12 months), and the SQL.
- `commands.rs`: `list_employees`, `get_employee`, `create_employee`, `update_employee`, `delete_employee`, `mark_employee_left`, `rejoin_employee`, `find_employees_by_name`, employee file add / delete / open (temp copies named `employee_<id>_<name>` through `attachments::temp_open_path`), `get_pay_sheet`, `save_pay_sheet`, `get_pay_month`, `save_pay_month`, `delete_pay_month`, `create_employee_payment`, `update_employee_payment`, `delete_employee_payment`, `list_wage_payments(from, to)` for the dashboard.
- Registered in `lib.rs`; the migration in `db/migrations.rs`; `employees`, `pay_months` and `employee_payments` added to `RECORD_TABLES` in `backup/repository.rs` ("employee", "pay month", "wage payment").

**UI:**
- `src/types/payroll.ts`, plus functions in `src/services/api.ts`.
- `src/lib/payroll.ts`: the same maths for live previews in forms (Rust stays the authority).
- `src/pages/EmployeesPage.tsx`.
- `src/components/employees/`: PaySheetTab, EmployeesTab, EmployeeFormModal, EmployeeDetailsModal, PayMonthModal, WageEntryFormModal (advance, salary, cash returned, write-off, take from next month).

## Testing

Rust tests in `payroll/repository.rs`; `payroll` added to `tools/test-harness/src/lib.rs` and run with `tools\test-harness\test.bat`:
- Maths: half days, OT with two decimals, paisa rounding per line, bonus, earned with no pay row.
- Days limits: the month's length (28/29/30/31), joining or leaving inside the month, steps of 0.5, OT cap, OT without days.
- Open months: before joining, after leaving, future months, months kept open by records after a rejoin.
- Finishing: exact payment, round-off down and up, round-off on a month with no pay row refused, editing a Paid month reopens it.
- Overpaid: take from next month (counted on both months, refused past the leaving month or two months ahead, delete undoes both), cash returned, write-off, each refused above the overpaid amount.
- Guards: delete an employee with records, delete a pay row with entries, leave before the last record month, rejoin before the leaving date.
- Batch save: all or nothing, copied rates untouched on existing rows.
- Migration 22 on a fresh database and on one at version 21; triggers write to `change_log`.

Then `npx tsc --noEmit -p .`, `npm run build` and `cargo check`.

## Docs

`docs/PROJECT_STRUCTURE.md` (screen table, business rules, code layout, tests list) and the rules list in `AGENTS.md`.

## Not included

Loans, allowances, incentives, other deductions, PF/ESI/TDS, a daily attendance register, pay slips or WhatsApp messages, "Remind me" links to employees (the reminders table only accepts a fixed list of record types; a plain monthly reminder works today), and a "wages to pay" item in Needs attention.
