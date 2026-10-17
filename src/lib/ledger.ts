import { formatMoney } from "./format";
import { periodKind, rangeDates } from "./period";

/** "₹1,08,560.00 Dr" (they owe us), "₹4,000.00 Cr" (we owe them) or "Nil". */
export function balanceText(balance: number): string {
  if (balance > 0) return `${formatMoney(balance)} Dr`;
  if (balance < 0) return `${formatMoney(-balance)} Cr`;
  return "Nil";
}

/**
 * The From and To dates (YYYY-MM-DD) for a period from the period picker; null for no limit.
 * A period running past today stops at today, so the ledger reads "balance as on today".
 */
export function periodBounds(period: string, today: string): { from: string | null; to: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  switch (periodKind(period)) {
    case "month": {
      const [y, m] = period.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      from = `${period}-01`;
      to = `${period}-${String(last).padStart(2, "0")}`;
      break;
    }
    case "fy": {
      const y = Number(period.slice(2));
      from = `${y}-04-01`;
      to = `${y + 1}-03-31`;
      break;
    }
    case "range":
      ({ from, to } = rangeDates(period));
      break;
    default:
      return { from: null, to: null };
  }
  if (to && from && to > today && from <= today) to = today;
  return { from, to };
}
