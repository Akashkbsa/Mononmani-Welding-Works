import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SupplierBillDetailsModal from "./SupplierBillDetailsModal";
import { SupplierBillDetail } from "../../types/supplierBill";

const api = vi.hoisted(() => ({
  getSupplierBill: vi.fn(),
  getSupplierBillFilePreview: vi.fn(),
  openSupplierBillFile: vi.fn(),
  deleteSupplierBill: vi.fn(),
  getRemindersForRecord: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const baseBill = (): SupplierBillDetail => ({
  bill: {
    id: 1,
    supplier_id: 2,
    supplier_name: "Steel Traders",
    bill_number: "INV-42",
    bill_date: "2026-09-10",
    total_amount: 8000,
    notes: null,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  },
  settled_amount: 0,
  outstanding_amount: 8000,
  status: "NOT_PAID",
  files: [],
  payments: [],
});

const billWithPayments = (): SupplierBillDetail => ({
  ...baseBill(),
  settled_amount: 3000,
  outstanding_amount: 5000,
  status: "PARTIAL",
  payments: [{ payment_id: 5, payment_number: "SPAY-001", payment_date: "2026-09-20", amount_settled: 3000, payment_method: "NEFT", reference_number: null }],
});

describe("SupplierBillDetailsModal — delete confirmation", () => {
  it("names the bill number, supplier and amount in the confirm dialog", async () => {
    api.getSupplierBill.mockResolvedValue(baseBill());
    api.getRemindersForRecord.mockResolvedValue([]);

    render(
      <SupplierBillDetailsModal
        id={1}
        onClose={() => {}}
        onChanged={() => {}}
        onOpenPayment={() => {}}
      />,
    );

    const user = userEvent.setup();
    const deleteBtn = await screen.findByRole("button", { name: /^delete$/i });
    await user.click(deleteBtn);

    expect(screen.getAllByText(/INV-42/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Steel Traders/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/₹8,000\.00/).length).toBeGreaterThan(0);
  });

  it("warns when the bill has payments recorded", async () => {
    api.getSupplierBill.mockResolvedValue(billWithPayments());
    api.getRemindersForRecord.mockResolvedValue([]);

    render(
      <SupplierBillDetailsModal
        id={1}
        onClose={() => {}}
        onChanged={() => {}}
        onOpenPayment={() => {}}
      />,
    );

    const user = userEvent.setup();
    const deleteBtn = await screen.findByRole("button", { name: /^delete$/i });
    await user.click(deleteBtn);

    expect(screen.getByText(/payments recorded/i)).toBeInTheDocument();
  });
});
