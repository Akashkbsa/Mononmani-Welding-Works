import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LedgerModal from "./LedgerModal";
import { ToastProvider } from "../ui";
import { Ledger } from "../../types/ledger";
import { financialYearOf } from "../../lib/period";
import { todayISO } from "../../lib/format";

const api = vi.hoisted(() => ({ getLedger: vi.fn(), printLedger: vi.fn(), setOpeningBalance: vi.fn() }));
vi.mock("../../services/api", () => api);

const ledger = (over: Partial<Ledger> = {}): Ledger => ({
  company_id: 1,
  company_name: "Sri Krishna Engineering Works",
  party_type: "BOTH",
  from: "2026-04-01",
  to: "2026-10-17",
  brought_forward: 18500,
  lines: [
    { date: "2026-04-10", particulars: "Sales invoice", number: "MWW/26-27/001", detail: "", debit: 11800, credit: 0, balance: 30300 },
    { date: "2026-05-02", particulars: "Payment received", number: "PAY/26-27/004", detail: "Bank Transfer · UTR9", debit: 0, credit: 10000, balance: 20300 },
    { date: "2026-05-10", particulars: "Purchase bill", number: "SKE-55", detail: "", debit: 0, credit: 24300, balance: -4000 },
  ],
  total_debit: 11800,
  total_credit: 34300,
  closing: -4000,
  opening_balance: { amount: 0, as_on: null },
  dates: ["2026-04-10", "2026-05-02", "2026-05-10"],
  ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getLedger.mockResolvedValue(ledger());
  api.printLedger.mockResolvedValue("C:/data/Ledgers/x.pdf");
  api.setOpeningBalance.mockResolvedValue({ amount: 18500, as_on: "2026-01-01" });
});

const open = async () => {
  render(
    <ToastProvider>
      <LedgerModal companyId={1} companyName="Sri Krishna Engineering Works" onClose={() => {}} />
    </ToastProvider>
  );
  await screen.findByText("MWW/26-27/001");
};

describe("LedgerModal", () => {
  it("opens on this financial year up to today and shows every line with a running balance", async () => {
    await open();
    const fy = financialYearOf(todayISO());
    expect(api.getLedger).toHaveBeenCalledWith(1, `${fy}-04-01`, expect.any(String));
    expect(screen.getByText("Balance brought forward")).toBeInTheDocument();
    expect(screen.getByText("Bank Transfer · UTR9")).toBeInTheDocument();
    expect(screen.getByText("₹30,300.00 Dr")).toBeInTheDocument();
    expect(screen.getAllByText("₹4,000.00 Cr").length).toBeGreaterThan(0);
    expect(screen.getByText("You owe them")).toBeInTheDocument();
  });

  it("prints the ledger for the same period", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Print ledger" }));
    const [id, from, to] = api.getLedger.mock.calls[0];
    await waitFor(() => expect(api.printLedger).toHaveBeenCalledWith(id, from, to));
    expect(await screen.findByText("Ledger opened. Print it from the PDF viewer.")).toBeInTheDocument();
  });

  it("asks for all records when All dates is chosen", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Show dates"), { target: { value: "all" } });
    await waitFor(() => expect(api.getLedger).toHaveBeenLastCalledWith(1, null, null));
  });

  it("saves an opening balance owed to us, with its date", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Add opening balance" }));
    fireEvent.change(screen.getByLabelText("Opening balance amount"), { target: { value: "18500" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the date the balance stood on.");
    fireEvent.change(screen.getByLabelText("As on"), { target: { value: "2026-01-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.setOpeningBalance).toHaveBeenCalledWith(1, { amount: 18500, as_on: "2026-01-01" }));
    await waitFor(() => expect(api.getLedger).toHaveBeenCalledTimes(2));
  });

  it("saves one we owe them as a credit", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Add opening balance" }));
    fireEvent.change(screen.getByLabelText("Opening balance amount"), { target: { value: "41475" } });
    fireEvent.change(screen.getByLabelText("Who owes"), { target: { value: "CR" } });
    fireEvent.change(screen.getByLabelText("As on"), { target: { value: "2026-04-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.setOpeningBalance).toHaveBeenCalledWith(1, { amount: -41475, as_on: "2026-04-01" }));
  });

  it("shows an existing opening balance and says when a period is empty", async () => {
    api.getLedger.mockResolvedValue(ledger({ lines: [], opening_balance: { amount: 18500, as_on: "2026-01-01" } }));
    render(
      <ToastProvider>
        <LedgerModal companyId={1} companyName="Sri Krishna Engineering Works" onClose={() => {}} />
      </ToastProvider>
    );
    expect(await screen.findByText("No entries in this period.")).toBeInTheDocument();
    expect(screen.getByText("Opening balance ₹18,500.00 Dr as on 01-01-2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });
});
