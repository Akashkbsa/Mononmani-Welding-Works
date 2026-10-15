import { TaxType } from "../types/invoice";
import { round2 } from "./format";

/** What the totals depend on. Numbers may still be text straight from an input box. */
export interface TotalsInput {
  items: { quantity: number | string; rate: number | string }[];
  tax_type: TaxType;
  discount: number | string;
  cgst_rate: number | string;
  sgst_rate: number | string;
  igst_rate: number | string;
}

/**
 * Same arithmetic as `calculate_financials` in the backend, so the totals shown are the totals
 * saved. Both are checked against src/test/fixtures/invoice_totals.json.
 */
export function computeTotals(form: TotalsInput) {
  const amounts = form.items.map((i) => round2((Number(i.quantity) || 0) * (Number(i.rate) || 0)));
  const subtotal = round2(amounts.reduce((a, b) => a + b, 0));
  const discount = round2(Math.max(0, Number(form.discount) || 0));
  const taxable = Math.max(0, subtotal - discount);
  const igst = form.tax_type === "IGST";
  const cgst = igst ? 0 : round2((taxable * (Number(form.cgst_rate) || 0)) / 100);
  const sgst = igst ? 0 : round2((taxable * (Number(form.sgst_rate) || 0)) / 100);
  const igstAmount = igst ? round2((taxable * (Number(form.igst_rate) || 0)) / 100) : 0;
  // Exact to the paisa: invoice totals are not rounded to the rupee.
  const total = round2(taxable + cgst + sgst + igstAmount);
  return { amounts, subtotal, discount, cgst, sgst, igst: igstAmount, total };
}
