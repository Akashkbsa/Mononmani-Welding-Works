import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InvoiceFormModal from "./InvoiceFormModal";
import { Customer } from "../../types/customer";
import { Invoice, InvoiceInput, InvoiceWithItems } from "../../types/invoice";
import { PurchaseOrderListItem } from "../../types/purchaseOrder";
import { BusinessSettings } from "../../types/settings";

const api = vi.hoisted(() => ({
  listCustomers: vi.fn(),
  getNextInvoiceNumber: vi.fn(),
  getSettings: vi.fn(),
  listPurchaseOrders: vi.fn(),
  checkDuplicateInvoiceNumber: vi.fn(),
  createInvoice: vi.fn(),
  updateInvoice: vi.fn(),
}));
vi.mock("../../services/api", () => api);

// RichTextBox calls these while typing; jsdom has no editing commands.
Object.defineProperty(document, "execCommand", { value: () => true, configurable: true });

const customer = (over: Partial<Customer>): Customer => ({
  id: 1,
  name: "Anand Steels",
  gstin: "34AAAAA0000A1Z5",
  phone: "+919876500001",
  email: null,
  address_line1: "12 Main Road",
  address_line2: null,
  city: "Puducherry",
  state: "Puducherry",
  postal_code: "605008",
  is_favorite: false,
  last_used_at: null,
  created_at: "",
  updated_at: "",
  party_type: "CUSTOMER",
  whatsapp_number: null,
  ...over,
});

const local = customer({});
const chennai = customer({ id: 2, name: "Bala Traders", gstin: "33BBBBB1111B1Z5", city: "Chennai", state: "Tamil Nadu" });
// Record says Puducherry but the GSTIN is Tamil Nadu's.
const mismatched = customer({ id: 3, name: "Chola Works", gstin: "33CCCCC2222C1Z5", city: "Lawspet", state: "Puducherry" });

const settings: BusinessSettings = {
  business_name: "MONONMANI WELDING WORKS",
  business_subtitle: "",
  gstin: "",
  phone: "",
  email: "",
  address: "",
  services_banner: "",
  bank_name: "Test Bank",
  bank_branch: "Main",
  bank_account_no: "1234567890",
  bank_ifsc: "TEST0000001",
  terms_and_conditions: "Pay soon",
  cgst_rate: 6,
  sgst_rate: 6,
  igst_rate: 12,
};

const order = (over: Partial<PurchaseOrderListItem>): PurchaseOrderListItem =>
  ({ id: 50, po_number: "PO-77", po_date: "2026-10-01", customer_id: 1, status: "NOT_STARTED", ...over }) as PurchaseOrderListItem;

function savedInvoice(over: Partial<Invoice> = {}): InvoiceWithItems {
  const invoice = {
    id: 9,
    invoice_number: "MWW/26-27/009",
    invoice_date: "2026-10-10",
    due_date: "2026-11-09",
    payment_terms_days: 30,
    invoice_state: "Puducherry",
    customer_id: 1,
    customer_name: "Anand Steels",
    customer_address: "12 Main Road, Puducherry",
    customer_phone: null,
    customer_gstin: "34AAAAA0000A1Z5",
    customer_state: "Puducherry",
    customer_state_code: "34",
    po_number_and_date: null,
    vehicle_number: null,
    date_of_supply: "10-10-2026",
    place_of_supply: "Puducherry",
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
    subtotal: 1000,
    discount: 0,
    cgst_rate: 9,
    cgst_amount: 90,
    sgst_rate: 9,
    sgst_amount: 90,
    igst_rate: 18,
    igst_amount: 0,
    round_off: 0,
    total_amount: 1180,
    amount_in_words: "",
    bank_name: "Indian Bank",
    bank_branch: "Mettupalayam (PONDY)",
    bank_account_no: "498877880",
    bank_ifsc: "IDIB000M070",
    terms_and_conditions: "Terms",
    status: "ISSUED",
    notes: null,
    pdf_path: null,
    purchase_order_id: null,
    purchase_order_number: null,
    created_at: "",
    updated_at: "",
    ...over,
  } as Invoice;
  return {
    invoice,
    items: [{ id: 1, invoice_id: 9, sl_no: 1, description: "Gate welding", hsn_sac: "7308", qum: "NOS", quantity: 2, rate: 500, amount: 1000 }],
  };
}

