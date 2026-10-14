import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, ReceiptText, Search } from "lucide-react";
import { getSupplierBillsSummary, listSupplierBills } from "../services/api";
import { errorMessage, formatDate, formatMoney } from "../lib/format";
import { SupplierBillListItem, SupplierBillsSummary } from "../types/supplierBill";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  inputClass,
  ListSkeleton,
  PageHeader,
  RowChevron,
  rowClass,
  rowProps,
  Stat,
  StatStrip,
  theadClass,
} from "../components/ui";
import SupplierBillFormModal from "../components/supplierBills/SupplierBillFormModal";
import SupplierBillDetailsModal from "../components/supplierBills/SupplierBillDetailsModal";
import SupplierBillStatusBadge from "../components/supplierBills/SupplierBillStatusBadge";

type Tab = "all" | "notPaid" | "partial" | "paid";

const TABS: { id: Tab; label: string; match: (b: SupplierBillListItem) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "notPaid", label: "Not paid", match: (b) => b.status === "NOT_PAID" },
  { id: "partial", label: "Partially paid", match: (b) => b.status === "PARTIAL" },
  { id: "paid", label: "Fully paid", match: (b) => b.status === "PAID" },
];

export default function SupplierBillsPage({ onOpenPayment }: { onOpenPayment: (paymentId: number) => void }) {
  const [bills, setBills] = useState<SupplierBillListItem[] | null>(null);
  const [summary, setSummary] = useState<SupplierBillsSummary | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [slider, setSlider] = useState<{ x: number; w: number } | null>(null);
  const [sliderReady, setSliderReady] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const load = useCallback(async () => {
    try {
      const [list, totals] = await Promise.all([
        listSupplierBills({ query: query.trim() || undefined }),
        getSupplierBillsSummary(),
      ]);
      setBills(list);
      setSummary(totals);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.id, (bills ?? []).filter(t.match).length])) as Record<Tab, number>,
    [bills]
  );
  const visible = useMemo(() => (bills ?? []).filter(TABS.find((t) => t.id === tab)!.match), [bills, tab]);

  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    if (el) setSlider({ x: el.offsetLeft, w: el.offsetWidth });
  }, [tab, counts, bills]);

  useEffect(() => {
    if (slider && !sliderReady) {
      const frame = requestAnimationFrame(() => setSliderReady(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [slider, sliderReady]);

  const nothingYet = bills !== null && bills.length === 0 && !query;

  return (
    <>
      <PageHeader
        title="Supplier bills"
        description="Bills you receive from suppliers and what you still owe."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
            New supplier bill
          </Button>
        }
      />

      {summary && (
        <div className="mb-5">
          <StatStrip cols={3}>
            <Stat label="You owe suppliers" value={formatMoney(summary.total_outstanding)} tone="attention" />
            <Stat label="Open bills" value={String(summary.open_bills_count)} />
            <Stat label="Advances paid to suppliers" value={formatMoney(summary.advances_held)} />
          </StatStrip>
        </div>
      )}

      <div className="flex items-end justify-between gap-4 mb-4 border-b border-slate-200">
        <div role="tablist" aria-label="Supplier bill status" className="relative flex gap-1">
          <span
            aria-hidden="true"
            className={`${sliderReady ? "mww-slider" : ""} pointer-events-none absolute -bottom-px left-0 h-0.5 w-[100px] origin-left bg-brand-600`}
            style={{ transform: slider ? `translateX(${slider.x}px) scaleX(${slider.w / 100})` : "scaleX(0)" }}
          />
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 h-9 text-sm transition-colors ${
                tab === t.id ? "text-brand-700 font-medium" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
              {bills && t.id !== "all" && counts[t.id] > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 tabular">{counts[t.id]}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-72 mb-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchRef}
            aria-label="Search supplier bills"
            className={`${inputClass} pl-9`}
            placeholder="Search bill number or supplier   ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {bills === null ? (
          <ListSkeleton label="Loading supplier bills" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title={nothingYet ? "No supplier bills yet" : "No supplier bills here"}
            description={
              nothingYet
                ? "Add a bill when a supplier sends one, then record what you pay against it."
                : "Try another tab, or clear the search box."
            }
            action={
              nothingYet ? (
                <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                  New supplier bill
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <table className="mww-fade w-full text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Bill number</th>
                  <th className="py-2.5 pr-4 font-semibold">Supplier</th>
                  <th className="py-2.5 pr-4 font-semibold">Date</th>
                  <th className="py-2.5 pr-4 font-semibold text-right">Total</th>
                  <th className="py-2.5 pr-4 font-semibold text-right">Balance due</th>
                  <th className="py-2.5 pr-4 font-semibold">Status</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Files</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((b) => (
                  <tr key={b.id} {...rowProps(() => setViewingId(b.id))} className={rowClass}>
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">{b.bill_number}</td>
                    <td className="max-w-[16rem] truncate py-3 pr-4" title={b.supplier_name}>
                      {b.supplier_name}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{formatDate(b.bill_date)}</td>
                    <td className="py-3 pr-4 text-right tabular">{formatMoney(b.total_amount)}</td>
                    <td className="py-3 pr-4 text-right tabular">
                      {b.outstanding_amount > 0 ? (
                        <span className="font-medium text-arc-700">{formatMoney(b.outstanding_amount)}</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <SupplierBillStatusBadge status={b.status} />
                    </td>
                    <td className="py-3 px-4 text-right tabular">{b.file_count}</td>
                    <RowChevron />
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg text-sm text-slate-600">
              {visible.length} supplier bill{visible.length === 1 ? "" : "s"}
            </div>
          </>
        )}
      </Card>

      {creating && (
        <SupplierBillFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {viewingId !== null && (
        <SupplierBillDetailsModal
          id={viewingId}
          onClose={() => setViewingId(null)}
          onChanged={load}
          onOpenPayment={(paymentId) => {
            setViewingId(null);
            onOpenPayment(paymentId);
          }}
        />
      )}
    </>
  );
}
