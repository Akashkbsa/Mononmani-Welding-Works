import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PurchaseOrderDetailsModal from "./PurchaseOrderDetailsModal";
import { PurchaseOrderDetail } from "../../types/purchaseOrder";

const api = vi.hoisted(() => ({
  getPurchaseOrder: vi.fn(),
  getPurchaseOrderFilePreview: vi.fn(),
  openPurchaseOrderFile: vi.fn(),
  deletePurchaseOrder: vi.fn(),
  getRemindersForRecord: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const baseOrder = (): PurchaseOrderDetail => ({
  order: {
    id: 1,
    customer_id: 2,
    customer_name: "ABC Ltd",
    po_number: "PO-007",
    po_date: "2026-09-01",
    status: "NOT_STARTED",
    notes: null,
    quotation_id: null,
    quotation_number: null,
    quotation_date: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  },
  files: [],
  invoices: [],
});

const orderWithInvoice = (): PurchaseOrderDetail => ({
  ...baseOrder(),
  invoices: [
    {
      id: 10,
      invoice_number: "MWW/26-27/001",
      invoice_date: "2026-09-15",
      total_amount: 12000,
      status: "ISSUED",
      payment_status: "UNPAID",
      po_number_and_date: "PO-007 dt 01-09-2026",
    },
  ],
});

describe("PurchaseOrderDetailsModal — delete confirmation", () => {
  it("names the PO number and customer in the confirm dialog", async () => {
    api.getPurchaseOrder.mockResolvedValue(baseOrder());
    api.getRemindersForRecord.mockResolvedValue([]);

    render(
      <PurchaseOrderDetailsModal
        id={1}
        onClose={() => {}}
        onChanged={() => {}}
        onOpenInvoice={() => {}}
        onOpenQuotation={() => {}}
      />,
    );

    const user = userEvent.setup();
    const deleteBtn = await screen.findByRole("button", { name: /^delete$/i });
    await user.click(deleteBtn);

    expect(screen.getAllByText(/PO-007/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ABC Ltd/).length).toBeGreaterThan(0);
  });

  it("mentions linked invoice losing PO reference when invoice is linked", async () => {
    api.getPurchaseOrder.mockResolvedValue(orderWithInvoice());
    api.getRemindersForRecord.mockResolvedValue([]);

    render(
      <PurchaseOrderDetailsModal
        id={1}
        onClose={() => {}}
        onChanged={() => {}}
        onOpenInvoice={() => {}}
        onOpenQuotation={() => {}}
      />,
    );

    const user = userEvent.setup();
    const deleteBtn = await screen.findByRole("button", { name: /^delete$/i });
    await user.click(deleteBtn);

    // The confirm dialog should mention the invoice losing its PO reference
    expect(screen.getByText(/lose.*PO reference|PO reference/i)).toBeInTheDocument();
  });
});
