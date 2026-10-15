import { formatDate, monthTitle, shiftMonth } from "./format";

/**
 * The list filters pick a period, kept as text:
 * - "" for all dates
 * - "YYYY-MM" for one month
 * - "FY2026" for the financial year 1 April 2026 to 31 March 2027
 * - "R:YYYY-MM-DD:YYYY-MM-DD" for a custom range, both days included
 */
export type PeriodKind = "all" | "month" | "fy" | "range";

export function periodKind(period: string): PeriodKind {
  if (!period) return "all";
  if (period.startsWith("FY")) return "fy";
  if (period.startsWith("R:")) return "range";
  return "month";
}

/** The year a YYYY-MM-DD date's financial year starts in (April to March). */
export function financialYearOf(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

/** True for one calendar month. */
export function isMonth(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period);
}

/** One step back (-1) or forward (+1): a month or a financial year. Others stay as they are. */
export function shiftPeriod(period: string, delta: number): string {
  const kind = periodKind(period);
  if (kind === "month") return shiftMonth(period, delta);
  if (kind === "fy") return `FY${Number(period.slice(2)) + delta}`;
  return period;
}

/** Where a kind starts when chosen: this month, this financial year, or this month so far. */
export function startOf(kind: PeriodKind, today: string): string {
  switch (kind) {
    case "month":
      return today.slice(0, 7);
    case "fy":
      return `FY${financialYearOf(today)}`;
    case "range":
      return rangePeriod(`${today.slice(0, 7)}-01`, today);
    default:
      return "";
  }
}

/** A custom range; the earlier day always comes first. */
export function rangePeriod(from: string, to: string): string {
  return from <= to ? `R:${from}:${to}` : `R:${to}:${from}`;
}

export function rangeDates(period: string): { from: string; to: string } {
  const [, from = "", to = ""] = period.split(":");
  return { from, to };
}

/** True when a stored YYYY-MM-DD date falls in the chosen period; "" (all dates) matches everything. */
export function inMonth(date: string | null | undefined, period: string): boolean {
  const kind = periodKind(period);
  if (kind === "all") return true;
  if (!date) return false;
  if (kind === "fy") {
    const start = Number(period.slice(2));
    return date >= `${start}-04-01` && date <= `${start + 1}-03-31`;
  }
  if (kind === "range") {
    const { from, to } = rangeDates(period);
    return date >= from && date <= to;
  }
  return date.startsWith(period);
}

/** 2026 -> "2026-27". */
export function fyLabel(start: number): string {
  return `${start}-${String(start + 1).slice(2)}`;
}

/** "October 2026", "financial year 2026-27" or "01-10-2026 to 20-10-2026". */
export function periodTitle(period: string): string {
  switch (periodKind(period)) {
    case "fy":
      return `financial year ${fyLabel(Number(period.slice(2)))}`;
    case "range": {
      const { from, to } = rangeDates(period);
      return `${formatDate(from)} to ${formatDate(to)}`;
    }
    case "all":
      return "all dates";
    default:
      return monthTitle(period);
  }
}
