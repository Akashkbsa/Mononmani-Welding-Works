import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BackupBanner from "./BackupBanner";
import { ToastProvider } from "./ui";
import { AutoBackupEvent, BackupStatus } from "../types/backup";

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

function setup(s: BackupStatus) {
  api.getBackupStatus.mockResolvedValue(s);
  const onChanged = vi.fn();
  const view = render(
    <ToastProvider>
      <BackupBanner refreshKey="k" onChanged={onChanged} />
    </ToastProvider>
  );
  return { onChanged, ...view };
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  events.handler = null;
  events.unlisten.mockReset();
});

describe("BackupBanner", () => {
  it("shows nothing while Drive has room", async () => {
    setup(status({ drive_space: "OK" }));
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows nothing when Drive is not connected", async () => {
    setup(status({ connected: false, drive_space: "FULL" }));
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns when Drive is almost full, in MB", async () => {
    setup(status({ drive_space: "LOW", drive_free_bytes: 300 * 1024 ** 2 }));
    const banner = await screen.findByRole("alert", { name: "Google Drive space" });
    expect(banner).toHaveTextContent("Google Drive is almost full.");
    expect(banner).toHaveTextContent("Only 300 MB left.");
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });

  it("shows free space in GB from a gigabyte", async () => {
    setup(status({ drive_space: "LOW", drive_free_bytes: 1.5 * 1024 ** 3 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only 1.5 GB left.");
  });

  it("says backups have stopped when Drive is full, and can check again", async () => {
    api.runBackup.mockResolvedValue({ outcome: "SUCCESS", message: "", run: null });
    const { onChanged } = setup(status({ drive_space: "FULL" }));
    expect(await screen.findByText("Google Drive is full: backups have stopped.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(api.runBackup).toHaveBeenCalledOnce();
    expect(await screen.findByText("Backup complete.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    expect(api.getBackupStatus).toHaveBeenCalledTimes(2);
  });

  it("shows why a check-again backup was skipped or failed", async () => {
    api.runBackup.mockResolvedValueOnce({ outcome: "SKIPPED", message: "Nothing changed since the last backup.", run: null });
    setup(status({ drive_space: "FULL" }));
    await userEvent.click(await screen.findByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Nothing changed since the last backup.")).toBeInTheDocument();
  });

  it("shows a failed check as an error", async () => {
    api.runBackup.mockRejectedValueOnce(new Error("Drive is still full"));
    setup(status({ drive_space: "FULL" }));
    await userEvent.click(await screen.findByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent === "Drive is still full")).toBe(true));
  });

  it("opens Google Drive, and reports if it cannot", async () => {
    api.openGoogleDrive.mockRejectedValueOnce(new Error("No browser"));
    setup(status({ drive_space: "LOW", drive_free_bytes: 1 }));
    await userEvent.click(await screen.findByRole("button", { name: "Open Google Drive" }));
    expect(api.openGoogleDrive).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent === "No browser")).toBe(true));
  });

  it("announces an automatic backup and checks again", async () => {
    const { onChanged } = setup(status({ drive_space: "OK" }));
    await waitFor(() => expect(events.handler).not.toBeNull());
    act(() => events.handler!({ payload: { ok: true, message: "Backed up to Google Drive." } }));
    expect(await screen.findByRole("status")).toHaveTextContent("Backed up to Google Drive.");
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledTimes(2));
  });

  it("announces a failed automatic backup as an error", async () => {
    setup(status({ drive_space: "OK" }));
    await waitFor(() => expect(events.handler).not.toBeNull());
    act(() => events.handler!({ payload: { ok: false, message: "No space" } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Automatic backup failed: No space");
  });

  it("stops listening when removed", async () => {
    const { unmount } = setup(status({}));
    await waitFor(() => expect(events.handler).not.toBeNull());
    unmount();
    await waitFor(() => expect(events.unlisten).toHaveBeenCalled());
  });
});
