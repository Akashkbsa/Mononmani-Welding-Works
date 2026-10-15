import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TenantFormModal from "./TenantFormModal";
import { ToastProvider } from "../ui";
import { PlaceListItem, Tenant, TenantDetail, TenantInput } from "../../types/rental";
import { fileInput, makeFile } from "../../test/helpers";

const api = vi.hoisted(() => ({
  addRentalFile: vi.fn(),
  createRentalTenant: vi.fn(),
  getRentalTenant: vi.fn(),
  listRentalPlaces: vi.fn(),
  openRentalFile: vi.fn(),
  removeRentalFile: vi.fn(),
  setRentalTenantMovedOut: vi.fn(),
  updateRentalTenant: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const place = (over: Partial<PlaceListItem>): PlaceListItem => ({
  id: 1,
  name: "Shop 1",
  address: null,
  monthly_rent: 6000,
  current_tenant: null,
  file_count: 0,
  ...over,
});

const tenant = (over: Partial<Tenant> = {}): TenantDetail => ({
  tenant: {
    id: 12,
    place_id: 2,
    place_name: "Flat 2B",
    name: "Kumar",
    whatsapp_number: "+919876543210",
    monthly_rent: 8000,
    move_in_date: "2025-06-01",
    moved_out_date: null,
    notes: null,
    created_at: "",
    updated_at: "",
    ...over,
  },
  files: [],
});

let onClose: Mock<() => void>;
let onSaved: Mock<(id: number) => void>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  Object.values(api).forEach((f) => f.mockReset());
  api.listRentalPlaces.mockResolvedValue([
    place({}),
    place({ id: 2, name: "Flat 2B", monthly_rent: 8000, current_tenant: "Kumar" }),
    place({ id: 3, name: "Godown", monthly_rent: 0 }),
  ]);
  api.createRentalTenant.mockImplementation(async (input: TenantInput) => tenant({ id: 13, ...input }));
  api.updateRentalTenant.mockImplementation(async (id: number) => tenant({ id }));
  api.getRentalTenant.mockResolvedValue(tenant());
  api.setRentalTenantMovedOut.mockResolvedValue(undefined);
  api.addRentalFile.mockResolvedValue({});
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<(id: number) => void>();
});
afterEach(() => vi.useRealTimers());

const open = async (tenantId?: number) => {
  render(
    <ToastProvider>
      <TenantFormModal tenantId={tenantId} onClose={onClose} onSaved={onSaved} />
    </ToastProvider>
  );
  await screen.findByRole("dialog", { name: tenantId === undefined ? "New tenant" : "Edit tenant" });
};

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = (name = "Save tenant") => userEvent.click(screen.getByRole("button", { name }));
const optionText = (value: string) => screen.getByLabelText("Place").querySelector(`option[value="${value}"]`)!.textContent;

describe("a new tenant", () => {
  it("marks places that already have a tenant", async () => {
    await open();
    expect(optionText("1")).toBe("Shop 1");
    expect(optionText("2")).toBe("Flat 2B (has a tenant)");
  });

  it("fills the place's usual rent", async () => {
    await open();
    type("Place", "1");
    expect(screen.getByLabelText("Monthly rent")).toHaveValue(6000);
  });

  it("does not overwrite a rent already typed, or fill a 0 rent", async () => {
    await open();
    type("Monthly rent", "5500");
    type("Place", "1");
    expect(screen.getByLabelText("Monthly rent")).toHaveValue(5500);
    type("Monthly rent", "");
    type("Place", "3");
    expect(screen.getByLabelText("Monthly rent")).toHaveValue(null);
  });

  it("saves the tenant", async () => {
    await open();
    type("Place", "1");
    type("Name", " Selvi ");
    type("WhatsApp number", " 98765 43210 ");
    type("Move-in date", "2026-10-01");
    await save();
    await waitFor(() => expect(api.createRentalTenant).toHaveBeenCalledOnce());
    expect(api.createRentalTenant.mock.calls[0][0]).toEqual({
      place_id: 1,
      name: "Selvi",
      whatsapp_number: "98765 43210",
      monthly_rent: 6000,
      move_in_date: "2026-10-01",
      notes: null,
    });
    expect(await screen.findByText("Tenant saved")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(13);
  });

  it.each<[{ place?: string; name?: string; number?: string }, string]>([
    [{}, "Choose the place."],
    [{ place: "1" }, "Enter the tenant's name."],
    [{ place: "1", name: "Selvi" }, "Enter the WhatsApp number."],
    [{ place: "3", name: "Selvi", number: "9876543210" }, "Monthly rent must be more than zero."],
  ])("refuses %j", async (fill, message) => {
    await open();
    if (fill.place) type("Place", fill.place);
    if (fill.name) type("Name", fill.name);
    if (fill.number) type("WhatsApp number", fill.number);
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(api.createRentalTenant).not.toHaveBeenCalled();
  });

  it("asks for a place first when there is none", async () => {
    api.listRentalPlaces.mockResolvedValue([]);
    await open();
    expect(screen.getByText("Add a place in the Places tab first, then come back to add the tenant.")).toBeInTheDocument();
  });

  it("stores files as the tenant's own", async () => {
    await open();
    type("Place", "1");
    type("Name", "Selvi");
    type("WhatsApp number", "9876543210");
    await userEvent.upload(fileInput(), [makeFile("agreement.pdf")]);
    await screen.findByText("agreement.pdf");
    await save();
    await waitFor(() => expect(api.addRentalFile).toHaveBeenCalledWith("TENANT", 13, "agreement.pdf", expect.any(String)));
  });
});

describe("editing a tenant", () => {
  it("loads the tenant, with the number written the usual way", async () => {
    await open(12);
    expect(screen.getByLabelText("Place")).toHaveValue("2");
    // Their own place is not shown as taken.
    expect(optionText("2")).toBe("Flat 2B");
    expect(screen.getByLabelText("WhatsApp number")).toHaveValue("+91 98765 43210");
    expect(screen.getByLabelText("Monthly rent")).toHaveValue(8000);
    type("Monthly rent", "8500");
    await save("Save changes");
    await waitFor(() => expect(api.updateRentalTenant).toHaveBeenCalledOnce());
    expect(api.updateRentalTenant.mock.calls[0]).toEqual([
      12,
      { place_id: 2, name: "Kumar", whatsapp_number: "+91 98765 43210", monthly_rent: 8500, move_in_date: "2025-06-01", notes: null },
    ]);
  });

  it("marks a tenant moved out straight away", async () => {
    await open(12);
    expect(screen.getByLabelText("Moved out on")).toHaveValue("2026-10-15");
    type("Moved out on", "2026-10-10");
    api.getRentalTenant.mockResolvedValue(tenant({ moved_out_date: "2026-10-10" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark moved out" }));
    await waitFor(() => expect(api.setRentalTenantMovedOut).toHaveBeenCalledWith(12, "2026-10-10"));
    expect(await screen.findByText("Marked as moved out")).toBeInTheDocument();
    expect(await screen.findByText("Moved out on 10-10-2026.")).toBeInTheDocument();
  });

  it("moves a tenant back in", async () => {
    api.getRentalTenant.mockResolvedValue(tenant({ moved_out_date: "2026-09-30" }));
    await open(12);
    api.getRentalTenant.mockResolvedValue(tenant());
    await userEvent.click(screen.getByRole("button", { name: "Move back in" }));
    await waitFor(() => expect(api.setRentalTenantMovedOut).toHaveBeenCalledWith(12, null));
    expect(await screen.findByText("Moved back in")).toBeInTheDocument();
  });

  it("shows why a move was refused", async () => {
    api.setRentalTenantMovedOut.mockRejectedValue(new Error("Flat 2B already has a tenant."));
    api.getRentalTenant.mockResolvedValue(tenant({ moved_out_date: "2026-09-30" }));
    await open(12);
    await userEvent.click(screen.getByRole("button", { name: "Move back in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Flat 2B already has a tenant.");
  });

  it("says so when the tenant was deleted", async () => {
    api.getRentalTenant.mockResolvedValue(null);
    render(
      <ToastProvider>
        <TenantFormModal tenantId={12} onClose={onClose} onSaved={onSaved} />
      </ToastProvider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This tenant no longer exists.");
  });
});
