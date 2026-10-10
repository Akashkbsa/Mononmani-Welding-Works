export interface MigrationLog {
  version: number;
  name: string;
  applied_at: string;
}

export interface DbStatusInfo {
  db_path: string;
  is_connected: boolean;
  applied_migrations: MigrationLog[];
}
