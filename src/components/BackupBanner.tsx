import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CloudOff, ExternalLink, RefreshCw } from "lucide-react";
import { AutoBackupEvent, BackupStatus } from "../types/backup";
import { getBackupStatus, openGoogleDrive, runBackup } from "../services/api";
import { errorMessage } from "../lib/format";
import { Button, useToast } from "./ui";

function formatFree(bytes: number | null): string {
  if (bytes == null) return "";
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

interface Props {
  /** Changes whenever the backup state may have changed (a page switch), so the banner checks again. */
  refreshKey: string;
  /** Called after an automatic or banner-started backup, so the sidebar dot can update. */
  onChanged: () => void;
}

/**
 * Google Drive almost full (amber) or full (red), at the top of every screen, with a way to open
 * Drive and delete the oldest backups. Also says when the automatic daily backup has run.
 */
export default function BackupBanner({ refreshKey, onChanged }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getBackupStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => {
        // The banner is a helper; a failed check leaves the screen as it is.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, tick]);

  // The automatic backup runs in the background; show what happened and check the space again.
  useEffect(() => {
    const unlisten = listen<AutoBackupEvent>("backup-auto", (e) => {
      toast(e.payload.ok ? e.payload.message : `Automatic backup failed: ${e.payload.message}`, e.payload.ok ? "success" : "error");
      setTick((t) => t + 1);
      onChanged();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [toast, onChanged]);

  if (!status?.connected || status.drive_space === "OK") return null;

  const full = status.drive_space === "FULL";

  const checkAgain = async () => {
    setChecking(true);
    try {
      const result = await runBackup();
      toast(result.outcome === "SUCCESS" ? "Backup complete." : result.message);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setChecking(false);
      setTick((t) => t + 1);
      onChanged();
    }
  };

  return (
    <section
      role="alert"
      aria-label="Google Drive space"
      className={`mww-fade mb-5 flex items-center gap-3 rounded-lg border py-3 pl-4 pr-3 ${
        full ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
      }`}
    >
      <CloudOff className={`h-5 w-5 shrink-0 ${full ? "text-red-600" : "text-amber-600"}`} />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium text-slate-900">
          {full ? "Google Drive is full: backups have stopped." : "Google Drive is almost full."}
        </div>
        <div className="text-slate-700">
          {full
            ? "Open Google Drive, go to the Mononmani Backups folder and delete the oldest backups, then press Check again."
            : `Only ${formatFree(status.drive_free_bytes)} left. Delete the oldest backups in the Mononmani Backups folder soon.`}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" icon={<ExternalLink className="h-4 w-4" />} onClick={() => openGoogleDrive().catch((err) => toast(errorMessage(err), "error"))}>
          Open Google Drive
        </Button>
        {full && (
          <Button size="sm" variant="primary" icon={<RefreshCw className="h-4 w-4" />} loading={checking} onClick={checkAgain}>
            Check again
          </Button>
        )}
      </div>
    </section>
  );
}
