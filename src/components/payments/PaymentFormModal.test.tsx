import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentFormModal from "./PaymentFormModal";
import { Customer } from "../../types/customer";
import { Payment, PaymentInput, PaymentWithAllocations, UnpaidInvoice } from "../../types/payment";

const api = vi.hoisted(() => ({
  listCustomers: vi.fn(),
  getNextPaymentNumber: vi.fn(),
  getUnpaidInvoices: vi.fn(),
  getCustomerCredits: vi.fn(),
  createPayment: vi.fn(),
  updatePayment: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const customer = (id: number, name: string): Customer => ({
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
  party_type: "CUSTOMER",
  whatsapp_number: null,
});

const unpaid = (id: number, number: string, outstanding: number, total = outstanding, taxable = total): UnpaidInvoice => ({
  invoice_id: id,
  invoice_number: number,
  invoice_date: "2026-09-01",
  total_amount: total,
  taxable_amount: taxable,
  total_settled: total - outstanding,
  outstanding_amount: outstanding,
});

const INV1 = unpaid(11, "MWW/26-27/001", 600);
const INV2 = unpaid(12, "MWW/26-27/002", 800);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  Object.values(api).forEach((f) => f.mockReset());
  api.listCustomers.mockResolvedValue([customer(1, "Anand Steels"), customer(2, "Bala Traders")]);
  api.getNextPaymentNumber.mockResolvedValue("PAY/26-27/004");
  api.getUnpaidInvoices.mockImplementation(async (id: number) => (id === 1 ? [INV1, INV2] : []));
  api.getCustomerCredits.mockResolvedValue([]);
  api.createPayment.mockResolvedValue({});
  api.updatePayment.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

let onClose: Mock<() => void>;
let onSaved: Mock<() => void>;

const open = async (props: Partial<Parameters<typeof PaymentFormModal>[0]> = {}) => {
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<() => void>();
  render(<PaymentFormModal onClose={onClose} onSaved={onSaved} {...props} />);
  await waitFor(() => expect(api.listCustomers).toHaveBeenCalledWith("CUSTOMER"));
};

const field = (label: string) => {
  const el = screen.getByText(label, { selector: "label" }).parentElement!.querySelector("input, select, textarea");
  if (!el) throw new Error(`no control for ${label}`);
  return el as HTMLInputElement;
};

const pickCustomer = async (name: string) => {
  await userEvent.click(screen.getByRole("combobox", { name: "Customer" }));
  await userEvent.click(await screen.findByText(name));
  await screen.findByText(/Apply to invoices/);
};

const received = (v: string) => fireEvent.change(field("Amount received (₹)"), { target: { value: v } });
const tick = (number: string) => fireEvent.click(screen.getByLabelText(`Apply to ${number}`));
const applyBox = (number: string) => screen.getByLabelText(`Amount for ${number}`) as HTMLInputElement;
const summary = (label: string) => screen.getByText(label, { selector: "span" }).nextElementSibling!.textContent;
const record = () => userEvent.click(screen.getByRole("button", { name: "Record payment" }));
const sent = (): PaymentInput => api.createPayment.mock.calls[0][0];

describe("recording a payment", () => {
  it("starts with the next number and today's date", async () => {
    await open();
    expect(await screen.findByDisplayValue("PAY/26-27/004")).toBeInTheDocument();
    expect(field("Date received")).toHaveValue("2026-10-15");
    expect(field("Method")).toHaveValue("Bank Transfer");
    expect(screen.getByText("Choose a customer to see their unpaid invoices.")).toBeInTheDocument();
  });

  it("lists the customer's unpaid invoices with their balances", async () => {
    await open();
    await pickCustomer("Anand Steels");
    expect(api.getUnpaidInvoices).toHaveBeenCalledWith(1, undefined);
    expect(await screen.findByText("MWW/26-27/001")).toBeInTheDocument();
    expect(screen.getByText("₹600.00")).toBeInTheDocument();
    expect(screen.getByText("₹800.00")).toBeInTheDocument();
  });

  it("says the money becomes an advance when nothing is owed", async () => {
    await open();
    await pickCustomer("Bala Traders");
    expect(await screen.findByText("This customer has no unpaid invoices. The amount will be kept as an advance.")).toBeInTheDocument();
  });

  it("ticking an invoice applies what the money covers, up to its balance", async () => {
    await open();
    await pickCustomer("Anand Steels");
    received("1000");
    tick("MWW/26-27/002");
    expect(applyBox("MWW/26-27/002")).toHaveValue(800);
    tick("MWW/26-27/001");
    expect(applyBox("MWW/26-27/001")).toHaveValue(200);
    expect(summary("Applied to invoices")).toBe("₹1,000.00");
    tick("MWW/26-27/002");
    expect(screen.queryByLabelText("Amount for MWW/26-27/002")).not.toBeInTheDocument();
  });

  it("Fill oldest first spreads the money in order", async () => {
    await open();
    await pickCustomer("Anand Steels");
    received("1000");
    await userEvent.click(await screen.findByRole("button", { name: "Fill oldest first" }));
    expect(applyBox("MWW/26-27/001")).toHaveValue(600);
    expect(applyBox("MWW/26-27/002")).toHaveValue(400);
  });

  it("saves the payment with its allocations", async () => {
    await open();
    await pickCustomer("Anand Steels");
    received("1400");
    fireEvent.change(field("Method"), { target: { value: "Cheque" } });
    fireEvent.change(field("Cheque number"), { target: { value: " 004512 " } });
    fireEvent.click(screen.getByLabelText(/Money is in the bank/));
    await userEvent.click(screen.getByRole("button", { name: "Fill oldest first" }));
    await record();
    await waitFor(() => expect(api.createPayment).toHaveBeenCalledOnce());
    expect(sent()).toEqual({
      payment_number: "PAY/26-27/004",
      customer_id: 1,
      payment_date: "2026-10-15",
      payment_method: "Cheque",
      reference_number: "004512",
      bank_name: null,
      amount_received: 1400,
      tds_amount: 0,
      tds_recognized: true,
      credit_to_apply: 0,
      is_verified: false,
      remarks: null,
      allocations: [
        { invoice_id: 11, allocated_amount: 600 },
        { invoice_id: 12, allocated_amount: 800 },
      ],
      excess_action: "NONE",
      writeoff_amount: 0,
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("changing the customer clears the ticked invoices", async () => {
    await open();
    await pickCustomer("Anand Steels");
    received("100");
    tick("MWW/26-27/001");
    await pickCustomer("Bala Traders");
    await pickCustomer("Anand Steels");
    expect(await screen.findByLabelText("Apply to MWW/26-27/001")).not.toBeChecked();
  });

  describe("money left over", () => {
    it("is kept as an advance by default", async () => {
      await open();
      await pickCustomer("Anand Steels");
      received("700");
      tick("MWW/26-27/001");
      expect(summary("Left over")).toBe("₹100.00");
      expect(screen.getByLabelText("Keep as advance for future invoices")).toBeChecked();
      await record();
      await waitFor(() => expect(api.createPayment).toHaveBeenCalled());
      expect(sent().excess_action).toBe("CREDIT");
    });

    it("can be marked refunded", async () => {
      await open();
      await pickCustomer("Anand Steels");
      received("700");
      tick("MWW/26-27/001");
      fireEvent.click(screen.getByLabelText("Refunded to customer"));
      await record();
      await waitFor(() => expect(api.createPayment).toHaveBeenCalled());
      expect(sent().excess_action).toBe("REFUND");
    });

    it("suggests a round-off for a small extra amount", async () => {
      await open();
      await pickCustomer("Anand Steels");
      received("620");
      tick("MWW/26-27/001");
      expect(screen.getByText('Looks like a rounded-up payment? Choose "Keep as round-off".')).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("Keep as round-off"));
      expect(screen.getByText(/not held as an advance and not owed back/)).toBeInTheDocument();
      await record();
      await waitFor(() => expect(api.createPayment).toHaveBeenCalled());
      expect(sent().excess_action).toBe("ROUNDOFF");
    });

    it("all goes to advance when the customer owes nothing", async () => {
      await open();
      await pickCustomer("Bala Traders");
      received("5000");
      await record();
      await waitFor(() => expect(api.createPayment).toHaveBeenCalled());
      expect(sent()).toMatchObject({ allocations: [], excess_action: "CREDIT", amount_received: 5000 });
    });
  });

  describe("paying less than applied", () => {
    it("refuses to save until the short amount is written off", async () => {
      await open();
      await pickCustomer("Anand Steels");
      received("590");
      tick("MWW/26-27/001");
      fireEvent.change(applyBox("MWW/26-27/001"), { target: { value: "600" } });
      expect(summary("Short")).toBe("₹10.00");
      expect(screen.getByText("Applied is ₹10.00 more than the money available.")).toBeInTheDocument();
      await record();
      expect(screen.getByRole("alert")).toHaveTextContent(`You've allocated ₹10.00 more than was received. Tick "Settle in full"`);
      expect(api.createPayment).not.toHaveBeenCalled();
    });

    it("writes off exactly what is short once settled in full", async () => {
      await open();
      await pickCustomer("Anand Steels");
      received("590");
      tick("MWW/26-27/001");
      fireEvent.change(applyBox("MWW/26-27/001"), { target: { value: "600" } });
      fireEvent.click(screen.getByLabelText(/Settle in full: write off ₹10.00/));
      expect(summary("Written off")).toBe("₹10.00");
      expect(screen.queryByText(/large amount to write off/)).not.toBeInTheDocument();
      await record();
      await waitFor(() => expect(api.createPayment).toHaveBeenCalled());
      expect(sent()).toMatchObject({ amount_received: 590, writeoff_amount: 10, excess_action: "NONE" });
    });

    it("warns about a large write-off", async () => {
      await open();
      await pickCustomer("Anand Steels");
      received("400");
      tick("MWW/26-27/001");
      fireEvent.change(applyBox("MWW/26-27/001"), { target: { value: "600" } });
      fireEvent.click(screen.getByLabelText(/Settle in full: write off ₹200.00/));
      expect(screen.getByText("That is a large amount to write off. Check it is right.")).toBeInTheDocument();
    });

    it("forgets the write-off once nothing is short", async () => {
      await open();
      await pickCustomer("Anand Steels");
      received("590");
      tick("MWW/26-27/001");
      fireEvent.change(applyBox("MWW/26-27/001"), { target: { value: "600" } });
      fireEvent.click(screen.getByLabelText(/Settle in full: write off ₹10.00/));
      received("600");
      received("590");
      expect(screen.getByLabelText(/Settle in full: write off ₹10.00/)).not.toBeChecked();
    });

    it("offers to settle a small balance left on an invoice", async () => {
      await open();
      await pickCustomer("Anand Steels");
      received("580");
      tick("MWW/26-27/001");
      expect(screen.getByText("Invoice MWW/26-27/001 will still show ₹20.00 due.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Settle in full" }));
      expect(applyBox("MWW/26-27/001")).toHaveValue(600);
      expect(summary("Written off")).toBe("₹20.00");
    });

    it("does not offer it for a big balance", async () => {
      await open();
      await pickCustomer("Anand Steels");
      received("200");
      tick("MWW/26-27/002");
      expect(screen.queryByText(/will still show/)).not.toBeInTheDocument();
    });
  });

  describe("refuses to save", () => {
    it("without a customer", async () => {
      await open();
      received("100");
      await record();
      expect(screen.getByRole("alert")).toHaveTextContent("Choose the customer who paid.");
    });

    it("without an amount", async () => {
      await open();
      await pickCustomer("Bala Traders");
      await record();
      expect(screen.getByRole("alert")).toHaveTextContent("Enter the amount received.");
    });

    it("with a negative amount", async () => {
      await open();
      await pickCustomer("Bala Traders");
      received("-5");
      await record();
      expect(screen.getByRole("alert")).toHaveTextContent("Amounts cannot be negative.");
    });

    it("when more is applied to an invoice than it owes", async () => {
      await open();
      await pickCustomer("Anand Steels");
      received("1000");
      tick("MWW/26-27/001");
      fireEvent.change(applyBox("MWW/26-27/001"), { target: { value: "650" } });
      expect(applyBox("MWW/26-27/001").className).toContain("border-red-400");
      await record();
      expect(screen.getByRole("alert")).toHaveTextContent("The amount for invoice MWW/26-27/001 is more than its balance.");
    });
  });

  it("shows the backend's refusal and stays open", async () => {
    api.createPayment.mockRejectedValueOnce(new Error("Payment number already used."));
    await open();
    await pickCustomer("Bala Traders");
    received("100");
    await record();
    expect(await screen.findByRole("alert")).toHaveTextContent("Payment number already used.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("TDS", () => {
  // Invoice of ₹1,180: ₹1,000 before GST, so 2% TDS on it is ₹20.
  const GST_INVOICE = unpaid(21, "MWW/26-27/021", 1180, 1180, 1000);

  beforeEach(() => api.getUnpaidInvoices.mockResolvedValue([GST_INVOICE]));

  it("as an amount, counts towards the invoices", async () => {
    await open();
    await pickCustomer("Anand Steels");
    fireEvent.click(screen.getByLabelText("TDS was deducted"));
    fireEvent.click(screen.getByRole("button", { name: "₹ amount" }));
    received("1160");
    fireEvent.change(field("TDS amount (₹)"), { target: { value: "20" } });
    tick("MWW/26-27/021");
    expect(applyBox("MWW/26-27/021")).toHaveValue(1180);
    expect(summary("TDS")).toBe("₹20.00");
    await record();
    await waitFor(() => expect(api.createPayment).toHaveBeenCalled());
    expect(sent()).toMatchObject({ amount_received: 1160, tds_amount: 20, tds_recognized: true, excess_action: "NONE", writeoff_amount: 0 });
  });

  it("not recognised yet, leaves the invoice short by that much", async () => {
    await open();
    await pickCustomer("Anand Steels");
    fireEvent.click(screen.getByLabelText("TDS was deducted"));
    fireEvent.click(screen.getByRole("button", { name: "₹ amount" }));
    received("1160");
    fireEvent.change(field("TDS amount (₹)"), { target: { value: "20" } });
    fireEvent.click(screen.getByLabelText(/Recognise TDS/));
    expect(screen.getByText("Recorded only; the invoices stay unpaid by this amount.")).toBeInTheDocument();
    tick("MWW/26-27/021");
    expect(applyBox("MWW/26-27/021")).toHaveValue(1160);
    expect(summary("TDS (not recognised)")).toBe("₹20.00");
    await record();
    await waitFor(() => expect(api.createPayment).toHaveBeenCalled());
    expect(sent()).toMatchObject({ tds_amount: 20, tds_recognized: false });
  });

  it("as 2% of the amount before GST, sizes the invoice so money plus TDS pays it", async () => {
    await open();
    await pickCustomer("Anand Steels");
    fireEvent.click(screen.getByLabelText("TDS was deducted"));
    expect(screen.getByRole("button", { name: "% of invoice" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Tick the invoices below and the TDS is worked out from them.")).toBeInTheDocument();
    received("1160");
    tick("MWW/26-27/021");
    expect(applyBox("MWW/26-27/021")).toHaveValue(1180);
    expect(summary("TDS")).toBe("₹20.00");
    await record();
    await waitFor(() => expect(api.createPayment).toHaveBeenCalled());
    expect(sent()).toMatchObject({ amount_received: 1160, tds_amount: 20, allocations: [{ invoice_id: 21, allocated_amount: 1180 }] });
  });

  it("as a percentage of a part payment, takes TDS on that part only", async () => {
    await open();
    await pickCustomer("Anand Steels");
    fireEvent.click(screen.getByLabelText("TDS was deducted"));
    received("580");
    tick("MWW/26-27/021");
    // ₹590 of the invoice is half of it, so half the TDS: ₹10; ₹580 + ₹10 pays ₹590.
    expect(applyBox("MWW/26-27/021")).toHaveValue(590);
    expect(summary("TDS")).toBe("₹10.00");
  });

  it("on the invoice total with GST when chosen", async () => {
    await open();
    await pickCustomer("Anand Steels");
    fireEvent.click(screen.getByLabelText("TDS was deducted"));
    fireEvent.change(field("TDS is taken on"), { target: { value: "total" } });
    received("1156.4");
    tick("MWW/26-27/021");
    // 2% of ₹1,180 is ₹23.60.
    expect(summary("TDS")).toBe("₹23.60");
    expect(applyBox("MWW/26-27/021")).toHaveValue(1180);
  });

  it("offers the amount the customer should pay after TDS", async () => {
    await open();
    await pickCustomer("Anand Steels");
    fireEvent.click(screen.getByLabelText("TDS was deducted"));
    tick("MWW/26-27/021");
    expect(screen.getByText("After TDS the customer should pay ₹1,160.00 for these invoices.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set amount received" }));
    expect(field("Amount received (₹)")).toHaveValue(1160);
  });

  it("needs a rate when Other is chosen", async () => {
    await open();
    await pickCustomer("Anand Steels");
    fireEvent.click(screen.getByLabelText("TDS was deducted"));
    fireEvent.change(field("TDS rate"), { target: { value: "other" } });
    expect(screen.getByLabelText("TDS rate in percent")).toHaveFocus();
    received("100");
    await record();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a TDS rate between 0 and 100 percent.");
  });
});

describe("advance from earlier payments", () => {
  beforeEach(() =>
    api.getCustomerCredits.mockResolvedValue([
      { id: 1, customer_id: 1, source_payment_id: 3, source_payment_number: "PAY/1", original_amount: 500, remaining_amount: 200, created_at: "" },
      { id: 2, customer_id: 1, source_payment_id: 4, source_payment_number: "PAY/2", original_amount: 100, remaining_amount: 100, created_at: "" },
    ])
  );

  it("covers what is applied beyond the money received", async () => {
    await open();
    await pickCustomer("Anand Steels");
    const use = await screen.findByLabelText(/Use advance from earlier payments \(₹300.00 available\)/);
    received("1100");
    fireEvent.click(use);
    await userEvent.click(screen.getByRole("button", { name: "Fill oldest first" }));
    expect(applyBox("MWW/26-27/001")).toHaveValue(600);
    expect(applyBox("MWW/26-27/002")).toHaveValue(800);
    expect(summary("Advance used")).toBe("₹300.00");
    await record();
    await waitFor(() => expect(api.createPayment).toHaveBeenCalled());
    expect(sent()).toMatchObject({ amount_received: 1100, credit_to_apply: 300, writeoff_amount: 0, excess_action: "NONE" });
  });

  it("can pay an invoice from the advance alone", async () => {
    await open();
    await pickCustomer("Anand Steels");
    fireEvent.click(await screen.findByLabelText(/Use advance/));
    tick("MWW/26-27/001");
    expect(applyBox("MWW/26-27/001")).toHaveValue(300);
    await record();
    await waitFor(() => expect(api.createPayment).toHaveBeenCalled());
    expect(sent()).toMatchObject({ amount_received: 0, credit_to_apply: 300, allocations: [{ invoice_id: 11, allocated_amount: 300 }] });
  });
});

describe("opened from an invoice", () => {
  it("starts with that invoice ticked for its full balance", async () => {
    await open({ initialCustomerId: 1, initialInvoiceId: 12 });
    expect(await screen.findByLabelText("Amount for MWW/26-27/002")).toHaveValue(800);
    expect(field("Amount received (₹)")).toHaveValue(800);
    expect(screen.getByLabelText("Apply to MWW/26-27/001")).not.toBeChecked();
  });
});

describe("editing a payment", () => {
  const existing = (over: Partial<Payment> = {}): PaymentWithAllocations => ({
    payment: {
      id: 7,
      payment_number: "PAY/26-27/003",
      customer_id: 1,
      customer_name: "Anand Steels",
      payment_date: "2026-10-05",
      payment_method: "NEFT (old)",
      reference_number: "UTR1",
      bank_name: "SBI",
      amount_received: 600,
      tds_amount: 0,
      tds_recognized: true,
      total_settled: 600,
      credit_applied: 0,
      excess_amount: 0,
      excess_action: "NONE",
      writeoff_amount: 0,
      advance_used: 0,
      is_verified: true,
      remarks: "first part",
      created_at: "",
      updated_at: "",
      ...over,
    },
    allocations: [{ invoice_id: 11, invoice_number: "MWW/26-27/001", invoice_date: "2026-09-01", invoice_total_amount: 600, allocated_amount: 600 }],
  });

  it("shows the saved payment and saves it in place", async () => {
    await open({ payment: existing() });
    expect(screen.getByRole("dialog", { name: "Edit payment PAY/26-27/003" })).toBeInTheDocument();
    expect(api.getNextPaymentNumber).not.toHaveBeenCalled();
    await waitFor(() => expect(api.getUnpaidInvoices).toHaveBeenCalledWith(1, 7));
    expect(api.getCustomerCredits).toHaveBeenCalledWith(1, 7);
    expect(screen.getByRole("combobox", { name: "Customer" })).toBeDisabled();
    expect(field("Payment number")).toBeDisabled();
    // A method no longer in the list still shows.
    expect(field("Method")).toHaveValue("NEFT (old)");
    expect(await screen.findByLabelText("Amount for MWW/26-27/001")).toHaveValue(600);

    received("650");
    fireEvent.change(applyBox("MWW/26-27/001"), { target: { value: "600" } });
    fireEvent.click(screen.getByLabelText("Refunded to customer"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updatePayment).toHaveBeenCalledOnce());
    const [id, input] = api.updatePayment.mock.calls[0];
    expect(id).toBe(7);
    expect(input).toMatchObject({
      payment_number: null,
      payment_method: "NEFT (old)",
      bank_name: "SBI",
      amount_received: 650,
      remarks: "first part",
      excess_action: "REFUND",
    });
  });

  it("starts with the saved write-off ticked", async () => {
    await open({ payment: existing({ amount_received: 590, writeoff_amount: 10, total_settled: 600 }) });
    expect(await screen.findByLabelText(/Settle in full: write off ₹10.00/)).toBeChecked();
  });

  it("says when its advance was already used later", async () => {
    await open({ payment: existing({ amount_received: 1000, excess_amount: 400, excess_action: "CREDIT", advance_used: 150 }) });
    expect(await screen.findByText("₹150.00 of this advance has already been used by a later payment.")).toBeInTheDocument();
  });

  it("starts in TDS amount mode when TDS was recorded", async () => {
    await open({ payment: existing({ tds_amount: 12 }) });
    expect(screen.getByLabelText("TDS was deducted")).toBeChecked();
    expect(screen.getByRole("button", { name: "₹ amount" })).toHaveAttribute("aria-pressed", "true");
    expect(field("TDS amount (₹)")).toHaveValue(12);
  });
});
