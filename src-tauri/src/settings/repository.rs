use super::models::BusinessSettings;
use chrono::Utc;
use rusqlite::{params, Connection};
use std::collections::HashMap;

pub struct SettingsRepository;

impl SettingsRepository {
    /// Saved settings, with the built-in defaults for anything never saved.
    pub fn get(conn: &Connection) -> Result<BusinessSettings, String> {
        let mut stmt = conn
            .prepare("SELECT key, value FROM app_settings")
            .map_err(|e| format!("Could not read settings: {}", e))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("Could not read settings: {}", e))?;
        let mut saved: HashMap<String, String> = HashMap::new();
        for row in rows {
            let (k, v) = row.map_err(|e| e.to_string())?;
            saved.insert(k, v);
        }

        let mut s = BusinessSettings::default();
        let text = |key: &str, target: &mut String| {
            if let Some(v) = saved.get(key) {
                *target = v.clone();
            }
        };
        let number = |key: &str, target: &mut f64| {
            if let Some(v) = saved.get(key).and_then(|v| v.parse::<f64>().ok()) {
                *target = v;
            }
        };
        text("business_name", &mut s.business_name);
        text("business_subtitle", &mut s.business_subtitle);
        text("gstin", &mut s.gstin);
        text("phone", &mut s.phone);
        text("email", &mut s.email);
        text("address", &mut s.address);
        text("services_banner", &mut s.services_banner);
        text("bank_name", &mut s.bank_name);
        text("bank_branch", &mut s.bank_branch);
        text("bank_account_no", &mut s.bank_account_no);
        text("bank_ifsc", &mut s.bank_ifsc);
        text("terms_and_conditions", &mut s.terms_and_conditions);
        number("cgst_rate", &mut s.cgst_rate);
        number("sgst_rate", &mut s.sgst_rate);
        number("igst_rate", &mut s.igst_rate);
        Ok(s)
    }

    fn validate(mut s: BusinessSettings) -> Result<BusinessSettings, String> {
        let trim = |v: &mut String| *v = v.trim().to_string();
        trim(&mut s.business_name);
        trim(&mut s.business_subtitle);
        trim(&mut s.gstin);
        trim(&mut s.phone);
        trim(&mut s.email);
        trim(&mut s.address);
        trim(&mut s.services_banner);
        trim(&mut s.bank_name);
        trim(&mut s.bank_branch);
        trim(&mut s.bank_account_no);
        trim(&mut s.bank_ifsc);
        s.terms_and_conditions = s.terms_and_conditions.trim().to_string();
        s.gstin = s.gstin.to_uppercase();
        s.bank_ifsc = s.bank_ifsc.to_uppercase();

        if s.business_name.is_empty() {
            return Err("Enter your business name.".to_string());
        }
        if !s.gstin.is_empty() && !(s.gstin.len() == 15 && s.gstin.chars().all(|c| c.is_ascii_alphanumeric())) {
            return Err("GSTIN should be 15 letters and digits, like 34AIRPV5028N1ZG.".to_string());
        }
        if !s.bank_ifsc.is_empty() && !(s.bank_ifsc.len() == 11 && s.bank_ifsc.chars().all(|c| c.is_ascii_alphanumeric())) {
            return Err("IFSC should be 11 characters, like IDIB000M070.".to_string());
        }
        if !s.bank_account_no.is_empty()
            && !(s.bank_account_no.len() >= 6 && s.bank_account_no.len() <= 18 && s.bank_account_no.chars().all(|c| c.is_ascii_digit()))
        {
            return Err("Account number should be 6 to 18 digits.".to_string());
        }
        for (label, rate) in [("CGST", s.cgst_rate), ("SGST", s.sgst_rate), ("IGST", s.igst_rate)] {
            if !rate.is_finite() || !(0.0..=100.0).contains(&rate) {
                return Err(format!("{} rate must be between 0 and 100.", label));
            }
        }
        Ok(s)
    }

    pub fn save(conn: &Connection, input: BusinessSettings) -> Result<BusinessSettings, String> {
        let s = Self::validate(input)?;
        let now = Utc::now().to_rfc3339();
        let pairs: Vec<(&str, String)> = vec![
            ("business_name", s.business_name.clone()),
            ("business_subtitle", s.business_subtitle.clone()),
            ("gstin", s.gstin.clone()),
            ("phone", s.phone.clone()),
            ("email", s.email.clone()),
            ("address", s.address.clone()),
            ("services_banner", s.services_banner.clone()),
            ("bank_name", s.bank_name.clone()),
            ("bank_branch", s.bank_branch.clone()),
            ("bank_account_no", s.bank_account_no.clone()),
            ("bank_ifsc", s.bank_ifsc.clone()),
            ("terms_and_conditions", s.terms_and_conditions.clone()),
            ("cgst_rate", s.cgst_rate.to_string()),
            ("sgst_rate", s.sgst_rate.to_string()),
            ("igst_rate", s.igst_rate.to_string()),
        ];
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (key, value) in pairs {
            tx.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![key, value, now],
            )
            .map_err(|e| format!("Could not save settings: {}", e))?;
        }
        tx.commit().map_err(|e| format!("Could not save settings: {}", e))?;
        Ok(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseManager;

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = DatabaseManager::new(dir.path().join("s.db")).unwrap().get_connection().unwrap();
        (dir, conn)
    }

    #[test]
    fn defaults_then_saved_values() {
        let (_d, conn) = setup();
        let d = SettingsRepository::get(&conn).unwrap();
        assert_eq!((d.cgst_rate, d.sgst_rate, d.igst_rate), (9.0, 9.0, 18.0));
        assert_eq!(d.bank_account_no, "498877880");

        let mut changed = d.clone();
        changed.bank_name = " New Bank ".to_string();
        changed.bank_ifsc = "abcd0123456".to_string();
        changed.igst_rate = 12.5;
        let saved = SettingsRepository::save(&conn, changed).unwrap();
        assert_eq!(saved.bank_name, "New Bank");
        let reread = SettingsRepository::get(&conn).unwrap();
        assert_eq!(reread, saved);
        assert_eq!(reread.bank_ifsc, "ABCD0123456");
        assert_eq!(reread.igst_rate, 12.5);
        assert_eq!(reread.gstin, d.gstin); // untouched values survive
    }

    #[test]
    fn rejects_bad_input() {
        let (_d, conn) = setup();
        let ok = BusinessSettings::default();
        let mut bad = ok.clone();
        bad.business_name = "  ".into();
        assert!(SettingsRepository::save(&conn, bad).is_err());
        let mut bad = ok.clone();
        bad.cgst_rate = 120.0;
        assert!(SettingsRepository::save(&conn, bad).is_err());
        let mut bad = ok.clone();
        bad.bank_account_no = "12ab".into();
        assert!(SettingsRepository::save(&conn, bad).is_err());
        let mut bad = ok;
        bad.bank_ifsc = "SHORT".into();
        assert!(SettingsRepository::save(&conn, bad).is_err());
    }
}