let onClose: Mock<() => void>;
let onSaved: Mock<(saved: InvoiceWithItems, print: boolean) => void>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  Object.values(api).forEach((f) => f.mockReset());
  api.listCustomers.mockResolvedValue([local, chennai, mismatched]);
  api.getNextInvoiceNumber.mockResolvedValue("MWW/26-27/010");
  api.getSettings.mockResolvedValue(settings);
  api.listPurchaseOrders.mockResolvedValue([]);
  api.checkDuplicateInvoiceNumber.mockResolvedValue({ has_duplicate: false });
  api.createInvoice.mockImplementation(async (input: InvoiceInput) => ({ invoice: { id: 100, ...input }, items: [] }));
  api.updateInvoice.mockImplementation(async (id: number, input: InvoiceInput) => ({ invoice: { id, ...input }, items: [] }));
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<(saved: InvoiceWithItems, print: boolean) => void>();
});
afterEach(() => vi.useRealTimers());

const open = async (invoice?: InvoiceWithItems) => {
  render(<InvoiceFormModal invoice={invoice} onClose={onClose} onSaved={onSaved} />);
  await waitFor(() => expect(api.listCustomers).toHaveBeenCalledWith("CUSTOMER"));
  if (!invoice) await screen.findByDisplayValue("MWW/26-27/010");
};

/** The input or select inside the field with this label. */
const field = (label: string) => {
  const el = screen.getByText(label, { selector: "label" }).parentElement!.querySelector("input, select, textarea");
  if (!el) throw new Error(`no control for ${label}`);
  return el as HTMLInputElement;
};

const pickCustomer = async (label: string) => {
  await userEvent.click(screen.getByRole("combobox", { name: "Customer" }));
  await userEvent.click(await screen.findByText(label));
};

const describeLine = (n: number, text: string) => {
  const box = screen.getByRole("textbox", { name: `Description for line ${n}` });
  box.innerHTML = text;
  fireEvent.input(box);
};

const setLine = (n: number, qty: string, rate: string) => {
  fireEvent.change(screen.getByLabelText(`Quantity for line ${n}`), { target: { value: qty } });
  fireEvent.change(screen.getByLabelText(`Rate for line ${n}`), { target: { value: rate } });
};

/** The figure shown next to a label in the totals box. */
const total = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling!.textContent;

const saveButton = () => screen.getByRole("button", { name: "Save" });

