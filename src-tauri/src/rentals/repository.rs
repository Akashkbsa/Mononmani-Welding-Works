use super::models::{
    Place, PlaceDetail, PlaceInput, PlaceListItem, RentalFileInfo, Tenant, TenantDetail, TenantInput, TenantListItem,
};
use super::reminder::normalize_whatsapp_number;
use crate::attachments::{clean_file_name, validate_file};
use crate::util::{normalize_date, round2};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

const FILE_GONE: &str = "That file is no longer there.";
const PLACE_NOT_FOUND: &str = "Place not found.";
const TENANT_NOT_FOUND: &str = "Tenant not found.";
const PLACE_TAKEN: &str = "This place already has a current tenant. Mark that tenant as moved out first.";

pub struct RentalRepository;

fn clean(value: &Option<String>) -> Option<String> {
    value.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

impl RentalRepository {
    // ------------------------------------------------------------------ places

    fn clean_place(conn: &Connection, input: &PlaceInput, exclude_id: i64) -> Result<(String, f64), String> {
        let name = input.name.trim().to_string();
        if name.is_empty() {
            return Err("Place name is required.".to_string());
        }
        let rent = round2(input.monthly_rent);
        if rent < 0.0 {
            return Err("Monthly rent can't be negative.".to_string());
        }
        let clash: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM rental_places WHERE name = ?1 COLLATE NOCASE AND id != ?2",
                params![name, exclude_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to check the place name: {}", e))?;
        if clash > 0 {
            return Err("A place with this name already exists.".to_string());
        }
        Ok((name, rent))
    }

    pub fn create_place(conn: &Connection, input: PlaceInput) -> Result<PlaceDetail, String> {
        let (name, rent) = Self::clean_place(conn, &input, -1)?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO rental_places (name, address, monthly_rent, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![name, clean(&input.address), rent, clean(&input.notes), now],
        )
        .map_err(|e| format!("Failed to save the place: {}", e))?;
        let id = conn.last_insert_rowid();
        Self::get_place(conn, id)?.ok_or_else(|| "Saved place could not be reloaded.".to_string())
    }

    pub fn update_place(conn: &Connection, id: i64, input: PlaceInput) -> Result<PlaceDetail, String> {
        if Self::get_place(conn, id)?.is_none() {
            return Err(PLACE_NOT_FOUND.to_string());
        }
        let (name, rent) = Self::clean_place(conn, &input, id)?;
        conn.execute(
            "UPDATE rental_places SET name = ?1, address = ?2, monthly_rent = ?3, notes = ?4, updated_at = ?5 WHERE id = ?6",
            params![name, clean(&input.address), rent, clean(&input.notes), Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to save the place: {}", e))?;
        Self::get_place(conn, id)?.ok_or_else(|| "Saved place could not be reloaded.".to_string())
    }

    pub fn delete_place(conn: &Connection, id: i64) -> Result<(), String> {
        if Self::get_place(conn, id)?.is_none() {
            return Err(PLACE_NOT_FOUND.to_string());
        }
        let tenants: i64 = conn
            .query_row("SELECT COUNT(*) FROM rental_tenants WHERE place_id = ?1", params![id], |r| r.get(0))
            .map_err(|e| format!("Failed to check the place: {}", e))?;
        if tenants > 0 {
            return Err("This place has had tenants, so it can't be deleted.".to_string());
        }
        conn.execute("DELETE FROM rental_places WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete the place: {}", e))?;
        Ok(())
    }

    pub fn get_place(conn: &Connection, id: i64) -> Result<Option<PlaceDetail>, String> {
        let place = conn
            .query_row(
                "SELECT id, name, address, monthly_rent, notes, created_at, updated_at FROM rental_places WHERE id = ?1",
                params![id],
                |r| {
                    Ok(Place {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        address: r.get(2)?,
                        monthly_rent: r.get(3)?,
                        notes: r.get(4)?,
                        created_at: r.get(5)?,
                        updated_at: r.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to load the place: {}", e))?;
        let Some(place) = place else { return Ok(None) };
        let files = Self::files_of(conn, "PLACE", id)?;
        Ok(Some(PlaceDetail { place, files }))
    }

    pub fn list_places(conn: &Connection) -> Result<Vec<PlaceListItem>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.name, p.address, p.monthly_rent,
                        (SELECT t.name FROM rental_tenants t WHERE t.place_id = p.id AND t.moved_out_date IS NULL),
                        (SELECT COUNT(*) FROM rental_files f WHERE f.owner_kind = 'PLACE' AND f.owner_id = p.id)
                 FROM rental_places p ORDER BY p.name COLLATE NOCASE",
            )
            .map_err(|e| format!("Failed to load places: {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(PlaceListItem {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    address: r.get(2)?,
                    monthly_rent: r.get(3)?,
                    current_tenant: r.get(4)?,
                    file_count: r.get(5)?,
                })
            })
            .map_err(|e| format!("Failed to load places: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read places: {}", e))
    }

    // ----------------------------------------------------------------- tenants

    /// The cleaned name, number, rent and move-in date of a tenant input.
    fn clean_tenant(conn: &Connection, input: &TenantInput) -> Result<(String, String, f64, Option<String>), String> {
        let name = input.name.trim().to_string();
        if name.is_empty() {
            return Err("Tenant name is required.".to_string());
        }
        if input.place_id <= 0 {
            return Err("Choose the place.".to_string());
        }
        let known: i64 = conn
            .query_row("SELECT COUNT(*) FROM rental_places WHERE id = ?1", params![input.place_id], |r| r.get(0))
            .map_err(|e| format!("Failed to check the place: {}", e))?;
        if known == 0 {
            return Err(PLACE_NOT_FOUND.to_string());
        }
        let number = normalize_whatsapp_number(&input.whatsapp_number)?;
        let rent = round2(input.monthly_rent);
        if !(rent > 0.0) {
            return Err("Monthly rent must be more than zero.".to_string());
        }
        let move_in = match clean(&input.move_in_date) {
            Some(d) => Some(normalize_date(&d, "Move-in date")?),
            None => None,
        };
        Ok((name, number, rent, move_in))
    }

    /// Another tenant (not `exclude_id`) living in the place now.
    fn place_is_taken(conn: &Connection, place_id: i64, exclude_id: i64) -> Result<bool, String> {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM rental_tenants WHERE place_id = ?1 AND moved_out_date IS NULL AND id != ?2",
                params![place_id, exclude_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to check the place: {}", e))?;
        Ok(n > 0)
    }

    pub fn create_tenant(conn: &Connection, input: TenantInput) -> Result<TenantDetail, String> {
        let (name, number, rent, move_in) = Self::clean_tenant(conn, &input)?;
        if Self::place_is_taken(conn, input.place_id, -1)? {
            return Err(PLACE_TAKEN.to_string());
        }
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO rental_tenants (place_id, name, whatsapp_number, monthly_rent, move_in_date, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![input.place_id, name, number, rent, move_in, clean(&input.notes), now],
        )
        .map_err(|e| format!("Failed to save the tenant: {}", e))?;
        let id = conn.last_insert_rowid();
        Self::get_tenant(conn, id)?.ok_or_else(|| "Saved tenant could not be reloaded.".to_string())
    }

    pub fn update_tenant(conn: &Connection, id: i64, input: TenantInput) -> Result<TenantDetail, String> {
        let current = Self::get_tenant(conn, id)?.ok_or_else(|| TENANT_NOT_FOUND.to_string())?;
        let (name, number, rent, move_in) = Self::clean_tenant(conn, &input)?;
        if let (Some(moved_out), Some(move_in)) = (&current.tenant.moved_out_date, &move_in) {
            if moved_out < move_in {
                return Err("The moved-out date can't be before the move-in date.".to_string());
            }
        }
        let is_current = current.tenant.moved_out_date.is_none();
        if is_current && input.place_id != current.tenant.place_id && Self::place_is_taken(conn, input.place_id, id)? {
            return Err(PLACE_TAKEN.to_string());
        }
        conn.execute(
            "UPDATE rental_tenants SET place_id = ?1, name = ?2, whatsapp_number = ?3, monthly_rent = ?4, move_in_date = ?5,
                    notes = ?6, updated_at = ?7 WHERE id = ?8",
            params![input.place_id, name, number, rent, move_in, clean(&input.notes), Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to save the tenant: {}", e))?;
        Self::get_tenant(conn, id)?.ok_or_else(|| "Saved tenant could not be reloaded.".to_string())
    }

    /// Mark a tenant as moved out on a date, or move them back in with `None`.
    pub fn set_moved_out(conn: &Connection, id: i64, moved_out_date: Option<&str>) -> Result<TenantDetail, String> {
        let current = Self::get_tenant(conn, id)?.ok_or_else(|| TENANT_NOT_FOUND.to_string())?;
        let date = match moved_out_date.map(str::trim).filter(|d| !d.is_empty()) {
            Some(d) => {
                let normalized = normalize_date(d, "Moved-out date")?;
                if let Some(move_in) = &current.tenant.move_in_date {
                    if normalized < *move_in {
                        return Err("The moved-out date can't be before the move-in date.".to_string());
                    }
                }
                Some(normalized)
            }
            None => {
                if Self::place_is_taken(conn, current.tenant.place_id, id)? {
                    return Err(PLACE_TAKEN.to_string());
                }
                None
            }
        };
        conn.execute(
            "UPDATE rental_tenants SET moved_out_date = ?1, updated_at = ?2 WHERE id = ?3",
            params![date, Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to save the tenant: {}", e))?;
        Self::get_tenant(conn, id)?.ok_or_else(|| "Saved tenant could not be reloaded.".to_string())
    }

    pub fn delete_tenant(conn: &Connection, id: i64) -> Result<(), String> {
        if Self::get_tenant(conn, id)?.is_none() {
            return Err(TENANT_NOT_FOUND.to_string());
        }
        let months: i64 = conn
            .query_row("SELECT COUNT(*) FROM rent_months WHERE tenant_id = ?1", params![id], |r| r.get(0))
            .map_err(|e| format!("Failed to check the tenant: {}", e))?;
        if months > 0 {
            return Err("This tenant has rent records, so they can't be deleted. Mark them as moved out instead.".to_string());
        }
        conn.execute("DELETE FROM rental_tenants WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete the tenant: {}", e))?;
        Ok(())
    }

    pub fn get_tenant(conn: &Connection, id: i64) -> Result<Option<TenantDetail>, String> {
        let tenant = conn
            .query_row(
                "SELECT t.id, t.place_id, p.name, t.name, t.whatsapp_number, t.monthly_rent, t.move_in_date, t.moved_out_date,
                        t.notes, t.created_at, t.updated_at
                 FROM rental_tenants t JOIN rental_places p ON p.id = t.place_id WHERE t.id = ?1",
                params![id],
                |r| {
                    Ok(Tenant {
                        id: r.get(0)?,
                        place_id: r.get(1)?,
                        place_name: r.get(2)?,
                        name: r.get(3)?,
                        whatsapp_number: r.get(4)?,
                        monthly_rent: r.get(5)?,
                        move_in_date: r.get(6)?,
                        moved_out_date: r.get(7)?,
                        notes: r.get(8)?,
                        created_at: r.get(9)?,
                        updated_at: r.get(10)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to load the tenant: {}", e))?;
        let Some(tenant) = tenant else { return Ok(None) };
        let files = Self::files_of(conn, "TENANT", id)?;
        Ok(Some(TenantDetail { tenant, files }))
    }

    /// Current tenants first, then those who moved out (only when asked for), each by name.
    pub fn list_tenants(conn: &Connection, include_moved_out: bool) -> Result<Vec<TenantListItem>, String> {
        let mut query = String::from(
            "SELECT t.id, t.place_id, p.name, t.name, t.whatsapp_number, t.monthly_rent, t.move_in_date, t.moved_out_date,
                    (SELECT COUNT(*) FROM rental_files f WHERE f.owner_kind = 'TENANT' AND f.owner_id = t.id)
             FROM rental_tenants t JOIN rental_places p ON p.id = t.place_id",
        );
        if !include_moved_out {
            query.push_str(" WHERE t.moved_out_date IS NULL");
        }
        query.push_str(" ORDER BY (t.moved_out_date IS NOT NULL), t.name COLLATE NOCASE");
        let mut stmt = conn.prepare(&query).map_err(|e| format!("Failed to load tenants: {}", e))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(TenantListItem {
                    id: r.get(0)?,
                    place_id: r.get(1)?,
                    place_name: r.get(2)?,
                    name: r.get(3)?,
                    whatsapp_number: r.get(4)?,
                    monthly_rent: r.get(5)?,
                    move_in_date: r.get(6)?,
                    moved_out_date: r.get(7)?,
                    file_count: r.get(8)?,
                })
            })
            .map_err(|e| format!("Failed to load tenants: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read tenants: {}", e))
    }

    // ------------------------------------------------------------------- files

    fn files_of(conn: &Connection, kind: &str, owner_id: i64) -> Result<Vec<RentalFileInfo>, String> {
        // The file contents are never read here, only their names and sizes.
        let mut stmt = conn
            .prepare("SELECT id, file_name, mime_type, size_bytes FROM rental_files WHERE owner_kind = ?1 AND owner_id = ?2 ORDER BY id")
            .map_err(|e| format!("Failed to load files: {}", e))?;
        let rows = stmt
            .query_map(params![kind, owner_id], |r| {
                Ok(RentalFileInfo { id: r.get(0)?, file_name: r.get(1)?, mime_type: r.get(2)?, size_bytes: r.get(3)? })
            })
            .map_err(|e| format!("Failed to load files: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read files: {}", e))
    }

    pub fn add_file(conn: &Connection, owner_kind: &str, owner_id: i64, file_name: &str, bytes: &[u8]) -> Result<RentalFileInfo, String> {
        let (kind, table, missing) = match owner_kind {
            "PLACE" => ("PLACE", "rental_places", PLACE_NOT_FOUND),
            "TENANT" => ("TENANT", "rental_tenants", TENANT_NOT_FOUND),
            _ => return Err("Owner must be PLACE or TENANT.".to_string()),
        };
        let exists: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {} WHERE id = ?1", table), params![owner_id], |r| r.get(0))
            .map_err(|e| format!("Failed to check the owner: {}", e))?;
        if exists == 0 {
            return Err(missing.to_string());
        }
        let mime = validate_file(file_name, bytes)?;
        let name = clean_file_name(file_name);
        conn.execute(
            "INSERT INTO rental_files (owner_kind, owner_id, file_name, mime_type, size_bytes, data, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![kind, owner_id, name, mime, bytes.len() as i64, bytes, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Failed to save the file: {}", e))?;
        Ok(RentalFileInfo { id: conn.last_insert_rowid(), file_name: name, mime_type: mime.to_string(), size_bytes: bytes.len() as i64 })
    }

    pub fn remove_file(conn: &Connection, file_id: i64) -> Result<(), String> {
        let removed = conn
            .execute("DELETE FROM rental_files WHERE id = ?1", params![file_id])
            .map_err(|e| format!("Failed to remove the file: {}", e))?;
        if removed == 0 {
            return Err(FILE_GONE.to_string());
        }
        Ok(())
    }

    /// File name, MIME type and contents of one attached file.
    pub fn read_file(conn: &Connection, file_id: i64) -> Result<(String, String, Vec<u8>), String> {
        conn.query_row(
            "SELECT file_name, mime_type, data FROM rental_files WHERE id = ?1",
            params![file_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| format!("Failed to read the file: {}", e))?
        .ok_or_else(|| FILE_GONE.to_string())
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;
    use crate::rentals::models::*;
    use rusqlite::{params, Connection};

    const PDF: &[u8] = b"%PDF-1.4 sample";

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = DatabaseManager::new(dir.path().join("t.db")).unwrap();
        let conn = db.get_connection().unwrap();
        (dir, conn)
    }

    fn place_input(name: &str, rent: f64) -> PlaceInput {
        PlaceInput { name: name.to_string(), address: None, monthly_rent: rent, notes: None }
    }

    fn place(conn: &Connection, name: &str) -> i64 {
        RentalRepository::create_place(conn, place_input(name, 5000.0)).unwrap().place.id
    }

    fn tenant_input(place_id: i64, name: &str) -> TenantInput {
        TenantInput {
            place_id,
            name: name.to_string(),
            whatsapp_number: "98765 43210".to_string(),
            monthly_rent: 5000.0,
            move_in_date: None,
            notes: None,
        }
    }

    fn tenant(conn: &Connection, place_id: i64, name: &str) -> i64 {
        RentalRepository::create_tenant(conn, tenant_input(place_id, name)).unwrap().tenant.id
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn places_need_a_unique_name_and_a_sensible_rent() {
        let (_d, conn) = setup();
        assert_eq!(RentalRepository::create_place(&conn, place_input("   ", 100.0)).unwrap_err(), "Place name is required.");
        assert_eq!(RentalRepository::create_place(&conn, place_input("Flat", -1.0)).unwrap_err(), "Monthly rent can't be negative.");
        let mut input = place_input(" Flat 2B ", 5000.0);
        input.address = Some("   ".to_string());
        let saved = RentalRepository::create_place(&conn, input).unwrap().place;
        assert_eq!((saved.name.as_str(), saved.address.clone()), ("Flat 2B", None));
        assert_eq!(
            RentalRepository::create_place(&conn, place_input("flat 2b", 1.0)).unwrap_err(),
            "A place with this name already exists."
        );
        let other = place(&conn, "Shop 1");
        assert!(RentalRepository::update_place(&conn, saved.id, place_input("Flat 2B", 6000.0)).is_ok(), "keeping its own name is fine");
        assert_eq!(
            RentalRepository::update_place(&conn, other, place_input("FLAT 2B", 1.0)).unwrap_err(),
            "A place with this name already exists."
        );
        assert_eq!(RentalRepository::update_place(&conn, 9999, place_input("X", 1.0)).unwrap_err(), "Place not found.");
    }

    #[test]
    fn tenants_need_a_name_place_number_and_rent() {
        let (_d, conn) = setup();
        let p = place(&conn, "Flat 2B");
        let mut blank = tenant_input(p, "  ");
        assert_eq!(RentalRepository::create_tenant(&conn, blank.clone()).unwrap_err(), "Tenant name is required.");
        blank.name = "Ravi".to_string();
        blank.place_id = 0;
        assert_eq!(RentalRepository::create_tenant(&conn, blank.clone()).unwrap_err(), "Choose the place.");
        blank.place_id = 9999;
        assert_eq!(RentalRepository::create_tenant(&conn, blank.clone()).unwrap_err(), "Place not found.");
        blank.place_id = p;
        blank.whatsapp_number = "12345".to_string();
        assert!(RentalRepository::create_tenant(&conn, blank.clone()).unwrap_err().contains("10-digit"));
        blank.whatsapp_number = "98765 43210".to_string();
        blank.monthly_rent = 0.0;
        assert_eq!(RentalRepository::create_tenant(&conn, blank.clone()).unwrap_err(), "Monthly rent must be more than zero.");
        blank.monthly_rent = 5000.0;
        blank.move_in_date = Some("31-02-2026".to_string());
        assert_eq!(RentalRepository::create_tenant(&conn, blank.clone()).unwrap_err(), "Move-in date is not a valid date.");

        let mut good = tenant_input(p, " Ravi ");
        good.move_in_date = Some("05-10-2026".to_string());
        good.notes = Some("  ".to_string());
        let t = RentalRepository::create_tenant(&conn, good).unwrap().tenant;
        assert_eq!((t.name.as_str(), t.whatsapp_number.as_str(), t.place_name.as_str()), ("Ravi", "+919876543210", "Flat 2B"));
        assert_eq!((t.move_in_date.as_deref(), t.notes.clone()), (Some("2026-10-05"), None));
    }

    #[test]
    fn one_current_tenant_per_place() {
        let (_d, conn) = setup();
        let p = place(&conn, "Flat 2B");
        let taken = "This place already has a current tenant. Mark that tenant as moved out first.";
        let first = tenant(&conn, p, "Ravi");
        assert_eq!(RentalRepository::create_tenant(&conn, tenant_input(p, "Meena")).unwrap_err(), taken);

        RentalRepository::set_moved_out(&conn, first, Some("2026-10-31")).unwrap();
        let second = tenant(&conn, p, "Meena");
        assert_eq!(RentalRepository::set_moved_out(&conn, first, None).unwrap_err(), taken, "moving back in while the place is taken");

        let q = place(&conn, "Shop 1");
        let third = tenant(&conn, q, "Kumar");
        let mut moved = tenant_input(p, "Kumar");
        moved.place_id = p;
        assert_eq!(RentalRepository::update_tenant(&conn, third, moved).unwrap_err(), taken, "changing to a taken place");
        assert!(RentalRepository::update_tenant(&conn, second, tenant_input(p, "Meena S")).is_ok(), "editing in place is fine");
    }

    #[test]
    fn moving_out_and_back() {
        let (_d, conn) = setup();
        let p = place(&conn, "Flat 2B");
        let mut input = tenant_input(p, "Ravi");
        input.move_in_date = Some("2026-10-05".to_string());
        let t = RentalRepository::create_tenant(&conn, input).unwrap().tenant.id;
        assert_eq!(
            RentalRepository::set_moved_out(&conn, t, Some("01-10-2026")).unwrap_err(),
            "The moved-out date can't be before the move-in date."
        );
        assert_eq!(RentalRepository::set_moved_out(&conn, t, Some("not a date")).unwrap_err(), "Moved-out date is not a valid date.");
        let out = RentalRepository::set_moved_out(&conn, t, Some("30-11-2026")).unwrap().tenant;
        assert_eq!(out.moved_out_date.as_deref(), Some("2026-11-30"));
        // Editing the move-in date can't push it past the moved-out date either.
        let mut edit = tenant_input(p, "Ravi");
        edit.move_in_date = Some("2026-12-01".to_string());
        assert_eq!(
            RentalRepository::update_tenant(&conn, t, edit).unwrap_err(),
            "The moved-out date can't be before the move-in date."
        );
        let back =RentalRepository::set_moved_out(&conn, t, None).unwrap().tenant;
        assert_eq!(back.moved_out_date, None);
        assert_eq!(RentalRepository::set_moved_out(&conn, 9999, None).unwrap_err(), "Tenant not found.");
    }

    #[test]
    fn lists_show_the_current_tenant_and_vacancy() {
        let (_d, conn) = setup();
        let p = place(&conn, "Flat 2B");
        let q = place(&conn, "Shop 1");
        let old = tenant(&conn, q, "Old Tenant");
        RentalRepository::set_moved_out(&conn, old, Some("2026-09-30")).unwrap();
        tenant(&conn, p, "Ravi");

        let places = RentalRepository::list_places(&conn).unwrap();
        assert_eq!(places.iter().map(|x| (x.name.as_str(), x.current_tenant.as_deref())).collect::<Vec<_>>(), vec![("Flat 2B", Some("Ravi")), ("Shop 1", None)]);

        let current = RentalRepository::list_tenants(&conn, false).unwrap();
        assert_eq!(current.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["Ravi"]);
        let all = RentalRepository::list_tenants(&conn, true).unwrap();
        assert_eq!(all.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["Ravi", "Old Tenant"], "current first");
    }

    #[test]
    fn a_place_that_has_had_tenants_cannot_be_deleted() {
        let (_d, conn) = setup();
        let p = place(&conn, "Flat 2B");
        let t = tenant(&conn, p, "Ravi");
        RentalRepository::set_moved_out(&conn, t, Some("2026-10-31")).unwrap();
        assert_eq!(RentalRepository::delete_place(&conn, p).unwrap_err(), "This place has had tenants, so it can't be deleted.");

        let empty = place(&conn, "Shop 1");
        RentalRepository::add_file(&conn, "PLACE", empty, "deed.pdf", PDF).unwrap();
        RentalRepository::delete_place(&conn, empty).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM rental_files WHERE owner_kind = 'PLACE'"), 0, "files go with the place");
        assert_eq!(RentalRepository::delete_place(&conn, empty).unwrap_err(), "Place not found.");
    }

    #[test]
    fn a_tenant_with_rent_records_cannot_be_deleted() {
        let (_d, conn) = setup();
        let p = place(&conn, "Flat 2B");
        let paid = tenant(&conn, p, "Ravi");
        conn.execute("INSERT INTO rent_months (tenant_id, month, paid_on, created_at, updated_at) VALUES (?1, '2026-10', '2026-10-03', 'x', 'x')", params![paid]).unwrap();
        assert_eq!(
            RentalRepository::delete_tenant(&conn, paid).unwrap_err(),
            "This tenant has rent records, so they can't be deleted. Mark them as moved out instead."
        );
        RentalRepository::set_moved_out(&conn, paid, Some("2026-10-31")).unwrap();

        let q = place(&conn, "Shop 1");
        let fresh = tenant(&conn, q, "Kumar");
        RentalRepository::add_file(&conn, "TENANT", fresh, "id.pdf", PDF).unwrap();
        RentalRepository::delete_tenant(&conn, fresh).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM rental_files WHERE owner_kind = 'TENANT'"), 0, "files go with the tenant");
        assert_eq!(RentalRepository::delete_tenant(&conn, fresh).unwrap_err(), "Tenant not found.");
    }

    #[test]
    fn files_follow_the_shared_rules() {
        let (_d, conn) = setup();
        let p = place(&conn, "Flat 2B");
        let t = tenant(&conn, p, "Ravi");
        let placed = RentalRepository::add_file(&conn, "PLACE", p, "..\\deed.pdf", PDF).unwrap();
        assert_eq!((placed.file_name.as_str(), placed.mime_type.as_str()), ("deed.pdf", "application/pdf"));
        let owned = RentalRepository::add_file(&conn, "TENANT", t, "agreement.pdf", PDF).unwrap();
        let (name, mime, bytes) = RentalRepository::read_file(&conn, owned.id).unwrap();
        assert_eq!((name.as_str(), mime.as_str(), bytes.as_slice()), ("agreement.pdf", "application/pdf", PDF));

        assert!(RentalRepository::add_file(&conn, "TENANT", t, "fake.pdf", b"just text").is_err());
        assert_eq!(RentalRepository::add_file(&conn, "ROOM", t, "a.pdf", PDF).unwrap_err(), "Owner must be PLACE or TENANT.");
        assert_eq!(RentalRepository::add_file(&conn, "PLACE", 9999, "a.pdf", PDF).unwrap_err(), "Place not found.");
        assert_eq!(RentalRepository::add_file(&conn, "TENANT", 9999, "a.pdf", PDF).unwrap_err(), "Tenant not found.");

        assert_eq!(RentalRepository::get_place(&conn, p).unwrap().unwrap().files.len(), 1);
        assert_eq!(RentalRepository::get_tenant(&conn, t).unwrap().unwrap().files.len(), 1);
        assert_eq!(RentalRepository::list_places(&conn).unwrap()[0].file_count, 1);
        assert_eq!(RentalRepository::list_tenants(&conn, false).unwrap()[0].file_count, 1);

        RentalRepository::remove_file(&conn, owned.id).unwrap();
        assert_eq!(RentalRepository::remove_file(&conn, owned.id).unwrap_err(), "That file is no longer there.");
        assert_eq!(RentalRepository::read_file(&conn, owned.id).unwrap_err(), "That file is no longer there.");
    }
}
