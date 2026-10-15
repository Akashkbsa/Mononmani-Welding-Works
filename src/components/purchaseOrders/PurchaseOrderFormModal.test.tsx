import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PurchaseOrderFormModal from "./PurchaseOrderFormModal";
import { ToastProvider } from "../ui";
import { LinkedInvoice, PurchaseOrder, PurchaseOrderDetail, PurchaseOrderInput } from "../../types/purchaseOrder";
import { QuotationListItem } from "../../types/quotation";
import { fileInput, makeCustomer, makeFile, pick } from "../../test/helpers";

const api = vi.hoisted(() => ({
  addPurchaseOrderFile: vi.fn(),
  checkDuplicatePoNumber: vi.fn(),
  createPurchaseOrder: vi.fn(),
  getPurchaseOrder: vi.fn(),
  listCustomers: vi.fn(),
  listQuotations: vi.fn(),
  listUnlinkedInvoicesForCustomer: vi.fn(),
  removePurchaseOrderFile: vi.fn(),
  setInvoicePurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const linked = (over: Partial<LinkedInvoice>): LinkedInvoice => ({
  id: 1,
  invoice_number: "MWW/26-27/001",
  invoice_date: "2026-10-02",
  total_amount: 1180,
  status: "ISSUED",
  payment_status: "UNPAID",
  po_number_and_date: null,
  ...over,
});

const quotation = (id: number, number: string) =>
  ({ id, quotation_number: number, quotation_date: "2026-09-20", customer_id: 1 }) as QuotationListItem;

const order = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 60,
  customer_id: 1,
  customer_name: "Anand Steels",
  po_number: "PO-77",
  po_date: "2026-10-01",
  status: "PARTIAL",
  notes: "Gate job",
  quotation_id: null,
  quotation_number: null,
  quotation_date: null,
  created_at: "",
  updated_at: "",
  ...over,
});

const detail = (over: Partial<PurchaseOrderDetail> = {}, orderOver: Partial<PurchaseOrder> = {}): PurchaseOrderDetail => ({
  order: order(orderOver),
  files: [],
  invoices: [],
  ...over,
});

let onClose: Mock<() => void>;
let onSaved: Mock<(id: number) => void>;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listCustomers.mockResolvedValue([makeCustomer({ id: 1, name: "Anand Steels" }), makeCustomer({ id: 2, name: "Bala Traders" })]);
  api.listUnlinkedInvoicesForCustomer.mockImplementation(async (id: number) =>
    id === 1
      ? [linked({ id: 1 }), linked({ id: 2, invoice_number: "MWW/26-27/002", po_number_and_date: "OLD-PO & 01-09-2026", payment_status: "PAID" })]
      : []
  );
  api.listQuotations.mockImplementation(async ({ customer_id }: { customer_id: number }) =>
    customer_id === 1 ? [quotation(70, "QT/26-27/005")] : []
  );
  api.checkDuplicatePoNumber.mockResolvedValue({ has_duplicate: false, existing_id: null });
  api.createPurchaseOrder.mockResolvedValue(detail({}, { id: 61 }));
  api.updatePurchaseOrder.mockImplementation(async (id: number) => detail({}, { id }));
  api.getPurchaseOrder.mockResolvedValue(detail());
  api.addPurchaseOrderFile.mockResolvedValue({});
  api.setInvoicePurchaseOrder.mockResolvedValue(undefined);
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<(id: number) => void>();
});

const open = async (purchaseOrderId?: number) => {
  render(
    <ToastProvider>
      <PurchaseOrderFormModal purchaseOrderId={purchaseOrderId} onClose={onClose} onSaved={onSaved} />
    </ToastProvider>
  );
  await waitFor(() => expect(api.listCustomers).toHaveBeenCalledWith("CUSTOMER"));
  if (purchaseOrderId) await screen.findByRole("dialog", { name: /Edit purchase order/ });
};

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = (name = "Save purchase order") => userEvent.click(screen.getByRole("button", { name }));
const sent = (): PurchaseOrderInput => api.createPurchaseOrder.mock.calls[0][0];

