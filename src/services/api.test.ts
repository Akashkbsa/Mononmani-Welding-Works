import { beforeEach, describe, expect, it, vi } from "vitest";
import apiSource from "./api.ts?raw";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import * as api from "./api";

beforeEach(() => invoke.mockReset());

describe("calling the backend", () => {
  it("passes the command name and arguments through", async () => {
    invoke.mockResolvedValue([{ id: 1 }]);
    await expect(api.listCustomers("SUPPLIER")).resolves.toEqual([{ id: 1 }]);
    expect(invoke).toHaveBeenCalledWith("list_customers", { party: "SUPPLIER" });
  });

  it("sends null, not undefined, for optional arguments left out", async () => {
    invoke.mockResolvedValue(null);
    await api.listCustomers();
    await api.checkDuplicateCustomer("Anand");
    await api.checkDuplicateInvoiceNumber("MWW/2026-27/001");
    expect(invoke.mock.calls).toEqual([
      ["list_customers", { party: null }],
      ["check_duplicate_customer", { name: "Anand", excludeId: null }],
      ["check_duplicate_invoice_number", { invoiceNumber: "MWW/2026-27/001", excludeId: null }],
    ]);
  });

  it("sends an empty filter by default", async () => {
    invoke.mockResolvedValue([]);
    await api.listInvoices();
    expect(invoke).toHaveBeenCalledWith("list_invoices", { filter: {} });
  });

  it("turns a backend error string into an Error without the 'Error:' prefix", async () => {
    invoke.mockRejectedValueOnce("Error: Invoice has payments and cannot be deleted");
    await expect(api.deleteInvoice(5)).rejects.toThrow(new Error("Invoice has payments and cannot be deleted"));
  });

  it("keeps errors that have no prefix as they are", async () => {
    invoke.mockRejectedValueOnce("Customer not found");
    const err = await api.deleteCustomer(1).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Customer not found");
  });

  it("printInvoice makes the PDF, then opens it", async () => {
    invoke.mockResolvedValueOnce("C:/pdf/inv.pdf").mockResolvedValueOnce(undefined);
    await api.printInvoice(7);
    expect(invoke.mock.calls).toEqual([
      ["generate_invoice_pdf_by_id", { id: 7, copyType: "Original" }],
      ["open_invoice_pdf", { path: "C:/pdf/inv.pdf" }],
    ]);
  });

  it("printInvoice does not try to open a PDF that failed", async () => {
    invoke.mockRejectedValueOnce("Chrome not found");
    await expect(api.printInvoice(7, "Duplicate")).rejects.toThrow("Chrome not found");
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("printCopies sends every copy type", async () => {
    invoke.mockResolvedValueOnce("x.pdf").mockResolvedValueOnce(undefined);
    await api.printCopies(3, ["Original", "Duplicate"]);
    expect(invoke.mock.calls[0]).toEqual(["generate_invoice_copies_pdf", { id: 3, copyTypes: ["Original", "Duplicate"] }]);
    expect(invoke.mock.calls[1]).toEqual(["open_invoice_pdf", { path: "x.pdf" }]);
  });

  it("downloadMonthInvoices opens the file and returns the count", async () => {
    invoke.mockResolvedValueOnce({ path: "oct.pdf", invoice_count: 12 }).mockResolvedValueOnce(undefined);
    await expect(api.downloadMonthInvoices(2026, 10)).resolves.toEqual({ path: "oct.pdf", invoice_count: 12 });
    expect(invoke.mock.calls[0]).toEqual(["generate_month_invoices_pdf", { year: 2026, month: 10 }]);
    expect(invoke.mock.calls[1]).toEqual(["open_invoice_pdf", { path: "oct.pdf" }]);
  });
});

/* ---------- Contract with the Rust commands ---------- */

// Read the Rust sources as text so the two sides can be compared without running the app.
const rustFiles = import.meta.glob("../../src-tauri/src/**/*.rs", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const libRs = Object.entries(rustFiles).find(([path]) => path.endsWith("src-tauri/src/lib.rs"))![1];

/** Command names in `generate_handler![...]`, without their module path. */
function registeredCommands(): Set<string> {
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(libRs)![1];
  return new Set(
    block
      .split(",")
      .map((s) => s.replace(/\/\/.*$/gm, "").trim())
      .filter(Boolean)
      .map((s) => s.split("::").pop()!)
  );
}

/** Parameter names of each `#[tauri::command]` function, minus the ones Tauri fills in itself. */
function commandParams(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /#\[tauri::command[^\]]*\]\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)\s*(?:->|\{)/g;
  for (const src of Object.values(rustFiles)) {
    for (const m of src.matchAll(re)) {
      const params = m[2]
        .split(/,(?![^<]*>)/)
        .map((p) => p.trim())
        .filter(Boolean)
        .filter((p) => !/:\s*(tauri::)?(State|AppHandle|Window|WebviewWindow)\b/.test(p))
        .map((p) => p.split(":")[0].trim().replace(/^mut\s+/, ""));
      out.set(m[1], params);
    }
  }
  return out;
}

/** Every `call<...>("command", { ... })` in api.ts with the argument names it sends. */
function apiCalls(): { command: string; args: string[] }[] {
  const out: { command: string; args: string[] }[] = [];
  const re = /call<[\s\S]*?>\(\s*"(\w+)"\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
  for (const m of apiSource.matchAll(re)) {
    const args = (m[2] ?? "")
      .split(",")
      .map((a) => a.split(":")[0].trim())
      .filter(Boolean);
    out.push({ command: m[1], args });
  }
  return out;
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe("api.ts matches the Rust commands", () => {
  const calls = apiCalls();
  const registered = registeredCommands();
  const params = commandParams();

  it("finds the calls and commands to compare", () => {
    expect(calls.length).toBeGreaterThan(100);
    expect(registered.size).toBeGreaterThan(100);
    expect(params.size).toBeGreaterThan(100);
  });

  it("every command called from the UI is registered in lib.rs", () => {
    const missing = calls.map((c) => c.command).filter((c) => !registered.has(c));
    expect(missing).toEqual([]);
  });

  it("every registered command has a #[tauri::command] function", () => {
    const missing = [...registered].filter((c) => !params.has(c));
    expect(missing).toEqual([]);
  });

  it("every call sends exactly the arguments the Rust function takes", () => {
    const problems: string[] = [];
    for (const { command, args } of calls) {
      const expected = params.get(command);
      if (!expected) continue;
      const sent = args.map(snake).sort();
      const wanted = [...expected].sort();
      if (sent.join() !== wanted.join()) problems.push(`${command}: sends [${sent}] but Rust takes [${wanted}]`);
    }
    expect(problems).toEqual([]);
  });
});
