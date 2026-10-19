import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InvoiceDetailsModal from "./InvoiceDetailsModal";
import { InvoiceWithItems } from "../../types/invoice";
import { InvoicePaymentSummary } from "../../types/payment";

const api = vi.hoisted(() => ({
  getInvoice: vi.fn(),
  getInvoicePayments: vi.fn(),
  deleteInvoice: vi.fn(),
  printInvoice: vi.fn(),
  printCopies: vi.fn(),
  setInvoiceCancelled: vi.fn(),
  listReminders: vi.fn(),
  createReminder: vi.fn(),
  updateReminder: vi.fn(),
  deleteReminder: vi.fn(),
  dismissReminder: vi.fn(),
  snoozeReminder: vi.fn(),
  getPurchaseOrder: vi.fn(),
  getRemindersForRecord: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const baseInvoice = (): InvoiceWithItems => ({
  invoice: {
    id: 1,
    invoice_number: "MWW/26-27/001",
    invoice_date: "2026-09-01",
    due_date: null,
    payment_terms_days: 30,
    invoice_state: "Puducherry",
    customer_id: 1,
    customer_name: "ABC Ltd",
    customer_address: null,
    customer_phone: null,
    customer_gstin: null,
    customer_state: null,
    customer_state_code: null,
    po_number_and_date: null,
    vehicle_number: null,
    date_of_supply: null,
    place_of_supply: null,
    our_dc_number_and_date: null,
    your_dc_number_and_date: null,
    delivery_note: null,
    supplier_ref: null,
    buyer_ref: null,
    dispatch_doc_no: null,
    delivery_note_date: null,
    dispatch_through: null,
    destination: null,
    terms_of_delivery: null,
    tax_type: "CGST_SGST",
    subtotal: 10000,
    discount: 0,
    cgst_rate: 9,
    cgst_amount: 900,
    sgst_rate: 9,
    sgst_amount: 900,
    igst_rate: 0,
    igst_amount: 0,
    round_off: 0,
    total_amount: 11800,
    amount_in_words: "Eleven thousand eight hundred only",
    bank_name: "",
    bank_branch: "",
    bank_account_no: "",
    bank_ifsc: "",
    terms_and_conditions: null,
    notes: null,
    pdf_path: null,
    status: "ISSUED",
    purchase_order_id: null,
    purchase_order_number: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  },
  items: [],
});

const noPayments = (): InvoicePaymentSummary => ({
  invoice_id: 1,
  total_amount: 11800,
  total_settled: 0,
  outstanding_amount: 11800,
  payment_status: "UNPAID",
  payments: [],
});

const withPayments = (): InvoicePaymentSummary => ({
  ...noPayments(),
  payments: [
    {
      payment_id: 10,
      payment_number: "PAY-001",
      payment_date: "2026-09-15",
      allocated_amount: 5000,
      invoice_total_amount: 11800,
    } as any,
  ],
});

async function openDeleteDialog() {
  const user = userEvent.setup();
  // The footer has a "Delete" dangerText button that opens the confirm dialog
  const deleteBtn = await screen.findByRole("button", { name: /^delete$/i });
  await user.click(deleteBtn);
}

describe("InvoiceDetailsModal — delete confirmation", () => {
  it("names the invoice number, customer and amount when no payments", async () => {
    api.getInvoice.mockResolvedValue(baseInvoice());
    api.getInvoicePayments.mockResolvedValue(noPayments());
    api.getRemindersForRecord.mockResolvedValue([]);

    render(
      <InvoiceDetailsModal
        invoiceId={1}
        onClose={() => {}}
        onChanged={() => {}}
        onOpenQuotation={() => {}}
      />,
    );

    await openDeleteDialog();

    // The confirm dialog renders on top; assert text appears somewhere in the DOM
    expect(screen.getAllByText(/MWW\/26-27\/001/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ABC Ltd/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/₹11,800\.00/).length).toBeGreaterThan(0);
  });

  it("warns about payment count when payments exist", async () => {
    api.getInvoice.mockResolvedValue(baseInvoice());
    api.getInvoicePayments.mockResolvedValue(withPayments());
    api.getRemindersForRecord.mockResolvedValue([]);

    render(
      <InvoiceDetailsModal
        invoiceId={1}
        onClose={() => {}}
        onChanged={() => {}}
        onOpenQuotation={() => {}}
      />,
    );

    await openDeleteDialog();

    expect(screen.getByText(/1 payment/i)).toBeInTheDocument();
    expect(screen.getAllByText(/MWW\/26-27\/001/).length).toBeGreaterThan(0);
  });
});
