/** The sums behind the dashboard charts. Plain functions, so they are easy to check. */

export interface Money {
  /** YYYY-MM-DD */
  date: string;
  amount: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The last `count` months ending with the month of `today` (YYYY-MM-DD), oldest first, as YYYY-MM. */
export function lastMonths(today: string, count: number): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const index = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(index / 12)}-${pad((index % 12) + 1)}`);
  }
  return out;
}

/** Total per month for the given months; entries outside them are ignored. */
export function monthlySums(items: Money[], months: string[]): number[] {
  const sums = new Map(months.map((m) => [m, 0]));
  for (const item of items) {
    const key = item.date.slice(0, 7);
    if (sums.has(key)) sums.set(key, (sums.get(key) ?? 0) + item.amount);
  }
  return months.map((m) => Math.round((sums.get(m) ?? 0) * 100) / 100);
}

/** Whole days from a YYYY-MM-DD date to `today` (0 for today or a future date). */
export function ageInDays(date: string, today: string): number {
  const toTime = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(0, Math.round((toTime(today) - toTime(date)) / 86_400_000));
}

export interface Ranked {
  name: string;
  amount: number;
  count: number;
}

/** The biggest totals by name (a customer or a supplier), largest first. */
export function topByName(items: { name: string; amount: number }[], limit: number): Ranked[] {
  const totals = new Map<string, Ranked>();
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    const row = totals.get(key) ?? { name: item.name.trim(), amount: 0, count: 0 };
    row.amount += item.amount;
    row.count += 1;
    totals.set(key, row);
  }
  return [...totals.values()]
    .map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** "Oct" for 2026-10, with the year added for January so a six-month chart reads clearly. */
export function monthShort(month: string): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `Jan ${String(y).slice(2)}` : names[m - 1];
}

/** ₹1.2 L, ₹45 K style for chart labels: "₹12,50,000" is too long to sit on a bar. */
export function compactMoney(value: number): string {
  const v = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (v >= 10_000_000) return `${sign}₹${(v / 10_000_000).toFixed(v >= 100_000_000 ? 0 : 1).replace(/\.0$/, "")} Cr`;
  if (v >= 100_000) return `${sign}₹${(v / 100_000).toFixed(v >= 1_000_000 ? 0 : 1).replace(/\.0$/, "")} L`;
  if (v >= 1000) return `${sign}₹${(v / 1000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, "")} K`;
  return `${sign}₹${Math.round(v)}`;
}