describe("a new purchase order", () => {
  it("asks for a customer before showing invoices", async () => {
    await open();
    expect(screen.getByRole("dialog", { name: "New purchase order" })).toBeInTheDocument();
    expect(screen.getByText("Choose a customer to see invoices that can be attached.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Quotation" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveValue("NOT_STARTED");
  });

  it("saves with the chosen quotation and attached invoices", async () => {
    await open();
    await pick("Customer", "Anand Steels");
    type("PO number", "  PO-90 ");
    type("PO date", "2026-10-12");
    type("Status", "PARTIAL");
    type("Internal note", "  rush  ");
    await pick("Quotation", "QT/26-27/005 — 20-09-2026");
    fireEvent.click(await screen.findByLabelText("Attach invoice MWW/26-27/002"));
    await save();
    await waitFor(() => expect(api.createPurchaseOrder).toHaveBeenCalledOnce());
    expect(sent()).toEqual({
      customer_id: 1,
      po_number: "PO-90",
      po_date: "2026-10-12",
      status: "PARTIAL",
      notes: "rush",
      invoice_ids: [2],
      quotation_id: 70,
    });
    expect(await screen.findByText("Purchase order saved")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(61);
  });

  it("sends no date when none is given", async () => {
    await open();
    await pick("Customer", "Anand Steels");
    type("PO number", "PO-1");
    await save();
    await waitFor(() => expect(api.createPurchaseOrder).toHaveBeenCalled());
    expect(sent()).toMatchObject({ po_date: null, notes: null, invoice_ids: [], quotation_id: null });
  });

  it("warns that attaching replaces the PO text an invoice prints now", async () => {
    await open();
    await pick("Customer", "Anand Steels");
    expect(
      await screen.findByText('Prints PO "OLD-PO & 01-09-2026" now. Attaching replaces it with this order\'s number.')
    ).toBeInTheDocument();
  });

  it("shows each invoice's payment state", async () => {
    api.listUnlinkedInvoicesForCustomer.mockResolvedValue([
      linked({ id: 1, payment_status: "PAID" }),
      linked({ id: 2, invoice_number: "D-1", status: "DRAFT" }),
      linked({ id: 3, invoice_number: "C-1", status: "CANCELLED" }),
    ]);
    await open();
    await pick("Customer", "Anand Steels");
    const row = (n: string) => screen.getByLabelText(`Attach invoice ${n}`).closest("label")!;
    expect(within(await waitFor(() => row("MWW/26-27/001"))).getByText("Paid")).toBeInTheDocument();
    expect(within(row("D-1")).getByText("Draft")).toBeInTheDocument();
    expect(within(row("C-1")).getByText("Cancelled")).toBeInTheDocument();
  });

  it("says when the customer has nothing to attach or quote", async () => {
    await open();
    await pick("Customer", "Bala Traders");
    expect(await screen.findByText("No unlinked invoices for this customer.")).toBeInTheDocument();
    expect(screen.getByText("This customer has no quotations yet. You can add one under Quotations.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Quotation" })).toBeDisabled();
  });

  it("changing the customer drops the quotation and ticked invoices", async () => {
    await open();
    await pick("Customer", "Anand Steels");
    await pick("Quotation", "QT/26-27/005 — 20-09-2026");
    fireEvent.click(await screen.findByLabelText("Attach invoice MWW/26-27/001"));
    await pick("Customer", "Bala Traders");
    await pick("Customer", "Anand Steels");
    expect(screen.getByRole("combobox", { name: "Quotation" })).toHaveValue("");
    expect(await screen.findByLabelText("Attach invoice MWW/26-27/001")).not.toBeChecked();
  });

  it("warns about a PO number this customer already used", async () => {
    api.checkDuplicatePoNumber.mockResolvedValue({ has_duplicate: true, existing_id: 3 });
    await open();
    await pick("Customer", "Anand Steels");
    type("PO number", "PO-77");
    fireEvent.blur(screen.getByLabelText("PO number"));
    expect(await screen.findByText("This customer already has a purchase order with this number.")).toBeInTheDocument();
    expect(api.checkDuplicatePoNumber).toHaveBeenCalledWith(1, "PO-77", undefined);
    type("PO number", "PO-78");
    expect(screen.queryByText(/already has a purchase order/)).not.toBeInTheDocument();
  });

  it("refuses to save without a customer or a number", async () => {
    await open();
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a customer.");
    await pick("Customer", "Anand Steels");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the purchase order number.");
    expect(api.createPurchaseOrder).not.toHaveBeenCalled();
  });

  it("uploads picked files after saving", async () => {
    await open();
    await pick("Customer", "Anand Steels");
    type("PO number", "PO-1");
    await userEvent.upload(fileInput(), [makeFile("po.pdf")]);
    await screen.findByText("po.pdf");
    await save();
    await waitFor(() => expect(api.addPurchaseOrderFile).toHaveBeenCalledWith(61, "po.pdf", expect.any(String)));
  });

  it("shows the backend's refusal and stays open", async () => {
    api.createPurchaseOrder.mockRejectedValue(new Error("Invoice MWW/26-27/001 belongs to another customer."));
    await open();
    await pick("Customer", "Anand Steels");
    type("PO number", "PO-1");
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Invoice MWW/26-27/001 belongs to another customer.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("editing a purchase order", () => {
  it("loads the order and saves in place", async () => {
    await open(60);
    expect(api.getPurchaseOrder).toHaveBeenCalledWith(60);
    expect(screen.getByLabelText("PO number")).toHaveValue("PO-77");
    expect(screen.getByLabelText("PO date")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Status")).toHaveValue("PARTIAL");
    expect(screen.getByLabelText("Internal note")).toHaveValue("Gate job");
    expect(await screen.findByText("No invoices linked yet.")).toBeInTheDocument();
    type("Status", "COMPLETED");
    await save("Save changes");
    await waitFor(() => expect(api.updatePurchaseOrder).toHaveBeenCalledOnce());
    expect(api.updatePurchaseOrder.mock.calls[0]).toEqual([
      60,
      { customer_id: 1, po_number: "PO-77", po_date: "2026-10-01", status: "COMPLETED", notes: "Gate job", invoice_ids: [], quotation_id: null },
    ]);
    expect(onSaved).toHaveBeenCalledWith(60);
  });

  it("fixes the customer once invoices are linked, and can unlink one", async () => {
    api.getPurchaseOrder.mockResolvedValue(detail({ invoices: [linked({ id: 9, invoice_number: "MWW/26-27/009" })] }));
    await open(60);
    expect(screen.getByRole("combobox", { name: "Customer" })).toBeDisabled();
    expect(screen.getByText("Customer cannot be changed after invoices have been linked to this purchase order.")).toBeInTheDocument();

    api.getPurchaseOrder.mockResolvedValue(detail());
    await userEvent.click(await screen.findByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(api.setInvoicePurchaseOrder).toHaveBeenCalledWith(9, null));
    expect(await screen.findByText("Invoice unlinked")).toBeInTheDocument();
    expect(await screen.findByText("No invoices linked yet.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Customer" })).toBeEnabled();
  });

  it("shows why an unlink was refused", async () => {
    api.getPurchaseOrder.mockResolvedValue(detail({ invoices: [linked({ id: 9 })] }));
    api.setInvoicePurchaseOrder.mockRejectedValue(new Error("Invoice is cancelled."));
    await open(60);
    await userEvent.click(await screen.findByRole("button", { name: "Unlink" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invoice is cancelled.");
  });

  it("fixes the customer while it keeps its quotation", async () => {
    api.getPurchaseOrder.mockResolvedValue(detail({}, { quotation_id: 70, quotation_number: "QT/26-27/005" }));
    await open(60);
    expect(screen.getByRole("combobox", { name: "Customer" })).toBeDisabled();
    expect(screen.getByText(/linked to a quotation, so its customer is fixed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("combobox", { name: "Customer" })).toBeEnabled();
  });

  it("says so when the order was deleted", async () => {
    api.getPurchaseOrder.mockResolvedValue(null);
    render(
      <ToastProvider>
        <PurchaseOrderFormModal purchaseOrderId={60} onClose={onClose} onSaved={onSaved} />
      </ToastProvider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This purchase order no longer exists.");
  });

  it("removes a saved file after asking", async () => {
    api.getPurchaseOrder.mockResolvedValue(detail({ files: [{ id: 4, file_name: "scan.pdf", mime_type: "application/pdf", size_bytes: 1024 * 1024 * 2 }] }));
    api.removePurchaseOrderFile.mockResolvedValue(undefined);
    await open(60);
    expect(screen.getByText("2.0 MB")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("dialog", { name: "Remove scan.pdf?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove file" }));
    await waitFor(() => expect(api.removePurchaseOrderFile).toHaveBeenCalledWith(4));
  });
});
