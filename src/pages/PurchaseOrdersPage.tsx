import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Plus, Search } from "lucide-react";
import { listPurchaseOrders } from "../services/api";
import { errorMessage, formatDate } from "../lib/format";
import { PurchaseOrderListItem } from "../types/purchaseOrder";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  inputClass,
  ListSkeleton,
  PageHeader,
  RowChevron,
  rowClass,
  rowProps,
  theadClass,
} from "../components/ui";
import PurchaseOrderFormModal from "../components/purchaseOrders/PurchaseOrderFormModal";
import PurchaseOrderDetailsModal from "../components/purchaseOrders/PurchaseOrderDetailsModal";

type Tab = "all" | "notStarted" | "partial" | "completed";

const TABS: { id: Tab; label: string; match: (po: PurchaseOrderListItem) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "notStarted", label: "Not started", match: (po) => po.status === "NOT_STARTED" },
  { id: "partial", label: "Partially completed", match: (po) => po.status === "PARTIAL" },
  { id: "completed", label: "Completed", match: (po) => po.status === "COMPLETED" },
];

function statusBadge(status: PurchaseOrderListItem["status"]) {
  if (status === "COMPLETED") return <Badge tone="green">Completed</Badge>;
  if (status === "PARTIAL") return <Badge tone="amber">Partially completed</Badge>;
  return <Badge tone="neutral">Not started</Badge>;
}

export default function PurchaseOrdersPage({ onOpenInvoice }: { onOpenInvoice: (invoiceId: number) => void }) {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderListItem[] | null>(null);
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
      setPurchaseOrders(await listPurchaseOrders({ query: query.trim() || undefined }));
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
    () =>
      Object.fromEntries(TABS.map((t) => [t.id, (purchaseOrders ?? []).filter(t.match).length])) as Record<Tab, number>,
    [purchaseOrders]
  );
  const visible = useMemo(
    () => (purchaseOrders ?? []).filter(TABS.find((t) => t.id === tab)!.match),
    [purchaseOrders, tab]
  );

  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    if (el) setSlider({ x: el.offsetLeft, w: el.offsetWidth });
  }, [tab, counts, purchaseOrders]);

  useEffect(() => {
    if (slider && !sliderReady) {
      const frame = requestAnimationFrame(() => setSliderReady(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [slider, sliderReady]);

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Customer purchase orders and the invoices linked to them."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
            New purchase order
          </Button>
        }
      />

      <div className="flex items-end justify-between gap-4 mb-4 border-b border-slate-200">
        <div role="tablist" aria-label="Purchase order status" className="relative flex gap-1">
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
              {purchaseOrders && t.id !== "all" && counts[t.id] > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 tabular">{counts[t.id]}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-72 mb-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchRef}
            aria-label="Search purchase orders"
            className={`${inputClass} pl-9`}
            placeholder="Search PO number or customer   ( / )"
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
        {purchaseOrders === null ? (
          <ListSkeleton label="Loading purchase orders" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={purchaseOrders.length === 0 && !query ? "No purchase orders yet" : "No purchase orders here"}
            description={
              purchaseOrders.length === 0 && !query
                ? "Add the first purchase order to start keeping customer references and attachments together."
                : "Try another tab, or clear the search box."
            }
            action={
              purchaseOrders.length === 0 && !query ? (
                <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                  New purchase order
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <table className="mww-fade w-full text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className="py-2.5 px-4 font-semibold">PO number</th>
                  <th className="py-2.5 pr-4 font-semibold">Customer</th>
                  <th className="py-2.5 pr-4 font-semibold">PO date</th>
                  <th className="py-2.5 pr-4 font-semibold">Status</th>
                  <th className="py-2.5 pr-4 font-semibold text-right">Files</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Invoices</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((po) => (
                  <tr key={po.id} {...rowProps(() => setViewingId(po.id))} className={rowClass}>
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">{po.po_number}</td>
                    <td className="max-w-[18rem] truncate py-3 pr-4" title={po.customer_name}>
                      {po.customer_name}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{po.po_date ? formatDate(po.po_date) : "-"}</td>
                    <td className="py-3 pr-4">{statusBadge(po.status)}</td>
                    <td className="py-3 pr-4 text-right tabular">{po.file_count}</td>
                    <td className="py-3 px-4 text-right tabular">{po.invoice_count}</td>
                    <RowChevron />
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg text-sm text-slate-600">
              {visible.length} purchase order{visible.length === 1 ? "" : "s"}
            </div>
          </>
        )}
      </Card>

      {creating && (
        <PurchaseOrderFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {viewingId !== null && (
        <PurchaseOrderDetailsModal
          id={viewingId}
          onClose={() => setViewingId(null)}
          onChanged={load}
          onOpenInvoice={(invoiceId) => {
            setViewingId(null);
            onOpenInvoice(invoiceId);
          }}
        />
      )}
    </>
  );
}
