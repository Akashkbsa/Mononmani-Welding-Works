import { describe, expect, it } from "vitest";
import { computeTotals, TotalsInput } from "./invoiceTotals";
import cases from "../test/fixtures/invoice_totals.json";

describe("computeTotals", () => {
  // The backend checks the same cases in invoices/repository.rs, so screen and saved totals agree.
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(computeTotals(c as TotalsInput)).toEqual(c.expected);
  });

  const base: TotalsInput = { items: [{ quantity: 1, rate: 100 }], tax_type: "CGST_SGST", discount: 0, cgst_rate: 9, sgst_rate: 9, igst_rate: 18 };

  it("reads numbers typed as text", () => {
    const t = computeTotals({ ...base, items: [{ quantity: "2", rate: "49.50" }], discount: "9" });
    expect(t).toMatchObject({ amounts: [99], subtotal: 99, discount: 9, cgst: 8.1, sgst: 8.1, total: 106.2 });
  });

  it("treats empty or unreadable boxes as zero", () => {
    const t = computeTotals({ ...base, items: [{ quantity: "", rate: "abc" }], discount: "", cgst_rate: "" });
    expect(t).toMatchObject({ amounts: [0], subtotal: 0, cgst: 0, total: 0 });
  });

  it("ignores a negative discount", () => {
    expect(computeTotals({ ...base, discount: -50 })).toMatchObject({ discount: 0, total: 118 });
  });

  it("never taxes below zero while a too-large discount is still on screen", () => {
    expect(computeTotals({ ...base, discount: 150 })).toMatchObject({ subtotal: 100, discount: 150, cgst: 0, total: 0 });
  });

  it("uses only IGST for another state, whatever the CGST and SGST rates", () => {
    expect(computeTotals({ ...base, tax_type: "IGST" })).toMatchObject({ cgst: 0, sgst: 0, igst: 18, total: 118 });
  });
});
