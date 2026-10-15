import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonth, monthTitle, todayISO } from "../lib/format";
import { financialYearOf, fyLabel, periodKind, PeriodKind, rangeDates, rangePeriod, shiftPeriod, startOf } from "../lib/period";
import { inputClass } from "./ui";

export { inMonth } from "../lib/period";

const KINDS: { id: PeriodKind; label: string }[] = [
  { id: "all", label: "All dates" },
  { id: "month", label: "Month" },
  { id: "fy", label: "Financial year" },
  { id: "range", label: "Custom range" },
];

const smallInput = inputClass.replace("w-full", "");

/**
 * Pick the dates a list shows: all, one month or one financial year (April to March) with ‹ › to step
 * back and forward, or a custom range of days. With `allowAll` off it is a month picker only, kept
 * between the first and last of `dates`.
 */
export default function MonthFilter({
  dates,
  value,
  onChange,
  allowAll = true,
}: {
  /** The records' dates as YYYY-MM-DD. Only used to bound the month picker when `allowAll` is off. */
  dates: (string | null | undefined)[];
  /** "" for all dates, YYYY-MM, FY2026, or R:YYYY-MM-DD:YYYY-MM-DD (see `lib/period.ts`). */
  value: string;
  onChange: (period: string) => void;
  /** False: one month at a time, no other choices (a screen that always shows one month). */
  allowAll?: boolean;
}) {
  const today = todayISO();
  const kind = periodKind(value);

  // Months only: stay between the first and last month given. Otherwise never past this month or year.
  const bounds = useMemo(() => {
    const months = dates.filter((d): d is string => !!d).map((d) => d.slice(0, 7)).sort();
    return { first: months[0] ?? null, last: months[months.length - 1] ?? null };
  }, [dates]);
  const max = kind === "fy" ? `FY${financialYearOf(today)}` : allowAll ? currentMonth() : (bounds.last ?? currentMonth());
  const min = !allowAll ? bounds.first : null;
  const atMax = kind === "fy" ? Number(value.slice(2)) >= Number(max.slice(2)) : value >= max;
  const atMin = min !== null && value <= min;

  const label = kind === "fy" ? `FY ${fyLabel(Number(value.slice(2)))}` : monthTitle(value);
  const range = kind === "range" ? rangeDates(value) : null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {allowAll && (
        <select
          aria-label="Show dates"
          className={`${smallInput} w-36`}
          value={kind}
          onChange={(e) => onChange(startOf(e.target.value as PeriodKind, today))}
        >
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      )}

      {(kind === "month" || kind === "fy") && (
        <div className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white">
          <button
            type="button"
            aria-label={kind === "fy" ? "Previous financial year" : "Previous month"}
            disabled={atMin}
            onClick={() => onChange(shiftPeriod(value, -1))}
            className="flex h-full w-8 items-center justify-center rounded-l-md text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span aria-live="polite" className="min-w-[8.5rem] px-1 text-center text-sm font-medium text-slate-800 tabular">
            {label}
          </span>
          <button
            type="button"
            aria-label={kind === "fy" ? "Next financial year" : "Next month"}
            disabled={atMax}
            onClick={() => onChange(shiftPeriod(value, 1))}
            className="flex h-full w-8 items-center justify-center rounded-r-md text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {range && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <input
            aria-label="From date"
            type="date"
            className={`${smallInput} w-40`}
            value={range.from}
            max={today}
            onChange={(e) => e.target.value && onChange(rangePeriod(e.target.value, range.to))}
          />
          <span>to</span>
          <input
            aria-label="To date"
            type="date"
            className={`${smallInput} w-40`}
            value={range.to}
            onChange={(e) => e.target.value && onChange(rangePeriod(range.from, e.target.value))}
          />
        </div>
      )}
    </div>
  );
}
