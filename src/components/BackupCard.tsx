import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CloudUpload, History, Link2, Unlink } from "lucide-react";
import { BackupProgress, BackupStatus, DriveBackupList } from "../types/backup";
import {
  connectDrive,
  disconnectDrive,
  getBackupStatus,
  listDriveBackups,
  restoreDriveBackup,
  runBackup,
} from "../services/api";
import { errorMessage } from "../lib/format";
import { Alert, Badge, Button, Card, ConfirmDialog, Field, inputClass, Loading, useToast } from "./ui";

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "2026-10-11 18:30:05" (local) → "11-10-2026 18:30" */
function formatLocal(value: string | null | undefined): string {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}` : value ?? "";
}

function formatUtc(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function BackupCard() {
  const toast = useToast();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [drive, setDrive] = useState<DriveBackupList | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [stage, setStage] = useState("");
  const [restoreId, setRestoreId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await getBackupStatus();
      setStatus(s);
      setError(null);
      if (s.connected) {
        listDriveBackups()
          .then((d) => {
            setDrive(d);
            setDriveError(null);
          })
          .catch((err) => setDriveError(errorMessage(err)));
      } else {
        setDrive(null);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen<BackupProgress>("backup-progress", (e) => setStage(e.payload.message));
    return () => {
      unlisten.then((f) => f());
    };
  }, [refresh]);

  const connect = async () => {
    setConnecting(true);
    setNotice(null);
    try {
      await connectDrive(clientId, clientSecret);
      setClientId("");
      setClientSecret("");
      toast("Google Drive connected.");
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setConnecting(false);
      refresh();
    }
  };

  const backUp = async () => {
    setBackingUp(true);
    setNotice(null);
    setStage("Starting...");
    try {
      const result = await runBackup();
      setNotice({ tone: "info", text: result.message });
      if (result.outcome === "SUCCESS") toast("Backup complete.");
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setBackingUp(false);
      refresh();
    }
  };

  if (error) return <Alert>{error}</Alert>;
  if (!status) return <Loading />;

  const needsSetup = !status.connected;
  const last = status.last_success;
  const stale = status.last_run?.status === "FAILED" && status.last_run.id !== last?.id;
  const usagePct =
    drive?.used_bytes != null && drive.limit_bytes ? Math.round((drive.used_bytes / drive.limit_bytes) * 100) : null;

  return (
    <Card className="p-6 max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Back up to Google Drive</h2>
          <p className="text-sm text-slate-600 mt-1">
            Click Back up whenever you are online, for example at the end of the day. Every backup is a complete copy
            of your records, and older backups are kept so an earlier version can always be restored.
          </p>
        </div>
        {status.connected && (
          <Badge tone="green">{status.account_email ? `Connected: ${status.account_email}` : "Connected"}</Badge>
        )}
      </div>

      {needsSetup ? (
        <div className="space-y-3">
          {status.connected === false && status.configured && (
            <Alert tone="info">Google Drive is not connected. Press Connect to sign in again.</Alert>
          )}
          <details className="text-sm text-slate-600">
            <summary className="cursor-pointer text-slate-800 font-medium">One-time setup (new Google account)</summary>
            <ol className="list-decimal pl-5 mt-2 space-y-1">
              <li>Open console.cloud.google.com with the backup Google account and create a project.</li>
              <li>Enable the Google Drive API for it.</li>
              <li>Set up the OAuth consent screen and publish it (status: In production), so sign-in does not expire.</li>
              <li>Create an OAuth client ID of type Desktop app, then paste its Client ID and Client secret below.</li>
            </ol>
          </details>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Client ID">
              <input
                className={`${inputClass} font-mono`}
                value={clientId}
                placeholder={status.configured ? "Saved" : ""}
                onChange={(e) => setClientId(e.target.value)}
              />
            </Field>
            <Field label="Client secret">
              <input
                type="password"
                className={`${inputClass} font-mono`}
                value={clientSecret}
                placeholder={status.configured ? "Saved" : ""}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </Field>
          </div>
          <Button variant="primary" icon={<Link2 className="w-4 h-4" />} loading={connecting} onClick={connect}>
            Connect Google Drive
          </Button>
          {connecting && <p className="text-xs text-slate-500">Finish signing in in your browser, then return here.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Button variant="primary" icon={<CloudUpload className="w-4 h-4" />} loading={backingUp} onClick={backUp}>
              Back up
            </Button>
            <div className="text-sm">
              {backingUp ? (
                <span className="text-slate-600">{stage}</span>
              ) : last ? (
                <span className="text-slate-700">
                  Last backup: <strong>{formatLocal(last.finished_at)}</strong>
                  {last.size_bytes ? ` (${formatSize(last.size_bytes)})` : ""}
                </span>
              ) : (
                <span className="text-amber-700">No backup yet. Press Back up to make the first one.</span>
              )}
            </div>
          </div>

          {!backingUp && (
            <p className="text-sm text-slate-600">
              {status.pending.lines.length
                ? `Not backed up yet: ${status.pending.lines.join(", ")}.`
                : last
                  ? "Everything is backed up."
                  : ""}
            </p>
          )}

          {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
          {!notice && stale && status.last_run?.error && (
            <Alert>
              The last attempt ({formatLocal(status.last_run.finished_at)}) failed: {status.last_run.error}
            </Alert>
          )}

          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <History className="w-4 h-4 text-slate-500" /> Backups on Google Drive
              </h3>
              {usagePct != null && (
                <span className={`text-xs ${usagePct >= 80 ? "text-amber-700" : "text-slate-500"}`}>
                  Drive storage {formatSize(drive?.used_bytes)} of {formatSize(drive?.limit_bytes)} used ({usagePct}%)
                </span>
              )}
            </div>
            {driveError && <Alert>{driveError}</Alert>}
            {!drive && !driveError && <Loading label="Loading backups..." />}
            {drive && drive.backups.length === 0 && <p className="text-sm text-slate-500">No backups yet.</p>}
            {drive && drive.backups.length > 0 && (
              <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto border border-slate-200 rounded-md">
                {drive.backups.map((b) => (
                  <li key={b.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-slate-800">
                      {formatUtc(b.created_at)} <span className="text-slate-500">{formatSize(b.size_bytes)}</span>
                    </span>
                    <Button size="sm" disabled={backingUp} onClick={() => setRestoreId(b.id)}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              variant="dangerText"
              size="sm"
              icon={<Unlink className="w-4 h-4" />}
              onClick={() =>
                disconnectDrive()
                  .then(refresh)
                  .catch((err) => toast(errorMessage(err), "error"))
              }
            >
              Disconnect Google Drive
            </Button>
          </div>
        </div>
      )}

      {restoreId && (
        <ConfirmDialog
          title="Restore this backup?"
          confirmLabel="Restore"
          message={
            <>
              Your current invoices, customers and payments will be replaced by this backup. Today's data is copied
              aside first, but anything entered after this backup will not be in the restored data.
            </>
          }
          onConfirm={async () => {
            const message = await restoreDriveBackup(restoreId);
            toast(message);
            setTimeout(() => window.location.reload(), 1500);
          }}
          onClose={() => setRestoreId(null)}
        />
      )}
    </Card>
  );
}
