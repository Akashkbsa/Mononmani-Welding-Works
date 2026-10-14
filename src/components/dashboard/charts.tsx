import { useLayoutEffect, useRef, useState } from "react";
import { compactMoney, monthShort } from "../../lib/dashboardStats";
import { formatMoney, monthTitle } from "../../lib/format";

export interface BarSeries {
  name: string;
  /** Tailwind fill class for the bars, e.g. "fill-brand-600". */
  fill: string;
  /** Tailwind background class for the legend dot. */
  dot: string;
  values: number[];
}

/** A round top for the axis and how many equal steps to draw, so every grid line is a round figure. */
function niceScale(value: number): { max: number; steps: number } {
  if (value <= 0) return { max: 1, steps: 4 };
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const unit = value / power;
  if (unit <= 1) return { max: power, steps: 4 };
  if (unit <= 2) return { max: 2 * power, steps: 4 };
  if (unit <= 2.5) return { max: 2.5 * power, steps: 5 };
  if (unit <= 5) return { max: 5 * power, steps: 5 };
  return { max: 10 * power, steps: 5 };
}

/** Follows the size of its box, so the chart is drawn at real size, fills the card and the text stays crisp. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 600, height: 260 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ width: el.clientWidth || 600, height: el.clientHeight || 260 });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

/** Bars side by side for each month, filling the box it is in. Pointing at a month shows its exact amounts. */
export function BarChart({ months, series, label }: { months: string[]; series: BarSeries[]; label: string }) {
  const { ref, width, height } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const left = 58;
  const right = 4;
  const top = 10;
  const bottom = 26;
  const plotW = Math.max(100, width - left - right);
  const plotH = height - top - bottom;
  const { max, steps } = niceScale(Math.max(0, ...series.flatMap((s) => s.values)));
  const groupW = plotW / months.length;
  const barW = Math.max(6, Math.min(30, (groupW * 0.62) / series.length));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: steps + 1 }, (_, i) => (max / steps) * i);
  const empty = series.every((s) => s.values.every((v) => v === 0));
  const tipLeft = hover === null ? 0 : Math.min(Math.max(left + groupW * hover + groupW / 2, 90), width - 90);

  return (
    <div ref={ref} className="relative h-full min-h-[15rem] w-full" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={label} className="absolute inset-0 block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-slate-300" : "stroke-slate-100"} strokeWidth={1} />
            {!empty && (
              <text x={left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-500" fontSize={11}>
                {compactMoney(t)}
              </text>
            )}
          </g>
        ))}
        {months.map((m, i) => {
          const gx = left + groupW * i;
          const cx = gx + groupW / 2;
          return (
            <g key={m}>
              {hover === i && <rect x={gx + 2} y={top} width={groupW - 4} height={plotH} rx={4} className="fill-slate-100" />}
              {series.map((s, j) => {
                const v = s.values[i];
                const h = v > 0 ? Math.max(2, (v / max) * plotH) : 0;
                const x = cx - (barW * series.length) / 2 + barW * j;
                return <rect key={s.name} x={x + 1.5} y={top + plotH - h} width={barW - 3} height={h} rx={3} className={s.fill} />;
              })}
              <text x={cx} y={height - 8} textAnchor="middle" className={hover === i ? "fill-slate-900" : "fill-slate-500"} fontSize={12}>
                {monthShort(m)}
              </text>
              <rect x={gx} y={0} width={groupW} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-md bg-ink-900 px-3 py-2 text-xs text-white shadow-lg"
          style={{ left: tipLeft }}
        >
          <div className="mb-1 font-medium">{monthTitle(months[hover])}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className={`h-2 w-2 rounded-sm ${s.dot}`} />
                {s.name}
              </span>
              <span className="tabular">{formatMoney(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}
      {empty && <p className="absolute inset-x-0 top-1/3 text-center text-sm text-slate-500">Nothing in these months yet.</p>}
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
              <td>{monthTitle(m)}</td>
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

/** A small trend line; the last point is marked. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const W = 120;
  const H = 30;
  const max = Math.max(...values, 0);
  const pts = values.map((v, i) => [values.length === 1 ? W / 2 : (i / (values.length - 1)) * (W - 4) + 2, H - 3 - (max > 0 ? (v / max) * (H - 6) : 0)]);
  const path = pts.map(([x, py], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-8 w-full" preserveAspectRatio="none">
      <path d={`${path} L${last[0]},${H} L${pts[0][0]},${H} Z`} className="fill-brand-100" />
      <path d={path} fill="none" className="stroke-brand-600" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} className="fill-brand-600" />
    </svg>
  );
}

export interface Segment {
  label: string;
  amount: number;
  /** Tailwind background class. */
  color: string;
}

/** One thin bar split into parts, e.g. unpaid money by age. */
export function SegmentBar({ parts }: { parts: Segment[] }) {
  const total = parts.reduce((s, p) => s + p.amount, 0);
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={parts.map((p) => `${p.label}: ${formatMoney(p.amount)}`).join(", ")}>
      {total > 0 &&
        parts.map((p) =>
          p.amount > 0 ? <div key={p.label} className={`h-full ${p.color}`} style={{ width: `${(p.amount / total) * 100}%` }} title={`${p.label}: ${formatMoney(p.amount)}`} /> : null
        )}
    </div>
  );
}

/** How much of something is done, as a filled bar. */
export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={label}>
      <div className="h-full rounded-full bg-brand-600" style={{ width: `${share * 100}%` }} />
    </div>
  );
}

export interface SharePart {
  label: string;
  amount: number;
  /** Tailwind stroke class for the ring. */
  stroke: string;
  /** Tailwind background class for the legend dot. */
  dot: string;
}

/** A ring of who makes up a total, with each part's share listed beside it. */
export function ShareRing({ parts, centerLabel, empty, onPick }: { parts: SharePart[]; centerLabel: string; empty: string; onPick?: (label: string) => void }) {
  const total = parts.reduce((s, p) => s + p.amount, 0);
  if (total <= 0) return <p className="py-12 text-center text-sm text-slate-500">{empty}</p>;
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-5 2xl:gap-6">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${centerLabel}: ${formatMoney(total)}`} className="h-32 w-32 shrink-0 2xl:h-36 2xl:w-36">
        <g transform="rotate(-90 70 70)">
          {parts.map((p) => {
            const length = (p.amount / total) * C;
            const drawn = Math.max(0, length - 2);
            const ring = (
              <circle
                key={p.label}
                cx={70}
                cy={70}
                r={R}
                fill="none"
                className={p.stroke}
                strokeWidth={16}
                strokeDasharray={`${drawn} ${C - drawn}`}
                strokeDashoffset={-offset}
              >
                <title>{`${p.label}: ${formatMoney(p.amount)}`}</title>
              </circle>
            );
            offset += length;
            return ring;
          })}
        </g>
        <text x={70} y={64} textAnchor="middle" className="fill-slate-500" fontSize={10}>
          {centerLabel}
        </text>
        <text x={70} y={82} textAnchor="middle" className="fill-slate-900" fontSize={17} fontWeight={600}>
          {compactMoney(total)}
        </text>
      </svg>
      <ul className="grid min-w-0 flex-1 grid-cols-1 gap-y-1.5 text-sm">
        {parts.map((p) => {
          const body = (
            <>
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${p.dot}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-800" title={p.label}>
                  {p.label}
                </span>
              </span>
              <span className="shrink-0 tabular text-slate-900">{compactMoney(p.amount)}</span>
              <span className="hidden w-10 shrink-0 text-right text-xs leading-5 text-slate-500 tabular 2xl:inline">{Math.round((p.amount / total) * 100)}%</span>
            </>
          );
          return (
            <li key={p.label}>
              {onPick && p.label !== "Others" ? (
                <button type="button" onClick={() => onPick(p.label)} className="flex w-full items-start gap-2 rounded text-left hover:text-brand-700">
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
