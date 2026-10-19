import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CloudOff, ExternalLink, RefreshCw } from "lucide-react";
import { AutoBackupEvent, BackupRun, BackupStatus } from "../types/backup";
import { getBackupStatus, openGoogleDrive, runBackup } from "../services/api";
import { errorMessage } from "../lib/format";
import { Button, useToast } from "./ui";

function formatFree(bytes: number | null): string {
  if (bytes == null) return "";
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function daysSince(finishedAt: string): number {
  const finished = new Date(finishedAt.replace(" ", "T")).getTime();
  return Math.floor((Date.now() - finished) / (24 * 60 * 60 * 1000));
}

function isStale(lastSuccess: BackupRun | null): boolean {
  if (!lastSuccess) return true;
  return daysSince(lastSuccess.finished_at) > 3;
}

interface Props {
  /** Changes whenever the backup state may have changed (a page switch), so the banner checks again. */
  refreshKey: string;
  /** Called after an automatic or banner-started backup, so the sidebar dot can update. */
  onChanged: () => void;
  /** Opens the Settings page, used by "Set up backup" and "Reconnect" buttons. */
  onOpenSettings: () => void;
}

export default function BackupBanner({ refreshKey, onChanged, onOpenSettings }: Props) {
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

  if (!status) return null;

  const notConfigured = !status.configured;
  const disconnected = status.configured && !status.connected;
  const connected = status.configured && status.connected;
  const stale = connected && isStale(status.last_success);
  const spaceLow = connected && status.drive_space === "LOW";
  const spaceFull = connected && status.drive_space === "FULL";

  if (!notConfigured && !disconnected && !stale && !spaceLow && !spaceFull) return null;

  const backUpNow = async () => {
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

  const amberRow = "mww-fade flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 py-3 pl-4 pr-3";

  return (
    <div className="mb-5 space-y-2">
      {notConfigured && (
        <section role="alert" aria-label="Backup not set up" className={amberRow}>
          <CloudOff className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium text-slate-900">Backups are not set up.</div>
            <div className="text-slate-700">Your data is only on this computer.</div>
          </div>
          <Button size="sm" variant="primary" onClick={onOpenSettings}>
            Set up backup
          </Button>
        </section>
      )}

      {disconnected && (
        <section role="alert" aria-label="Google Drive disconnected" className={amberRow}>
          <CloudOff className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium text-slate-900">Google Drive is disconnected. Backups have stopped.</div>
          </div>
          <Button size="sm" variant="primary" onClick={onOpenSettings}>
            Reconnect
          </Button>
        </section>
      )}

      {stale && (
        <section role="alert" aria-label="Backup stale" className={amberRow}>
          <CloudOff className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium text-slate-900">
              {status.last_success
                ? `Last backup was ${daysSince(status.last_success.finished_at)} days ago.`
                : "No backup has been made yet."}
            </div>
            {!status.last_success && <div className="text-slate-700">Your data is only on this computer.</div>}
          </div>
          <Button size="sm" variant="primary" icon={<RefreshCw className="h-4 w-4" />} loading={checking} onClick={backUpNow}>
            Back up now
          </Button>
        </section>
      )}

      {(spaceLow || spaceFull) && (
        <section
          role="alert"
          aria-label="Google Drive space"
          className={`mww-fade flex items-center gap-3 rounded-lg border py-3 pl-4 pr-3 ${
            spaceFull ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
          }`}
        >
          <CloudOff className={`h-5 w-5 shrink-0 ${spaceFull ? "text-red-600" : "text-amber-600"}`} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium text-slate-900">
              {spaceFull ? "Google Drive is full: backups have stopped." : "Google Drive is almost full."}
            </div>
            <div className="text-slate-700">
              {spaceFull
                ? "Open Google Drive, go to the Mononmani Backups folder and delete the oldest backups, then press Check again."
                : `Only ${formatFree(status.drive_free_bytes)} left. Delete the oldest backups in the Mononmani Backups folder soon.`}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" icon={<ExternalLink className="h-4 w-4" />} onClick={() => openGoogleDrive().catch((err) => toast(errorMessage(err), "error"))}>
              Open Google Drive
            </Button>
            {spaceFull && (
              <Button size="sm" variant="primary" icon={<RefreshCw className="h-4 w-4" />} loading={checking} onClick={backUpNow}>
                Check again
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
