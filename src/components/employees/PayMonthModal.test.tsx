import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PayMonthModal from "./PayMonthModal";
import { ToastProvider } from "../ui";
import { PayMonthInput } from "../../types/payroll";
import { figures, monthDetail, payRow, wagePayment } from "./payrollFixtures";

const api = vi.hoisted(() => ({
  deletePayMonth: vi.fn(),
  getPayMonth: vi.fn(),
  savePayMonth: vi.fn(),
  createEmployeePayment: vi.fn(),
  deleteEmployeePayment: vi.fn(),
  updateEmployeePayment: vi.fn(),
  listIncentiveReasons: vi.fn(),
  addIncentive: vi.fn(),
  updateIncentive: vi.fn(),
  deleteIncentive: vi.fn(),
  getEmployeePayMessage: vi.fn(),
  openEmployeePayWhatsApp: vi.fn(),
  printPaySlip: vi.fn(),
  sendPaySlipWhatsApp: vi.fn(),
}));
vi.mock("../../services/api", () => api);

let onClose: Mock<() => void>;
let onChanged: Mock<() => void>;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getPayMonth.mockResolvedValue(monthDetail());
  api.savePayMonth.mockResolvedValue(monthDetail());
  api.deletePayMonth.mockResolvedValue(undefined);
  api.listIncentiveReasons.mockResolvedValue(["Night work"]);
  const payMessage = { message: "Hello Murugan,\nBalance : ₹21,200.00", number: "+919876500003", link: "https://wa.me/919876500003?text=x" };
  api.getEmployeePayMessage.mockResolvedValue(payMessage);
  api.openEmployeePayWhatsApp.mockResolvedValue(payMessage);
  onClose = vi.fn<() => void>();
  onChanged = vi.fn<() => void>();
});

const open = async () => {
  render(
    <ToastProvider>
      <PayMonthModal employeeId={3} month="2026-09" onClose={onClose} onChanged={onChanged} />
    </ToastProvider>
  );
  await screen.findByRole("dialog", { name: "Murugan · September 2026" });
};

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const working = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling!.textContent;
const sent = (): PayMonthInput => api.savePayMonth.mock.calls[0][2];

