use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AuditLogEntry {
    pub seq: i64,
    pub table_name: String,
    pub row_id: i64,
    pub op: String,
    pub changed_at: String,
}

#[derive(Debug, Serialize)]
pub struct AuditLogPage {
    pub entries: Vec<AuditLogEntry>,
    pub has_more: bool,
}
