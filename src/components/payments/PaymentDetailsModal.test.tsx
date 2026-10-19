import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentDetailsModal from "./PaymentDetailsModal";
import { PaymentWithAllocations } from "../../types/payment";

const api = vi.hoisted(() => ({
  getPayment: vi.fn(),
  deletePayment: vi.fn(),
  getRemindersForRecord: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const basePayment = (): PaymentWithAllocations => ({
  payment: {
    id: 1,
    payment_number: "PAY-001",
    customer_id: 1,
    customer_name: "ABC Ltd",
    payment_date: "2026-09-15",
    payment_method: "NEFT",
    reference_number: null,
    bank_name: null,
    amount_received: 5000,
    tds_amount: 0,
    tds_recognized: false,
    total_settled: 5000,
    credit_applied: 0,
    excess_amount: 0,
    excess_action: "NONE",
    writeoff_amount: 0,
    advance_used: 0,
    is_verified: true,
    remarks: null,
    created_at: "2026-09-15T00:00:00Z",
    updated_at: "2026-09-15T00:00:00Z",
  },
  allocations: [],
});

const withAllocations = (): PaymentWithAllocations => ({
  ...basePayment(),
  allocations: [
    {
      invoice_id: 10,
      invoice_number: "MWW/26-27/001",
      invoice_date: "2026-09-01",
      invoice_total_amount: 5000,
      allocated_amount: 5000,
    },
    {
      invoice_id: 11,
      invoice_number: "MWW/26-27/002",
      invoice_date: "2026-09-05",
      invoice_total_amount: 3000,
      allocated_amount: 0,
    },
  ],
});

describe("PaymentDetailsModal — delete confirmation", () => {
  it("names the payment, customer and amount in the confirm dialog", async () => {
    api.getPayment.mockResolvedValue(basePayment());
    api.getRemindersForRecord.mockResolvedValue([]);

    render(<PaymentDetailsModal paymentId={1} onClose={() => {}} onChanged={() => {}} />);

    const user = userEvent.setup();
    const deleteBtn = await screen.findByRole("button", { name: /^delete$/i });
    await user.click(deleteBtn);

    expect(screen.getAllByText(/PAY-001/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ABC Ltd/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/₹5,000\.00/).length).toBeGreaterThan(0);
  });

  it("mentions how many invoices will revert to unpaid when allocations exist", async () => {
    api.getPayment.mockResolvedValue(withAllocations());
    api.getRemindersForRecord.mockResolvedValue([]);

    render(<PaymentDetailsModal paymentId={1} onClose={() => {}} onChanged={() => {}} />);

    const user = userEvent.setup();
    const deleteBtn = await screen.findByRole("button", { name: /^delete$/i });
    await user.click(deleteBtn);

    expect(screen.getByText(/2 invoice/i)).toBeInTheDocument();
  });
});