describe("a new invoice", () => {
  it("starts with the next number, today's date, and Settings' bank and tax rates", async () => {
    await open();
    expect(screen.getByRole("dialog", { name: "New invoice" })).toBeInTheDocument();
    expect(field("Invoice date")).toHaveValue("2026-10-15");
    expect(field("Status")).toHaveValue("ISSUED");
    expect(screen.getByText("CGST 6% + SGST 6%")).toBeInTheDocument();
    expect(screen.getByText(/Test Bank, A\/c 1234567890/)).toBeInTheDocument();
    // Cancelled is only for invoices already issued.
    expect(within(field("Status")).queryByText("Cancelled")).not.toBeInTheDocument();
  });

  it("keeps a number typed before the next number arrived", async () => {
    let give!: (n: string) => void;
    api.getNextInvoiceNumber.mockReturnValue(new Promise((r) => (give = r)));
    render(<InvoiceFormModal onClose={onClose} onSaved={onSaved} />);
    const number = field("Invoice number");
    fireEvent.change(number, { target: { value: "SPECIAL/1" } });
    give("MWW/26-27/010");
    await waitFor(() => expect(api.getNextInvoiceNumber).toHaveBeenCalled());
    expect(number).toHaveValue("SPECIAL/1");
  });

  it("shows why something failed to load", async () => {
    api.getSettings.mockRejectedValue(new Error("Error: settings table missing"));
    await open();
    expect(await screen.findByRole("alert")).toHaveTextContent("settings table missing");
  });

  it("copies a local customer's details and charges CGST + SGST", async () => {
    await open();
    await pickCustomer("Anand Steels — Puducherry");
    expect(screen.getByText("12 Main Road, Puducherry, Puducherry - 605008")).toBeInTheDocument();
    expect(screen.getByText("GSTIN 34AAAAA0000A1Z5")).toBeInTheDocument();
    expect(screen.getByText("Puducherry (34)")).toBeInTheDocument();
    expect(screen.getByText("Customer state code 34: within Puducherry.")).toBeInTheDocument();
    expect(screen.getByText("CGST 6% + SGST 6%")).toBeInTheDocument();
  });

  it("charges IGST for a customer in another state", async () => {
    await open();
    await pickCustomer("Bala Traders — Chennai");
    expect(screen.getByText("Tamil Nadu (33)")).toBeInTheDocument();
    expect(screen.getByText("Customer state code 33: outside Puducherry.")).toBeInTheDocument();
    expect(screen.getByText("IGST 12%", { selector: "div" })).toBeInTheDocument();
  });

  it("goes by the GSTIN when it disagrees with the customer's state, and says so", async () => {
    await open();
    await pickCustomer("Chola Works — Lawspet");
    expect(screen.getByText(/The customer record says Puducherry, but its GSTIN starts with 33 \(Tamil Nadu\)/)).toBeInTheDocument();
    expect(screen.getByText("Tamil Nadu (33)")).toBeInTheDocument();
    expect(screen.getByText("Customer state code 33: outside Puducherry.")).toBeInTheDocument();
  });

  it("works out line amounts and totals as you type", async () => {
    await open();
    setLine(1, "2", "1500");
    expect(total("Subtotal")).toBe("₹3,000.00");
    expect(total("CGST 6%")).toBe("₹180.00");
    expect(total("SGST 6%")).toBe("₹180.00");
    expect(total("Total")).toBe("₹3,360.00");
  });

  it("rounds half a paisa up, the same as the saved invoice", async () => {
    await open();
    setLine(1, "1", "1.005");
    expect(total("Subtotal")).toBe("₹1.01");
  });

  it("takes a discount off before tax and shows it", async () => {
    await open();
    setLine(1, "1", "1000");
    fireEvent.change(field("Discount (₹)"), { target: { value: "100" } });
    expect(total("Discount")).toBe("− ₹100.00");
    expect(total("Total")).toBe("₹1,008.00");
  });

  it("switches to IGST by hand", async () => {
    await open();
    setLine(1, "1", "1000");
    fireEvent.change(field("Tax"), { target: { value: "IGST" } });
    expect(total("IGST 12%")).toBe("₹120.00");
    expect(screen.queryByText("CGST 6%", { selector: "dt" })).not.toBeInTheDocument();
    expect(total("Total")).toBe("₹1,120.00");
  });

  it("adds and removes lines, but always keeps one", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Remove line 1" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    setLine(1, "1", "100");
    setLine(2, "1", "50");
    expect(total("Subtotal")).toBe("₹150.00");
    await userEvent.click(screen.getByRole("button", { name: "Remove line 1" }));
    expect(screen.queryByLabelText("Quantity for line 2")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Rate for line 1")).toHaveValue(50);
    expect(total("Subtotal")).toBe("₹50.00");
  });

  it("warns when the invoice number is already used", async () => {
    api.checkDuplicateInvoiceNumber.mockResolvedValue({ has_duplicate: true });
    await open();
    fireEvent.blur(field("Invoice number"));
    expect(await screen.findByText("This number is already used.")).toBeInTheDocument();
    expect(api.checkDuplicateInvoiceNumber).toHaveBeenCalledWith("MWW/26-27/010", undefined);
    fireEvent.change(field("Invoice number"), { target: { value: "MWW/26-27/011" } });
    expect(screen.queryByText("This number is already used.")).not.toBeInTheDocument();
  });

  describe("refuses to save", () => {
    it("without a customer", async () => {
      await open();
      await userEvent.click(saveButton());
      expect(screen.getByRole("alert")).toHaveTextContent("Choose a customer, or add a new one.");
      expect(api.createInvoice).not.toHaveBeenCalled();
    });

    it("without an invoice number", async () => {
      await open();
      await pickCustomer("Anand Steels — Puducherry");
      fireEvent.change(field("Invoice number"), { target: { value: "  " } });
      await userEvent.click(saveButton());
      expect(screen.getByRole("alert")).toHaveTextContent("Enter an invoice number.");
    });

    it("with a line that has no description", async () => {
      await open();
      await pickCustomer("Anand Steels — Puducherry");
      await userEvent.click(screen.getByRole("button", { name: "Add line" }));
      describeLine(1, "Gate");
      describeLine(2, "<b></b>");
      await userEvent.click(saveButton());
      expect(screen.getByRole("alert")).toHaveTextContent("Line 2 needs a description.");
    });

    it("with a quantity of zero", async () => {
      await open();
      await pickCustomer("Anand Steels — Puducherry");
      describeLine(1, "Gate");
      setLine(1, "0", "100");
      await userEvent.click(saveButton());
      expect(screen.getByRole("alert")).toHaveTextContent("Every line needs a quantity above zero.");
    });

    it("with a discount bigger than the subtotal", async () => {
      await open();
      await pickCustomer("Anand Steels — Puducherry");
      describeLine(1, "Gate");
      setLine(1, "1", "100");
      fireEvent.change(field("Discount (₹)"), { target: { value: "100.01" } });
      await userEvent.click(saveButton());
      expect(screen.getByRole("alert")).toHaveTextContent("Discount cannot be more than the subtotal.");
    });

    it("with a vehicle number that is not Indian", async () => {
      await open();
      await pickCustomer("Anand Steels — Puducherry");
      describeLine(1, "Gate");
      await userEvent.click(screen.getByRole("button", { name: "Delivery details" }));
      const vehicle = field("Vehicle number");
      fireEvent.change(vehicle, { target: { value: "abc" } });
      expect(vehicle).toHaveValue("ABC");
      fireEvent.blur(vehicle);
      expect(screen.getByText("Not a valid Indian vehicle number. Example: TN 09 AB 1234.", { selector: "p" })).toBeInTheDocument();
      await userEvent.click(saveButton());
      expect(screen.getByRole("alert")).toHaveTextContent("Not a valid Indian vehicle number.");
      expect(api.createInvoice).not.toHaveBeenCalled();
    });
  });

  it("writes a vehicle number in the standard form when leaving the box", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Delivery details" }));
    const vehicle = field("Vehicle number");
    fireEvent.change(vehicle, { target: { value: "tn09ab1234" } });
    fireEvent.blur(vehicle);
    expect(vehicle).toHaveValue("TN 09 AB 1234");
  });

  it("saves a cleaned-up invoice and reports it", async () => {
    await open();
    await pickCustomer("Anand Steels — Puducherry");
    describeLine(1, "<b>Gate</b> welding");
    fireEvent.change(screen.getByLabelText("HSN/SAC for line 1"), { target: { value: "7308" } });
    setLine(1, "2", "1500");
    fireEvent.change(field("Internal note"), { target: { value: "   " } });
    await userEvent.click(screen.getByRole("button", { name: "Delivery details" }));
    fireEvent.change(screen.getByLabelText("Our DC number & date: number"), { target: { value: " DC-5 " } });
    fireEvent.change(screen.getByLabelText("Our DC number & date: date"), { target: { value: "2026-10-14" } });
    await userEvent.click(saveButton());

    await waitFor(() => expect(api.createInvoice).toHaveBeenCalledOnce());
    const input: InvoiceInput = api.createInvoice.mock.calls[0][0];
    expect(input).toMatchObject({
      invoice_number: "MWW/26-27/010",
      invoice_date: "2026-10-15",
      customer_id: 1,
      customer_name: "Anand Steels",
      customer_state_code: "34",
      tax_type: "CGST_SGST",
      cgst_rate: 6,
      sgst_rate: 6,
      discount: 0,
      bank_name: "Test Bank",
      terms_and_conditions: "Pay soon",
      our_dc_number_and_date: "DC-5 & 14-10-2026",
      notes: null,
      vehicle_number: null,
      status: "ISSUED",
    });
    expect(input.items).toEqual([{ description: "<b>Gate</b> welding", hsn_sac: "7308", qum: "NOS", quantity: 2, rate: 1500 }]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ invoice: expect.objectContaining({ id: 100 }) }), false);
  });

  it("Save and print asks for the PDF too", async () => {
    await open();
    await pickCustomer("Anand Steels — Puducherry");
    describeLine(1, "Gate");
    setLine(1, "1", "100");
    await userEvent.click(screen.getByRole("button", { name: "Save and print" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.anything(), true));
  });

  it("shows the backend's refusal and lets you try again", async () => {
    api.createInvoice.mockRejectedValueOnce(new Error("Invoice number MWW/26-27/010 already exists."));
    await open();
    await pickCustomer("Anand Steels — Puducherry");
    describeLine(1, "Gate");
    setLine(1, "1", "100");
    await userEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Invoice number MWW/26-27/010 already exists.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
  });

  it("asks before throwing away typed work", async () => {
    await open();
    setLine(1, "3", "10");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard your changes?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes straight away when nothing was changed", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("purchase orders", () => {
  it("lists the chosen customer's orders and fills the PO text from one", async () => {
    api.listPurchaseOrders.mockResolvedValue([order({})]);
    await open();
    await pickCustomer("Anand Steels — Puducherry");
    await waitFor(() => expect(api.listPurchaseOrders).toHaveBeenCalledWith({ customer_id: 1 }));
    await userEvent.click(screen.getByRole("combobox", { name: "Purchase order" }));
    await userEvent.click(await screen.findByText("PO-77 — 01-10-2026"));
    expect(screen.getByText("The PO number & date below are filled from this order.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delivery details" }));
    const poNumber = screen.getByLabelText("PO number & date: number");
    expect(poNumber).toHaveValue("PO-77");
    expect(poNumber).toBeDisabled();
  });

  it("says when the customer has no orders", async () => {
    await open();
    await pickCustomer("Anand Steels — Puducherry");
    expect(await screen.findByText("This customer has no purchase orders yet. You can add one under Purchase orders.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Purchase order" })).toBeDisabled();
  });

  it("drops another customer's order and its PO text when the customer changes", async () => {
    api.listPurchaseOrders.mockImplementation(async ({ customer_id }: { customer_id: number }) =>
      customer_id === 1 ? [order({})] : []
    );
    await open();
    await pickCustomer("Anand Steels — Puducherry");
    await userEvent.click(await screen.findByRole("combobox", { name: "Purchase order" }));
    await userEvent.click(await screen.findByText("PO-77 — 01-10-2026"));
    await pickCustomer("Bala Traders — Chennai");
    await userEvent.click(screen.getByRole("button", { name: "Delivery details" }));
    expect(screen.getByLabelText("PO number & date: number")).toHaveValue("");
    expect(screen.getByLabelText("PO number & date: number")).toBeEnabled();
  });

  it("Remove unlinks the order but keeps its text to edit", async () => {
    api.listPurchaseOrders.mockResolvedValue([order({})]);
    await open();
    await pickCustomer("Anand Steels — Puducherry");
    await userEvent.click(await screen.findByRole("combobox", { name: "Purchase order" }));
    await userEvent.click(await screen.findByText("PO-77 — 01-10-2026"));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Delivery details" }));
    expect(screen.getByLabelText("PO number & date: number")).toHaveValue("PO-77");
    expect(screen.getByLabelText("PO number & date: number")).toBeEnabled();
  });
});

