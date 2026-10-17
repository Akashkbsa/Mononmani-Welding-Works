import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IncentiveFormModal from "./IncentiveFormModal";
import { ToastProvider } from "../ui";
import { Incentive, PayMonthDetail } from "../../types/payroll";
import { monthDetail } from "./payrollFixtures";

const api = vi.hoisted(() => ({
  addIncentive: vi.fn(),
  updateIncentive: vi.fn(),
  deleteIncentive: vi.fn(),
  listIncentiveReasons: vi.fn(),
}));
vi.mock("../../services/api", () => api);

let onClose: Mock<() => void>;
let onSaved: Mock<(d: PayMonthDetail) => void>;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listIncentiveReasons.mockResolvedValue(["Night work", "Site visit"]);
  api.addIncentive.mockResolvedValue(monthDetail());
  api.updateIncentive.mockResolvedValue(monthDetail());
  api.deleteIncentive.mockResolvedValue(monthDetail());
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<(d: PayMonthDetail) => void>();
});

const open = (existing?: Incentive) =>
  render(
    <ToastProvider>
      <IncentiveFormModal detail={monthDetail()} existing={existing} onClose={onClose} onSaved={onSaved} />
    </ToastProvider>
  );
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("IncentiveFormModal", () => {
  it("adds an incentive to the month and offers reasons used before", async () => {
    open();
    expect(screen.getByRole("dialog", { name: "Add incentive" })).toBeInTheDocument();
    expect(screen.getByText("Murugan · September 2026")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('#incentive-reasons option[value="Site visit"]')).not.toBeNull());
    type("Reason", " Night work ");
    type("Amount", "250.5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.addIncentive).toHaveBeenCalledWith(3, "2026-09", { reason: "Night work", amount: 250.5 }));
    expect(onSaved).toHaveBeenCalled();
  });

  it("saves with Enter", async () => {
    open();
    type("Reason", "Night work");
    type("Amount", "300");
    await userEvent.type(screen.getByLabelText("Amount"), "{Enter}");
    await waitFor(() => expect(api.addIncentive).toHaveBeenCalledOnce());
  });

  it.each([
    ["", "200", "Type a reason, e.g. Night work."],
    ["Night work", "", "Enter an amount more than 0."],
    ["Night work", "0", "Enter an amount more than 0."],
  ])("refuses reason %j amount %j", async (reason, amount, message) => {
    open();
    type("Reason", reason);
    type("Amount", amount);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(api.addIncentive).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal and stays open", async () => {
    api.addIncentive.mockRejectedValue(new Error("Enter the days for September 2026 first."));
    open();
    type("Reason", "Night work");
    type("Amount", "300");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the days for September 2026 first.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("edits and deletes a saved incentive", async () => {
    open({ id: 7, reason: "Night work", amount: 300 });
    expect(screen.getByRole("dialog", { name: "Edit incentive" })).toBeInTheDocument();
    type("Amount", "350");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateIncentive).toHaveBeenCalledWith(7, { reason: "Night work", amount: 350 }));

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Night work will be taken off September 2026 pay.")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Delete" });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.deleteIncentive).toHaveBeenCalledWith(7));
  });
});
