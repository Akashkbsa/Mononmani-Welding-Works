import { useMemo } from "react";
import { monthTitle, todayISO } from "../lib/format";
import { financialYearOf, isMonth } from "../lib/period";
import { inputClass } from "./ui";

export { inMonth } from "../lib/period";

/**
 * Pick one month, all months, or this or last financial year (April to March). The list offers the
 * months that have records, newest first; the chosen month stays listed even when a search hides
 * all of its records.
 */
export default function MonthFilter({
  dates,
  value,
  onChange,
  allowAll = true,
}: {
  /** The records' dates as YYYY-MM-DD; empty ones are skipped. */
  dates: (string | null | undefined)[];
  /** "" for all months, YYYY-MM for one month, or FY2026 for 1 April 2026 to 31 March 2027. */
  value: string;
  onChange: (month: string) => void;
  /** False leaves out "All months" (a screen that always shows one month). */
  allowAll?: boolean;
}) {
  const months = useMemo(() => {
    const keys = new Set(dates.filter((d): d is string => !!d).map((d) => d.slice(0, 7)));
    if (isMonth(value)) keys.add(value);
    return Array.from(keys).sort().reverse();
  }, [dates, value]);

  const fy = financialYearOf(todayISO());

  return (
    <select aria-label="Month" className={`${inputClass.replace("w-full", "")} w-60 shrink-0`} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && (
        <>
          <option value="">All months</option>
          <option value={`FY${fy}`}>This financial year ({fyLabel(fy)})</option>
          <option value={`FY${fy - 1}`}>Last financial year ({fyLabel(fy - 1)})</option>
        </>
      )}
      {months.map((k) => (
        <option key={k} value={k}>
          {monthTitle(k)}
        </option>
      ))}
    </select>
  );
}

/** 2026 -> "2026-27". */
function fyLabel(start: number): string {
  return `${start}-${String(start + 1).slice(2)}`;
}
