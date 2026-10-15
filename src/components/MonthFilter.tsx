import { useMemo } from "react";
import { monthTitle } from "../lib/format";
import { inputClass } from "./ui";

/** True when a stored YYYY-MM-DD date falls in the chosen month; "" (all months) matches everything. */
export function inMonth(date: string | null | undefined, month: string): boolean {
  return !month || (!!date && date.startsWith(month));
}

/**
 * Pick one month, or all months. The list offers the months that have records, newest first;
 * the chosen month stays listed even when a search hides all of its records.
 */
export default function MonthFilter({
  dates,
  value,
  onChange,
  allowAll = true,
}: {
  /** The records' dates as YYYY-MM-DD; empty ones are skipped. */
  dates: (string | null | undefined)[];
  /** "" for all months, otherwise YYYY-MM. */
  value: string;
  onChange: (month: string) => void;
  /** False leaves out "All months" (a screen that always shows one month). */
  allowAll?: boolean;
}) {
  const months = useMemo(() => {
    const keys = new Set(dates.filter((d): d is string => !!d).map((d) => d.slice(0, 7)));
    if (value) keys.add(value);
    return Array.from(keys).sort().reverse();
  }, [dates, value]);

  return (
    <select aria-label="Month" className={`${inputClass.replace("w-full", "")} w-48 shrink-0`} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">All months</option>}
      {months.map((k) => (
        <option key={k} value={k}>
          {monthTitle(k)}
        </option>
      ))}
    </select>
  );
}