describe("editing an invoice", () => {
  it("shows the saved invoice and saves it in place", async () => {
    await open(savedInvoice());
    expect(screen.getByRole("dialog", { name: "Edit invoice MWW/26-27/009" })).toBeInTheDocument();
    expect(api.getNextInvoiceNumber).not.toHaveBeenCalled();
    expect(api.getSettings).not.toHaveBeenCalled();
    expect(field("Invoice number")).toHaveValue("MWW/26-27/009");
    expect(screen.getByLabelText("Quantity for line 1")).toHaveValue(2);
    expect(total("Total")).toBe("₹1,180.00");
    expect(within(field("Status")).getByText("Cancelled")).toBeInTheDocument();

    setLine(1, "3", "500");
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.updateInvoice).toHaveBeenCalledOnce());
    const [id, input] = api.updateInvoice.mock.calls[0];
    expect(id).toBe(9);
    expect(input.items[0]).toMatchObject({ description: "Gate welding", quantity: 3, rate: 500 });
    // The backend works out the due date again from the invoice date.
    expect(input.due_date).toBeUndefined();
    // Bank details stay as saved on the invoice.
    expect(input.bank_name).toBe("Indian Bank");
  });

  it("checks the number against other invoices only", async () => {
    await open(savedInvoice());
    fireEvent.blur(field("Invoice number"));
    await waitFor(() => expect(api.checkDuplicateInvoiceNumber).toHaveBeenCalledWith("MWW/26-27/009", 9));
  });

  it("keeps an old vehicle number that predates the check", async () => {
    await open(savedInvoice({ vehicle_number: "OLD-VAN" }));
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.updateInvoice).toHaveBeenCalled());
    expect(api.updateInvoice.mock.calls[0][1].vehicle_number).toBe("OLD-VAN");
  });

  it("can be saved when the customer was deleted, showing the saved name", async () => {
    await open(savedInvoice({ customer_id: null, customer_name: "Gone Co" }));
    expect(screen.getByRole("combobox", { name: "Customer" })).toHaveValue("Gone Co");
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.updateInvoice).toHaveBeenCalled());
  });

  it("fixes the customer while the invoice is linked to a purchase order", async () => {
    api.listPurchaseOrders.mockResolvedValue([order({ id: 50 })]);
    await open(savedInvoice({ purchase_order_id: 50, purchase_order_number: "PO-77", po_number_and_date: "PO-77 & 01-10-2026" }));
    expect(screen.getByRole("combobox", { name: "Customer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    expect(screen.getByText(/linked to a purchase order, so its customer is fixed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("combobox", { name: "Customer" })).toBeEnabled();
  });
});
