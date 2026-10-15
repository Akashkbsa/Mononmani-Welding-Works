import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WageEntryFormModal from "./WageEntryFormModal";
import { ToastProvider } from "../ui";
import { EmployeePayment, EmployeePaymentInput, PayMonthDetail, WageKind } from "../../types/payroll";
import { figures, monthDetail, wagePayment } from "./payrollFixtures";

const api = vi.hoisted(() => ({
  createEmployeePayment: vi.fn(),
  deleteEmployeePayment: vi.fn(),
  getPayMonth: vi.fn(),
  updateEmployeePayment: vi.fn(),
}));
vi.mock("../../services/api", () => api);

let onClose: Mock<() => void>;
let onSaved: Mock<(d: PayMonthDetail | null) => void>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  Object.values(api).forEach((f) => f.mockReset());
  api.createEmployeePayment.mockResolvedValue(monthDetail());
  api.updateEmployeePayment.mockResolvedValue(monthDetail());
  api.deleteEmployeePayment.mockResolvedValue(undefined);
  api.getPayMonth.mockResolvedValue(monthDetail());
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<(d: PayMonthDetail | null) => void>();
});
afterEach(() => vi.useRealTimers());

const open = (kind: WageKind, detail: PayMonthDetail | null = monthDetail(), existing?: EmployeePayment, extra = {}) =>
  render(
    <ToastProvider>
      <WageEntryFormModal detail={detail} kind={kind} existing={existing} month="2026-09" onClose={onClose} onSaved={onSaved} {...extra} />
    </ToastProvider>
  );

const amount = () => screen.getByLabelText("Amount") as HTMLInputElement;
const setAmount = (v: string) => fireEvent.change(amount(), { target: { value: v } });
const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));
const sentCreate = (): EmployeePaymentInput => api.createEmployeePayment.mock.calls[0][0];

