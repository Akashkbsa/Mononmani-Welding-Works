import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { StorageInfo } from "../types/storage";
import { DbStatusInfo } from "../types/db";
import { getDbStatus, getStorageInfo, openDataFolder } from "../services/api";
import { errorMessage } from "../lib/format";
import { Alert, Button, Card, Loading, PageHeader, useToast } from "../components/ui";
import BackupCard from "../components/BackupCard";
import BusinessSettingsCard from "../components/BusinessSettingsCard";
import SnoozeSettingsCard from "../components/SnoozeSettingsCard";

export default function SettingsPage() {
  const toast = useToast();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [db, setDb] = useState<DbStatusInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getStorageInfo(), getDbStatus()])
      .then(([s, d]) => {
        setStorage(s);
        setDb(d);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <>
      <PageHeader title="Settings" description="Your business details, tax defaults and backups, and where your records are kept." />

      {error && <Alert>{error}</Alert>}
      {!storage || !db ? (
        !error && <Loading />
      ) : (
        <Card className="p-6 max-w-3xl space-y-5">
          <p className="text-sm text-slate-600">
            All invoices, customers and payments are stored on this computer and work without internet. Copy the
            data folder to a USB drive regularly, or use Google Drive backup below.
          </p>

          <dl className="space-y-3 text-sm">
            <Path label="Data folder" value={storage.app_data_dir} />
            <Path label="Database" value={storage.db_path} />
            <Path label="Invoice PDFs" value={storage.invoices_dir} />
          </dl>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <span className="text-xs text-slate-500">Database version {db.applied_migrations.length}</span>
            <Button
              icon={<FolderOpen className="w-4 h-4" />}
              onClick={() => openDataFolder().catch((err) => toast(errorMessage(err), "error"))}
            >
              Open data folder
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-6 space-y-6">
        <BusinessSettingsCard />
        <SnoozeSettingsCard />
        <BackupCard />
      </div>
    </>
  );
}

function Path({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-mono text-xs text-slate-800 break-all select-text">{value}</dd>
    </div>
  );
}
