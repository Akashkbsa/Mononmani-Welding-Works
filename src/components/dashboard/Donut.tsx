import { compactMoney } from "../../lib/dashboardStats";
import { formatMoney } from "../../lib/format";

export interface DonutPart {
  label: string;
  amount: number;
  /** Tailwind stroke class for the ring, e.g. "stroke-brand-600". */
  stroke: string;
  /** Tailwind background class for the legend dot. */
  dot: string;
  note?: string;
}

/** A ring split into parts with the total in the middle and a legend beside it. */
export default function Donut({ parts, centerLabel, empty }: { parts: DonutPart[]; centerLabel: string; empty: string }) {
  const total = parts.reduce((sum, p) => sum + p.amount, 0);
  if (total <= 0) return <p className="py-10 text-center text-sm text-slate-500">{empty}</p>;
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${centerLabel}: ${formatMoney(total)}`} className="h-36 w-36 shrink-0">
        <circle cx={70} cy={70} r={R} fill="none" className="stroke-slate-100" strokeWidth={18} />
        <g transform="rotate(-90 70 70)">
          {parts.map((p) => {
            if (p.amount <= 0) return null;
            const length = (p.amount / total) * C;
            const drawn = Math.max(0, length - 1.5);
            const circle = (
              <circle
                key={p.label}
                cx={70}
                cy={70}
                r={R}
                fill="none"
                className={p.stroke}
                strokeWidth={18}
                strokeDasharray={`${drawn} ${C - drawn}`}
                strokeDashoffset={-offset}
              >
                <title>{`${p.label}: ${formatMoney(p.amount)}`}</title>
              </circle>
            );
            offset += length;
            return circle;
          })}
        </g>
        <text x={70} y={66} textAnchor="middle" className="fill-slate-500" fontSize={9}>
          {centerLabel}
        </text>
        <text x={70} y={82} textAnchor="middle" className="fill-slate-900" fontSize={15} fontWeight={600}>
          {compactMoney(total)}
        </text>
      </svg>
      <ul className="w-full min-w-0 space-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-start gap-2">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${p.dot}`} />
              <span className="min-w-0">
                <span className="block truncate text-slate-800">{p.label}</span>
                {p.note && <span className="block text-xs text-slate-500">{p.note}</span>}
              </span>
            </span>
            <span className="shrink-0 tabular text-slate-900">{formatMoney(p.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
