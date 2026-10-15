//! When the automatic backup runs, which old backups are thinned out, and how full Google Drive is.
//! No network and no database here, so every rule can be tested on its own.

use chrono::{Months, NaiveDate};
use std::collections::HashMap;

/// Less free space than this on Google Drive shows the "almost full" warning.
pub const LOW_SPACE_BYTES: i64 = 500 * 1024 * 1024;

/// The automatic backup runs when something changed and nothing was backed up today.
/// `last_success` is the finish time of the last good backup ("YYYY-MM-DD HH:MM:SS"), `today` is "YYYY-MM-DD".
pub fn backup_due(last_success: Option<&str>, today: &str, has_changes: bool) -> bool {
    has_changes && last_success.and_then(|s| s.get(..10)) != Some(today)
}

/// The day ("YYYY-MM-DD") and the sortable time ("YYYY-MM-DD_HHMMSS") from a backup's name,
/// e.g. `manonmani-2026-10-15_104233-seq12.db.gz`. Anything else is not one of the app's backups.
pub fn backup_stamp(name: &str) -> Option<(String, String)> {
    let rest = name.strip_prefix("manonmani-")?;
    if !name.ends_with(".db.gz") {
        return None;
    }
    let stamp = rest.get(..17)?;
    let day = stamp.get(..10)?;
    NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
    if stamp.as_bytes().get(10) != Some(&b'_') || !stamp[11..].bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((day.to_string(), stamp.to_string()))
}

/// Backups older than two years keep only the newest one of each month; the rest are returned
/// (by id) to be removed. Files that are not the app's backups are never returned.
/// `files` is (id, name).
pub fn files_to_thin(files: &[(String, String)], today: NaiveDate) -> Vec<String> {
    let cutoff = today.checked_sub_months(Months::new(24)).unwrap_or(today).format("%Y-%m-%d").to_string();
    let mut newest: HashMap<String, (String, String)> = HashMap::new(); // month -> (stamp, id)
    let mut old: Vec<(String, String, String)> = Vec::new(); // (month, stamp, id)
    for (id, name) in files {
        let Some((day, stamp)) = backup_stamp(name) else { continue };
        if day >= cutoff {
            continue;
        }
        let month = day[..7].to_string();
        let keep = newest.entry(month.clone()).or_insert_with(|| (stamp.clone(), id.clone()));
        if stamp > keep.0 {
            *keep = (stamp.clone(), id.clone());
        }
        old.push((month, stamp, id.clone()));
    }
    old.into_iter().filter(|(month, _, id)| newest.get(month).map(|k| &k.1) != Some(id)).map(|(_, _, id)| id).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpaceState {
    Ok,
    /// Less than `LOW_SPACE_BYTES` free.
    Low,
    /// The next backup does not fit.
    Full,
}

impl SpaceState {
    pub fn as_str(self) -> &'static str {
        match self {
            SpaceState::Ok => "OK",
            SpaceState::Low => "LOW",
            SpaceState::Full => "FULL",
        }
    }
}

/// Free bytes on the Google account, or None when there is no limit or it is unknown.
pub fn free_bytes(used: Option<i64>, limit: Option<i64>) -> Option<i64> {
    Some((limit? - used.unwrap_or(0)).max(0))
}