describe("paying salary", () => {
  it("starts with what is still to pay", () => {
    open("SALARY");
    expect(screen.getByRole("dialog", { name: "Pay salary" })).toBeInTheDocument();
    expect(screen.getByText("Murugan · September 2026")).toBeInTheDocument();
    expect(screen.getByText("Still to pay: ₹21,200.00")).toBeInTheDocument();
    expect(amount()).toHaveValue(21200);
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-15");
    expect(screen.getByLabelText("Paid by")).toHaveValue("Cash");
  });

  it("pays the full amount without a round-off", async () => {
    open("SALARY");
    expect(screen.queryByLabelText("Round off and finish")).not.toBeInTheDocument();
    await save();
    await waitFor(() => expect(api.createEmployeePayment).toHaveBeenCalledOnce());
    expect(sentCreate()).toEqual({
      employee_id: 3,
      month: "2026-09",
      kind: "SALARY",
      entry_date: "2026-10-15",
      amount: 21200,
      finish: false,
      payment_method: "Cash",
      note: null,
    });
    expect(await screen.findByText("Salary saved")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(monthDetail());
  });

  it("rounds off a little less and finishes the month", async () => {
    open("SALARY");
    setAmount("21190");
    fireEvent.click(screen.getByLabelText("Round off and finish"));
    expect(screen.getByText("Rounded off ₹10.00 (paid less)")).toBeInTheDocument();
    await save();
    await waitFor(() => expect(api.createEmployeePayment).toHaveBeenCalled());
    expect(sentCreate()).toMatchObject({ amount: 21190, finish: true });
  });

  it("counts a little extra as paid when finishing", () => {
    open("SALARY");
    setAmount("21250");
    expect(screen.getByText("This pays ₹50.00 more than is due. The month will show Overpaid.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Round off and finish"));
    expect(screen.getByText("₹50.00 extra, counted as paid")).toBeInTheDocument();
  });

  it("warns about a round-off over ₹100", () => {
    open("SALARY");
    setAmount("21000");
    fireEvent.click(screen.getByLabelText("Round off and finish"));
    expect(screen.getByText("That's a round-off of more than ₹100. Check the amount.")).toBeInTheDocument();
  });

  it("sends finish only when there is something to round", async () => {
    open("SALARY");
    setAmount("21190");
    fireEvent.click(screen.getByLabelText("Round off and finish"));
    setAmount("21200");
    await save();
    await waitFor(() => expect(api.createEmployeePayment).toHaveBeenCalled());
    expect(sentCreate().finish).toBe(false);
  });

  it("cannot round off a month with no days entered", () => {
    open("SALARY", monthDetail({ row: null, figures: figures(), status: "NOT_ENTERED" }));
    expect(screen.getByText("Days not entered yet.")).toBeInTheDocument();
    setAmount("1000");
    expect(screen.queryByLabelText("Round off and finish")).not.toBeInTheDocument();
  });

  it.each(["", "0", "-5"])("refuses an amount of %j", async (v) => {
    open("SALARY");
    setAmount(v);
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount more than 0.");
    expect(api.createEmployeePayment).not.toHaveBeenCalled();
  });

  it("refuses an empty date", async () => {
    open("SALARY");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the date.");
  });
});

describe("giving an advance", () => {
  it("starts empty and warns when it is more than is due", async () => {
    open("ADVANCE");
    expect(amount()).toHaveValue(null);
    setAmount("25000");
    expect(screen.getByText("This is more than is still due. The month will show Overpaid.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "UPI" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: " festival " } });
    await save();
    await waitFor(() => expect(api.createEmployeePayment).toHaveBeenCalled());
    expect(sentCreate()).toMatchObject({ kind: "ADVANCE", amount: 25000, finish: false, payment_method: "UPI", note: "festival" });
  });

  it("asks for the employee first from the pay sheet", async () => {
    open("ADVANCE", null, undefined, { employeeChoices: [{ id: 3, name: "Murugan", role: "Welder" }, { id: 4, name: "Ravi", role: null }] });
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(screen.getByRole("combobox", { name: "Employee" }));
    await userEvent.click(screen.getByText("Murugan"));
    await waitFor(() => expect(api.getPayMonth).toHaveBeenCalledWith(3, "2026-09"));
    expect(await screen.findByText("Still to pay: ₹21,200.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows why the employee's month could not load", async () => {
    api.getPayMonth.mockRejectedValue(new Error("Employee has left."));
    open("ADVANCE", null, undefined, { employeeChoices: [{ id: 3, name: "Murugan", role: null }] });
    await userEvent.click(screen.getByRole("combobox", { name: "Employee" }));
    await userEvent.click(screen.getByText("Murugan"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Employee has left.");
  });
});

describe("settling an overpaid month", () => {
  const overpaid = monthDetail({ figures: figures({ earned: 21200, given: 22200, balance: -1000 }), status: "OVERPAID" });

  it.each([
    ["RETURNED", "Cash returned", true],
    ["WRITE_OFF", "Write off", false],
    ["CARRIED", "Take from next month", false],
  ] as const)("%s starts with the overpaid amount", async (kind, title, asksMethod) => {
    open(kind, overpaid);
    expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
    expect(screen.getByText("Overpaid: ₹1,000.00")).toBeInTheDocument();
    expect(amount()).toHaveValue(1000);
    expect(!!screen.queryByLabelText("Paid by")).toBe(asksMethod);
    await save();
    await waitFor(() => expect(api.createEmployeePayment).toHaveBeenCalled());
    expect(sentCreate()).toMatchObject({ kind, amount: 1000, payment_method: asksMethod ? "Cash" : null });
  });

  it("says where a carried amount goes", () => {
    open("CARRIED", overpaid);
    expect(screen.getByText("It will show as an advance on October 2026 pay.")).toBeInTheDocument();
  });
});

describe("editing an entry", () => {
  // The month's figures already include the ₹21,190 salary and its ₹10 round-off.
  const finished = monthDetail({ figures: figures({ earned: 21200, given: 21190, rounded_off: 10, balance: 0 }), status: "PAID" });
  const salary = wagePayment({ id: 21, kind: "SALARY", amount: 21190, round_off: 10, payment_method: "Bank Transfer (old)" });

  it("works out the balance without the entry and keeps its round-off ticked", () => {
    open("SALARY", finished, salary);
    expect(screen.getByRole("dialog", { name: "Edit salary" })).toBeInTheDocument();
    expect(screen.getByText("Still to pay: ₹21,200.00")).toBeInTheDocument();
    expect(amount()).toHaveValue(21190);
    expect(screen.getByLabelText("Round off and finish")).toBeChecked();
    // A method no longer offered still shows.
    expect(screen.getByLabelText("Paid by")).toHaveValue("Bank Transfer (old)");
  });

  it("does not quietly write off wages added after it was finished", () => {
    // ₹500 bonus added since: balance is now ₹500, so the old round-off no longer matches.
    const later = monthDetail({ figures: figures({ earned: 21700, given: 21190, rounded_off: 10, balance: 500 }), status: "TO_PAY" });
    open("SALARY", later, salary);
    expect(screen.getByLabelText("Round off and finish")).not.toBeChecked();
  });

  it("says when the round-off changes", () => {
    open("SALARY", finished, salary);
    setAmount("21180");
    expect(screen.getByText("The round-off changes from ₹10.00 to ₹20.00.")).toBeInTheDocument();
  });

  it("saves in place", async () => {
    open("SALARY", finished, salary);
    setAmount("21200");
    await save();
    await waitFor(() => expect(api.updateEmployeePayment).toHaveBeenCalledOnce());
    expect(api.updateEmployeePayment.mock.calls[0][0]).toBe(21);
    expect(api.updateEmployeePayment.mock.calls[0][1]).toMatchObject({ amount: 21200, finish: false });
  });

  it("deletes after asking", async () => {
    open("SALARY", finished, salary);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete this salary?" })).toHaveTextContent("September 2026 will show the difference again.");
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" }).slice(-1)[0]);
    await waitFor(() => expect(api.deleteEmployeePayment).toHaveBeenCalledWith(21));
    expect(onSaved).toHaveBeenCalledWith(null);
  });

  it("warns that deleting a carried amount removes next month's advance", async () => {
    const overpaid = monthDetail({ figures: figures({ earned: 100, given: 200, cleared: 100, balance: 0 }), status: "PAID" });
    open("CARRIED", overpaid, wagePayment({ id: 22, kind: "CARRIED", amount: 100, carried_to: "2026-10", payment_method: null }));
    expect(amount()).toHaveValue(100);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete this taken from next month?" })).toHaveTextContent(
      "The advance on October 2026 goes too, and September 2026 shows the difference again."
    );
  });
});
