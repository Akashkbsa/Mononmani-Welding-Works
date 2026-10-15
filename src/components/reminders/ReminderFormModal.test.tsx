import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReminderFormModal from "./ReminderFormModal";
import { ToastProvider } from "../ui";
import { Reminder, ReminderInput } from "../../types/reminder";

const api = vi.hoisted(() => ({ createReminder: vi.fn(), updateReminder: vi.fn() }));
vi.mock("../../services/api", () => api);

const saved = (over: Partial<Reminder> = {}): Reminder => ({
  id: 5,
  title: "Renew insurance",
  note: "Policy 123",
  due_date: "2026-11-01",
  remind_days: 7,
  repeat: "YEARLY",
  month_end: false,
  link_kind: null,
  link_id: null,
  link_label: null,
  link_missing: false,
  dismissed: false,
  snoozed_until: null,
  done_on: null,
  last_done_on: null,
  state: "WAITING",
  days_away: 17,
  created_at: "",
  updated_at: "",
  ...over,
});

let onClose: Mock<() => void>;
let onSaved: Mock<() => void>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  api.createReminder.mockReset().mockResolvedValue({});
  api.updateReminder.mockReset().mockResolvedValue({});
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<() => void>();
});
afterEach(() => vi.useRealTimers());

const open = (props: Partial<Parameters<typeof ReminderFormModal>[0]> = {}) =>
  render(
    <ToastProvider>
      <ReminderFormModal onClose={onClose} onSaved={onSaved} {...props} />
    </ToastProvider>
  );

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = (name = "Save reminder") => userEvent.click(screen.getByRole("button", { name }));
const sent = (): ReminderInput => api.createReminder.mock.calls[0][0];

describe("a new reminder", () => {
  it("starts today, on the day, not repeating", () => {
    open();
    expect(screen.getByLabelText("What to do")).toHaveFocus();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-15");
    expect(screen.getByLabelText("Remind me")).toHaveValue("0");
    expect(screen.getByLabelText("Repeat")).toHaveValue("NONE");
  });

  it("saves it", async () => {
    open();
    type("What to do", "  Pay EB bill ");
    type("Date", "2026-10-20");
    type("Remind me", "3");
    type("Note", " ");
    await save();
    await waitFor(() => expect(api.createReminder).toHaveBeenCalledOnce());
    expect(sent()).toEqual({
      title: "Pay EB bill",
      note: null,
      due_date: "2026-10-20",
      remind_days: 3,
      repeat: "NONE",
      month_end: false,
      link_kind: null,
      link_id: null,
    });
    expect(await screen.findByText("Reminder saved")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("can repeat on the last day of each month", async () => {
    open({ suggestedTitle: "Pay rent" });
    expect(screen.getByLabelText("What to do")).toHaveValue("Pay rent");
    expect(screen.queryByLabelText("On the last day of each month")).not.toBeInTheDocument();
    type("Repeat", "MONTHLY");
    fireEvent.click(screen.getByLabelText("On the last day of each month"));
    await save();
    await waitFor(() => expect(api.createReminder).toHaveBeenCalled());
    expect(sent()).toMatchObject({ repeat: "MONTHLY", month_end: true });
  });

  it("drops month end once the repeat is not monthly", async () => {
    open({ suggestedTitle: "Pay rent" });
    type("Repeat", "MONTHLY");
    fireEvent.click(screen.getByLabelText("On the last day of each month"));
    type("Repeat", "WEEKLY");
    await save();
    await waitFor(() => expect(api.createReminder).toHaveBeenCalled());
    expect(sent()).toMatchObject({ repeat: "WEEKLY", month_end: false });
  });

  it("takes a custom number of days before", async () => {
    open({ suggestedTitle: "Renew licence" });
    type("Remind me", "custom");
    type("Days before", "30");
    await save();
    await waitFor(() => expect(api.createReminder).toHaveBeenCalled());
    expect(sent().remind_days).toBe(30);
  });

  it("counts a cleared days box as on the day", async () => {
    open({ suggestedTitle: "Renew licence" });
    type("Remind me", "custom");
    type("Days before", "");
    await save();
    await waitFor(() => expect(api.createReminder).toHaveBeenCalled());
    expect(sent().remind_days).toBe(0);
  });

  it.each(["366", "-1", "1.5"])("refuses %j days before", async (value) => {
    open({ suggestedTitle: "Renew licence" });
    type("Remind me", "custom");
    type("Days before", value);
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Remind me can be 0 to 365 days before.");
    expect(api.createReminder).not.toHaveBeenCalled();
  });

  it("refuses no title or no date", async () => {
    open();
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter what the reminder is for.");
    type("What to do", "Call");
    type("Date", "");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the date.");
  });

  it("starts linked to the record it was made from", async () => {
    open({ link: { kind: "INVOICE", id: 9, label: "MWW/26-27/009" }, suggestedTitle: "Follow up" });
    expect(screen.getByText("Linked to invoice:")).toBeInTheDocument();
    expect(screen.getByText("MWW/26-27/009")).toBeInTheDocument();
    await save();
    await waitFor(() => expect(api.createReminder).toHaveBeenCalled());
    expect(sent()).toMatchObject({ link_kind: "INVOICE", link_id: 9 });
  });

  it("can have its link removed", async () => {
    open({ link: { kind: "INVOICE", id: 9, label: "MWW/26-27/009" }, suggestedTitle: "Follow up" });
    await userEvent.click(screen.getByRole("button", { name: "Remove link" }));
    expect(screen.queryByText("Linked to invoice:")).not.toBeInTheDocument();
    await save();
    await waitFor(() => expect(api.createReminder).toHaveBeenCalled());
    expect(sent()).toMatchObject({ link_kind: null, link_id: null });
  });

  it("shows the backend's refusal", async () => {
    api.createReminder.mockRejectedValue(new Error("Date is not valid."));
    open({ suggestedTitle: "x" });
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Date is not valid.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("editing a reminder", () => {
  it("loads it and saves in place", async () => {
    open({ reminder: saved() });
    expect(screen.getByRole("dialog", { name: "Edit reminder" })).toBeInTheDocument();
    expect(screen.getByLabelText("What to do")).toHaveValue("Renew insurance");
    expect(screen.getByLabelText("Remind me")).toHaveValue("7");
    expect(screen.getByLabelText("Repeat")).toHaveValue("YEARLY");
    type("Date", "2026-11-05");
    await save("Save changes");
    await waitFor(() => expect(api.updateReminder).toHaveBeenCalledOnce());
    expect(api.updateReminder.mock.calls[0]).toEqual([
      5,
      { title: "Renew insurance", note: "Policy 123", due_date: "2026-11-05", remind_days: 7, repeat: "YEARLY", month_end: false, link_kind: null, link_id: null },
    ]);
  });

  it("shows a custom days-before value", () => {
    open({ reminder: saved({ remind_days: 21 }) });
    expect(screen.getByLabelText("Remind me")).toHaveValue("custom");
    expect(screen.getByLabelText("Days before")).toHaveValue(21);
  });

  it("keeps a link whose record was deleted", () => {
    open({ reminder: saved({ link_kind: "PAYMENT", link_id: 3, link_label: null, link_missing: true }) });
    expect(screen.getByText("Linked to payment:")).toBeInTheDocument();
    expect(screen.getByText("link removed")).toBeInTheDocument();
  });

  it("asks before throwing away changes", async () => {
    open({ reminder: saved() });
    type("Note", "changed");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard your changes?" })).toBeInTheDocument();
  });
});
