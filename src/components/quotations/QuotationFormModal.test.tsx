import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuotationFormModal from "./QuotationFormModal";
import { ToastProvider } from "../ui";
import { LinkedOrder, QuotationDetail, QuotationInput } from "../../types/quotation";
import { fileInput, makeCustomer, makeFile, pick } from "../../test/helpers";

const api = vi.hoisted(() => ({
  addQuotationFile: vi.fn(),
  checkDuplicateQuotationNumber: vi.fn(),
  createQuotation: vi.fn(),
  getQuotation: vi.fn(),
  listCustomers: vi.fn(),
  listUnlinkedPurchaseOrdersForCustomer: vi.fn(),
  removeQuotationFile: vi.fn(),
  setPurchaseOrderQuotation: vi.fn(),
  updateQuotation: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const po = (over: Partial<LinkedOrder>): LinkedOrder => ({
  id: 60,
  po_number: "PO-77",
  po_date: "2026-10-01",
  status: "NOT_STARTED",
  invoice_count: 0,
  ...over,
});

const detail = (over: Partial<QuotationDetail> = {}): QuotationDetail => ({
  quotation: {
    id: 70,
    customer_id: 1,
    customer_name: "Anand Steels",
    quotation_number: "QT/26-27/005",
    quotation_date: "2026-09-20",
    notes: null,
    created_at: "",
    updated_at: "",
  },
  files: [],
  orders: [],
  ...over,
});

let onClose: Mock<() => void>;
let onSaved: Mock<(id: number) => void>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  Object.values(api).forEach((f) => f.mockReset());
  api.listCustomers.mockResolvedValue([makeCustomer({ id: 1, name: "Anand Steels" }), makeCustomer({ id: 2, name: "Bala Traders" })]);
  api.listUnlinkedPurchaseOrdersForCustomer.mockImplementation(async (id: number) =>
    id === 1 ? [po({}), po({ id: 61, po_number: "PO-78", po_date: null, status: "COMPLETED", invoice_count: 1 })] : []
  );
  api.checkDuplicateQuotationNumber.mockResolvedValue({ has_duplicate: false, existing_id: null, existing_customer_name: null });
  api.createQuotation.mockResolvedValue({ ...detail(), quotation: { ...detail().quotation, id: 71 } });
  api.updateQuotation.mockResolvedValue(detail());
  api.getQuotation.mockResolvedValue(detail());
  api.addQuotationFile.mockResolvedValue({});
  api.setPurchaseOrderQuotation.mockResolvedValue(undefined);
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<(id: number) => void>();
});
afterEach(() => vi.useRealTimers());

const open = async (quotationId?: number) => {
  render(
    <ToastProvider>
      <QuotationFormModal quotationId={quotationId} onClose={onClose} onSaved={onSaved} />
    </ToastProvider>
  );
  await waitFor(() => expect(api.listCustomers).toHaveBeenCalledWith("CUSTOMER"));
  if (quotationId) await screen.findByRole("dialog", { name: /Edit quotation/ });
};

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = (name = "Save quotation") => userEvent.click(screen.getByRole("button", { name }));

describe("a new quotation", () => {
  it("starts dated today", async () => {
    await open();
    expect(screen.getByLabelText("Quotation date")).toHaveValue("2026-10-15");
    expect(screen.getByText("Choose a customer to see purchase orders that can be attached.")).toBeInTheDocument();
  });

  it("lists the customer's orders with their dates and invoice counts", async () => {
    await open();
    await pick("Customer", "Anand Steels");
    expect(await screen.findByText("01-10-2026 · 0 invoices")).toBeInTheDocument();
    expect(screen.getByText("No date · 1 invoice")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("saves with the attached orders", async () => {
    await open();
    await pick("Customer", "Anand Steels");
    type("Quotation number", " QT/26-27/009 ");
    type("Internal note", " sent by email ");
    fireEvent.click(await screen.findByLabelText("Attach purchase order PO-78"));
    await save();
    await waitFor(() => expect(api.createQuotation).toHaveBeenCalledOnce());
    expect(api.createQuotation.mock.calls[0][0]).toEqual<QuotationInput>({
      customer_id: 1,
      quotation_number: "QT/26-27/009",
      quotation_date: "2026-10-15",
      notes: "sent by email",
      purchase_order_ids: [61],
    });
    expect(await screen.findByText("Quotation saved")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(71);
  });

  it("refuses to save without a customer, number or date", async () => {
    await open();
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a customer.");
    await pick("Customer", "Bala Traders");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the quotation number.");
    type("Quotation number", "QT/1");
    type("Quotation date", "");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the quotation date.");
    expect(api.createQuotation).not.toHaveBeenCalled();
  });

  it("warns, naming the customer, when the number is already used", async () => {
    api.checkDuplicateQuotationNumber.mockResolvedValue({ has_duplicate: true, existing_id: 3, existing_customer_name: "Bala Traders" });
    await open();
    type("Quotation number", "QT/26-27/005");
    fireEvent.blur(screen.getByLabelText("Quotation number"));
    expect(await screen.findByText("QT/26-27/005 is already used for Bala Traders.")).toBeInTheDocument();
  });

  it("says 'another customer' when the name is not known", async () => {
    api.checkDuplicateQuotationNumber.mockResolvedValue({ has_duplicate: true, existing_id: 3, existing_customer_name: null });
    await open();
    type("Quotation number", "QT/1");
    fireEvent.blur(screen.getByLabelText("Quotation number"));
    expect(await screen.findByText("QT/1 is already used for another customer.")).toBeInTheDocument();
  });

  it("says when the customer has no orders to attach", async () => {
    await open();
    await pick("Customer", "Bala Traders");
    expect(await screen.findByText("No purchase orders without a quotation for this customer.")).toBeInTheDocument();
  });

  it("changing the customer drops the ticked orders", async () => {
    await open();
    await pick("Customer", "Anand Steels");
    fireEvent.click(await screen.findByLabelText("Attach purchase order PO-77"));
    await pick("Customer", "Bala Traders");
    type("Quotation number", "QT/1");
    await save();
    await waitFor(() => expect(api.createQuotation).toHaveBeenCalled());
    expect(api.createQuotation.mock.calls[0][0].purchase_order_ids).toEqual([]);
  });

  it("says which files did not upload, after saving", async () => {
    api.addQuotationFile.mockRejectedValue(new Error("too big"));
    await open();
    await pick("Customer", "Anand Steels");
    type("Quotation number", "QT/1");
    await userEvent.upload(fileInput(), [makeFile("a.pdf"), makeFile("b.pdf")]);
    await screen.findByText("b.pdf");
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Quotation saved, but 2 files were not added: a.pdf: too big; b.pdf: too big. Open the quotation to add them again."
    );
    expect(onSaved).toHaveBeenCalledWith(71);
  });
});

describe("editing a quotation", () => {
  it("loads it and saves in place", async () => {
    await open(70);
    expect(screen.getByLabelText("Quotation number")).toHaveValue("QT/26-27/005");
    expect(screen.getByLabelText("Quotation date")).toHaveValue("2026-09-20");
    type("Internal note", "revised");
    await save("Save changes");
    await waitFor(() => expect(api.updateQuotation).toHaveBeenCalledOnce());
    expect(api.updateQuotation.mock.calls[0]).toEqual([
      70,
      { customer_id: 1, quotation_number: "QT/26-27/005", quotation_date: "2026-09-20", notes: "revised", purchase_order_ids: [] },
    ]);
  });

  it("checks the number against other quotations only", async () => {
    await open(70);
    fireEvent.blur(screen.getByLabelText("Quotation number"));
    await waitFor(() => expect(api.checkDuplicateQuotationNumber).toHaveBeenCalledWith("QT/26-27/005", 70));
  });

  it("fixes the customer while orders are linked, and can unlink one", async () => {
    api.getQuotation.mockResolvedValue(detail({ orders: [po({ id: 65, po_number: "PO-80", invoice_count: 2 })] }));
    await open(70);
    expect(screen.getByRole("combobox", { name: "Customer" })).toBeDisabled();
    expect(screen.getByText("Customer cannot be changed while purchase orders are linked to this quotation.")).toBeInTheDocument();
    expect(screen.getByText("01-10-2026 · 2 invoices")).toBeInTheDocument();
    api.getQuotation.mockResolvedValue(detail());
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(api.setPurchaseOrderQuotation).toHaveBeenCalledWith(65, null));
    expect(await screen.findByText("Purchase order unlinked")).toBeInTheDocument();
    expect(await screen.findByText("No purchase orders linked yet.")).toBeInTheDocument();
  });

  it("says so when the quotation was deleted", async () => {
    api.getQuotation.mockResolvedValue(null);
    render(
      <ToastProvider>
        <QuotationFormModal quotationId={70} onClose={onClose} onSaved={onSaved} />
      </ToastProvider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This quotation no longer exists.");
  });
});