describe("the month's working", () => {
  it("shows how the pay is made up", async () => {
    await open();
    expect(api.getPayMonth).toHaveBeenCalledWith(3, "2026-09");
    expect(working("26 days × ₹800.00")).toBe("₹20,800.00");
    expect(working("4 h OT × ₹100.00")).toBe("₹400.00");
    expect(working("Earned")).toBe("₹21,200.00");
    expect(working("Still to pay")).toBe("₹21,200.00");
    expect(screen.getByText("To pay ₹21,200.00")).toBeInTheDocument();
  });

  it("shows payments, round-offs and an overpaid month", async () => {
    api.getPayMonth.mockResolvedValue(
      monthDetail({
        row: payRow({ bonus_amount: 500, bonus_note: "Diwali" }),
        figures: figures({ wages: 20800, ot_amount: 400, bonus: 500, earned: 21700, given: 22700, rounded_off: 0, balance: -1000 }),
        status: "OVERPAID",
        entries: [wagePayment({ amount: 22700, note: "Two advances", round_off: -5 })],
      })
    );
    await open();
    expect(working("Bonus (Diwali)")).toBe("₹500.00");
    expect(working("Paid (advances and salary)")).toBe("−₹22,700.00");
    expect(working("Overpaid")).toBe("₹1,000.00");
    expect(screen.getByText("Two advances")).toBeInTheDocument();
    expect(screen.getByText("+₹5 rounded off")).toBeInTheDocument();
    expect(screen.getByText("Paid ₹1,000 extra. How is it settled?")).toBeInTheDocument();
  });

  it("lists each incentive and keeps money written off in view", async () => {
    api.getPayMonth.mockResolvedValue(
      monthDetail({
        row: payRow({ days_worked: 16, daily_wage: 500, ot_hours: 0, incentives: [{ id: 1, reason: "Night work", amount: 300 }] }),
        figures: figures({ wages: 8000, incentives: 300, earned: 8300, given: 12000, cleared: 3700, written_off: 3200, balance: 0 }),
        status: "PAID",
        entries: [
          wagePayment({ id: 21, kind: "SALARY", amount: 12000 }),
          wagePayment({ id: 22, kind: "RETURNED", amount: 500 }),
          wagePayment({ id: 23, kind: "WRITE_OFF", amount: 3200, payment_method: null }),
        ],
      })
    );
    await open();
    expect(working("Incentive (Night work)")).toContain("₹300.00");
    expect(working("Cash returned")).toBe("₹500.00");
    expect(working("Extra, written off")).toBe("₹3,200.00");
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  it("shows the pay message and opens WhatsApp with it", async () => {
    await open();
    expect(await screen.findByText(/Balance : ₹21,200.00/)).toBeInTheDocument();
    expect(api.getEmployeePayMessage).toHaveBeenCalledWith(3, "2026-09");
    await userEvent.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    await waitFor(() => expect(api.openEmployeePayWhatsApp).toHaveBeenCalledWith(3, "2026-09"));
    expect(await screen.findByText("WhatsApp opened. Press Send there.")).toBeInTheDocument();
  });

  it("prints the pay slip", async () => {
    api.printPaySlip.mockResolvedValue("C:/data/Pay slips/2026-09/Murugan - Pay slip September 2026.pdf");
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Print pay slip" }));
    await waitFor(() => expect(api.printPaySlip).toHaveBeenCalledWith(3, "2026-09"));
    expect(await screen.findByText("Pay slip opened. Print it from the PDF viewer.")).toBeInTheDocument();
  });

  it("sends the pay slip on WhatsApp and says to drag it into the chat", async () => {
    api.sendPaySlipWhatsApp.mockResolvedValue({ message: "Hello", number: "+919876500003", link: "https://wa.me/919876500003?text=Hello" });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Send pay slip on WhatsApp" }));
    await waitFor(() => expect(api.sendPaySlipWhatsApp).toHaveBeenCalledWith(3, "2026-09"));
    expect(await screen.findByText("Drag the pay slip from the folder into the WhatsApp chat, then press Send.")).toBeInTheDocument();
  });

  it("shows why the pay slip could not be made", async () => {
    api.printPaySlip.mockRejectedValue(new Error("The PDF was not created. Try again."));
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Print pay slip" }));
    expect(await screen.findByText("The PDF was not created. Try again.")).toBeInTheDocument();
  });

  it("says why the pay message can't be sent", async () => {
    api.getEmployeePayMessage.mockRejectedValue(new Error("Add a phone number for Murugan (Employees, Edit) to send on WhatsApp."));
    await open();
    expect(await screen.findByText("Add a phone number for Murugan (Employees, Edit) to send on WhatsApp.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send on WhatsApp" })).not.toBeInTheDocument();
  });

  it("has no pay message before the days are entered", async () => {
    api.getPayMonth.mockResolvedValue(monthDetail({ row: null, figures: figures(), status: "NOT_ENTERED" }));
    await open();
    expect(screen.queryByText("WhatsApp message")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print pay slip" })).not.toBeInTheDocument();
    expect(api.getEmployeePayMessage).not.toHaveBeenCalled();
  });

  it("names an advance carried in from the month before", async () => {
    api.getPayMonth.mockResolvedValue(
      monthDetail({ carried_in: [wagePayment({ id: 30, month: "2026-08", kind: "CARRIED", carried_to: "2026-09", amount: 700, payment_method: null })] })
    );
    await open();
    expect(screen.getByText("Advance carried from August 2026")).toBeInTheDocument();
  });

  it("says when nothing is entered or paid yet", async () => {
    api.getPayMonth.mockResolvedValue(monthDetail({ row: null, figures: figures(), status: "NOT_ENTERED" }));
    await open();
    expect(screen.getAllByText("Days not entered yet.")).toHaveLength(1);
    expect(screen.getByText("Nothing paid yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter the days" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete month" })).not.toBeInTheDocument();
    // A new month starts from the employee's current rates.
    expect(screen.getByLabelText("Daily wage")).toHaveValue(800);
    expect(screen.getByLabelText("OT rate per hour")).toHaveValue(100);
  });

  it("is read-only for a month that has not started", async () => {
    api.getPayMonth.mockResolvedValue(monthDetail({ row: null, figures: figures({ given: 700 }), editable: false, status: "NOT_ENTERED" }));
    await open();
    expect(screen.getByText("You can enter this month once it starts.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Days")).not.toBeInTheDocument();
    // The X in the corner and the Close button in the footer.
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Pay salary" })).not.toBeInTheDocument();
  });

  it("shows why the month could not load", async () => {
    api.getPayMonth.mockRejectedValue(new Error("Employee not found."));
    render(
      <ToastProvider>
        <PayMonthModal employeeId={3} month="2026-09" onClose={onClose} onChanged={onChanged} />
      </ToastProvider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Employee not found.");
  });
});

describe("entering the days", () => {
  it("previews the pay and saves the month", async () => {
    api.getPayMonth.mockResolvedValue(monthDetail({ row: null, figures: figures(), status: "NOT_ENTERED" }));
    await open();
    type("Days", "25.5");
    type("OT hours", "3.25");
    type("Bonus", "250");
    type("Bonus reason", " Pongal ");
    expect(screen.getByText("Earned ₹20,975.00")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enter the days" }));
    await waitFor(() => expect(api.savePayMonth).toHaveBeenCalledOnce());
    expect(api.savePayMonth.mock.calls[0].slice(0, 2)).toEqual([3, "2026-09"]);
    expect(sent()).toEqual({
      days_worked: 25.5,
      ot_hours: 3.25,
      daily_wage: 800,
      ot_rate: 100,
      bonus_amount: 250,
      bonus_note: "Pongal",
      note: null,
    });
    expect(await screen.findByText("Month saved")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it.each([
    ["Days", "", "Enter the days (0 if absent)."],
    ["Days", "25.3", "Days: Half days only, e.g. 25.5."],
    ["Days", "abc", "Days: Enter a number."],
    ["OT hours", "1.234", "OT hours: Up to two decimals."],
    ["Daily wage", "0", "Daily wage must be more than 0."],
    ["OT rate per hour", "-1", "OT rate can't be negative."],
    ["Bonus", "-10", "Bonus can't be negative."],
  ])("refuses %s %j", async (label, value, message) => {
    await open();
    type(label, value);
    await userEvent.click(screen.getByRole("button", { name: "Save month" }));
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(api.savePayMonth).not.toHaveBeenCalled();
  });

  it("adds an incentive from its own button and keeps what is typed in the month", async () => {
    await open();
    type("Days", "20");
    api.addIncentive.mockResolvedValue(
      monthDetail({
        row: payRow({ incentives: [{ id: 7, reason: "Night work", amount: 300 }] }),
        figures: figures({ wages: 20800, ot_amount: 400, incentives: 300, earned: 21500, balance: 21500 }),
        status: "TO_PAY",
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "Add incentive" }));
    const form = await screen.findByRole("dialog", { name: "Add incentive" });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: " Night work " } });
    fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "300" } });
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.addIncentive).toHaveBeenCalledWith(3, "2026-09", { reason: "Night work", amount: 300 }));
    expect(await screen.findByText("Incentive saved")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add incentive" })).not.toBeInTheDocument();
    expect(working("Incentive (Night work)")).toContain("₹300.00");
    expect(screen.getByLabelText("Days")).toHaveValue("20");
    expect(onChanged).toHaveBeenCalled();
  });

  it("opens a saved incentive to edit it", async () => {
    api.getPayMonth.mockResolvedValue(monthDetail({ row: payRow({ incentives: [{ id: 7, reason: "Target met", amount: 1000 }] }) }));
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Edit Incentive (Target met)" }));
    const form = await screen.findByRole("dialog", { name: "Edit incentive" });
    expect(within(form).getByLabelText("Reason")).toHaveValue("Target met");
    expect(within(form).getByLabelText("Amount")).toHaveValue(1000);
  });

  it("offers Add incentive only once the days are entered", async () => {
    api.getPayMonth.mockResolvedValue(monthDetail({ row: null, figures: figures(), status: "NOT_ENTERED" }));
    await open();
    expect(screen.queryByRole("button", { name: "Add incentive" })).not.toBeInTheDocument();
  });

  it("updates the working and what is left to pay as the rates are typed", async () => {
    api.getPayMonth.mockResolvedValue(
      monthDetail({ figures: figures({ wages: 20800, ot_amount: 400, earned: 21200, given: 5000, balance: 16200 }), status: "TO_PAY" })
    );
    await open();
    expect(screen.queryByText("Not saved yet")).not.toBeInTheDocument();
    type("Daily wage", "900");
    type("OT rate per hour", "150");
    expect(working("26 days × ₹900.00")).toBe("₹23,400.00");
    expect(working("4 h OT × ₹150.00")).toBe("₹600.00");
    expect(working("Earned")).toBe("₹24,000.00");
    expect(working("Still to pay")).toBe("₹19,000.00");
    expect(screen.getByText("To pay ₹19,000.00")).toBeInTheDocument();
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    type("Daily wage", "800");
    type("OT rate per hour", "100");
    expect(working("Still to pay")).toBe("₹16,200.00");
    expect(screen.queryByText("Not saved yet")).not.toBeInTheDocument();
  });

  it("shows a bad number right under its box", async () => {
    await open();
    type("Days", "25.3");
    expect(screen.getByText("Half days only, e.g. 25.5")).toBeInTheDocument();
  });

  it("points out OT hours that earn nothing", async () => {
    await open();
    type("OT rate per hour", "0");
    expect(screen.getByText("OT hours are typed but the OT rate is 0, so overtime adds nothing.")).toBeInTheDocument();
  });

  it("asks before changing a month that is already paid", async () => {
    api.getPayMonth.mockResolvedValue(monthDetail({ figures: figures({ wages: 20800, ot_amount: 400, earned: 21200, given: 21200 }), status: "PAID" }));
    await open();
    type("Days", "27");
    await userEvent.click(screen.getByRole("button", { name: "Save month" }));
    expect(screen.getByRole("dialog", { name: "Change September 2026?" })).toBeInTheDocument();
    expect(api.savePayMonth).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Change month" }));
    await waitFor(() => expect(api.savePayMonth).toHaveBeenCalled());
    expect(sent().days_worked).toBe(27);
  });

  it("does not ask when a paid month's pay stays the same", async () => {
    api.getPayMonth.mockResolvedValue(monthDetail({ figures: figures({ wages: 20800, ot_amount: 400, earned: 21200, given: 21200 }), status: "PAID" }));
    await open();
    type("Note", "checked");
    await userEvent.click(screen.getByRole("button", { name: "Save month" }));
    await waitFor(() => expect(api.savePayMonth).toHaveBeenCalled());
  });

  it("shows the backend's refusal", async () => {
    api.savePayMonth.mockRejectedValue(new Error("Days cannot be more than the days in the month."));
    await open();
    type("Days", "31.5");
    await userEvent.click(screen.getByRole("button", { name: "Save month" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Days cannot be more than the days in the month.");
  });
});

describe("payments in the month", () => {
  it("opens Pay salary with the balance", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Pay salary" }));
    const form = screen.getByRole("dialog", { name: "Pay salary" });
    expect(within(form).getByLabelText("Amount")).toHaveValue(21200);
  });

  it("opens an entry to edit it", async () => {
    api.getPayMonth.mockResolvedValue(monthDetail({ entries: [wagePayment({ id: 20, kind: "ADVANCE", amount: 2000 })] }));
    await open();
    fireEvent.click(screen.getByText("Advance").closest("tr")!);
    expect(screen.getByRole("dialog", { name: "Edit advance" })).toBeInTheDocument();
  });

  it("does not open an advance carried in from another month", async () => {
    api.getPayMonth.mockResolvedValue(
      monthDetail({ carried_in: [wagePayment({ id: 30, month: "2026-08", kind: "CARRIED", carried_to: "2026-09", amount: 700 })] })
    );
    await open();
    fireEvent.click(screen.getByText("Advance carried from August 2026").closest("tr")!);
    expect(screen.queryByRole("dialog", { name: /Edit/ })).not.toBeInTheDocument();
  });

  it("offers the three ways to settle an overpaid month", async () => {
    api.getPayMonth.mockResolvedValue(monthDetail({ figures: figures({ earned: 100, given: 300, balance: -200 }), status: "OVERPAID" }));
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Take from next month" }));
    expect(screen.getByRole("dialog", { name: "Take from next month" })).toBeInTheDocument();
  });

  it("shows the new figures after a payment is saved", async () => {
    api.createEmployeePayment.mockResolvedValue(monthDetail({ figures: figures({ earned: 21200, given: 21200 }), status: "PAID" }));
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Pay salary" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Pay salary" })).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Paid", { selector: "span" })).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("deleting the month", () => {
  it("removes the days after asking and reloads", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Delete month" }));
    expect(screen.getByRole("dialog", { name: "Delete September 2026 for Murugan?" })).toBeInTheDocument();
    api.getPayMonth.mockResolvedValue(monthDetail({ row: null, figures: figures(), status: "NOT_ENTERED" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Delete month" }).slice(-1)[0]);
    await waitFor(() => expect(api.deletePayMonth).toHaveBeenCalledWith(3, "2026-09"));
    expect(await screen.findByText("Month deleted")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Enter the days" })).toBeInTheDocument();
  });

  it("explains a refusal for a month with payments", async () => {
    api.deletePayMonth.mockRejectedValue(new Error("Delete the payments first."));
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Delete month" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Delete month" }).slice(-1)[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Delete the payments first.");
  });
});
