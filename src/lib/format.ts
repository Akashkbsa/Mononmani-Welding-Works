const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: number | null | undefined): string {
  return inr.format(value ?? 0);
}

/**
 * Round a rupee amount to paise as a calculator does: half a paisa goes up (away from zero).
 * The paise are first read to 15 significant digits, so a stored 1.005 (really 1.00499999…) still
 * rounds to 1.01. Mirrors `round2` in the backend's util.rs, so the screen and saved figures agree.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return value;
  const paise = Number((value * 100).toPrecision(15));
  const rounded = (Math.sign(paise) * Math.round(Math.abs(paise))) / 100;
  // No "-₹0.00" for a tiny negative amount.
  return rounded === 0 ? 0 : rounded;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Today's date in the user's time zone as YYYY-MM-DD. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

/** "+919876543210" -> "+91 98765 43210". Numbers from other countries are shown as stored. */
export function formatPhone(value: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(value);
  return m ? `+91 ${m[1]} ${m[2]}` : value;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The current month as YYYY-MM. */
export function currentMonth(): string {
  return todayISO().slice(0, 7);
}

/** Move a YYYY-MM month forward or back: ("2026-12", 1) -> "2027-01". */
export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** "2026-11" -> "November 2026". */
export function monthTitle(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return `${MONTH_NAMES[number - 1] ?? month} ${year}`;
}

/** "2026-11-03" -> "3 Nov", for small notes where the year is clear from the page. */
export function shortDate(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  const name = m ? MONTH_NAMES[Number(m[2]) - 1] : undefined;
  return m && name ? `${Number(m[3])} ${name.slice(0, 3)}` : "—";
}

/**
 * Indian vehicle registration number in the usual written form, or null when it isn't one:
 * "tn09ab1234" -> "TN 09 AB 1234", "dl1cab1234" -> "DL 1C AB 1234", "22bh1234aa" -> "22 BH 1234 AA".
 * Mirrors the check in the backend.
 */
export function formatVehicleNumber(raw: string): string | null {
  if (/[^A-Za-z0-9 .\-]/.test(raw)) return null;
  const s = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const bh = /^(\d{2})BH(\d{4})([A-Z]{2})$/.exec(s);
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

/** "1.2 MB" or "34.5 KB" for a file size in bytes. */
export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}
