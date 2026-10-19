import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BackupBanner from "./BackupBanner";
import { ToastProvider } from "./ui";
import { AutoBackupEvent, BackupRun, BackupStatus } from "../types/backup";

const api = vi.hoisted(() => ({
  getBackupStatus: vi.fn(),
  openGoogleDrive: vi.fn(),
  runBackup: vi.fn(),
}));
vi.mock("../services/api", () => api);

// Capture the "backup-auto" listener so a test can fire the event.
const events = vi.hoisted(() => ({ handler: null as null | ((e: { payload: AutoBackupEvent }) => void), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, handler: (e: { payload: AutoBackupEvent }) => void) => {
    events.handler = handler;
    return Promise.resolve(events.unlisten);
  }),
}));

const status = (over: Partial<BackupStatus>): BackupStatus => ({
  configured: true,
  connected: true,
  account_email: "owner@example.com",
  last_success: null,
  last_run: null,
  pending: { total: 0, lines: [], any: false },
  running: false,
  drive_space: "OK",
  drive_free_bytes: null,
  ...over,
});

function recentRun(): BackupRun {
  const d = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
  const finishedAt = d.toISOString().replace("T", " ").slice(0, 19);
  return { id: 1, started_at: finishedAt, finished_at: finishedAt, status: "SUCCESS", file_name: null, size_bytes: null, summary: [], error: null };
}

function staleRun(): BackupRun {
  const d = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000); // 4 days ago
  const finishedAt = d.toISOString().replace("T", " ").slice(0, 19);
  return { id: 1, started_at: finishedAt, finished_at: finishedAt, status: "SUCCESS", file_name: null, size_bytes: null, summary: [], error: null };
}

function setup(s: BackupStatus, onOpenSettings = vi.fn()) {
  api.getBackupStatus.mockResolvedValue(s);
  const onChanged = vi.fn();
  const view = render(
    <ToastProvider>
      <BackupBanner refreshKey="k" onChanged={onChanged} onOpenSettings={onOpenSettings} />
    </ToastProvider>
  );
  return { onChanged, onOpenSettings, ...view };
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  events.handler = null;
  events.unlisten.mockReset();
});

describe("BackupBanner — space warnings", () => {
  it("shows nothing while Drive has room and backup is recent", async () => {
    setup(status({ drive_space: "OK", last_success: recentRun() }));
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns when Drive is almost full, in MB", async () => {
    setup(status({ drive_space: "LOW", drive_free_bytes: 300 * 1024 ** 2, last_success: recentRun() }));
    const banner = await screen.findByRole("alert", { name: "Google Drive space" });
    expect(banner).toHaveTextContent("Google Drive is almost full.");
    expect(banner).toHaveTextContent("Only 300 MB left.");
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });

  it("shows free space in GB from a gigabyte", async () => {
    setup(status({ drive_space: "LOW", drive_free_bytes: 1.5 * 1024 ** 3, last_success: recentRun() }));
    expect(await screen.findByRole("alert", { name: "Google Drive space" })).toHaveTextContent("Only 1.5 GB left.");
  });

  it("says backups have stopped when Drive is full, and can check again", async () => {
    api.runBackup.mockResolvedValue({ outcome: "SUCCESS", message: "", run: null });
    const { onChanged } = setup(status({ drive_space: "FULL", last_success: recentRun() }));
    expect(await screen.findByText("Google Drive is full: backups have stopped.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(api.runBackup).toHaveBeenCalledOnce();
    expect(await screen.findByText("Backup complete.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    expect(api.getBackupStatus).toHaveBeenCalledTimes(2);
  });

  it("shows why a check-again backup was skipped or failed", async () => {
    api.runBackup.mockResolvedValueOnce({ outcome: "SKIPPED", message: "Nothing changed since the last backup.", run: null });
    setup(status({ drive_space: "FULL", last_success: recentRun() }));
    await userEvent.click(await screen.findByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Nothing changed since the last backup.")).toBeInTheDocument();
  });

  it("shows a failed check as an error", async () => {
    api.runBackup.mockRejectedValueOnce(new Error("Drive is still full"));
    setup(status({ drive_space: "FULL", last_success: recentRun() }));
    await userEvent.click(await screen.findByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent === "Drive is still full")).toBe(true));
  });

  it("opens Google Drive, and reports if it cannot", async () => {
    api.openGoogleDrive.mockRejectedValueOnce(new Error("No browser"));
    setup(status({ drive_space: "LOW", drive_free_bytes: 1, last_success: recentRun() }));
    await userEvent.click(await screen.findByRole("button", { name: "Open Google Drive" }));
    expect(api.openGoogleDrive).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent === "No browser")).toBe(true));
  });
});

