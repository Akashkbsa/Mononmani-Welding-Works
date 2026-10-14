use super::models::{Customer, CustomerCreateInput, CustomerUpdateInput, DuplicateCheckResult, PartyRole, PARTY_TYPES};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};

pub struct CustomerRepository;

impl CustomerRepository {
    fn map_row(row: &Row) -> Result<Customer, rusqlite::Error> {
        let is_favorite_int: i32 = row.get(10)?;
        Ok(Customer {
            id: row.get(0)?,
            name: row.get(1)?,
            gstin: row.get(2)?,
            phone: row.get(3)?,
            email: row.get(4)?,
            address_line1: row.get(5)?,
            address_line2: row.get(6)?,
            city: row.get(7)?,
            state: row.get(8)?,
            postal_code: row.get(9)?,
            is_favorite: is_favorite_int != 0,
            last_used_at: row.get(11)?,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
            party_type: row.get(14)?,
        })
    }

    /// Validate and normalize input fields
    pub fn validate_and_normalize(
        name: &str,
        gstin: Option<&str>,
        phone: Option<&str>,
        email: Option<&str>,
        address_line1: Option<&str>,
        address_line2: Option<&str>,
        city: Option<&str>,
        state: Option<&str>,
        postal_code: Option<&str>,
    ) -> Result<
        (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ),
        String,
    > {
        // 1. Customer Name validation
        let clean_name = name.trim().to_string();
        if clean_name.is_empty() {
            return Err("Customer name is required and cannot be empty.".to_string());
        }
        if clean_name.len() > 200 {
            return Err("Customer name is too long (maximum 200 characters).".to_string());
        }

        // 2. GSTIN validation (optional)
        let clean_gstin = match gstin {
            Some(g) => {
                let trimmed = g.trim().to_uppercase();
                if trimmed.is_empty() {
                    None
                } else {
                    if trimmed.len() != 15 {
                        return Err(
                            "Invalid GSTIN length. GSTIN must be exactly 15 characters.".to_string(),
                        );
                    }
                    // Validate basic 15-character GSTIN structure: 2 digits, 5 letters, 4 digits, 1 letter, 1 alphanumeric, 'Z', 1 alphanumeric
                    let bytes = trimmed.as_bytes();
                    let is_valid_structure = bytes[0..2].iter().all(|b| b.is_ascii_digit())
                        && bytes[2..7].iter().all(|b| b.is_ascii_uppercase())
                        && bytes[7..11].iter().all(|b| b.is_ascii_digit())
                        && bytes[11].is_ascii_uppercase()
                        && bytes[12].is_ascii_alphanumeric()
                        && bytes[13] == b'Z'
                        && bytes[14].is_ascii_alphanumeric();

                    if !is_valid_structure {
                        return Err(
                            "Invalid GSTIN format. Expected 15-character GSTIN (e.g., 33AAACT1234F1ZV)."
                                .to_string(),
                        );
                    }
                    Some(trimmed)
                }
            }
            None => None,
        };

        // 3. Phone validation (optional)
        let clean_phone = match phone {
            Some(p) => {
                let trimmed = p.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    // Strip common formatting characters: spaces, hyphens, parentheses, plus
                    let digits_only: String = trimmed
                        .chars()
                        .filter(|c| c.is_ascii_digit())
                        .collect();

                    if digits_only.len() < 7 || digits_only.len() > 15 {
                        return Err(
                            "Invalid phone number. Must contain between 7 and 15 digits."
                                .to_string(),
                        );
                    }

                    // Check for invalid non-formatting characters
                    let has_invalid_chars = trimmed
                        .chars()
                        .any(|c| !c.is_ascii_digit() && ![' ', '-', '(', ')', '+'].contains(&c));

                    if has_invalid_chars {
                        return Err("Phone number contains invalid characters.".to_string());
                    }

                    Some(trimmed)
                }
            }
            None => None,
        };

