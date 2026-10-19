import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerDetailsModal from "./CustomerDetailsModal";
import { Customer } from "../../types/customer";

const api = vi.hoisted(() => ({
  listInvoices: vi.fn(),
  listPayments: vi.fn(),
  getCustomerCredits: vi.fn(),
  listSupplierBills: vi.fn(),
  listSupplierPayments: vi.fn(),
  deleteCustomer: vi.fn(),
  getRemindersForRecord: vi.fn(),
  listReminders: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const baseCustomer = (): Customer => ({
  id: 1,
  name: "Sri Krishna Engineering Works",
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
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  party_type: "CUSTOMER",
  whatsapp_number: null,
});

describe("CustomerDetailsModal — delete confirmation", () => {
  it("names the company in the delete confirmation", async () => {
    api.listInvoices.mockResolvedValue([]);
    api.listPayments.mockResolvedValue([]);
    api.getCustomerCredits.mockResolvedValue([]);
    api.listSupplierBills.mockResolvedValue([]);
    api.listSupplierPayments.mockResolvedValue([]);
    api.getRemindersForRecord.mockResolvedValue([]);

    render(
      <CustomerDetailsModal
        customer={baseCustomer()}
        onClose={() => {}}
        onEdit={() => {}}
        onDeleted={() => {}}
        onChanged={() => {}}
      />,
    );

    const user = userEvent.setup();
    const deleteBtn = await screen.findByRole("button", { name: /delete company/i });
    await user.click(deleteBtn);

    // Company name must appear in the confirm dialog message
    const strongs = screen.getAllByText(/Sri Krishna Engineering Works/);
    expect(strongs.length).toBeGreaterThan(0);
  });
});
