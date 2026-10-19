export interface AuditLogEntry {
  seq: number;
  table_name: string;
  row_id: number;
  op: "INSERT" | "UPDATE" | "DELETE";
  changed_at: string;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  has_more: boolean;
}
