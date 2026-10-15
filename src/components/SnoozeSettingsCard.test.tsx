import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SnoozeSettingsCard from "./SnoozeSettingsCard";
import { ToastProvider } from "./ui";

const api = vi.hoisted(() => ({ getSnoozeChoices: vi.fn(), saveSnoozeChoices: vi.fn() }));
vi.mock("../services/api", () => api);

const setup = () =>
  render(
    <ToastProvider>
      <SnoozeSettingsCard />
    </ToastProvider>
  );

beforeEach(() => {
  api.getSnoozeChoices.mockReset();
  api.saveSnoozeChoices.mockReset();
});

describe("SnoozeSettingsCard", () => {
  it("ticks the saved choices", async () => {
    api.getSnoozeChoices.mockResolvedValue([1, 7]);
    setup();
    expect(await screen.findByLabelText("Tomorrow")).toBeChecked();
    expect(screen.getByLabelText("1 week")).toBeChecked();
    expect(screen.getByLabelText("2 days")).not.toBeChecked();
    expect(screen.getByLabelText("1 month")).not.toBeChecked();
  });

  it("can't save until something changed", async () => {
    api.getSnoozeChoices.mockResolvedValue([1]);
    setup();
    const save = await screen.findByRole("button", { name: "Save snooze choices" });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByLabelText("3 days"));
    expect(save).toBeEnabled();
    await userEvent.click(screen.getByLabelText("3 days"));
    expect(save).toBeDisabled();
  });

  it("can't save with nothing ticked", async () => {
    api.getSnoozeChoices.mockResolvedValue([1]);
    setup();
    await userEvent.click(await screen.findByLabelText("Tomorrow"));
    expect(screen.getByRole("button", { name: "Save snooze choices" })).toBeDisabled();
  });

  it("saves the choices in order", async () => {
    api.getSnoozeChoices.mockResolvedValue([7]);
    api.saveSnoozeChoices.mockImplementation(async (days: number[]) => days);
    setup();
    await userEvent.click(await screen.findByLabelText("1 month"));
    await userEvent.click(screen.getByLabelText("Tomorrow"));
    await userEvent.click(screen.getByRole("button", { name: "Save snooze choices" }));
    expect(api.saveSnoozeChoices).toHaveBeenCalledWith([1, 7, 30]);
    expect(await screen.findByText("Snooze choices saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save snooze choices" })).toBeDisabled();
  });

  it("still lists an unusual saved length so it can be turned off", async () => {
    api.getSnoozeChoices.mockResolvedValue([1, 10]);
    setup();
    expect(await screen.findByLabelText("10 days")).toBeChecked();
  });

  it("shows why loading failed", async () => {
    api.getSnoozeChoices.mockRejectedValue(new Error("Error: no settings table"));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("no settings table");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows why saving failed and keeps the choices", async () => {
    api.getSnoozeChoices.mockResolvedValue([1]);
    api.saveSnoozeChoices.mockRejectedValue(new Error("Pick at least one"));
    setup();
    await userEvent.click(await screen.findByLabelText("2 days"));
    await userEvent.click(screen.getByRole("button", { name: "Save snooze choices" }));
    expect(await screen.findByText("Pick at least one")).toBeInTheDocument();
    expect(screen.getByLabelText("2 days")).toBeChecked();
  });
});
