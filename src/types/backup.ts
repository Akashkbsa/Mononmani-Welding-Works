export interface BackupRun {
  id: number;
  /** Local time, YYYY-MM-DD HH:MM:SS */
  started_at: string;
  finished_at: string;
  status: "SUCCESS" | "FAILED";
  file_name: string | null;
  size_bytes: number | null;
  /** Plain-language lines such as "2 invoices added". */
  summary: string[];
  error: string | null;
}

export interface PendingChanges {
  total: number;
  lines: string[];
  any: boolean;
}

export interface BackupStatus {
  configured: boolean;
  connected: boolean;
  account_email: string | null;
  last_success: BackupRun | null;
  last_run: BackupRun | null;
  pending: PendingChanges;
  running: boolean;
}

export interface DriveBackup {
  id: string;
  name: string;
  size_bytes: number;
  created_at: string;
}

export interface DriveBackupList {
  backups: DriveBackup[];
  used_bytes: number | null;
  limit_bytes: number | null;
}

export interface BackupResult {
  outcome: "SUCCESS" | "SKIPPED";
  message: string;
  run: BackupRun | null;
}

export interface BackupProgress {
  stage: string;
  message: string;
}
