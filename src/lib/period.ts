import { monthTitle } from "./format";

/**
 * The list filters pick a period: "" for all months, "YYYY-MM" for one month, or "FY2026" for the
 * financial year 1 April 2026 to 31 March 2027.
 */

/** The year a YYYY-MM-DD date's financial year starts in (April to March). */
export function financialYearOf(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

/** True for one calendar month, false for all months or a financial year. */
export function isMonth(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period);
}

/** True when a stored YYYY-MM-DD date falls in the chosen period; "" (all months) matches everything. */
export function inMonth(date: string | null | undefined, period: string): boolean {
  if (!period) return true;
  if (!date) return false;
  if (period.startsWith("FY")) {
    const start = Number(period.slice(2));
    return date >= `${start}-04-01` && date <= `${start + 1}-03-31`;
  }
  return date.startsWith(period);
}

/** "October 2026", or "financial year 2026-27". */
export function periodTitle(period: string): string {
  if (period.startsWith("FY")) {
    const start = Number(period.slice(2));
    return `financial year ${start}-${String(start + 1).slice(2)}`;
  }
  return monthTitle(period);
}