        // 4. Email validation (optional)
        let clean_email = match email {
            Some(e) => {
                let trimmed = e.trim().to_lowercase();
                if trimmed.is_empty() {
                    None
                } else {
                    let parts: Vec<&str> = trimmed.split('@').collect();
                    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
                        return Err("Invalid email address format (missing '@' or user/domain).".to_string());
                    }
                    let domain_parts: Vec<&str> = parts[1].split('.').collect();
                    if domain_parts.len() < 2 || domain_parts.iter().any(|p| p.is_empty()) {
                        return Err("Invalid email address domain format.".to_string());
                    }
                    Some(trimmed)
                }
            }
            None => None,
        };

        // 5. Address normalization
        let clean_address_line1 = address_line1
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let clean_address_line2 = address_line2
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let clean_city = city
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let clean_state = state
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let clean_postal_code = postal_code
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        Ok((
            clean_name,
            clean_gstin,
            clean_phone,
            clean_email,
            clean_address_line1,
            clean_address_line2,
            clean_city,
            clean_state,
            clean_postal_code,
        ))
    }

    /// Clean the company type text: trimmed, upper case, one of the three known values.
    fn clean_party_type(raw: &str) -> Result<String, String> {
        let t = raw.trim().to_uppercase();
        if PARTY_TYPES.contains(&t.as_str()) {
            Ok(t)
        } else {
            Err("Choose Customer, Supplier or Both.".to_string())
        }
    }

    /// The `AND party_type IN (...)` part for a list filter. `None` or "ALL" means everyone.
    fn party_clause(party: Option<&str>) -> Result<&'static str, String> {
        match party.map(|p| p.trim().to_uppercase()).as_deref() {
            None | Some("") | Some("ALL") => Ok(""),
            Some("CUSTOMER") => Ok(" AND party_type IN ('CUSTOMER', 'BOTH')"),
            Some("SUPPLIER") => Ok(" AND party_type IN ('SUPPLIER', 'BOTH')"),
            Some(_) => Err("Unknown company type.".to_string()),
        }
    }

    /// Retrieve all companies with default ordering:
    /// 1. Favorites first
    /// 2. Then by last_used_at (most recent first)
    /// 3. Then by created_at (newest first)
    pub fn find_all(conn: &Connection) -> Result<Vec<Customer>, String> {
        Self::list_by_party(conn, None)
    }

    /// The same list limited to customers (Customer and Both) or suppliers (Supplier and Both).
    pub fn list_by_party(conn: &Connection, party: Option<&str>) -> Result<Vec<Customer>, String> {
        let sql = format!(
            r#"
            SELECT
                id, name, gstin, phone, email, address_line1, address_line2,
                city, state, postal_code, is_favorite, last_used_at, created_at, updated_at, party_type
            FROM customers
            WHERE 1 = 1{}
            ORDER BY
                is_favorite DESC,
                (last_used_at IS NOT NULL) DESC,
                last_used_at DESC,
                created_at DESC
            "#,
            Self::party_clause(party)?
        );

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare find_all query: {}", e))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| format!("Failed to execute find_all query: {}", e))?;

        let mut customers = Vec::new();
        for r in rows {
            customers.push(r.map_err(|e| format!("Row mapping error: {}", e))?);
        }

        Ok(customers)
    }

    /// Search companies locally by name, gstin, phone, or email
    pub fn search(conn: &Connection, query: &str) -> Result<Vec<Customer>, String> {
        Self::search_by_party(conn, query, None)
    }

    pub fn search_by_party(conn: &Connection, query: &str, party: Option<&str>) -> Result<Vec<Customer>, String> {
        let clean_query = query.trim();
        if clean_query.is_empty() {
            return Self::list_by_party(conn, party);
        }

        let search_pattern = format!("%{}%", clean_query);

        let sql = format!(
            r#"
            SELECT
                id, name, gstin, phone, email, address_line1, address_line2,
                city, state, postal_code, is_favorite, last_used_at, created_at, updated_at, party_type
            FROM customers
            WHERE
                (name LIKE ?1 OR
                COALESCE(gstin, '') LIKE ?1 OR
                COALESCE(phone, '') LIKE ?1 OR
                COALESCE(email, '') LIKE ?1){}
            ORDER BY
                is_favorite DESC,
                (last_used_at IS NOT NULL) DESC,
                last_used_at DESC,
                created_at DESC
            "#,
            Self::party_clause(party)?
        );

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare search query: {}", e))?;

        let rows = stmt
            .query_map(params![search_pattern], Self::map_row)
            .map_err(|e| format!("Failed to execute search query: {}", e))?;

        let mut customers = Vec::new();
        for r in rows {
            customers.push(r.map_err(|e| format!("Row mapping error: {}", e))?);
        }

        Ok(customers)
    }

    /// Refuse a company that is the wrong type for the side of the business a record is on.
    pub fn require_party(conn: &Connection, id: i64, role: PartyRole) -> Result<(), String> {
        let found: Option<String> = conn
            .query_row("SELECT party_type FROM customers WHERE id = ?1", params![id], |r| r.get(0))
            .optional()
            .map_err(|e| format!("Failed to check the company: {}", e))?;
        let kind = found.ok_or_else(|| match role {
            PartyRole::Customer => "Customer not found.".to_string(),
            PartyRole::Supplier => "Supplier not found.".to_string(),
        })?;
        match (role, kind.as_str()) {
            (PartyRole::Customer, "SUPPLIER") => Err(
                "This company is a supplier only, so it can't be used for invoices, payments, purchase orders or quotations."
                    .to_string(),
            ),
            (PartyRole::Supplier, "CUSTOMER") => Err(
                "This company is a customer only, so it can't be used for supplier bills or supplier payments.".to_string(),
            ),
            _ => Ok(()),
        }
    }

    /// Invoices, payments, orders, quotations and advances that make a company a customer.
    fn customer_record_count(conn: &Connection, id: i64) -> Result<i64, String> {
        conn.query_row(
            "SELECT (SELECT COUNT(*) FROM invoices WHERE customer_id = ?1)
                  + (SELECT COUNT(*) FROM payments WHERE customer_id = ?1)
                  + (SELECT COUNT(*) FROM purchase_orders WHERE customer_id = ?1)
                  + (SELECT COUNT(*) FROM quotations WHERE customer_id = ?1)
                  + (SELECT COUNT(*) FROM customer_credits WHERE customer_id = ?1)",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check customer records: {}", e))
    }

    /// Find single customer by ID
    pub fn find_by_id(conn: &Connection, id: i64) -> Result<Option<Customer>, String> {
        let sql = r#"
            SELECT 
                id, name, gstin, phone, email, address_line1, address_line2, 
                city, state, postal_code, is_favorite, last_used_at, created_at, updated_at, party_type
            FROM customers
            WHERE id = ?1
        "#;

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("Failed to prepare find_by_id query: {}", e))?;

        let mut rows = stmt
            .query_map(params![id], Self::map_row)
            .map_err(|e| format!("Failed to execute find_by_id query: {}", e))?;

        if let Some(row) = rows.next() {
            let customer = row.map_err(|e| format!("Failed to map customer: {}", e))?;
            Ok(Some(customer))
        } else {
            Ok(None)
        }
    }

    /// Check if a potential duplicate customer already exists by normalized name
    pub fn check_duplicate(
        conn: &Connection,
        name: &str,
        exclude_id: Option<i64>,
    ) -> Result<DuplicateCheckResult, String> {
        let clean_name = name.trim();
        if clean_name.is_empty() {
            return Ok(DuplicateCheckResult {
                has_duplicate: false,
                existing_customer: None,
            });
        }

        let existing_customer = match exclude_id {
            Some(id) => {
                let sql = r#"
                SELECT 
                    id, name, gstin, phone, email, address_line1, address_line2, 
                    city, state, postal_code, is_favorite, last_used_at, created_at, updated_at, party_type
                FROM customers
                WHERE LOWER(TRIM(name)) = LOWER(TRIM(?1)) AND id != ?2
                LIMIT 1
                "#;
                let mut stmt = conn
                    .prepare(sql)
                    .map_err(|e| format!("Failed to prepare check_duplicate query: {}", e))?;
                stmt.query_row(params![clean_name, id], Self::map_row)
                    .optional()
                    .map_err(|e| format!("Failed to execute check_duplicate query: {}", e))?
            }
            None => {
                let sql = r#"
                SELECT 
                    id, name, gstin, phone, email, address_line1, address_line2, 
                    city, state, postal_code, is_favorite, last_used_at, created_at, updated_at, party_type
                FROM customers
                WHERE LOWER(TRIM(name)) = LOWER(TRIM(?1))
                LIMIT 1
                "#;
                let mut stmt = conn
                    .prepare(sql)
                    .map_err(|e| format!("Failed to prepare check_duplicate query: {}", e))?;
                stmt.query_row(params![clean_name], Self::map_row)
                    .optional()
                    .map_err(|e| format!("Failed to execute check_duplicate query: {}", e))?
            }
        };

        Ok(DuplicateCheckResult {
            has_duplicate: existing_customer.is_some(),
            existing_customer,
        })
    }

    /// Create new customer record
    pub fn create(conn: &Connection, input: CustomerCreateInput) -> Result<Customer, String> {
        let (
            name,
            gstin,
            phone,
            email,
            address_line1,
            address_line2,
            city,
            state,
            postal_code,
        ) = Self::validate_and_normalize(
            &input.name,
            input.gstin.as_deref(),
            input.phone.as_deref(),
            input.email.as_deref(),
            input.address_line1.as_deref(),
            input.address_line2.as_deref(),
            input.city.as_deref(),
            input.state.as_deref(),
            input.postal_code.as_deref(),
        )?;

        let party_type = match input.party_type.as_deref() {
            Some(p) => Self::clean_party_type(p)?,
            None => "CUSTOMER".to_string(),
        };
        let now = Utc::now().to_rfc3339();
        let is_favorite_int = if input.is_favorite.unwrap_or(false) {
            1
        } else {
            0
        };

        let sql = r#"
            INSERT INTO customers (
                name, gstin, phone, email, address_line1, address_line2, 
                city, state, postal_code, is_favorite, last_used_at, created_at, updated_at, party_type
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?11, ?12)
        "#;

        conn.execute(
            sql,
            params![
                name,
                gstin,
                phone,
                email,
                address_line1,
                address_line2,
                city,
                state,
                postal_code,
                is_favorite_int,
                now,
                party_type
            ],
        )
        .map_err(|e| format!("Failed to insert customer: {}", e))?;

        let last_id = conn.last_insert_rowid();
        Self::find_by_id(conn, last_id)?
            .ok_or_else(|| "Failed to retrieve newly created customer.".to_string())
    }

    /// Update existing customer record
    pub fn update(
        conn: &Connection,
        id: i64,
        input: CustomerUpdateInput,
    ) -> Result<Customer, String> {
        // Ensure customer exists
        let current = Self::find_by_id(conn, id)?.ok_or_else(|| format!("Customer with ID {} not found.", id))?;

        let (
            name,
            gstin,
            phone,
            email,
            address_line1,
            address_line2,
            city,
            state,
            postal_code,
        ) = Self::validate_and_normalize(
            &input.name,
            input.gstin.as_deref(),
            input.phone.as_deref(),
            input.email.as_deref(),
            input.address_line1.as_deref(),
            input.address_line2.as_deref(),
            input.city.as_deref(),
            input.state.as_deref(),
            input.postal_code.as_deref(),
        )?;

        // A company keeps its type unless the edit names another. Dropping a side of the business
        // is refused while records of that side exist.
        let new_type = match input.party_type.as_deref() {
            Some(p) => Self::clean_party_type(p)?,
            None => current.party_type.clone(),
        };
        if new_type != current.party_type {
            if new_type == "SUPPLIER" {
                let n = Self::customer_record_count(conn, id)?;
                if n > 0 {
                    return Err(format!(
                        "This company has {} customer record(s) (invoices, payments, purchase orders, quotations or advances), so it can't be changed to Supplier only.",
                        n
                    ));
                }
            }
        }

        let now = Utc::now().to_rfc3339();

        let is_favorite_int = match input.is_favorite {
            Some(fav) => Some(if fav { 1 } else { 0 }),
            None => None,
        };

        // If is_favorite was provided in update, update it, otherwise preserve
        let sql = match is_favorite_int {
            Some(_) => r#"
                UPDATE customers SET
                    name = ?1,
                    gstin = ?2,
                    phone = ?3,
                    email = ?4,
                    address_line1 = ?5,
                    address_line2 = ?6,
                    city = ?7,
                    state = ?8,
                    postal_code = ?9,
                    is_favorite = ?10,
                    updated_at = ?11
                WHERE id = ?12
            "#,
            None => r#"
                UPDATE customers SET
                    name = ?1,
                    gstin = ?2,
                    phone = ?3,
                    email = ?4,
                    address_line1 = ?5,
                    address_line2 = ?6,
                    city = ?7,
                    state = ?8,
                    postal_code = ?9,
                    updated_at = ?10
                WHERE id = ?11
            "#,
        };

        if let Some(fav_val) = is_favorite_int {
            conn.execute(
                sql,
                params![
                    name,
                    gstin,
                    phone,
                    email,
                    address_line1,
                    address_line2,
                    city,
                    state,
                    postal_code,
                    fav_val,
                    now,
                    id
                ],
            )
            .map_err(|e| format!("Failed to update customer: {}", e))?;
        } else {
            conn.execute(
                sql,
                params![
                    name,
                    gstin,
                    phone,
                    email,
                    address_line1,
                    address_line2,
                    city,
                    state,
                    postal_code,
                    now,
                    id
                ],
            )
            .map_err(|e| format!("Failed to update customer: {}", e))?;
        }

        if new_type != current.party_type {
            conn.execute(
                "UPDATE customers SET party_type = ?1 WHERE id = ?2",
                params![new_type, id],
            )
            .map_err(|e| format!("Failed to update customer type: {}", e))?;
        }

        Self::find_by_id(conn, id)?
            .ok_or_else(|| "Failed to retrieve updated customer.".to_string())
    }

    /// Delete customer by ID
    pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
        if Self::find_by_id(conn, id)?.is_none() {
            return Err(format!("Customer with ID {} not found.", id));
        }

        // Invoices and payments keep a link to the customer for allocations and advances,
        // so a customer with records cannot be removed.
        let (invoices, payments): (i64, i64) = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM invoices WHERE customer_id = ?1),
                        (SELECT COUNT(*) FROM payments WHERE customer_id = ?1)",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| format!("Failed to check customer records: {}", e))?;
        if invoices + payments > 0 {
            return Err(format!(
                "This customer has {} invoice(s) and {} payment(s), so they can't be deleted.",
                invoices, payments
            ));
        }

        let orders: i64 = conn
            .query_row("SELECT COUNT(*) FROM purchase_orders WHERE customer_id = ?1", params![id], |r| r.get(0))
            .map_err(|e| format!("Failed to check customer records: {}", e))?;
        if orders > 0 {
            return Err(format!("This customer has {} purchase order(s), so they can't be deleted.", orders));
        }

        let quotations: i64 = conn
            .query_row("SELECT COUNT(*) FROM quotations WHERE customer_id = ?1", params![id], |r| r.get(0))
            .map_err(|e| format!("Failed to check customer records: {}", e))?;
        if quotations > 0 {
            return Err(format!("This customer has {} quotation(s), so they can't be deleted.", quotations));
        }

        conn.execute("DELETE FROM customers WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete customer: {}", e))?;

        Ok(())
    }

    /// Toggle favorite status directly
    pub fn toggle_favorite(conn: &Connection, id: i64, is_favorite: bool) -> Result<Customer, String> {
        let now = Utc::now().to_rfc3339();
        let fav_int = if is_favorite { 1 } else { 0 };

        let affected = conn
            .execute(
                "UPDATE customers SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3",
                params![fav_int, now, id],
            )
            .map_err(|e| format!("Failed to toggle favorite: {}", e))?;

        if affected == 0 {
            return Err(format!("Customer with ID {} not found.", id));
        }

        Self::find_by_id(conn, id)?
            .ok_or_else(|| "Failed to retrieve customer after toggling favorite.".to_string())
    }

    /// Update last_used_at timestamp when customer is consumed for actual business use (e.g. Invoicing)
    pub fn update_last_used(conn: &Connection, id: i64) -> Result<Customer, String> {
        let now = Utc::now().to_rfc3339();

        let affected = conn
            .execute(
                "UPDATE customers SET last_used_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )
            .map_err(|e| format!("Failed to update customer last_used_at: {}", e))?;

        if affected == 0 {
            return Err(format!("Customer with ID {} not found.", id));
        }

        Self::find_by_id(conn, id)?
            .ok_or_else(|| "Failed to retrieve customer after updating last_used_at.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;

    fn setup_test_db(temp_file_path: &std::path::Path) -> Connection {
        let db = DatabaseManager::new(temp_file_path).expect("Failed to create test db");
        db.get_connection().expect("Failed to get connection")
    }

    #[test]
    fn test_1_create_customer_with_only_required_name() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust1.db");
        let conn = setup_test_db(&db_path);

        let input = CustomerCreateInput {
            name: "  Shree Murugan Enterprises  ".to_string(),
            gstin: None,
            phone: None,
            email: None,
            address_line1: None,
            address_line2: None,
            city: None,
            state: None,
            postal_code: None,
            is_favorite: None,
            party_type: None,
        };

        let customer = CustomerRepository::create(&conn, input).expect("Failed to create customer");
        assert_eq!(customer.name, "Shree Murugan Enterprises");
        assert_eq!(customer.gstin, None);
        assert_eq!(customer.phone, None);
        assert_eq!(customer.email, None);
        assert_eq!(customer.is_favorite, false);
        assert_eq!(customer.last_used_at, None);
    }

    #[test]
    fn test_2_create_complete_customer() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust2.db");
        let conn = setup_test_db(&db_path);

        let input = CustomerCreateInput {
            name: "Tamilnadu Engineering Works".to_string(),
            gstin: Some("33AAACT1234F1ZV".to_string()),
            phone: Some("+91 98401 23456".to_string()),
            email: Some("billing@tnew.in".to_string()),
            address_line1: Some("Plot 45, Phase II".to_string()),
            address_line2: Some("Ambattur Industrial Estate".to_string()),
            city: Some("Chennai".to_string()),
            state: Some("Tamil Nadu".to_string()),
            postal_code: Some("600058".to_string()),
            is_favorite: Some(true),
            party_type: None,
        };

        let customer = CustomerRepository::create(&conn, input).expect("Failed to create complete customer");
        assert_eq!(customer.name, "Tamilnadu Engineering Works");
        assert_eq!(customer.gstin, Some("33AAACT1234F1ZV".to_string()));
        assert_eq!(customer.phone, Some("+91 98401 23456".to_string()));
        assert_eq!(customer.email, Some("billing@tnew.in".to_string()));
        assert_eq!(customer.city, Some("Chennai".to_string()));
        assert_eq!(customer.is_favorite, true);
    }

    #[test]
    fn test_3_empty_customer_name_validation() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust3.db");
        let conn = setup_test_db(&db_path);

        let input = CustomerCreateInput {
            name: "   ".to_string(),
            gstin: None,
            phone: None,
            email: None,
            address_line1: None,
            address_line2: None,
            city: None,
            state: None,
            postal_code: None,
            is_favorite: None,
            party_type: None,
        };

        let result = CustomerRepository::create(&conn, input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Customer name is required"));
    }

    #[test]
    fn test_4_duplicate_detection() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust4.db");
        let conn = setup_test_db(&db_path);

        let input = CustomerCreateInput {
            name: "ABC Constructions".to_string(),
            gstin: None,
            phone: None,
            email: None,
            address_line1: None,
            address_line2: None,
            city: None,
            state: None,
            postal_code: None,
            is_favorite: None,
            party_type: None,
        };
        CustomerRepository::create(&conn, input).expect("Failed to create customer");

        // Check duplicate with varying casing and spaces
        let dup_check = CustomerRepository::check_duplicate(&conn, "  abc constructions  ", None)
            .expect("Duplicate check failed");
        assert!(dup_check.has_duplicate);
        assert_eq!(dup_check.existing_customer.unwrap().name, "ABC Constructions");

        // Non-duplicate check
        let non_dup = CustomerRepository::check_duplicate(&conn, "XYZ Infrastructure", None)
            .expect("Duplicate check failed");
        assert!(!non_dup.has_duplicate);
    }

    #[test]
    fn test_5_gstin_normalization_to_uppercase() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust5.db");
        let conn = setup_test_db(&db_path);

        let input = CustomerCreateInput {
            name: "Alpha Industries".to_string(),
            gstin: Some("  33aaact1234f1zv  ".to_string()),
            phone: None,
            email: None,
            address_line1: None,
            address_line2: None,
            city: None,
            state: None,
            postal_code: None,
            is_favorite: None,
            party_type: None,
        };

        let customer = CustomerRepository::create(&conn, input).expect("Failed to create customer");
        assert_eq!(customer.gstin, Some("33AAACT1234F1ZV".to_string()));
    }

    #[test]
    fn test_6_malformed_gstin_validation() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust6.db");
        let conn = setup_test_db(&db_path);

        let input = CustomerCreateInput {
            name: "Beta Works".to_string(),
            gstin: Some("INVALID_GST_123".to_string()),
            phone: None,
            email: None,
            address_line1: None,
            address_line2: None,
            city: None,
            state: None,
            postal_code: None,
            is_favorite: None,
            party_type: None,
        };

        let result = CustomerRepository::create(&conn, input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid GSTIN"));
    }

    #[test]
    fn test_7_invalid_email_validation() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust7.db");
        let conn = setup_test_db(&db_path);

        let input = CustomerCreateInput {
            name: "Gamma Steels".to_string(),
            gstin: None,
            phone: None,
            email: Some("not-an-email".to_string()),
            address_line1: None,
            address_line2: None,
            city: None,
            state: None,
            postal_code: None,
            is_favorite: None,
            party_type: None,
        };

        let result = CustomerRepository::create(&conn, input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid email"));
    }

    #[test]
    fn test_8_9_10_search_by_name_phone_gstin() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust8.db");
        let conn = setup_test_db(&db_path);

        CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "Precision Tools Co".to_string(),
                gstin: Some("33AAACT9999F1ZV".to_string()),
                phone: Some("044-24501234".to_string()),
                email: Some("info@precision.in".to_string()),
                address_line1: None,
                address_line2: None,
                city: Some("Coimbatore".to_string()),
                state: None,
                postal_code: None,
                is_favorite: None,
                party_type: None,
            },
        ).unwrap();

        // TEST 8: Search by name
        let by_name = CustomerRepository::search(&conn, "precision").unwrap();
        assert_eq!(by_name.len(), 1);
        assert_eq!(by_name[0].name, "Precision Tools Co");

        // TEST 9: Search by phone
        let by_phone = CustomerRepository::search(&conn, "24501234").unwrap();
        assert_eq!(by_phone.len(), 1);

        // TEST 10: Search by GSTIN
        let by_gstin = CustomerRepository::search(&conn, "9999F1ZV").unwrap();
        assert_eq!(by_gstin.len(), 1);
    }

    #[test]
    fn test_11_favorite_toggle_and_persistence() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust11.db");
        let conn = setup_test_db(&db_path);

        let cust = CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "Delta Infra".to_string(),
                gstin: None,
                phone: None,
                email: None,
                address_line1: None,
                address_line2: None,
                city: None,
                state: None,
                postal_code: None,
                is_favorite: Some(false),
                party_type: None,
            },
        ).unwrap();

        assert_eq!(cust.is_favorite, false);

        // Toggle to true
        let updated = CustomerRepository::toggle_favorite(&conn, cust.id, true).unwrap();
        assert_eq!(updated.is_favorite, true);

        // Reconnect to test DB to verify disk persistence
        let conn2 = Connection::open(&db_path).unwrap();
        let persisted = CustomerRepository::find_by_id(&conn2, cust.id).unwrap().unwrap();
        assert_eq!(persisted.is_favorite, true);
    }

    #[test]
    fn test_12_edit_customer_and_persistence() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust12.db");
        let conn = setup_test_db(&db_path);

        let cust = CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "Old Name Works".to_string(),
                gstin: None,
                phone: Some("9876543210".to_string()),
                email: None,
                address_line1: None,
                address_line2: None,
                city: Some("Madurai".to_string()),
                state: None,
                postal_code: None,
                is_favorite: None,
                party_type: None,
            },
        ).unwrap();

        let updated = CustomerRepository::update(
            &conn,
            cust.id,
            CustomerUpdateInput {
                name: "New Name Works".to_string(),
                gstin: Some("33AAACT1234F1ZV".to_string()),
                phone: Some("+91 98765 43210".to_string()),
                email: Some("contact@newname.com".to_string()),
                address_line1: Some("12 Industrial Lane".to_string()),
                address_line2: None,
                city: Some("Trichy".to_string()),
                state: Some("Tamil Nadu".to_string()),
                postal_code: Some("620001".to_string()),
                is_favorite: None,
                party_type: None,
            },
        ).unwrap();

        assert_eq!(updated.name, "New Name Works");
        assert_eq!(updated.city, Some("Trichy".to_string()));

        // Reconnect to verify disk persistence
        let conn2 = Connection::open(&db_path).unwrap();
        let persisted = CustomerRepository::find_by_id(&conn2, cust.id).unwrap().unwrap();
        assert_eq!(persisted.name, "New Name Works");
        assert_eq!(persisted.city, Some("Trichy".to_string()));
        assert_eq!(persisted.postal_code, Some("620001".to_string()));
    }

    #[test]
    fn test_13_delete_customer() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust13.db");
        let conn = setup_test_db(&db_path);

        let cust = CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "Temporary Customer".to_string(),
                gstin: None,
                phone: None,
                email: None,
                address_line1: None,
                address_line2: None,
                city: None,
                state: None,
                postal_code: None,
                is_favorite: None,
                party_type: None,
            },
        ).unwrap();

        CustomerRepository::delete(&conn, cust.id).expect("Failed to delete customer");
        let check = CustomerRepository::find_by_id(&conn, cust.id).unwrap();
        assert!(check.is_none());
    }

    #[test]
    fn test_14_database_reopen_persistence() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust14.db");

        // Session 1: Create customers
        {
            let conn1 = setup_test_db(&db_path);
            CustomerRepository::create(
                &conn1,
                CustomerCreateInput {
                    name: "Customer Alpha".to_string(),
                    gstin: None,
                    phone: None,
                    email: None,
                    address_line1: None,
                    address_line2: None,
                    city: Some("Salem".to_string()),
                    state: None,
                    postal_code: None,
                    is_favorite: Some(true),
                    party_type: None,
                },
            ).unwrap();

            CustomerRepository::create(
                &conn1,
                CustomerCreateInput {
                    name: "Customer Beta".to_string(),
                    gstin: None,
                    phone: None,
                    email: None,
                    address_line1: None,
                    address_line2: None,
                    city: Some("Erode".to_string()),
                    state: None,
                    postal_code: None,
                    is_favorite: Some(false),
                    party_type: None,
                },
            ).unwrap();
        } // conn1 is closed and dropped here

        // Session 2: Reopen same database file
        {
            let db2 = DatabaseManager::new(&db_path).unwrap();
            let conn2 = db2.get_connection().unwrap();
            let all = CustomerRepository::find_all(&conn2).unwrap();
            assert_eq!(all.len(), 2);
            assert_eq!(all[0].name, "Customer Alpha");
            assert_eq!(all[0].is_favorite, true);
            assert_eq!(all[1].name, "Customer Beta");
            assert_eq!(all[1].is_favorite, false);
        }
    }

    #[test]
    fn test_15_ordering_favorites_and_recents() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust15.db");
        let conn = setup_test_db(&db_path);

        // 1. Regular customer created first
        let c1 = CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "Customer Regular Older".to_string(),
                gstin: None, phone: None, email: None, address_line1: None,
                address_line2: None, city: None, state: None, postal_code: None,
                is_favorite: Some(false),
                party_type: None,
            },
        ).unwrap();

        // 2. Regular customer created second
        let c2 = CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "Customer Regular Newer".to_string(),
                gstin: None, phone: None, email: None, address_line1: None,
                address_line2: None, city: None, state: None, postal_code: None,
                is_favorite: Some(false),
                party_type: None,
            },
        ).unwrap();

        // 3. Favorite customer
        let c3 = CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "Customer Favorite".to_string(),
                gstin: None, phone: None, email: None, address_line1: None,
                address_line2: None, city: None, state: None, postal_code: None,
                is_favorite: Some(true),
                party_type: None,
            },
        ).unwrap();

        // 4. Mark c1 as used recently
        CustomerRepository::update_last_used(&conn, c1.id).unwrap();

        let list = CustomerRepository::find_all(&conn).unwrap();
        // Expect:
        // 1. c3 (Favorite first)
        // 2. c1 (Regular, but used recently)
        // 3. c2 (Regular, never used)
        assert_eq!(list[0].id, c3.id);
        assert_eq!(list[1].id, c1.id);
        assert_eq!(list[2].id, c2.id);
    }

    #[test]
    fn test_16_migration_applied_once() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_cust16.db");

        // Run migrations first time
        let db1 = DatabaseManager::new(&db_path).unwrap();
        let status1 = db1.get_status().unwrap();
        let applied = status1.applied_migrations.len();
        assert!(applied >= 2);
        assert_eq!(status1.applied_migrations[0].version, 1);
        assert_eq!(status1.applied_migrations[1].version, 2);

        // Run migrations second time on same database
        let db2 = DatabaseManager::new(&db_path).unwrap();
        let status2 = db2.get_status().unwrap();
        assert_eq!(status2.applied_migrations.len(), applied);
    }

    #[test]
    fn customer_with_purchase_orders_cannot_be_deleted() {
        let temp_dir = tempfile::tempdir().unwrap();
        let conn = setup_test_db(&temp_dir.path().join("test_cust_po.db"));
        let customer = CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "Has an order".to_string(),
                gstin: None,
                phone: None,
                email: None,
                address_line1: None,
                address_line2: None,
                city: None,
                state: None,
                postal_code: None,
                is_favorite: None,
                party_type: None,
            },
        )
        .unwrap();
        conn.execute(
            "INSERT INTO purchase_orders (customer_id, po_number, created_at, updated_at) VALUES (?1, 'PO-1', 'x', 'x')",
            params![customer.id],
        )
        .unwrap();
        let err = CustomerRepository::delete(&conn, customer.id).unwrap_err();
        assert!(err.contains("purchase order"), "{}", err);
        assert!(CustomerRepository::find_by_id(&conn, customer.id).unwrap().is_some());
    }

    #[test]
    fn customer_with_quotations_cannot_be_deleted() {
        let temp_dir = tempfile::tempdir().unwrap();
        let conn = setup_test_db(&temp_dir.path().join("test_cust_q.db"));
        let customer = CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "Has a quotation".to_string(),
                gstin: None,
                phone: None,
                email: None,
                address_line1: None,
                address_line2: None,
                city: None,
                state: None,
                postal_code: None,
                is_favorite: None,
                party_type: None,
            },
        )
        .unwrap();
        conn.execute(
            "INSERT INTO quotations (customer_id, quotation_number, quotation_date, created_at, updated_at) VALUES (?1, 'Q-1', '2026-10-01', 'x', 'x')",
            params![customer.id],
        )
        .unwrap();
        let err = CustomerRepository::delete(&conn, customer.id).unwrap_err();
        assert_eq!(err, "This customer has 1 quotation(s), so they can't be deleted.");
        assert!(CustomerRepository::find_by_id(&conn, customer.id).unwrap().is_some());
    }

    // ---- company type ----

    fn company(conn: &Connection, name: &str, party: Option<&str>) -> Customer {
        CustomerRepository::create(
            conn,
            CustomerCreateInput {
                name: name.to_string(),
                gstin: None,
                phone: None,
                email: None,
                address_line1: None,
                address_line2: None,
                city: None,
                state: None,
                postal_code: None,
                is_favorite: None,
                party_type: party.map(str::to_string),
            },
        )
        .unwrap()
    }

    fn update_type(conn: &Connection, id: i64, name: &str, party: Option<&str>) -> Result<Customer, String> {
        CustomerRepository::update(
            conn,
            id,
            CustomerUpdateInput {
                name: name.to_string(),
                gstin: None,
                phone: None,
                email: None,
                address_line1: None,
                address_line2: None,
                city: None,
                state: None,
                postal_code: None,
                is_favorite: None,
                party_type: party.map(str::to_string),
            },
        )
    }

    fn names(list: Vec<Customer>) -> Vec<String> {
        let mut n: Vec<String> = list.into_iter().map(|c| c.name).collect();
        n.sort();
        n
    }

    #[test]
    fn new_companies_default_to_customer_and_keep_the_type_chosen() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_test_db(&dir.path().join("t.db"));
        assert_eq!(company(&conn, "A", None).party_type, "CUSTOMER");
        assert_eq!(company(&conn, "B", Some("supplier")).party_type, "SUPPLIER");
        assert_eq!(company(&conn, "C", Some("BOTH")).party_type, "BOTH");
        let bad = CustomerRepository::create(
            &conn,
            CustomerCreateInput {
                name: "D".to_string(),
                gstin: None,
                phone: None,
                email: None,
                address_line1: None,
                address_line2: None,
                city: None,
                state: None,
                postal_code: None,
                is_favorite: None,
                party_type: Some("VENDOR".to_string()),
            },
        );
        assert_eq!(bad.unwrap_err(), "Choose Customer, Supplier or Both.");
    }

    #[test]
    fn lists_and_searches_filter_by_party() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_test_db(&dir.path().join("t.db"));
        company(&conn, "Alpha Traders", Some("CUSTOMER"));
        company(&conn, "Beta Steel", Some("SUPPLIER"));
        company(&conn, "Gamma Works", Some("BOTH"));
        assert_eq!(CustomerRepository::list_by_party(&conn, None).unwrap().len(), 3);
        assert_eq!(names(CustomerRepository::list_by_party(&conn, Some("CUSTOMER")).unwrap()), vec!["Alpha Traders", "Gamma Works"]);
        assert_eq!(names(CustomerRepository::list_by_party(&conn, Some("SUPPLIER")).unwrap()), vec!["Beta Steel", "Gamma Works"]);
        assert_eq!(names(CustomerRepository::search_by_party(&conn, "Steel", Some("SUPPLIER")).unwrap()), vec!["Beta Steel"]);
        assert!(CustomerRepository::search_by_party(&conn, "Steel", Some("CUSTOMER")).unwrap().is_empty());
        assert_eq!(CustomerRepository::search_by_party(&conn, "", Some("SUPPLIER")).unwrap().len(), 2);
        assert_eq!(CustomerRepository::list_by_party(&conn, Some("VENDOR")).unwrap_err(), "Unknown company type.");
    }

    #[test]
    fn require_party_refuses_the_wrong_type() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_test_db(&dir.path().join("t.db"));
        let cust = company(&conn, "A", Some("CUSTOMER")).id;
        let supp = company(&conn, "B", Some("SUPPLIER")).id;
        let both = company(&conn, "C", Some("BOTH")).id;
        assert!(CustomerRepository::require_party(&conn, cust, PartyRole::Customer).is_ok());
        assert!(CustomerRepository::require_party(&conn, both, PartyRole::Customer).is_ok());
        assert!(CustomerRepository::require_party(&conn, both, PartyRole::Supplier).is_ok());
        assert!(CustomerRepository::require_party(&conn, supp, PartyRole::Supplier).is_ok());
        assert_eq!(
            CustomerRepository::require_party(&conn, supp, PartyRole::Customer).unwrap_err(),
            "This company is a supplier only, so it can't be used for invoices, payments, purchase orders or quotations."
        );
        assert_eq!(
            CustomerRepository::require_party(&conn, cust, PartyRole::Supplier).unwrap_err(),
            "This company is a customer only, so it can't be used for supplier bills or supplier payments."
        );
        assert_eq!(CustomerRepository::require_party(&conn, 9999, PartyRole::Customer).unwrap_err(), "Customer not found.");
        assert_eq!(CustomerRepository::require_party(&conn, 9999, PartyRole::Supplier).unwrap_err(), "Supplier not found.");
    }

    #[test]
    fn a_company_with_customer_records_cannot_become_supplier_only() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_test_db(&dir.path().join("t.db"));
        let id = company(&conn, "A", Some("CUSTOMER")).id;
        let records: [(&str, &str); 5] = [
            ("invoices", "INSERT INTO invoices (invoice_number, invoice_date, customer_id, customer_name, amount_in_words, created_at, updated_at) VALUES ('I-1', '2026-10-01', ?1, 'A', 'x', 'x', 'x')"),
            ("payments", "INSERT INTO payments (payment_number, customer_id, customer_name, payment_date, created_at, updated_at) VALUES ('P-1', ?1, 'A', '2026-10-01', 'x', 'x')"),
            ("purchase_orders", "INSERT INTO purchase_orders (customer_id, po_number, created_at, updated_at) VALUES (?1, 'PO-1', 'x', 'x')"),
            ("quotations", "INSERT INTO quotations (customer_id, quotation_number, quotation_date, created_at, updated_at) VALUES (?1, 'Q-1', '2026-10-01', 'x', 'x')"),
            ("customer_credits", "INSERT INTO customer_credits (customer_id, original_amount, remaining_amount, created_at, updated_at) VALUES (?1, 5, 5, 'x', 'x')"),
        ];
        for (table, insert) in records {
            conn.execute(insert, params![id]).unwrap();
            let err = update_type(&conn, id, "A", Some("SUPPLIER")).unwrap_err();
            assert_eq!(
                err,
                "This company has 1 customer record(s) (invoices, payments, purchase orders, quotations or advances), so it can't be changed to Supplier only.",
                "{}",
                table
            );
            assert_eq!(update_type(&conn, id, "A", Some("BOTH")).unwrap().party_type, "BOTH", "{}", table);
            update_type(&conn, id, "A", Some("CUSTOMER")).unwrap();
            conn.execute(&format!("DELETE FROM {}", table), []).unwrap();
        }
        assert_eq!(update_type(&conn, id, "A", Some("SUPPLIER")).unwrap().party_type, "SUPPLIER");
    }

    #[test]
    fn editing_without_a_type_keeps_the_current_type() {
        let dir = tempfile::tempdir().unwrap();
        let conn = setup_test_db(&dir.path().join("t.db"));
        let id = company(&conn, "A", Some("SUPPLIER")).id;
        assert_eq!(update_type(&conn, id, "A renamed", None).unwrap().party_type, "SUPPLIER");
    }
}
