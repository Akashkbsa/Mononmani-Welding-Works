use rusqlite::{params, Connection};
use super::models::{AuditLogEntry, AuditLogPage};

pub struct AuditRepository;

const DEFAULT_LIMIT: u32 = 100;

impl AuditRepository {
    pub fn list(conn: &Connection, limit: Option<u32>, before_seq: Option<i64>) -> Result<AuditLogPage, String> {
        let limit = limit.unwrap_or(DEFAULT_LIMIT);
        let fetch = (limit + 1) as i64;

        let mut entries: Vec<AuditLogEntry> = if let Some(before) = before_seq {
            let mut stmt = conn
                .prepare(
                    "SELECT seq, table_name, row_id, op, changed_at \
                     FROM change_log WHERE seq < ?1 ORDER BY seq DESC LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![before, fetch], |r| {
                    Ok(AuditLogEntry {
                        seq: r.get(0)?,
                        table_name: r.get(1)?,
                        row_id: r.get(2)?,
                        op: r.get(3)?,
                        changed_at: r.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e: rusqlite::Error| e.to_string())?;
            rows
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT seq, table_name, row_id, op, changed_at \
                     FROM change_log ORDER BY seq DESC LIMIT ?1",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![fetch], |r| {
                    Ok(AuditLogEntry {
                        seq: r.get(0)?,
                        table_name: r.get(1)?,
                        row_id: r.get(2)?,
                        op: r.get(3)?,
                        changed_at: r.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e: rusqlite::Error| e.to_string())?;
            rows
        };

        let has_more = entries.len() > limit as usize;
        if has_more {
            entries.pop();
        }

        Ok(AuditLogPage { entries, has_more })
    }
}
