const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: number | null | undefined): string {
  return inr.format(value ?? 0);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Today's date in the user's time zone as YYYY-MM-DD. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from a YYYY-MM-DD date to today (0 for today or a future date). */
export function daysSince(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

/** "Today", "1 day old", "45 days old": how long an invoice has been waiting. */
export function ageLabel(iso: string): string {
  const n = daysSince(iso);
  return n === 0 ? "Today" : `${n} day${n === 1 ? "" : "s"} old`;
}

/** Stored dates are YYYY-MM-DD; show them the Indian way, DD-MM-YYYY. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : value;
}

/**
 * Indian vehicle registration number in the usual written form, or null when it isn't one:
 * "tn09ab1234" -> "TN 09 AB 1234", "dl1cab1234" -> "DL 1C AB 1234", "22bh1234aa" -> "22 BH 1234 AA".
 * Mirrors the check in the backend.
 */
export function formatVehicleNumber(raw: string): string | null {
  if (/[^A-Za-z0-9 .\-]/.test(raw)) return null;
  const s = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const bh = /^(\d{2})BH(\d{4})([A-Z]{1,2})$/.exec(s);
  if (bh) return `${bh[1]} BH ${bh[2]} ${bh[3]}`;
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/.exec(s);
  if (!m) return null;
  const [, state, rtoDigits, seriesLetters, number] = m;
  let rto = rtoDigits;
  let series = seriesLetters;
  // Delhi-style single-digit RTO carries a letter: DL 1C AB 1234.
  if (rto.length === 1 && series.length === 3) {
    rto += series[0];
    series = series.slice(1);
  }
  return [state, rto, series, number].filter(Boolean).join(" ");
}

/** "PO-123 & 12-01-2026" -> number "PO-123" and date "2026-01-12" (date empty when there is none). */
export function splitRefDate(value: string | null | undefined): { number: string; dateISO: string } {
  const v = value ?? "";
  const i = v.lastIndexOf(" & ");
  if (i >= 0) {
    const d = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v.slice(i + 3).trim());
    if (d) return { number: v.slice(0, i), dateISO: `${d[3]}-${d[2]}-${d[1]}` };
  }
  return { number: v, dateISO: "" };
}

/** The other way round: number and date -> "PO-123 & 12-01-2026"; empty without a number. */
export function joinRefDate(number: string, dateISO: string): string {
  if (!number.trim()) return "";
  return dateISO ? `${number} & ${formatDate(dateISO)}` : number;
}

/** Turns errors from the backend into a readable sentence. */
export function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error:\s*/, "");
}
