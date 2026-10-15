use super::models::*;
use crate::attachments::{clean_file_name, validate_file};
use crate::rentals::reminder::month_label;
use crate::util::{display_date, normalize_date, round2};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};

const EMPLOYEE_NOT_FOUND: &str = "Employee not found.";
const FILE_GONE: &str = "That file is no longer there.";

pub struct PayrollRepository;

fn clean(value: &Option<String>) -> Option<String> {
    value.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn check_wage(wage: f64) -> Result<f64, String> {
    let wage = round2(wage);
    if !wage.is_finite() || wage <= 0.0 {
        return Err("Daily wage must be more than 0.".to_string());
    }
    Ok(wage)
}

fn check_ot_rate(rate: f64) -> Result<f64, String> {
    let rate = round2(rate);
    if !rate.is_finite() || rate < 0.0 {
        return Err("OT rate can't be negative.".to_string());
    }
    Ok(rate)
}

const EMPLOYEE_COLUMNS: &str =
    "id, name, role, phone, address, joined_on, left_on, daily_wage, ot_rate, notes, created_at, updated_at";

fn map_employee(r: &Row) -> rusqlite::Result<Employee> {
    Ok(Employee {
        id: r.get(0)?,
        name: r.get(1)?,
        role: r.get(2)?,
        phone: r.get(3)?,
        address: r.get(4)?,
        joined_on: r.get(5)?,
        left_on: r.get(6)?,
        daily_wage: r.get(7)?,
        ot_rate: r.get(8)?,
        notes: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

const LIST_COLUMNS: &str = "e.id, e.name, e.role, e.phone, e.daily_wage, e.ot_rate, e.joined_on, e.left_on,
    (SELECT COUNT(*) FROM employee_files f WHERE f.employee_id = e.id)";

fn map_list_item(r: &Row) -> rusqlite::Result<EmployeeListItem> {
    Ok(EmployeeListItem {
        id: r.get(0)?,
        name: r.get(1)?,
        role: r.get(2)?,
        phone: r.get(3)?,
        daily_wage: r.get(4)?,
        ot_rate: r.get(5)?,
        joined_on: r.get(6)?,
        left_on: r.get(7)?,
        file_count: r.get(8)?,
    })
}

/// Cleaned employee details: name, role, phone, address, joining date, wage, OT rate, notes.
struct CleanEmployee {
    name: String,
    role: Option<String>,
    phone: Option<String>,
    address: Option<String>,
    joined_on: String,
    daily_wage: f64,
    ot_rate: f64,
    notes: Option<String>,
}

fn clean_employee(input: &EmployeeInput) -> Result<CleanEmployee, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("Employee name is required.".to_string());
    }
    let daily_wage = check_wage(input.daily_wage)?;
    let ot_rate = check_ot_rate(input.ot_rate)?;
    let phone = clean(&input.phone);
    if let Some(p) = &phone {
        if p.chars().count() > 20 || !p.chars().all(|c| c.is_ascii_digit() || c == ' ' || c == '+' || c == '-') {
            return Err("Phone can have only digits, spaces, + and -, up to 20 characters.".to_string());
        }
    }
    let joined_on = normalize_date(&input.joined_on, "Joining date")?;
    Ok(CleanEmployee {
        name,
        role: clean(&input.role),
        phone,
        address: clean(&input.address),
        joined_on,
        daily_wage,
        ot_rate,
        notes: clean(&input.notes),
    })
}

impl PayrollRepository {
    // ------------------------------------------------------------- employees

    pub fn create_employee(conn: &Connection, input: EmployeeInput) -> Result<EmployeeDetail, String> {
        let e = clean_employee(&input)?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO employees (name, role, phone, address, joined_on, daily_wage, ot_rate, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![e.name, e.role, e.phone, e.address, e.joined_on, e.daily_wage, e.ot_rate, e.notes, now],
        )
        .map_err(|e| format!("Failed to save the employee: {}", e))?;
        let id = conn.last_insert_rowid();
        Self::get_employee(conn, id)?.ok_or_else(|| "Saved employee could not be reloaded.".to_string())
    }

    pub fn update_employee(conn: &Connection, id: i64, input: EmployeeInput) -> Result<EmployeeDetail, String> {
        let current = Self::employee(conn, id)?;
        let e = clean_employee(&input)?;
        if let Some(left) = &current.left_on {
            if e.joined_on.as_str() > left.as_str() {
                return Err("The joining date can't be after the leaving date.".to_string());
            }
        }
        conn.execute(
            "UPDATE employees SET name = ?1, role = ?2, phone = ?3, address = ?4, joined_on = ?5, daily_wage = ?6,
                 ot_rate = ?7, notes = ?8, updated_at = ?9 WHERE id = ?10",
            params![e.name, e.role, e.phone, e.address, e.joined_on, e.daily_wage, e.ot_rate, e.notes, Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to save the employee: {}", e))?;
        Self::get_employee(conn, id)?.ok_or_else(|| EMPLOYEE_NOT_FOUND.to_string())
    }

    /// The employee row, or "Employee not found.".
    fn employee(conn: &Connection, id: i64) -> Result<Employee, String> {
        conn.query_row(&format!("SELECT {} FROM employees WHERE id = ?1", EMPLOYEE_COLUMNS), params![id], map_employee)
            .optional()
            .map_err(|e| format!("Failed to load the employee: {}", e))?
            .ok_or_else(|| EMPLOYEE_NOT_FOUND.to_string())
    }

    pub fn get_employee(conn: &Connection, id: i64) -> Result<Option<EmployeeDetail>, String> {
        let employee = match Self::employee(conn, id) {
            Ok(e) => e,
            Err(e) if e == EMPLOYEE_NOT_FOUND => return Ok(None),
            Err(e) => return Err(e),
        };
        let files = Self::files_of(conn, id)?;
        Ok(Some(EmployeeDetail { employee, files }))
    }

    pub fn list_employees(conn: &Connection) -> Result<Vec<EmployeeListItem>, String> {
        let mut stmt = conn
            .prepare(&format!("SELECT {} FROM employees e ORDER BY e.name COLLATE NOCASE, e.id", LIST_COLUMNS))
            .map_err(|e| format!("Failed to load employees: {}", e))?;
        let rows = stmt.query_map([], map_list_item).map_err(|e| format!("Failed to load employees: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read employees: {}", e))
    }

    /// Other employees with the same name (any case), for the "same name" warning.
    pub fn find_by_name(conn: &Connection, name: &str, exclude_id: i64) -> Result<Vec<EmployeeListItem>, String> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(Vec::new());
        }
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM employees e WHERE TRIM(e.name) = ?1 COLLATE NOCASE AND e.id != ?2 ORDER BY e.id",
                LIST_COLUMNS
            ))
            .map_err(|e| format!("Failed to check the name: {}", e))?;
        let rows = stmt.query_map(params![name, exclude_id], map_list_item).map_err(|e| format!("Failed to check the name: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to check the name: {}", e))
    }

    /// The latest month with a pay row, an entry, or an advance carried into it.
    fn last_record_month(conn: &Connection, id: i64) -> Result<Option<String>, String> {
        conn.query_row(
            "SELECT MAX(m) FROM (
                 SELECT month AS m FROM pay_months WHERE employee_id = ?1
                 UNION ALL SELECT month FROM employee_payments WHERE employee_id = ?1
                 UNION ALL SELECT carried_to FROM employee_payments WHERE employee_id = ?1 AND carried_to IS NOT NULL)",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check pay records: {}", e))
    }

    /// True when the month has a pay row, an entry, or an advance carried into it.
    fn has_record(conn: &Connection, id: i64, month: &str) -> Result<bool, String> {
        let n: i64 = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM pay_months WHERE employee_id = ?1 AND month = ?2)
                      + (SELECT COUNT(*) FROM employee_payments WHERE employee_id = ?1 AND (month = ?2 OR carried_to = ?2))",
                params![id, month],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to check pay records: {}", e))?;
        Ok(n > 0)
    }

    pub fn mark_left(conn: &Connection, id: i64, left_on: &str) -> Result<EmployeeDetail, String> {
        let e = Self::employee(conn, id)?;
        if e.left_on.is_some() {
            return Err(format!("{} is already marked as left.", e.name));
        }
        let left_on = normalize_date(left_on, "Leaving date")?;
        if left_on < e.joined_on {
            return Err("The leaving date can't be before the joining date.".to_string());
        }
        if let Some(last) = Self::last_record_month(conn, id)? {
            if last.as_str() > &left_on[..7] {
                return Err(format!("There are pay records for {}, after this leaving date.", month_label(&last)?));
            }
        }
        conn.execute(
            "UPDATE employees SET left_on = ?1, updated_at = ?2 WHERE id = ?3",
            params![left_on, Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to save the leaving date: {}", e))?;
        Self::get_employee(conn, id)?.ok_or_else(|| EMPLOYEE_NOT_FOUND.to_string())
    }

    /// Clears the leaving date and makes the rejoining date the new joining date.
    pub fn rejoin(conn: &Connection, id: i64, joined_on: &str) -> Result<EmployeeDetail, String> {
        let e = Self::employee(conn, id)?;
        let left = e.left_on.ok_or_else(|| format!("{} hasn't left.", e.name))?;
        let joined_on = normalize_date(joined_on, "Rejoining date")?;
        if joined_on <= left {
            return Err(format!("The rejoining date must be after the leaving date ({}).", display_date(&left)));
        }
        conn.execute(
            "UPDATE employees SET joined_on = ?1, left_on = NULL, updated_at = ?2 WHERE id = ?3",
            params![joined_on, Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to save the rejoining date: {}", e))?;
        Self::get_employee(conn, id)?.ok_or_else(|| EMPLOYEE_NOT_FOUND.to_string())
    }

    pub fn delete_employee(conn: &Connection, id: i64) -> Result<(), String> {
        Self::employee(conn, id)?;
        if Self::last_record_month(conn, id)?.is_some() {
            return Err("This employee has pay records and can't be deleted. Mark them as left instead.".to_string());
        }
        conn.execute("DELETE FROM employees WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete the employee: {}", e))?;
        Ok(())
    }

    // ------------------------------------------------------------------- files

    fn files_of(conn: &Connection, employee_id: i64) -> Result<Vec<EmployeeFileInfo>, String> {
        // The file contents are never read here, only their names and sizes.
        let mut stmt = conn
            .prepare("SELECT id, file_name, mime_type, size_bytes FROM employee_files WHERE employee_id = ?1 ORDER BY id")
            .map_err(|e| format!("Failed to load files: {}", e))?;
        let rows = stmt
            .query_map(params![employee_id], |r| {
                Ok(EmployeeFileInfo { id: r.get(0)?, file_name: r.get(1)?, mime_type: r.get(2)?, size_bytes: r.get(3)? })
            })
            .map_err(|e| format!("Failed to load files: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read files: {}", e))
    }

    pub fn add_file(conn: &Connection, employee_id: i64, file_name: &str, bytes: &[u8]) -> Result<EmployeeFileInfo, String> {
        Self::employee(conn, employee_id)?;
        let mime = validate_file(file_name, bytes)?;
        let name = clean_file_name(file_name);
        conn.execute(
            "INSERT INTO employee_files (employee_id, file_name, mime_type, size_bytes, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![employee_id, name, mime, bytes.len() as i64, bytes, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Failed to save the file: {}", e))?;
        Ok(EmployeeFileInfo { id: conn.last_insert_rowid(), file_name: name, mime_type: mime.to_string(), size_bytes: bytes.len() as i64 })
    }

    pub fn remove_file(conn: &Connection, file_id: i64) -> Result<(), String> {
        let removed = conn
            .execute("DELETE FROM employee_files WHERE id = ?1", params![file_id])
            .map_err(|e| format!("Failed to remove the file: {}", e))?;
        if removed == 0 {
            return Err(FILE_GONE.to_string());
        }
        Ok(())
    }

    /// File name, MIME type and contents of one attached file.
    pub fn read_file(conn: &Connection, file_id: i64) -> Result<(String, String, Vec<u8>), String> {
        conn.query_row("SELECT file_name, mime_type, data FROM employee_files WHERE id = ?1", params![file_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()
        .map_err(|e| format!("Failed to read the file: {}", e))?
        .ok_or_else(|| FILE_GONE.to_string())
    }
}

const ROW_COLUMNS: &str = "id, employee_id, month, days_worked, daily_wage, ot_hours, ot_rate, bonus_amount, bonus_note, note";

fn map_row(r: &Row) -> rusqlite::Result<PayRow> {
    Ok(PayRow {
        id: r.get(0)?,
        employee_id: r.get(1)?,
        month: r.get(2)?,
        days_worked: r.get(3)?,
        daily_wage: r.get(4)?,
        ot_hours: r.get(5)?,
        ot_rate: r.get(6)?,
        bonus_amount: r.get(7)?,
        bonus_note: r.get(8)?,
        note: r.get(9)?,
    })
}

const PAYMENT_COLUMNS: &str =
    "id, employee_id, month, kind, entry_date, amount, round_off, carried_to, payment_method, note, created_at, updated_at";

fn map_payment(r: &Row) -> rusqlite::Result<EmployeePayment> {
    Ok(EmployeePayment {
        id: r.get(0)?,
        employee_id: r.get(1)?,
        month: r.get(2)?,
        kind: r.get(3)?,
        entry_date: r.get(4)?,
        amount: r.get(5)?,
        round_off: r.get(6)?,
        carried_to: r.get(7)?,
        payment_method: r.get(8)?,
        note: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

/// `YYYY-MM` of a `YYYY-MM-DD` date.
fn month_of(date: &str) -> &str {
    date.get(..7).unwrap_or(date)
}

impl PayrollRepository {
    // -------------------------------------------------------------- pay rows

    fn pay_row(conn: &Connection, employee_id: i64, month: &str) -> Result<Option<PayRow>, String> {
        conn.query_row(
            &format!("SELECT {} FROM pay_months WHERE employee_id = ?1 AND month = ?2", ROW_COLUMNS),
            params![employee_id, month],
            map_row,
        )
        .optional()
        .map_err(|e| format!("Failed to load the month: {}", e))
    }

    /// The month's row and figures, leaving out one entry (an entry being edited).
    fn month_figures(conn: &Connection, employee_id: i64, month: &str, exclude_entry: Option<i64>) -> Result<(Option<PayRow>, MonthFigures), String> {
        let row = Self::pay_row(conn, employee_id, month)?;
        let (given, cleared, rounded_off): (f64, f64, f64) = conn
            .query_row(
                "SELECT
                     COALESCE(SUM(CASE WHEN (month = ?2 AND kind IN ('ADVANCE', 'SALARY')) OR (kind = 'CARRIED' AND carried_to = ?2) THEN amount END), 0),
                     COALESCE(SUM(CASE WHEN month = ?2 AND kind IN ('RETURNED', 'WRITE_OFF', 'CARRIED') THEN amount END), 0),
                     COALESCE(SUM(CASE WHEN month = ?2 AND kind = 'SALARY' THEN round_off END), 0)
                 FROM employee_payments WHERE employee_id = ?1 AND id != ?3 AND (month = ?2 OR carried_to = ?2)",
                params![employee_id, month, exclude_entry.unwrap_or(-1)],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| format!("Failed to load the payments: {}", e))?;
        let figures = super::calc::figures(row.as_ref(), given, cleared, rounded_off);
        Ok((row, figures))
    }

    fn has_carried_in(conn: &Connection, employee_id: i64, month: &str) -> Result<bool, String> {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM employee_payments WHERE employee_id = ?1 AND kind = 'CARRIED' AND carried_to = ?2",
                params![employee_id, month],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to check pay records: {}", e))?;
        Ok(n > 0)
    }

    /// Open months accept pay rows and entries: never after this month, and within the employee's
    /// months or already holding a record.
    fn check_open(conn: &Connection, e: &Employee, month: &str, today: &str) -> Result<(), String> {
        let label = month_label(month)?;
        let current = month_of(today);
        if month > current {
            return Err(format!("{} hasn't started yet.", label));
        }
        if super::calc::in_window(month, &e.joined_on, e.left_on.as_deref(), current) || Self::has_record(conn, e.id, month)? {
            Ok(())
        } else {
            Err(format!("{} isn't on the pay sheet for {}.", e.name, label))
        }
    }

    /// On the pay sheet: an open month, or a later month holding an advance carried into it.
    fn is_listed(conn: &Connection, e: &Employee, month: &str, today: &str) -> Result<bool, String> {
        match Self::check_open(conn, e, month, today) {
            Ok(()) => Ok(true),
            Err(_) => Self::has_carried_in(conn, e.id, month),
        }
    }

    fn entries(conn: &Connection, employee_id: i64, sql_where: &str, month: &str) -> Result<Vec<EmployeePayment>, String> {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM employee_payments WHERE employee_id = ?1 AND {} ORDER BY entry_date, id",
                PAYMENT_COLUMNS, sql_where
            ))
            .map_err(|e| format!("Failed to load the payments: {}", e))?;
        let rows = stmt.query_map(params![employee_id, month], map_payment).map_err(|e| format!("Failed to load the payments: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read the payments: {}", e))
    }

    pub fn pay_month(conn: &Connection, employee_id: i64, month: &str, today: &str) -> Result<PayMonthDetail, String> {
        let label = month_label(month)?;
        let employee = Self::employee(conn, employee_id)?;
        let editable = if month > month_of(today) {
            if !Self::has_carried_in(conn, employee_id, month)? {
                return Err(format!("{} hasn't started yet.", label));
            }
            false
        } else {
            Self::check_open(conn, &employee, month, today)?;
            true
        };
        let (row, figures) = Self::month_figures(conn, employee_id, month, None)?;
        let status = super::calc::status(row.is_some(), figures.balance).to_string();
        Ok(PayMonthDetail {
            entries: Self::entries(conn, employee_id, "month = ?2", month)?,
            carried_in: Self::entries(conn, employee_id, "kind = 'CARRIED' AND carried_to = ?2", month)?,
            employee,
            month: month.to_string(),
            row,
            figures,
            status,
            editable,
        })
    }

    /// Check and store one month's row; the caller reloads what it needs.
    fn write_pay_row(conn: &Connection, e: &Employee, month: &str, input: &PayMonthInput, today: &str) -> Result<(), String> {
        Self::check_open(conn, e, month, today)?;
        let month_days = super::calc::days_in_month(month)?;
        let max_days = super::calc::employed_days(month, &e.joined_on, e.left_on.as_deref())?;
        let days = super::calc::check_days(input.days_worked, max_days)?;
        let hours = super::calc::check_ot_hours(input.ot_hours, month_days)?;
        let bonus = round2(input.bonus_amount);
        if !bonus.is_finite() || bonus < 0.0 {
            return Err("Bonus can't be negative.".to_string());
        }
        let existing = Self::pay_row(conn, e.id, month)?;
        let wage = match input.daily_wage {
            Some(w) => check_wage(w)?,
            None => existing.as_ref().map_or(e.daily_wage, |r| r.daily_wage),
        };
        let rate = match input.ot_rate {
            Some(r) => check_ot_rate(r)?,
            None => existing.as_ref().map_or(e.ot_rate, |r| r.ot_rate),
        };
        let bonus_note = if bonus > 0.0 { clean(&input.bonus_note) } else { None };
        let now = Utc::now().to_rfc3339();
        let result = match existing {
            Some(r) => conn.execute(
                "UPDATE pay_months SET days_worked = ?1, daily_wage = ?2, ot_hours = ?3, ot_rate = ?4, bonus_amount = ?5,
                     bonus_note = ?6, note = ?7, updated_at = ?8 WHERE id = ?9",
                params![days, wage, hours, rate, bonus, bonus_note, clean(&input.note), now, r.id],
            ),
            None => conn.execute(
                "INSERT INTO pay_months (employee_id, month, days_worked, daily_wage, ot_hours, ot_rate, bonus_amount, bonus_note, note, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                params![e.id, month, days, wage, hours, rate, bonus, bonus_note, clean(&input.note), now],
            ),
        };
        result.map_err(|e| format!("Failed to save the month: {}", e))?;
        Ok(())
    }

    pub fn save_pay_month(conn: &Connection, employee_id: i64, month: &str, input: PayMonthInput, today: &str) -> Result<PayMonthDetail, String> {
        month_label(month)?;
        let e = Self::employee(conn, employee_id)?;
        Self::write_pay_row(conn, &e, month, &input, today)?;
        Self::pay_month(conn, employee_id, month, today)
    }

    pub fn delete_pay_month(conn: &Connection, employee_id: i64, month: &str) -> Result<(), String> {
        let label = month_label(month)?;
        Self::employee(conn, employee_id)?;
        let row = Self::pay_row(conn, employee_id, month)?.ok_or_else(|| format!("No days are entered for {}.", label))?;
        let entries: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM employee_payments WHERE employee_id = ?1 AND (month = ?2 OR carried_to = ?2)",
                params![employee_id, month],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to check the payments: {}", e))?;
        if entries > 0 {
            return Err(format!("Payments are recorded against {}. Delete or move them first.", label));
        }
        conn.execute("DELETE FROM pay_months WHERE id = ?1", params![row.id])
            .map_err(|e| format!("Failed to delete the month: {}", e))?;
        Ok(())
    }

    fn all_employees(conn: &Connection) -> Result<Vec<Employee>, String> {
        let mut stmt = conn
            .prepare(&format!("SELECT {} FROM employees ORDER BY name COLLATE NOCASE, id", EMPLOYEE_COLUMNS))
            .map_err(|e| format!("Failed to load employees: {}", e))?;
        let rows = stmt.query_map([], map_employee).map_err(|e| format!("Failed to load employees: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read employees: {}", e))
    }

    pub fn pay_sheet(conn: &Connection, month: &str, today: &str) -> Result<PaySheet, String> {
        month_label(month)?;
        let current = month_of(today).to_string();
        let mut rows = Vec::new();
        for e in Self::all_employees(conn)? {
            if !Self::is_listed(conn, &e, month, today)? {
                continue;
            }
            let (row, figures) = Self::month_figures(conn, e.id, month, None)?;
            rows.push(PaySheetRow {
                employee_id: e.id,
                name: e.name,
                role: e.role,
                status: super::calc::status(row.is_some(), figures.balance).to_string(),
                row,
                figures,
                current_wage: e.daily_wage,
                current_ot_rate: e.ot_rate,
            });
        }
        let (first, last): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT
                     (SELECT MIN(m) FROM (SELECT substr(joined_on, 1, 7) AS m FROM employees
                                          UNION ALL SELECT month FROM pay_months
                                          UNION ALL SELECT month FROM employee_payments)),
                     (SELECT MAX(carried_to) FROM employee_payments)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| format!("Failed to load the months: {}", e))?;
        let first_month = first.filter(|f| *f < current).unwrap_or_else(|| current.clone());
        let last_month = last.filter(|l| *l > current).unwrap_or_else(|| current.clone());
        let sum = |f: &dyn Fn(&PaySheetRow) -> f64| round2(rows.iter().map(f).sum());
        Ok(PaySheet {
            month: month.to_string(),
            first_month,
            last_month,
            total_earned: sum(&|r| r.figures.earned),
            total_given: sum(&|r| r.figures.given),
            total_to_pay: sum(&|r| r.figures.balance.max(0.0)),
            not_entered: rows.iter().filter(|r| r.row.is_none()).count() as i64,
            rows,
        })
    }

    /// Days and OT hours for several employees in one go: all saved, or none.
    pub fn save_pay_sheet(conn: &Connection, month: &str, rows: Vec<PaySheetEntry>, today: &str) -> Result<PaySheet, String> {
        month_label(month)?;
        let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin transaction: {}", e))?;
        let mut seen = std::collections::HashSet::new();
        for entry in &rows {
            let e = Self::employee(&tx, entry.employee_id)?;
            if !seen.insert(e.id) {
                return Err(format!("{} is in the list twice.", e.name));
            }
            let existing = Self::pay_row(&tx, e.id, month)?;
            let input = PayMonthInput {
                days_worked: entry.days_worked,
                ot_hours: entry.ot_hours,
                daily_wage: None,
                ot_rate: None,
                bonus_amount: existing.as_ref().map_or(0.0, |r| r.bonus_amount),
                bonus_note: existing.as_ref().and_then(|r| r.bonus_note.clone()),
                note: existing.as_ref().and_then(|r| r.note.clone()),
            };
            Self::write_pay_row(&tx, &e, month, &input, today).map_err(|err| format!("{}: {}", e.name, err))?;
        }
        tx.commit().map_err(|e| format!("Failed to save the days: {}", e))?;
        Self::pay_sheet(conn, month, today)
    }

    /// The employee's months, newest first, at most `limit`: joining (or the earliest record) to
    /// leaving or this month, plus every month with a record.
    pub fn pay_history(conn: &Connection, employee_id: i64, today: &str, limit: usize) -> Result<Vec<PayMonthSummary>, String> {
        let e = Self::employee(conn, employee_id)?;
        let current = month_of(today).to_string();
        let mut months = std::collections::BTreeSet::new();
        let mut stmt = conn
            .prepare(
                "SELECT month FROM pay_months WHERE employee_id = ?1
                 UNION SELECT month FROM employee_payments WHERE employee_id = ?1
                 UNION SELECT carried_to FROM employee_payments WHERE employee_id = ?1 AND carried_to IS NOT NULL",
            )
            .map_err(|e| format!("Failed to load the pay history: {}", e))?;
        let recorded = stmt
            .query_map(params![employee_id], |r| r.get::<_, String>(0))
            .map_err(|e| format!("Failed to load the pay history: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read the pay history: {}", e))?;
        let joined = month_of(&e.joined_on).to_string();
        let mut month = recorded.iter().min().filter(|m| **m < joined).cloned().unwrap_or(joined);
        let end = match e.left_on.as_deref().map(month_of) {
            Some(left) if left < current.as_str() => left.to_string(),
            _ => current,
        };
        while month <= end && months.len() < 1200 {
            months.insert(month.clone());
            month = super::calc::next_month(&month)?;
        }
        months.extend(recorded);
        months
            .into_iter()
            .rev()
            .take(limit)
            .map(|month| {
                let (row, figures) = Self::month_figures(conn, employee_id, &month, None)?;
                let status = super::calc::status(row.is_some(), figures.balance).to_string();
                Ok(PayMonthSummary { month, row, figures, status })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;
    use rusqlite::{params, Connection};

    const PDF: &[u8] = b"%PDF-1.4 sample";

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("t.db")).unwrap();
        let conn = db.get_connection().unwrap();
        (dir, conn)
    }

    fn input(name: &str, joined: &str) -> EmployeeInput {
        EmployeeInput {
            name: name.into(),
            role: Some("Welder".into()),
            phone: None,
            address: None,
            joined_on: joined.into(),
            daily_wage: 600.0,
            ot_rate: 80.0,
            notes: None,
        }
    }

    fn emp(conn: &Connection, name: &str, joined: &str) -> i64 {
        PayrollRepository::create_employee(conn, input(name, joined)).unwrap().employee.id
    }

    fn raw_payment(conn: &Connection, id: i64, month: &str, kind: &str, carried_to: Option<&str>) {
        conn.execute(
            "INSERT INTO employee_payments (employee_id, month, kind, entry_date, amount, carried_to, created_at, updated_at)
             VALUES (?1, ?2, ?3, '2026-10-15', 500, ?4, 'x', 'x')",
            params![id, month, kind, carried_to],
        )
        .unwrap();
    }

    fn raw_row(conn: &Connection, id: i64, month: &str) {
        conn.execute(
            "INSERT INTO pay_months (employee_id, month, days_worked, daily_wage, created_at, updated_at) VALUES (?1, ?2, 20, 600, 'x', 'x')",
            params![id, month],
        )
        .unwrap();
    }

    // ------------------------------------------------------------- employees

    #[test]
    fn employees_need_a_name_a_wage_and_sensible_details() {
        let (_d, conn) = setup();
        let err = |i: EmployeeInput| PayrollRepository::create_employee(&conn, i).unwrap_err();
        assert_eq!(err(input("  ", "2026-10-01")), "Employee name is required.");
        let mut i = input("Murugan", "2026-10-01");
        i.daily_wage = 0.0;
        assert_eq!(err(i), "Daily wage must be more than 0.");
        let mut i = input("Murugan", "2026-10-01");
        i.ot_rate = -1.0;
        assert_eq!(err(i), "OT rate can't be negative.");
        let mut i = input("Murugan", "2026-10-01");
        i.phone = Some("98765 43210 ext 5".into());
        assert_eq!(err(i), "Phone can have only digits, spaces, + and -, up to 20 characters.");
        assert_eq!(err(input("Murugan", "31-02-2026")), "Joining date is not a valid date.");
        let mut i = input(" Murugan ", "01-10-2026");
        i.daily_wage = 600.004;
        i.role = Some("  ".into());
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
        assert_eq!(
            PayrollRepository::rejoin(&conn, id, "2026-03-31").unwrap_err(),
            "The rejoining date must be after the leaving date (31-03-2026)."
        );
        let e = PayrollRepository::rejoin(&conn, id, "2026-09-01").unwrap().employee;
        assert_eq!((e.joined_on.as_str(), e.left_on), ("2026-09-01", None));
        assert_eq!(PayrollRepository::rejoin(&conn, id, "2026-10-01").unwrap_err(), "Murugan hasn't left.");
    }

    #[test]
    fn leaving_cannot_hide_pay_records() {
        let (_d, conn) = setup();
        let a = emp(&conn, "Anbu", "2026-01-01");
        raw_row(&conn, a, "2026-10");
        assert_eq!(
            PayrollRepository::mark_left(&conn, a, "2026-09-30").unwrap_err(),
            "There are pay records for October 2026, after this leaving date."
        );
        PayrollRepository::mark_left(&conn, a, "2026-10-05").unwrap();
        let r = emp(&conn, "Ravi", "2026-01-01");
        raw_payment(&conn, r, "2026-09", "CARRIED", Some("2026-10"));
        assert_eq!(
            PayrollRepository::mark_left(&conn, r, "2026-09-30").unwrap_err(),
            "There are pay records for October 2026, after this leaving date."
        );
    }

    #[test]
    fn an_employee_with_records_cannot_be_deleted() {
        let (_d, conn) = setup();
        let a = emp(&conn, "Anbu", "2026-01-01");
        raw_payment(&conn, a, "2026-10", "ADVANCE", None);
        assert_eq!(
            PayrollRepository::delete_employee(&conn, a).unwrap_err(),
            "This employee has pay records and can't be deleted. Mark them as left instead."
        );
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

    // -------------------------------------------------------------- pay rows

    const TODAY: &str = "2026-10-15";

    fn days(d: f64) -> PayMonthInput {
        PayMonthInput { days_worked: d, ot_hours: 0.0, daily_wage: None, ot_rate: None, bonus_amount: 0.0, bonus_note: None, note: None }
    }

    fn entry(employee_id: i64, days_worked: f64, ot_hours: f64) -> PaySheetEntry {
        PaySheetEntry { employee_id, days_worked, ot_hours }
    }

    #[test]
    fn saving_a_month_copies_the_rates_once() {
        let (_d, conn) = setup();
        let a = emp(&conn, "Murugan", "2026-01-01");
        let d = PayrollRepository::save_pay_month(&conn, a, "2026-09", PayMonthInput { ot_hours: 12.0, ..days(25.5) }, TODAY).unwrap();
        let r = d.row.clone().unwrap();
        assert_eq!(
            (r.daily_wage, r.ot_rate, d.figures.wages, d.figures.ot_amount, d.figures.earned, d.status.as_str()),
            (600.0, 80.0, 15300.0, 960.0, 16260.0, "TO_PAY")
        );
        let mut i = input("Murugan", "2026-01-01");
        i.daily_wage = 650.0;
        PayrollRepository::update_employee(&conn, a, i).unwrap();
        let d = PayrollRepository::save_pay_month(&conn, a, "2026-09", days(26.0), TODAY).unwrap();
        assert_eq!((d.row.unwrap().daily_wage, d.figures.wages), (600.0, 15600.0), "a raise does not touch an entered month");
        let d = PayrollRepository::save_pay_month(&conn, a, "2026-09", PayMonthInput { daily_wage: Some(650.0), ..days(26.0) }, TODAY).unwrap();
        assert_eq!(d.figures.wages, 16900.0, "unless changed on that month");
        assert_eq!(PayrollRepository::save_pay_month(&conn, a, "2026-10", days(10.0), TODAY).unwrap().row.unwrap().daily_wage, 650.0);
        let d = PayrollRepository::save_pay_month(
            &conn,
            a,
            "2026-10",
            PayMonthInput { bonus_amount: 500.0, bonus_note: Some("Diwali".into()), ..days(10.0) },
            TODAY,
        )
        .unwrap();
        assert_eq!(d.figures.earned, 7000.0);
        assert_eq!(
            PayrollRepository::save_pay_month(&conn, a, "2026-10", PayMonthInput { bonus_amount: -1.0, ..days(10.0) }, TODAY).unwrap_err(),
            "Bonus can't be negative."
        );
        assert_eq!(
            PayrollRepository::save_pay_month(&conn, a, "2026-10", PayMonthInput { daily_wage: Some(0.0), ..days(10.0) }, TODAY).unwrap_err(),
            "Daily wage must be more than 0."
        );
    }

    #[test]
    fn days_and_hours_are_checked_against_the_month() {
        let (_d, conn) = setup();
        let b = emp(&conn, "Bala", "2026-10-20");
        assert_eq!(PayrollRepository::save_pay_month(&conn, b, "2026-10", days(13.0), TODAY).unwrap_err(), "Days must be between 0 and 12.");
        PayrollRepository::save_pay_month(&conn, b, "2026-10", days(12.0), TODAY).unwrap();
        assert_eq!(
            PayrollRepository::save_pay_month(&conn, b, "2026-10", PayMonthInput { ot_hours: 744.5, ..days(1.0) }, TODAY).unwrap_err(),
            "OT hours must be between 0 and 744."
        );
        let a = emp(&conn, "Anbu", "2026-01-01");
        assert_eq!(PayrollRepository::save_pay_month(&conn, a, "2026-02", days(28.5), TODAY).unwrap_err(), "Days must be between 0 and 28.");
    }

    #[test]
    fn months_outside_employment_or_in_the_future_are_refused() {
        let (_d, conn) = setup();
        let b = emp(&conn, "Bala", "2026-10-20");
        assert_eq!(
            PayrollRepository::save_pay_month(&conn, b, "2026-09", days(1.0), TODAY).unwrap_err(),
            "Bala isn't on the pay sheet for September 2026."
        );
        assert_eq!(PayrollRepository::save_pay_month(&conn, b, "2026-11", days(1.0), TODAY).unwrap_err(), "November 2026 hasn't started yet.");
        assert_eq!(PayrollRepository::pay_month(&conn, b, "2026-09", TODAY).unwrap_err(), "Bala isn't on the pay sheet for September 2026.");
        assert_eq!(PayrollRepository::pay_month(&conn, b, "2026-11", TODAY).unwrap_err(), "November 2026 hasn't started yet.");
        PayrollRepository::mark_left(&conn, b, "2026-10-25").unwrap();
        assert_eq!(
            PayrollRepository::save_pay_month(&conn, b, "2026-11", days(1.0), "2026-12-05").unwrap_err(),
            "Bala isn't on the pay sheet for November 2026."
        );
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
        assert_eq!(
            save(vec![entry(a, 26.0, 0.0), entry(c, 5.0, 0.0)]).unwrap_err(),
            "Chandran: Chandran isn't on the pay sheet for October 2026."
        );
        assert_eq!(save(vec![entry(a, 26.0, 0.0), entry(a, 25.0, 0.0)]).unwrap_err(), "Anbu is in the list twice.");
        save(vec![entry(a, 26.0, 4.0), entry(b, 12.0, 0.0)]).unwrap();
        PayrollRepository::save_pay_month(
            &conn,
            a,
            "2026-10",
            PayMonthInput { daily_wage: Some(650.0), bonus_amount: 500.0, ot_hours: 4.0, ..days(26.0) },
            TODAY,
        )
        .unwrap();
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
        assert_eq!(
            PayrollRepository::delete_pay_month(&conn, a, "2026-10").unwrap_err(),
            "Payments are recorded against October 2026. Delete or move them first."
        );
        PayrollRepository::save_pay_month(&conn, a, "2026-09", days(20.0), TODAY).unwrap();
        raw_payment(&conn, a, "2026-08", "CARRIED", Some("2026-09"));
        assert_eq!(
            PayrollRepository::delete_pay_month(&conn, a, "2026-09").unwrap_err(),
            "Payments are recorded against September 2026. Delete or move them first."
        );
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
}
