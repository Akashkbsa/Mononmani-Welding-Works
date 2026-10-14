import { compactMoney, monthShort } from "../../lib/dashboardStats";
import { formatMoney } from "../../lib/format";

export interface BarSeries {
  name: string;
  /** Tailwind fill class, e.g. "fill-brand-600". */
  fill: string;
  /** Tailwind background class for the legend dot. */
  dot: string;
  values: number[];
}

/** A round upper limit for the axis: 1, 2, 2.5, 5 or 10 times a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const unit = value / power;
  const step = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return step * power;
}

/** Bars side by side for each month, with a light grid and the amount over each bar. */
export function MonthlyBars({ months, series, label }: { months: string[]; series: BarSeries[]; label: string }) {
  const W = 640;
  const H = 230;
  const left = 46;
  const right = 8;
  const top = 18;
  const bottom = 26;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const groupW = plotW / months.length;
  const barW = Math.min(30, (groupW * 0.72) / series.length);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const empty = series.every((s) => s.values.every((v) => v === 0));

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.dot}`} />
            {s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className="stroke-slate-200" strokeWidth={1} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" className="fill-slate-500" fontSize={11}>
              {compactMoney(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = left + groupW * i + groupW / 2;
          return (
            <g key={m}>
              {series.map((s, j) => {
                const v = s.values[i];
                const x = cx - (barW * series.length) / 2 + barW * j;
                const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
                return (
                  <g key={s.name}>
                    <rect x={x + 1} y={top + plotH - h} width={barW - 2} height={h} rx={2} className={s.fill}>
                      <title>{`${s.name}, ${monthShort(m)}: ${formatMoney(v)}`}</title>
                    </rect>
                    {v > 0 && barW >= 18 && (
                      <text x={x + barW / 2} y={top + plotH - h - 4} textAnchor="middle" className="fill-slate-600" fontSize={10}>
                        {compactMoney(v)}
                      </text>
                    )}
                  </g>
                );
              })}
              <text x={cx} y={H - 8} textAnchor="middle" className="fill-slate-600" fontSize={12}>
                {monthShort(m)}
              </text>
            </g>
          );
        })}
      </svg>
      {empty && <p className="-mt-2 text-center text-xs text-slate-500">Nothing in these months yet.</p>}
      {/* The same figures as text, for screen readers. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Month</th>
            {series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m, i) => (
            <tr key={m}>
              <td>{monthShort(m)}</td>
              {series.map((s) => (
                <td key={s.name}>{formatMoney(s.values[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface HBarRow {
  label: string;
  /** Smaller text under the label. */
  note?: string;
  amount: number;
  /** Tailwind background class for the bar. */
  bar?: string;
}

/** Horizontal bars for a short list: who owes most, how old the unpaid money is. */
export function HBars({ rows, empty, onRowClick }: { rows: HBarRow[]; empty: string; onRowClick?: (index: number) => void }) {
  const max = Math.max(0, ...rows.map((r) => r.amount));
  if (rows.length === 0 || max === 0) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => {
        const body = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-slate-800" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 tabular text-slate-900">{formatMoney(r.amount)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${r.bar ?? "bg-brand-600"}`} style={{ width: `${Math.max(2, (r.amount / max) * 100)}%` }} />
            </div>
            {r.note && <div className="mt-0.5 text-xs text-slate-500">{r.note}</div>}
          </>
        );
        return (
          <li key={r.label}>
            {onRowClick ? (
              <button type="button" className="block w-full text-left hover:opacity-80" onClick={() => onRowClick(i)}>
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