describe("BackupBanner — auto backup events", () => {
  it("announces an automatic backup and checks again", async () => {
    const { onChanged } = setup(status({ drive_space: "OK", last_success: recentRun() }));
    await waitFor(() => expect(events.handler).not.toBeNull());
    act(() => events.handler!({ payload: { ok: true, message: "Backed up to Google Drive." } }));
    expect(await screen.findByRole("status")).toHaveTextContent("Backed up to Google Drive.");
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledTimes(2));
  });

  it("announces a failed automatic backup as an error", async () => {
    setup(status({ drive_space: "OK", last_success: recentRun() }));
    await waitFor(() => expect(events.handler).not.toBeNull());
    act(() => events.handler!({ payload: { ok: false, message: "No space" } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Automatic backup failed: No space");
  });

  it("stops listening when removed", async () => {
    const { unmount } = setup(status({ last_success: recentRun() }));
    await waitFor(() => expect(events.handler).not.toBeNull());
    unmount();
    await waitFor(() => expect(events.unlisten).toHaveBeenCalled());
  });
});

describe("BackupBanner — backup warnings", () => {
  it("warns when Drive is not configured", async () => {
    setup(status({ configured: false, connected: false }));
    const banner = await screen.findByRole("alert", { name: "Backup not set up" });
    expect(banner).toHaveTextContent("Backups are not set up.");
    expect(banner).toHaveTextContent("Your data is only on this computer.");
    expect(screen.getByRole("button", { name: "Set up backup" })).toBeInTheDocument();
  });

  it("warns when configured but disconnected", async () => {
    setup(status({ configured: true, connected: false }));
    const banner = await screen.findByRole("alert", { name: "Google Drive disconnected" });
    expect(banner).toHaveTextContent("Google Drive is disconnected. Backups have stopped.");
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("'Set up backup' opens Settings", async () => {
    const onOpenSettings = vi.fn();
    setup(status({ configured: false, connected: false }), onOpenSettings);
    await userEvent.click(await screen.findByRole("button", { name: "Set up backup" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("'Reconnect' opens Settings", async () => {
    const onOpenSettings = vi.fn();
    setup(status({ configured: true, connected: false }), onOpenSettings);
    await userEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("warns when no backup has ever been made", async () => {
    setup(status({ last_success: null }));
    const banner = await screen.findByRole("alert", { name: "Backup stale" });
    expect(banner).toHaveTextContent("No backup has been made yet.");
    expect(screen.getByRole("button", { name: "Back up now" })).toBeInTheDocument();
  });

  it("warns with days when last backup is more than 3 days ago", async () => {
    setup(status({ last_success: staleRun() }));
    const banner = await screen.findByRole("alert", { name: "Backup stale" });
    expect(banner).toHaveTextContent(/Last backup was \d+ days ago/);
    expect(screen.getByRole("button", { name: "Back up now" })).toBeInTheDocument();
  });

  it("shows no stale warning when last backup is recent", async () => {
    setup(status({ last_success: recentRun() }));
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalled());
    expect(screen.queryByRole("alert", { name: "Backup stale" })).not.toBeInTheDocument();
  });

  it("'Back up now' runs a backup and refreshes status", async () => {
    api.runBackup.mockResolvedValue({ outcome: "SUCCESS", message: "", run: null });
    const { onChanged } = setup(status({ last_success: null }));
    await userEvent.click(await screen.findByRole("button", { name: "Back up now" }));
    expect(api.runBackup).toHaveBeenCalledOnce();
    expect(await screen.findByText("Backup complete.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    expect(api.getBackupStatus).toHaveBeenCalledTimes(2);
  });
});
