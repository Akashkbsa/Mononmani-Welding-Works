import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BusinessSettingsCard from "./BusinessSettingsCard";
import { ToastProvider } from "./ui";
import { BusinessSettings } from "../types/settings";
import { field } from "../test/helpers";

const api = vi.hoisted(() => ({ getSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../services/api", () => api);

const settings: BusinessSettings = {
  business_name: "MONONMANI WELDING WORKS",
  business_subtitle: "(FABRICATIONS)",
  gstin: "34AIRPV5028N1ZG",
  phone: "94432 94052",
  email: "owner@example.com",
  address: "Pondicherry",
  services_banner: "Welding",
  bank_name: "Indian Bank",
  bank_branch: "Mettupalayam",
  bank_account_no: "498877880",
  bank_ifsc: "IDIB000M070",
  terms_and_conditions: "1. Goods once sold.",
  cgst_rate: 9,
  sgst_rate: 9,
  igst_rate: 18,
};

beforeEach(() => {
  api.getSettings.mockReset().mockResolvedValue(settings);
  api.saveSettings.mockReset().mockImplementation(async (s: BusinessSettings) => s);
});

const open = async () => {
  render(
    <ToastProvider>
      <BusinessSettingsCard />
    </ToastProvider>
  );
  await screen.findByText("My business and invoice defaults");
};

const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const saveButton = () => screen.getByRole("button", { name: "Save changes" });

describe("BusinessSettingsCard", () => {
  it("shows the saved settings", async () => {
    await open();
    expect(field("Business name")).toHaveValue("MONONMANI WELDING WORKS");
    expect(field("IFSC")).toHaveValue("IDIB000M070");
    expect(field("CGST %")).toHaveValue(9);
    expect(field("IGST %")).toHaveValue(18);
  });

  it("can only save or reset once something changed", async () => {
    await open();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset to saved" })).toBeDisabled();
    type("Phone", "99999 00000");
    expect(saveButton()).toBeEnabled();
    type("Phone", "94432 94052");
    expect(saveButton()).toBeDisabled();
  });

  it("writes GSTIN and IFSC in capitals", async () => {
    await open();
    type("GSTIN", "34abcde1234f1z5");
    type("IFSC", "sbin0001234");
    expect(field("GSTIN")).toHaveValue("34ABCDE1234F1Z5");
    expect(field("IFSC")).toHaveValue("SBIN0001234");
  });

  it("saves the rates as numbers", async () => {
    await open();
    type("CGST %", "6");
    type("SGST %", "6");
    type("IGST %", "12");
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledOnce());
    expect(api.saveSettings.mock.calls[0][0]).toEqual({ ...settings, cgst_rate: 6, sgst_rate: 6, igst_rate: 12 });
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("shows what the backend saved, which may be tidied", async () => {
    api.saveSettings.mockResolvedValue({ ...settings, bank_name: "Indian Bank Ltd" });
    await open();
    type("Bank", "  Indian Bank Ltd  ");
    await userEvent.click(saveButton());
    await waitFor(() => expect(field("Bank")).toHaveValue("Indian Bank Ltd"));
  });

  it.each(["", "-1", "100.5", "abc"])("refuses a rate of %j", async (value) => {
    await open();
    type("SGST %", value);
    await userEvent.click(saveButton());
    expect(screen.getByText("Enter a rate between 0 and 100.")).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it("refuses an empty business name", async () => {
    await open();
    type("Business name", "  ");
    await userEvent.click(saveButton());
    expect(screen.getByText("Enter your business name.")).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it("Reset to saved puts everything back", async () => {
    await open();
    type("Business name", "  ");
    await userEvent.click(saveButton());
    await userEvent.click(screen.getByRole("button", { name: "Reset to saved" }));
    expect(field("Business name")).toHaveValue("MONONMANI WELDING WORKS");
    expect(screen.queryByText("Enter your business name.")).not.toBeInTheDocument();
  });

  it("shows the backend's refusal", async () => {
    api.saveSettings.mockRejectedValue(new Error("IFSC should be 11 characters, like IDIB000M070."));
    await open();
    type("IFSC", "SHORT");
    await userEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("IFSC should be 11 characters");
  });

  it("shows why the settings could not load", async () => {
    api.getSettings.mockRejectedValue(new Error("Error: database locked"));
    render(
      <ToastProvider>
        <BusinessSettingsCard />
      </ToastProvider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("database locked");
  });
});
