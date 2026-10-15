import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SupplierBillFormModal from "./SupplierBillFormModal";
import { ToastProvider } from "../ui";
import { SupplierBillDetail, SupplierBillInput } from "../../types/supplierBill";
import { fileInput, makeCustomer, makeFile, pick } from "../../test/helpers";

const api = vi.hoisted(() => ({
  addSupplierBillFile: vi.fn(),
  checkDuplicateSupplierBillNumber: vi.fn(),
  createSupplierBill: vi.fn(),
  getSupplierBill: vi.fn(),
  listCustomers: vi.fn(),
  removeSupplierBillFile: vi.fn(),
  updateSupplierBill: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const steel = makeCustomer({ id: 5, name: "Steel Depot", party_type: "SUPPLIER" });

const detail = (over: Partial<SupplierBillDetail> = {}): SupplierBillDetail => ({
  bill: {
    id: 40,
    supplier_id: 5,
    supplier_name: "Steel Depot",
    bill_number: "SD-101",
    bill_date: "2026-09-10",
    total_amount: 5000,
    notes: "MS pipes",
    created_at: "",
    updated_at: "",
  },
  settled_amount: 0,
  outstanding_amount: 5000,
  status: "NOT_PAID",
  files: [],
  payments: [],
  ...over,
});

let onClose: Mock<() => void>;
let onSaved: Mock<(id: number) => void>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  Object.values(api).forEach((f) => f.mockReset());
  api.listCustomers.mockResolvedValue([steel, makeCustomer({ id: 6, name: "Gas Agency", party_type: "BOTH" })]);
  api.checkDuplicateSupplierBillNumber.mockResolvedValue({ has_duplicate: false, existing_id: null });
  api.createSupplierBill.mockImplementation(async (input: SupplierBillInput) => ({ ...detail(), bill: { ...detail().bill, id: 77, ...input } }));
  api.updateSupplierBill.mockImplementation(async (id: number) => ({ ...detail(), bill: { ...detail().bill, id } }));
  api.getSupplierBill.mockResolvedValue(detail());
  api.addSupplierBillFile.mockResolvedValue({});
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<(id: number) => void>();
});
afterEach(() => vi.useRealTimers());

const open = async (billId?: number) => {
  render(
    <ToastProvider>
      <SupplierBillFormModal billId={billId} onClose={onClose} onSaved={onSaved} />
    </ToastProvider>
  );
  await waitFor(() => expect(api.listCustomers).toHaveBeenCalledWith("SUPPLIER"));
  if (billId) await screen.findByRole("dialog", { name: /Edit supplier bill/ });
};

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = (name = "Save supplier bill") => userEvent.click(screen.getByRole("button", { name }));

describe("a new supplier bill", () => {
  it("starts dated today", async () => {
    await open();
    expect(screen.getByRole("dialog", { name: "New supplier bill" })).toBeInTheDocument();
    expect(screen.getByLabelText("Bill date")).toHaveValue("2026-10-15");
    expect(screen.getByText("No files attached yet.")).toBeInTheDocument();
  });

  it("saves the bill", async () => {
    await open();
    await pick("Supplier", "Steel Depot");
    type("Bill number", "  SD-200 ");
    type("Total amount", "12500.50");
    type("Internal note", "  ");
    await save();
    await waitFor(() => expect(api.createSupplierBill).toHaveBeenCalledOnce());
    expect(api.createSupplierBill.mock.calls[0][0]).toEqual({
      supplier_id: 5,
      bill_number: "SD-200",
      bill_date: "2026-10-15",
      total_amount: 12500.5,
      notes: null,
    });
    expect(await screen.findByText("Supplier bill saved")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(77);
  });

  describe("refuses to save", () => {
    it("without a supplier", async () => {
      await open();
      await save();
      expect(screen.getByRole("alert")).toHaveTextContent("Choose a supplier.");
    });

    it("without a bill number", async () => {
      await open();
      await pick("Supplier", "Steel Depot");
      type("Bill number", "   ");
      await save();
      expect(screen.getByRole("alert")).toHaveTextContent("Enter the bill number.");
    });

    it.each(["", "0", "-5", "abc"])("with a total of %j", async (total) => {
      await open();
      await pick("Supplier", "Steel Depot");
      type("Bill number", "SD-1");
      type("Total amount", total);
      await save();
      expect(screen.getByRole("alert")).toHaveTextContent("Enter the bill total.");
      expect(api.createSupplierBill).not.toHaveBeenCalled();
    });
  });

  it("only warns about a bill number the supplier already used", async () => {
    api.checkDuplicateSupplierBillNumber.mockResolvedValue({ has_duplicate: true, existing_id: 3 });
    await open();
    await pick("Supplier", "Steel Depot");
    type("Bill number", "SD-101");
    fireEvent.blur(screen.getByLabelText("Bill number"));
    expect(await screen.findByText("SD-101 is already used by this supplier.")).toBeInTheDocument();
    expect(api.checkDuplicateSupplierBillNumber).toHaveBeenCalledWith(5, "SD-101", undefined);
    // A corrected bill may reuse the number, so it can still be saved.
    type("Total amount", "100");
    await save();
    await waitFor(() => expect(api.createSupplierBill).toHaveBeenCalled());
  });

  it("does not check the number before a supplier is chosen", async () => {
    await open();
    type("Bill number", "SD-101");
    fireEvent.blur(screen.getByLabelText("Bill number"));
    expect(api.checkDuplicateSupplierBillNumber).not.toHaveBeenCalled();
  });

  it("keeps picked files and uploads them once the bill is saved", async () => {
    await open();
    await pick("Supplier", "Steel Depot");
    type("Bill number", "SD-300");
    type("Total amount", "900");
    await userEvent.upload(fileInput(), [makeFile("bill.pdf"), makeFile("photo.jpg")]);
    expect(await screen.findByText("bill.pdf")).toBeInTheDocument();
    expect(api.addSupplierBillFile).not.toHaveBeenCalled();
    await save();
    await waitFor(() => expect(api.addSupplierBillFile).toHaveBeenCalledTimes(2));
    expect(api.addSupplierBillFile.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [77, "bill.pdf"],
      [77, "photo.jpg"],
    ]);
    expect(onSaved).toHaveBeenCalledWith(77);
  });

  it("still closes, and says which files are missing, when an upload fails", async () => {
    api.addSupplierBillFile.mockRejectedValueOnce(new Error("disk full"));
    await open();
    await pick("Supplier", "Steel Depot");
    type("Bill number", "SD-300");
    type("Total amount", "900");
    await userEvent.upload(fileInput(), [makeFile("bill.pdf")]);
    await screen.findByText("bill.pdf");
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Supplier bill saved, but 1 file was not added: bill.pdf: disk full. Open the bill to add it again."
    );
    // Staying open in "new" mode would let a second Save create the bill twice.
    expect(onSaved).toHaveBeenCalledWith(77);
  });

  it("shows the backend's refusal and stays open", async () => {
    api.createSupplierBill.mockRejectedValue(new Error("Gas Agency is a customer, not a supplier."));
    await open();
    await pick("Supplier", "Steel Depot");
    type("Bill number", "SD-1");
    type("Total amount", "100");
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Gas Agency is a customer, not a supplier.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("editing a supplier bill", () => {
  it("loads the bill and saves in place", async () => {
    await open(40);
    expect(api.getSupplierBill).toHaveBeenCalledWith(40);
    expect(screen.getByRole("dialog", { name: "Edit supplier bill SD-101" })).toBeInTheDocument();
    expect(screen.getByLabelText("Bill number")).toHaveValue("SD-101");
    expect(screen.getByLabelText("Total amount")).toHaveValue(5000);
    expect(screen.getByLabelText("Internal note")).toHaveValue("MS pipes");
    type("Total amount", "5200");
    await save("Save changes");
    await waitFor(() => expect(api.updateSupplierBill).toHaveBeenCalledOnce());
    expect(api.updateSupplierBill.mock.calls[0]).toEqual([
      40,
      { supplier_id: 5, bill_number: "SD-101", bill_date: "2026-09-10", total_amount: 5200, notes: "MS pipes" },
    ]);
  });

  it("says so when the bill was deleted", async () => {
    api.getSupplierBill.mockResolvedValue(null);
    render(
      <ToastProvider>
        <SupplierBillFormModal billId={40} onClose={onClose} onSaved={onSaved} />
      </ToastProvider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This supplier bill no longer exists.");
  });

  it("fixes the supplier once payments are recorded", async () => {
    api.getSupplierBill.mockResolvedValue(
      detail({ payments: [{ payment_id: 1, payment_number: "SP/1", payment_date: "2026-10-01", payment_method: "UPI", reference_number: null, amount_settled: 100 }] })
    );
    await open(40);
    expect(screen.getByRole("combobox", { name: "Supplier" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
    expect(screen.getByText("Supplier cannot be changed once payments are recorded against this bill.")).toBeInTheDocument();
  });

  it("uploads new files straight away and can remove a saved one", async () => {
    const withFile = detail({ files: [{ id: 3, file_name: "old.pdf", mime_type: "application/pdf", size_bytes: 2048 }] });
    api.getSupplierBill.mockResolvedValue(withFile);
    api.removeSupplierBillFile.mockResolvedValue(undefined);
    await open(40);
    expect(screen.getByText("old.pdf")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();

    await userEvent.upload(fileInput(), [makeFile("new.png")]);
    await waitFor(() => expect(api.addSupplierBillFile).toHaveBeenCalledWith(40, "new.png", expect.any(String)));

    api.getSupplierBill.mockResolvedValue(detail());
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove file" }));
    await waitFor(() => expect(api.removeSupplierBillFile).toHaveBeenCalledWith(3));
    expect(await screen.findByText("File removed")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("old.pdf")).not.toBeInTheDocument());
  });

  it("keeps typed changes when the file list reloads", async () => {
    await open(40);
    type("Total amount", "9999");
    await userEvent.upload(fileInput(), [makeFile("new.png")]);
    await waitFor(() => expect(api.getSupplierBill).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Total amount")).toHaveValue(9999);
  });
});
