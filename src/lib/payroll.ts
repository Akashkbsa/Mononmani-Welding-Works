import { MonthFigures, PayStatus, WageKind } from "../types/payroll";
import { formatMoney, monthTitle, round2 } from "./format";

/** One pay line rounded to the paisa, e.g. days × wage. */
export function payLine(qty: number, rate: number): number {
  return round2(qty * rate);
}

/**
 * Read a Days or OT hours box. Empty gives `value: null`; anything that is not a usable number
 * gives an error, so nothing invalid is ever sent to the app.
 */
export function parseQuantity(text: string, kind: "days" | "hours"): { value: number | null; error: string | null } {
  const t = text.trim();
  if (t === "") return { value: null, error: null };
  const n = Number(t);
  if (!/^\d*\.?\d*$/.test(t) || !Number.isFinite(n) || n < 0) return { value: null, error: "Enter a number" };
  if (kind === "days" && Math.abs(Math.round(n * 2) - n * 2) > 1e-9) return { value: null, error: "Half days only, e.g. 25.5" };
  if (kind === "hours" && Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return { value: null, error: "Up to two decimals" };
  return { value: n, error: null };
}

export const STATUS_LABEL: Record<PayStatus, string> = {
  NOT_ENTERED: "Not entered",
  TO_PAY: "To pay",
  PAID: "Paid",
  OVERPAID: "Overpaid",
};

export const STATUS_TONE: Record<PayStatus, "neutral" | "amber" | "green" | "red"> = {
  NOT_ENTERED: "neutral",
  TO_PAY: "amber",
  PAID: "green",
  OVERPAID: "red",
};

/** Money paid beyond what was earned and let go: written off, or counted as paid by a round-off. */
export function paidExtra(f: MonthFigures): number {
  return round2(f.written_off + Math.max(0, -f.rounded_off));
}

/** ₹3,600 or ₹3,600.50: whole rupees without the empty paise, for short notes. */
export function shortMoney(value: number): string {
  return formatMoney(value).replace(/\.00$/, "");
}

/**
 * Short notes on how a paid month was settled, shown under the amount paid:
 * "+₹3,600 written off", "+₹1,000 to next month", "+₹5 rounded off", "−₹10 rounded off".
 */
export function settleNotes(f: MonthFigures): string[] {
  const notes: string[] = [];
  if (f.written_off > 0) notes.push(`+${shortMoney(f.written_off)} written off`);
  if (f.carried > 0) notes.push(`+${shortMoney(f.carried)} to next month`);
  if (f.rounded_off < 0) notes.push(`+${shortMoney(-f.rounded_off)} rounded off`);
  if (f.rounded_off > 0) notes.push(`−${shortMoney(f.rounded_off)} rounded off`);
  return notes;
}

/** Like STATUS_TONE, but a month where more than earned was paid stands out from a plain "Paid". */
export function statusTone(status: PayStatus, f: MonthFigures): "neutral" | "amber" | "green" | "red" | "blue" {
  return status === "PAID" && (paidExtra(f) > 0 || f.carried > 0) ? "blue" : STATUS_TONE[status];
}

/** "To pay ₹13,260.00", "Paid", "Overpaid ₹1,000.00", ... How a paid month was settled is in settleNotes. */
export function statusText(status: PayStatus, f: MonthFigures): string {
  switch (status) {
    case "TO_PAY":
      return `To pay ${formatMoney(f.balance)}`;
    case "OVERPAID":
      return `Overpaid ${formatMoney(-f.balance)}`;
    case "PAID":
      return "Paid";
    default:
      return f.given > 0 ? `Not entered · ${shortMoney(f.given)} given` : "Not entered";
  }
}

export const WAGE_KIND_LABEL: Record<WageKind, string> = {
  ADVANCE: "Advance",
  SALARY: "Salary",
  RETURNED: "Cash returned",
  WRITE_OFF: "Written off",
  CARRIED: "Taken from next month",
};

/** How an advance carried in from the month before is shown. */
export function carriedInLabel(fromMonth: string): string {
  return `Advance carried from ${monthTitle(fromMonth)}`;
}

/**
 * When editing a salary, "Round off and finish" starts ticked only if its round-off still matches
 * the month. If wages were added after it was finished, saving it again must not quietly write
 * them off.
 */
export function finishStartsTicked(existing: { kind: WageKind; amount: number; round_off: number }, balanceWithout: number): boolean {
  return existing.kind === "SALARY" && existing.round_off !== 0 && round2(balanceWithout - existing.amount) === round2(existing.round_off);
}

/** Enter days sends only rows whose days or OT hours differ from what is saved. */
export function entryChanged(r: { row: { days_worked: number; ot_hours: number } | null }, e: { days_worked: number; ot_hours: number }): boolean {
  return !r.row || r.row.days_worked !== e.days_worked || r.row.ot_hours !== e.ot_hours;
}
