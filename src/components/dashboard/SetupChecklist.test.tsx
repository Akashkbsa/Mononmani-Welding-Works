import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupChecklist from "./SetupChecklist";
import { BusinessSettings } from "../../types/settings";
import { BackupStatus } from "../../types/backup";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getBackupStatus: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const fullSettings = (): BusinessSettings => ({
  business_name: "Mononmani Welding Works",
  business_subtitle: "",
  gstin: "33ABCDE1234F1Z5",
  phone: "9876543210",
  email: "",
  address: "No. 1, Main Road, Puducherry",
  services_banner: "",
  bank_name: "SBI",
  bank_branch: "Puducherry",
  bank_account_no: "123456789012",
  bank_ifsc: "SBIN0001234",
  terms_and_conditions: "",
  cgst_rate: 9,
  sgst_rate: 9,
  igst_rate: 18,
});

const connectedBackup = (): BackupStatus => ({
  configured: true,
  connected: true,
  account_email: "owner@example.com",
  last_success: null,
  last_run: null,
  pending: { total: 0, lines: [], any: false },
  running: false,
  drive_space: "OK",
  drive_free_bytes: null,
});

function setup(settings: Partial<BusinessSettings> = {}, backup: Partial<BackupStatus> = {}) {
  api.getSettings.mockResolvedValue({ ...fullSettings(), ...settings });
  api.getBackupStatus.mockResolvedValue({ ...connectedBackup(), ...backup });
  const onNavigate = vi.fn();
  render(<SetupChecklist onNavigate={onNavigate} />);
  return { onNavigate };
}

describe("SetupChecklist", () => {
  it("shows nothing when all three items are complete", async () => {
    setup();
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Setup checklist" })).not.toBeInTheDocument();
  });

  it("shows the card when business name is empty", async () => {
    setup({ business_name: "" });
    expect(await screen.findByRole("region", { name: "Setup checklist" })).toBeInTheDocument();
  });

  it("marks business name step as pending when name is empty", async () => {
    setup({ business_name: "" });
    await screen.findByRole("region", { name: "Setup checklist" });
    expect(screen.getByText(/business name/i)).toBeInTheDocument();
    // The step is pending, so a "Set up" button is shown for it
    expect(screen.getAllByRole("button", { name: /set up/i }).length).toBeGreaterThan(0);
  });

  it("marks business name step as done when name is filled", async () => {
    setup({ business_name: "My Shop", bank_account_no: "" });
    await screen.findByRole("region", { name: "Setup checklist" });
    // business name is done but bank is pending — only one "Set up" button
    const btns = screen.getAllByRole("button", { name: /set up/i });
    expect(btns).toHaveLength(1);
  });

  it("shows the card when bank account is empty", async () => {
    setup({ bank_account_no: "" });
    expect(await screen.findByRole("region", { name: "Setup checklist" })).toBeInTheDocument();
    expect(screen.getByText(/bank account/i)).toBeInTheDocument();
  });

  it("shows the card when Drive is not configured", async () => {
    setup({}, { configured: false });
    expect(await screen.findByRole("region", { name: "Setup checklist" })).toBeInTheDocument();
    expect(screen.getByText(/google drive/i)).toBeInTheDocument();
  });

  it("clicking 'Set up' for any step navigates to Settings", async () => {
    const { onNavigate } = setup({ business_name: "" });
    await userEvent.click(await screen.findByRole("button", { name: /set up/i }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("shows all three steps pending on a fresh install", async () => {
    setup({ business_name: "", bank_account_no: "" }, { configured: false });
    await screen.findByRole("region", { name: "Setup checklist" });
    expect(screen.getAllByRole("button", { name: /set up/i })).toHaveLength(3);
  });
});
