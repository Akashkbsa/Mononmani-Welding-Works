import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerPicker from "./CustomerPicker";
import { Customer } from "../types/customer";

const customer = (over: Partial<Customer>): Customer => ({
  id: 1,
  name: "Sample Co",
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
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  party_type: "CUSTOMER",
  whatsapp_number: null,
  ...over,
});

const customers = [
  customer({ id: 1, name: "Anand Steels", city: "Puducherry", phone: "+919876500001", gstin: "34AAAAA0000A1Z5" }),
  customer({ id: 2, name: "Bala Traders", state: "Tamil Nadu" }),
];

describe("CustomerPicker", () => {
  it("labels options with the city and shows GSTIN and phone below", async () => {
    render(<CustomerPicker customers={customers} value={null} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Customer" }));
    expect(screen.getByText("Anand Steels — Puducherry")).toBeInTheDocument();
    expect(screen.getByText("34AAAAA0000A1Z5 · +919876500001")).toBeInTheDocument();
    expect(screen.getByText("Bala Traders")).toBeInTheDocument();
  });

  it("finds a customer by phone, GSTIN or state", async () => {
    render(<CustomerPicker customers={customers} value={null} onChange={() => {}} />);
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "9876500001");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.clear(box);
    await userEvent.type(box, "34aaaaa");
    expect(screen.getByRole("option")).toHaveTextContent("Anand Steels");
    await userEvent.clear(box);
    await userEvent.type(box, "tamil");
    expect(screen.getByRole("option")).toHaveTextContent("Bala Traders");
  });

  it("gives back the whole customer when picked", async () => {
    const onChange = vi.fn();
    render(<CustomerPicker customers={customers} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByText("Bala Traders"));
    expect(onChange).toHaveBeenCalledWith(customers[1]);
  });

  it("uses the noun in the empty text", async () => {
    render(<CustomerPicker customers={customers} value={null} onChange={() => {}} noun="supplier" ariaLabel="Supplier" />);
    await userEvent.type(screen.getByRole("combobox", { name: "Supplier" }), "nobody");
    expect(screen.getByText("No supplier matches. Try another name, phone or GSTIN, or add a new supplier.")).toBeInTheDocument();
  });

  it("shows the selected customer and a fallback for a deleted one", () => {
    const { rerender } = render(<CustomerPicker customers={customers} value={2} onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveValue("Bala Traders");
    rerender(<CustomerPicker customers={customers} value={99} onChange={() => {}} fallbackLabel="Old Co" />);
    expect(screen.getByRole("combobox")).toHaveValue("Old Co");
  });
});
