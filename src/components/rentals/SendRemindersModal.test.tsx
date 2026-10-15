import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SendRemindersModal, { reminderLabel } from "./SendRemindersModal";
import { ToastProvider } from "../ui";
import { MonthRow, RentReminder } from "../../types/rental";

const api = vi.hoisted(() => ({ getRentReminder: vi.fn(), getRentReminderHistory: vi.fn(), openRentReminder: vi.fn() }));
vi.mock("../../services/api", () => api);

const row = (over: Partial<MonthRow> = {}): MonthRow => ({
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

const message = (tenant_id: number, reminder_number = 1): RentReminder => ({
  tenant_id,
  tenant_name: "Kumar",
  number: "+919876543210",
  reminder_number,
  message: "Dear Kumar, the rent of ₹8,000.00 for October 2026 is due.",
  link: "https://wa.me/919876543210?text=Dear%20Kumar",
});

let onChanged: Mock<() => void>;
const writeText = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  Object.values(api).forEach((f) => f.mockReset());
  api.getRentReminder.mockImplementation(async (id: number) => message(id));
  api.getRentReminderHistory.mockResolvedValue([]);
  api.openRentReminder.mockResolvedValue(undefined);
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  onChanged = vi.fn<() => void>();
});
afterEach(() => vi.useRealTimers());

const open = async (rows: MonthRow[]) => {
  render(
    <ToastProvider>
      <SendRemindersModal month="2026-10" rows={rows} onClose={() => {}} onChanged={onChanged} />
    </ToastProvider>
  );
  await waitFor(() => expect(api.getRentReminder).toHaveBeenCalledTimes(rows.length));
};

describe("reminderLabel", () => {
  it("names each reminder", () => {
    expect(reminderLabel(1)).toBe("First reminder");
    expect(reminderLabel(2)).toBe("Second reminder (follow-up)");
    expect(reminderLabel(5)).toBe("Fifth reminder (follow-up)");
    expect(reminderLabel(6)).toBe("6th reminder (follow-up)");
  });
});

describe("SendRemindersModal", () => {
  it("shows each unpaid tenant's message ready to send", async () => {
    await open([row()]);
    expect(screen.getByText("October 2026 · 1 not paid")).toBeInTheDocument();
    expect(screen.getByText("+91 98765 43210")).toBeInTheDocument();
    expect(await screen.findByText("Dear Kumar, the rent of ₹8,000.00 for October 2026 is due.")).toBeInTheDocument();
    expect(screen.getByText("First reminder")).toBeInTheDocument();
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    expect(api.getRentReminder).toHaveBeenCalledWith(12, "2026-10");
  });

  it("only opens WhatsApp through the app; it never sends by itself", async () => {
    await open([row()]);
    await userEvent.click(await screen.findByRole("button", { name: "Send first reminder" }));
    await waitFor(() => expect(api.openRentReminder).toHaveBeenCalledWith(12, "2026-10"));
    // Opening the chat is the only call made; the owner presses Send in WhatsApp.
    expect(api.openRentReminder).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
    // The messages load again so the next reminder number shows.
    await waitFor(() => expect(api.getRentReminder).toHaveBeenCalledTimes(2));
  });

  it("shows earlier reminders and offers a follow-up", async () => {
    api.getRentReminder.mockResolvedValue(message(12, 2));
    api.getRentReminderHistory.mockResolvedValue([{ id: 1, number: 1, opened_on: "2026-10-05", sent_on: "2026-10-05" }]);
    await open([row({ reminders_sent: 1, last_sent_on: "2026-10-05" })]);
    expect(await screen.findByText("Second reminder (follow-up)")).toBeInTheDocument();
    expect(screen.getByText("1 reminder sent · last 5 Oct")).toBeInTheDocument();
    const history = screen.getByRole("list", { name: "Reminder history for Kumar" });
    expect(within(history).getByText("First reminder")).toBeInTheDocument();
    expect(within(history).getByText("sent 5 Oct")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send second reminder" })).toBeInTheDocument();
  });

  it("asks twice before a second reminder on the same day", async () => {
    await open([row({ reminders_sent: 1, last_sent_on: "2026-10-15" })]);
    expect(screen.getByText("A reminder was already sent today.")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Send first reminder" }));
    expect(api.openRentReminder).not.toHaveBeenCalled();
    expect(screen.getByText("A reminder was already sent today. Press the button again only if you want to send another.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes, send another" }));
    await waitFor(() => expect(api.openRentReminder).toHaveBeenCalledOnce());
  });

  it("shows why a message could not be made, and blocks sending it", async () => {
    api.getRentReminder.mockRejectedValue(new Error("Kumar has no WhatsApp number."));
    await open([row()]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Kumar has no WhatsApp number.");
    expect(screen.getByRole("button", { name: "Send first reminder" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeDisabled();
  });

  it("shows why opening WhatsApp failed, on that tenant's row", async () => {
    api.openRentReminder.mockRejectedValue(new Error("WhatsApp is not installed."));
    await open([row()]);
    await userEvent.click(await screen.findByRole("button", { name: "Send first reminder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("WhatsApp is not installed.");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("still works when the history cannot load", async () => {
    api.getRentReminderHistory.mockRejectedValue(new Error("busy"));
    await open([row()]);
    expect(await screen.findByRole("button", { name: "Send first reminder" })).toBeEnabled();
  });

  it("copies the message", async () => {
    await open([row()]);
    await userEvent.click(await screen.findByRole("button", { name: "Copy message" }));
    expect(writeText).toHaveBeenCalledWith("Dear Kumar, the rent of ₹8,000.00 for October 2026 is due.");
    expect(await screen.findByText("Message copied")).toBeInTheDocument();
  });

  it("explains how to copy when the clipboard is blocked", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await open([row()]);
    await userEvent.click(await screen.findByRole("button", { name: "Copy message" }));
    expect(await screen.findByText("Could not copy the message. Select the text and press Ctrl+C.")).toBeInTheDocument();
  });

  it("lists several tenants", async () => {
    await open([row(), row({ tenant_id: 13, tenant_name: "Selvi", place_name: "Shop 1" })]);
    expect(screen.getByText("October 2026 · 2 not paid")).toBeInTheDocument();
    expect(await screen.findAllByRole("button", { name: "Send first reminder" })).toHaveLength(2);
  });
});
