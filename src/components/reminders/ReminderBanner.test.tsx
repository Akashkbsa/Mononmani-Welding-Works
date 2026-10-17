import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReminderBanner from "./ReminderBanner";
import { RemindersContext } from "./RemindersContext";
import { ToastProvider } from "../ui";
import { Reminder } from "../../types/reminder";

const api = vi.hoisted(() => ({
  getReminderBanner: vi.fn(),
  getSnoozeChoices: vi.fn(),
  markReminderDone: vi.fn(),
  setReminderDismissed: vi.fn(),
  snoozeReminder: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const reminder = (over: Partial<Reminder>): Reminder => ({
  id: 1,
  title: "Renew insurance",
  note: null,
  due_date: "2026-10-15",
  remind_days: 0,
  repeat: "NONE",
  month_end: false,
  link_kind: null,
  link_id: null,
  link_label: null,
  link_missing: false,
  dismissed: false,
  snoozed_until: null,
  done_on: null,
  last_done_on: null,
  state: "DUE_TODAY",
  days_away: 0,
  created_at: "2026-10-01",
  updated_at: "2026-10-01",
  ...over,
});

const ctx = { changed: vi.fn(), openRecord: vi.fn() };

function setup(items: Reminder[], snooze: number[] = [1]) {
  api.getReminderBanner.mockResolvedValue(items);
  api.getSnoozeChoices.mockResolvedValue(snooze);
  const onOpenAll = vi.fn();
  render(
    <ToastProvider>
      <RemindersContext.Provider value={ctx}>
        <ReminderBanner refreshKey="k" onOpenAll={onOpenAll} />
      </RemindersContext.Provider>
    </ToastProvider>
  );
  return { onOpenAll };
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  ctx.changed.mockReset();
  ctx.openRecord.mockReset();
});

describe("ReminderBanner", () => {
  it("shows nothing when no reminder is due", async () => {
    setup([]);
    await waitFor(() => expect(api.getReminderBanner).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Reminders" })).not.toBeInTheDocument();
  });

  it("shows nothing when the check fails", async () => {
    api.getReminderBanner.mockRejectedValue(new Error("db locked"));
    api.getSnoozeChoices.mockResolvedValue([1]);
    render(<ReminderBanner refreshKey="k" onOpenAll={() => {}} />);
    await waitFor(() => expect(api.getReminderBanner).toHaveBeenCalled());
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("shows a reminder with its state, date and how far away", async () => {
    setup([reminder({ state: "OVERDUE", due_date: "2026-10-12", days_away: -3 })]);
    expect(await screen.findByText("Renew insurance")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("12-10-2026 · 3 days late")).toBeInTheDocument();
  });

  it("shows the most urgent one, opens up to three, and links to the rest", async () => {
    const { onOpenAll } = setup([1, 2, 3, 4, 5].map((id) => reminder({ id, title: `R${id}` })));
    await screen.findByText("R1");
    expect(screen.queryByText("R2")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show 4 more reminders" }));
    expect(screen.getByText("R3")).toBeInTheDocument();
    expect(screen.queryByText("R4")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "and 2 more on the Reminders page" }));
    expect(onOpenAll).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByText("R2")).not.toBeInTheDocument();
  });

  it("says 'reminder' for one more", async () => {
    setup([1, 2].map((id) => reminder({ id, title: `R${id}` })));
    expect(await screen.findByRole("button", { name: "Show 1 more reminder" })).toBeInTheDocument();
  });

  it("has no extra line for a single reminder", async () => {
    setup([reminder({ id: 1, title: "R1" })]);
    await screen.findByText("R1");
    expect(screen.queryByRole("button", { name: /more reminder/ })).not.toBeInTheDocument();
  });

  it("opens the linked record", async () => {
    setup([reminder({ link_kind: "INVOICE", link_id: 42, link_label: "MWW/26-27/007" })]);
    await userEvent.click(await screen.findByRole("button", { name: "Invoice MWW/26-27/007" }));
    expect(ctx.openRecord).toHaveBeenCalledWith("INVOICE", 42);
  });

  it("says when the linked record was deleted", async () => {
    setup([reminder({ link_kind: "INVOICE", link_id: 42, link_missing: true })]);
    expect(await screen.findByText("link removed")).toBeInTheDocument();
  });

  it("Done marks it done and reloads", async () => {
    api.markReminderDone.mockResolvedValue(undefined);
    setup([reminder({ id: 9 })]);
    await userEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(api.markReminderDone).toHaveBeenCalledWith(9);
    expect(await screen.findByText("Marked as done")).toBeInTheDocument();
    expect(ctx.changed).toHaveBeenCalled();
  });

  it("Done on a repeating reminder says it moved on", async () => {
    api.markReminderDone.mockResolvedValue(undefined);
    setup([reminder({ repeat: "MONTHLY" })]);
    await userEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(await screen.findByText("Done. Moved to the next date")).toBeInTheDocument();
  });

  it("shows the backend's reason when an action fails", async () => {
    api.setReminderDismissed.mockRejectedValue(new Error("Reminder not found"));
    setup([reminder({ id: 4 })]);
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(api.setReminderDismissed).toHaveBeenCalledWith(4, true);
    expect(await screen.findByRole("alert")).toHaveTextContent("Reminder not found");
    expect(ctx.changed).not.toHaveBeenCalled();
  });

  it("with one snooze choice, snoozes in one click", async () => {
    api.snoozeReminder.mockResolvedValue(undefined);
    setup([reminder({ id: 3 })], [1]);
    const snooze = await screen.findByRole("button", { name: "Snooze" });
    expect(snooze).not.toHaveAttribute("aria-haspopup");
    await userEvent.click(snooze);
    expect(api.snoozeReminder).toHaveBeenCalledWith(3, 1);
    expect(await screen.findByText("Snoozed: back tomorrow")).toBeInTheDocument();
  });

  it("with several choices, asks how long", async () => {
    api.snoozeReminder.mockResolvedValue(undefined);
    setup([reminder({ id: 3 })], [1, 7]);
    const snooze = await screen.findByRole("button", { name: "Snooze" });
    await waitFor(() => expect(snooze).toHaveAttribute("aria-haspopup", "menu"));
    await userEvent.click(snooze);
    expect(snooze).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("menuitem", { name: "1 week" }));
    expect(api.snoozeReminder).toHaveBeenCalledWith(3, 7);
    expect(await screen.findByText("Snoozed: back in 1 week")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the snooze menu with Escape or a click elsewhere", async () => {
    setup([reminder({})], [1, 7]);
    const snooze = await screen.findByRole("button", { name: "Snooze" });
    await waitFor(() => expect(snooze).toHaveAttribute("aria-haspopup", "menu"));
    await userEvent.click(snooze);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(snooze);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps one snooze choice when the saved choices come back empty", async () => {
    setup([reminder({})], []);
    const snooze = await screen.findByRole("button", { name: "Snooze" });
    expect(snooze).not.toHaveAttribute("aria-haspopup");
  });
});
