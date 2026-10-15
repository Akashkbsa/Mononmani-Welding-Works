import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MarkPaidModal from "./MarkPaidModal";
import { ToastProvider } from "../ui";
import { MonthRow } from "../../types/rental";

const api = vi.hoisted(() => ({ markRentPaid: vi.fn() }));
vi.mock("../../services/api", () => api);

const monthRow = (over: Partial<MonthRow> = {}): MonthRow => ({
  tenant_id: 12,
  tenant_name: "Kumar",
  place_name: "Flat 2B",
  whatsapp_number: "+919876543210",
  rent_amount: 8000,
  paid: false,
  paid_on: null,
  paid_amount: null,
  note: null,
  reminders_sent: 0,
  last_sent_on: null,
  ...over,
});

let onClose: Mock<() => void>;
let onSaved: Mock<() => void>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  api.markRentPaid.mockReset().mockResolvedValue(undefined);
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<() => void>();
  render(
    <ToastProvider>
      <MarkPaidModal row={monthRow()} month="2026-10" onClose={onClose} onSaved={onSaved} />
    </ToastProvider>
  );
});
afterEach(() => vi.useRealTimers());

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("MarkPaidModal", () => {
  it("starts with today and the rent", () => {
    expect(screen.getByText("Kumar · Flat 2B · October 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Date paid")).toHaveValue("2026-10-15");
    expect(screen.getByLabelText("Amount")).toHaveValue(8000);
  });

  it("records the payment", async () => {
    type("Amount", "7500");
    type("Note", " paid by UPI ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.markRentPaid).toHaveBeenCalledOnce());
    expect(api.markRentPaid.mock.calls[0][0]).toEqual({ tenant_id: 12, month: "2026-10", paid_on: "2026-10-15", amount: 7500, note: "paid by UPI" });
    expect(await screen.findByText("Marked as paid")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("an empty amount means the tenant's rent", async () => {
    type("Amount", "");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.markRentPaid).toHaveBeenCalled());
    expect(api.markRentPaid.mock.calls[0][0].amount).toBeNull();
  });

  it("Enter in any box saves", async () => {
    fireEvent.keyDown(screen.getByLabelText("Note"), { key: "Enter" });
    await waitFor(() => expect(api.markRentPaid).toHaveBeenCalledOnce());
  });

  it("refuses a zero amount or no date", async () => {
    type("Amount", "0");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Amount must be more than zero.");
    type("Date paid", "");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the date paid.");
    expect(api.markRentPaid).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal", async () => {
    api.markRentPaid.mockRejectedValue(new Error("October 2026 is already paid."));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("October 2026 is already paid.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
