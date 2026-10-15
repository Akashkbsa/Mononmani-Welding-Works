import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SupplierPaymentFormModal from "./SupplierPaymentFormModal";
import { Customer } from "../../types/customer";
import { SupplierPayment, SupplierPaymentInput, SupplierPaymentWithAllocations, UnpaidBill } from "../../types/supplierPayment";

const api = vi.hoisted(() => ({
  listCustomers: vi.fn(),
  getNextSupplierPaymentNumber: vi.fn(),
  getUnpaidBillsForSupplier: vi.fn(),
  createSupplierPayment: vi.fn(),
  updateSupplierPayment: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const supplier = (id: number, name: string): Customer => ({
  id,
  name,
  gstin: null,
  phone: null,
  email: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  is_favorite: false,
  last_used_at: null,
  created_at: "",
  updated_at: "",
  party_type: "SUPPLIER",
  whatsapp_number: null,
});

const bill = (id: number, number: string, outstanding: number): UnpaidBill => ({
  bill_id: id,
  bill_number: number,
  bill_date: "2026-09-10",
  total_amount: outstanding,
  total_settled: 0,
  outstanding_amount: outstanding,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  Object.values(api).forEach((f) => f.mockReset());
  api.listCustomers.mockResolvedValue([supplier(5, "Steel Depot"), supplier(6, "Gas Agency")]);
  api.getNextSupplierPaymentNumber.mockResolvedValue("SP/26-27/002");
  api.getUnpaidBillsForSupplier.mockImplementation(async (id: number) =>
    id === 5 ? [bill(31, "SD-101", 5000), bill(32, "SD-102", 2500)] : []
  );
  api.createSupplierPayment.mockResolvedValue({});
  api.updateSupplierPayment.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

let onClose: Mock<() => void>;
let onSaved: Mock<() => void>;

const open = async (props: Partial<Parameters<typeof SupplierPaymentFormModal>[0]> = {}) => {
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<() => void>();
  render(<SupplierPaymentFormModal onClose={onClose} onSaved={onSaved} {...props} />);
  await waitFor(() => expect(api.listCustomers).toHaveBeenCalledWith("SUPPLIER"));
};

const field = (label: string) => {
  const el = screen.getByText(label, { selector: "label" }).parentElement!.querySelector("input, select, textarea");
  if (!el) throw new Error(`no control for ${label}`);
  return el as HTMLInputElement;
};

const pickSupplier = async (name: string) => {
  await userEvent.click(screen.getByRole("combobox", { name: "Supplier" }));
  await userEvent.click(await screen.findByText(name));
};

const paid = (v: string) => fireEvent.change(field("Amount paid (₹)"), { target: { value: v } });
const tick = (number: string) => fireEvent.click(screen.getByLabelText(`Apply to ${number}`));
const applyBox = (number: string) => screen.getByLabelText(`Amount for ${number}`) as HTMLInputElement;
const summary = (label: string) => screen.getByText(label, { selector: "span" }).nextElementSibling!.textContent;
const record = () => userEvent.click(screen.getByRole("button", { name: "Record payment" }));
const sent = (): SupplierPaymentInput => api.createSupplierPayment.mock.calls[0][0];

describe("recording a supplier payment", () => {
  it("lists suppliers only and starts with the next number", async () => {
    await open();
    expect(screen.getByRole("dialog", { name: "Record supplier payment" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("SP/26-27/002")).toBeInTheDocument();
    expect(field("Date paid")).toHaveValue("2026-10-15");
    expect(screen.getByText("Choose a supplier to see their unpaid bills.")).toBeInTheDocument();
  });

  it("asks for the bill first when nothing is owed", async () => {
    await open();
    await pickSupplier("Gas Agency");
    expect(await screen.findByText("This supplier has no unpaid bills. Add the supplier's bill first, then record the payment.")).toBeInTheDocument();
  });

  it("applies the money to the ticked bills and saves", async () => {
    await open();
    await pickSupplier("Steel Depot");
    await screen.findByText("SD-101");
    expect(api.getUnpaidBillsForSupplier).toHaveBeenCalledWith(5, undefined);
    paid("6000");
    fireEvent.change(field("Bank (optional)"), { target: { value: " Indian Bank " } });
    await userEvent.click(screen.getByRole("button", { name: "Fill oldest first" }));
    expect(applyBox("SD-101")).toHaveValue(5000);
    expect(applyBox("SD-102")).toHaveValue(1000);
    expect(summary("Applied to bills")).toBe("₹6,000.00");
    await record();
    await waitFor(() => expect(api.createSupplierPayment).toHaveBeenCalledOnce());
    expect(sent()).toEqual({
      payment_number: "SP/26-27/002",
      supplier_id: 5,
      payment_date: "2026-10-15",
      payment_method: "Bank Transfer",
      reference_number: null,
      bank_name: "Indian Bank",
      amount_paid: 6000,
      remarks: null,
      allocations: [
        { bill_id: 31, allocated_amount: 5000 },
        { bill_id: 32, allocated_amount: 1000 },
      ],
      writeoff_amount: 0,
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("ticking a bill applies what the money still covers", async () => {
    await open();
    await pickSupplier("Steel Depot");
    paid("3000");
    tick("SD-102");
    tick("SD-101");
    expect(applyBox("SD-102")).toHaveValue(2500);
    expect(applyBox("SD-101")).toHaveValue(500);
  });

  it("counts money paid beyond the bills as a round-off, not an advance", async () => {
    await open();
    await pickSupplier("Steel Depot");
    paid("2510");
    tick("SD-102");
    expect(summary("Left over")).toBe("₹10.00");
    expect(screen.getByText("Counted as paid (a round-off). It is not kept as an advance and nothing is owed back.")).toBeInTheDocument();
    // No choice of advance or refund for suppliers.
    expect(screen.queryByLabelText(/advance/i)).not.toBeInTheDocument();
    await record();
    await waitFor(() => expect(api.createSupplierPayment).toHaveBeenCalled());
    expect(sent()).toMatchObject({ amount_paid: 2510, allocations: [{ bill_id: 32, allocated_amount: 2500 }], writeoff_amount: 0 });
  });

  it("accepts a short payment as full once ticked, however large", async () => {
    await open();
    await pickSupplier("Steel Depot");
    paid("4000");
    tick("SD-101");
    fireEvent.change(applyBox("SD-101"), { target: { value: "5000" } });
    expect(summary("Short")).toBe("₹1,000.00");
    await record();
    expect(screen.getByRole("alert")).toHaveTextContent(`You've applied ₹1,000.00 more than was paid. Tick "Accept as full payment"`);
    fireEvent.click(screen.getByLabelText(/Accept as full payment: write off ₹1,000.00/));
    expect(summary("Written off")).toBe("₹1,000.00");
    await record();
    await waitFor(() => expect(api.createSupplierPayment).toHaveBeenCalled());
    expect(sent()).toMatchObject({ amount_paid: 4000, writeoff_amount: 1000 });
  });

  it("offers to settle the balance left on a bill", async () => {
    await open();
    await pickSupplier("Steel Depot");
    paid("4990");
    tick("SD-101");
    expect(screen.getByText("Bill SD-101 will still show ₹10.00 due.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Settle in full" }));
    expect(applyBox("SD-101")).toHaveValue(5000);
    expect(summary("Written off")).toBe("₹10.00");
  });

  describe("refuses to save", () => {
    it("without a supplier", async () => {
      await open();
      paid("100");
      await record();
      expect(screen.getByRole("alert")).toHaveTextContent("Choose the supplier you paid.");
    });

    it("without an amount", async () => {
      await open();
      await pickSupplier("Steel Depot");
      await record();
      expect(screen.getByRole("alert")).toHaveTextContent("Enter the amount paid.");
    });

    it("when the payment is not applied to a bill", async () => {
      await open();
      await pickSupplier("Steel Depot");
      paid("100");
      await record();
      expect(screen.getByRole("alert")).toHaveTextContent("Choose the bills this payment is for.");
      expect(api.createSupplierPayment).not.toHaveBeenCalled();
    });

    it("when more is applied to a bill than it owes", async () => {
      await open();
      await pickSupplier("Steel Depot");
      paid("9000");
      tick("SD-102");
      fireEvent.change(applyBox("SD-102"), { target: { value: "2600" } });
      await record();
      expect(screen.getByRole("alert")).toHaveTextContent("The amount for bill SD-102 is more than its balance.");
    });
  });

  it("starts with the bill it was opened from", async () => {
    await open({ initialSupplierId: 5, initialBillId: 32 });
    expect(await screen.findByLabelText("Amount for SD-102")).toHaveValue(2500);
    expect(field("Amount paid (₹)")).toHaveValue(2500);
  });

  it("shows the backend's refusal and stays open", async () => {
    api.createSupplierPayment.mockRejectedValueOnce(new Error("Steel Depot is a customer, not a supplier."));
    await open();
    await pickSupplier("Steel Depot");
    paid("100");
    tick("SD-101");
    await record();
    expect(await screen.findByRole("alert")).toHaveTextContent("Steel Depot is a customer, not a supplier.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("editing a supplier payment", () => {
  const existing = (over: Partial<SupplierPayment> = {}): SupplierPaymentWithAllocations => ({
    payment: {
      id: 8,
      payment_number: "SP/26-27/001",
      supplier_id: 5,
      supplier_name: "Steel Depot",
      payment_date: "2026-10-01",
      payment_method: "UPI",
      reference_number: "UPI-1",
      bank_name: null,
      amount_paid: 2000,
      writeoff_amount: 0,
      total_settled: 2000,
      excess_amount: 0,
      excess_action: "NONE",
      remarks: null,
      created_at: "",
      updated_at: "",
      whatsapp_sent_on: null,
      ...over,
    },
    allocations: [{ bill_id: 32, bill_number: "SD-102", bill_date: "2026-09-10", bill_total_amount: 2500, allocated_amount: 2000 }],
  });

  it("shows the saved payment and saves it in place", async () => {
    await open({ payment: existing() });
    expect(screen.getByRole("dialog", { name: "Edit payment SP/26-27/001" })).toBeInTheDocument();
    await waitFor(() => expect(api.getUnpaidBillsForSupplier).toHaveBeenCalledWith(5, 8));
    expect(api.getNextSupplierPaymentNumber).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Supplier" })).toBeDisabled();
    expect(await screen.findByLabelText("Amount for SD-102")).toHaveValue(2000);
    paid("2500");
    fireEvent.change(applyBox("SD-102"), { target: { value: "2500" } });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateSupplierPayment).toHaveBeenCalledOnce());
    const [id, input] = api.updateSupplierPayment.mock.calls[0];
    expect(id).toBe(8);
    expect(input).toMatchObject({ payment_number: null, payment_method: "UPI", reference_number: "UPI-1", amount_paid: 2500 });
  });

  it("starts with a saved write-off ticked", async () => {
    await open({ payment: existing({ amount_paid: 1990, writeoff_amount: 10 }) });
    expect(await screen.findByLabelText(/Accept as full payment: write off ₹10.00/)).toBeChecked();
  });
});
