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
}