/// How full Google Drive is for a backup of `need` bytes. Unknown or unlimited storage counts as OK;
/// Google refuses the upload itself if it really is full.
pub fn space_state(used: Option<i64>, limit: Option<i64>, need: i64) -> SpaceState {
    match free_bytes(used, limit) {
        None => SpaceState::Ok,
        Some(free) if free < need => SpaceState::Full,
        Some(free) if free < LOW_SPACE_BYTES => SpaceState::Low,
        Some(_) => SpaceState::Ok,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn file(id: &str, name: &str) -> (String, String) {
        (id.to_string(), name.to_string())
    }

    #[test]
    fn a_backup_is_due_once_a_day_when_something_changed() {
        assert!(backup_due(None, "2026-10-15", true), "never backed up");
        assert!(backup_due(Some("2026-10-14 18:02:11"), "2026-10-15", true), "yesterday's backup");
        assert!(!backup_due(Some("2026-10-15 09:00:00"), "2026-10-15", true), "already backed up today");
        assert!(!backup_due(Some("2026-10-14 18:02:11"), "2026-10-15", false), "nothing changed");
        assert!(!backup_due(None, "2026-10-15", false));
    }

    #[test]
    fn backup_names_give_their_day_and_time() {
        assert_eq!(backup_stamp("manonmani-2026-10-15_104233-seq12.db.gz"), Some(("2026-10-15".to_string(), "2026-10-15_104233".to_string())));
        assert_eq!(backup_stamp("manonmani-2026-10-15_104233-seq12.db.gz.partial"), None);
        assert_eq!(backup_stamp("holiday photo.jpg"), None);
        assert_eq!(backup_stamp("manonmani-2026-13-15_104233-seq12.db.gz"), None);
    }

    #[test]
    fn the_last_two_years_are_kept_in_full() {
        let files = vec![
            file("a", "manonmani-2024-10-16_090000-seq1.db.gz"),
            file("b", "manonmani-2025-03-01_090000-seq2.db.gz"),
            file("c", "manonmani-2025-03-02_090000-seq3.db.gz"),
            file("d", "manonmani-2026-10-15_090000-seq4.db.gz"),
        ];
        assert!(files_to_thin(&files, d("2026-10-15")).is_empty());
    }

    #[test]
    fn older_months_keep_only_their_newest_backup() {
        let files = vec![
            file("may1", "manonmani-2024-05-01_090000-seq1.db.gz"),
            file("may20", "manonmani-2024-05-20_090000-seq2.db.gz"),
            file("may31a", "manonmani-2024-05-31_090000-seq3.db.gz"),
            file("may31b", "manonmani-2024-05-31_180000-seq4.db.gz"),
            file("jun3", "manonmani-2024-06-03_090000-seq5.db.gz"),
            file("oct14", "manonmani-2024-10-14_090000-seq6.db.gz"),
            file("oct16", "manonmani-2024-10-16_090000-seq7.db.gz"),
            file("photo", "holiday photo.jpg"),
            file("now", "manonmani-2026-10-15_090000-seq8.db.gz"),
        ];
        let mut thin = files_to_thin(&files, d("2026-10-15"));
        thin.sort();
        // May 2024 keeps the evening of the 31st; June has one; the 14th of October 2024 is older than
        // two years but is the only old one in its month; the 16th is inside the two years.
        assert_eq!(thin, vec!["may1", "may20", "may31a"]);
    }

    #[test]
    fn the_cut_off_is_exactly_two_years_back() {
        let files = vec![
            file("old", "manonmani-2024-10-01_090000-seq1.db.gz"),
            file("edge", "manonmani-2024-10-15_090000-seq2.db.gz"),
        ];
        assert!(files_to_thin(&files, d("2026-10-15")).is_empty(), "the 15th is still inside two years");
        let files = vec![file("a", "manonmani-2024-02-10_090000-seq1.db.gz"), file("b", "manonmani-2024-02-20_090000-seq2.db.gz")];
        assert_eq!(files_to_thin(&files, d("2026-02-28")), vec!["a"], "both older than 28-02-2024");
    }

    #[test]
    fn drive_space_is_ok_low_or_full() {
        const MB: i64 = 1024 * 1024;
        assert_eq!(space_state(Some(1_000 * MB), Some(15_000 * MB), 10 * MB), SpaceState::Ok);
        assert_eq!(space_state(Some(14_600 * MB), Some(15_000 * MB), 10 * MB), SpaceState::Low, "under 500 MB free");
        assert_eq!(space_state(Some(14_995 * MB), Some(15_000 * MB), 10 * MB), SpaceState::Full, "this backup does not fit");
        assert_eq!(space_state(Some(15_100 * MB), Some(15_000 * MB), 10 * MB), SpaceState::Full, "over the limit");
        assert_eq!(space_state(Some(1_000 * MB), None, 10 * MB), SpaceState::Ok, "no limit (Workspace)");
        assert_eq!(space_state(None, None, 10 * MB), SpaceState::Ok, "unknown: let Google decide");
        assert_eq!(free_bytes(Some(14_600 * MB), Some(15_000 * MB)), Some(400 * MB));
        assert_eq!(free_bytes(Some(15_100 * MB), Some(15_000 * MB)), Some(0));
        assert_eq!(free_bytes(Some(1), None), None);
    }
}
