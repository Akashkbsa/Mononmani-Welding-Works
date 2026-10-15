import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileCheck2, Plus, Search } from "lucide-react";
import { listQuotations } from "../services/api";
import { errorMessage, formatDate } from "../lib/format";
import { QuotationListItem } from "../types/quotation";
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
  theadClass,
} from "../components/ui";
import QuotationFormModal from "../components/quotations/QuotationFormModal";
import QuotationDetailsModal from "../components/quotations/QuotationDetailsModal";
import { usePageShortcuts } from "../lib/usePageShortcuts";
import MonthFilter, { inMonth } from "../components/MonthFilter";

interface Props {
  /** A quotation to open as soon as the page shows (set by another screen). */
  openQuotationId?: number | null;
  onOpenHandled?: () => void;
  onOpenPurchaseOrder: (purchaseOrderId: number) => void;
}

export default function QuotationsPage({ openQuotationId = null, onOpenHandled, onOpenPurchaseOrder }: Props) {
  const [quotations, setQuotations] = useState<QuotationListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (openQuotationId === null) return;
    setViewingId(openQuotationId);
    onOpenHandled?.();
  }, [openQuotationId, onOpenHandled]);

  usePageShortcuts({ searchRef, onNew: () => setCreating(true) });

  const load = useCallback(async () => {
    try {
      setQuotations(await listQuotations({ query: query.trim() || undefined }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const nothingYet = quotations !== null && quotations.length === 0 && !query;

  const [month, setMonth] = useState("");
  const shown = useMemo(() => (quotations ?? []).filter((q) => inMonth(q.quotation_date, month)), [quotations, month]);

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Quotations sent to companies and the purchase orders that follow."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)} title="New quotation (Ctrl+N)">
            New quotation
          </Button>
        }
      />

      <div className="flex justify-end mb-4">
        <div className="relative w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchRef}
            aria-label="Search quotations"
            className={`${inputClass} pl-9`}
            placeholder="Search quotation number or company   ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <MonthFilter dates={(quotations ?? []).map((r) => r.quotation_date)} value={month} onChange={setMonth} />
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {quotations === null ? (
          <ListSkeleton label="Loading quotations" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={FileCheck2}
            title={nothingYet ? "No quotations yet" : "No quotations here"}
            description={
              nothingYet
                ? "Add the first quotation to keep what you sent to companies, and the purchase orders that follow, together."
                : "Try another word or month, or clear the search box."
            }
            action={
              nothingYet ? (
                <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                  New quotation
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <table className="mww-fade w-full text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Quotation number</th>
                  <th className="py-2.5 pr-4 font-semibold">Company</th>
                  <th className="py-2.5 pr-4 font-semibold">Date</th>
                  <th className="py-2.5 pr-4 font-semibold text-right">Files</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Purchase orders</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((q) => (
                  <tr key={q.id} {...rowProps(() => setViewingId(q.id))} className={rowClass}>
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">{q.quotation_number}</td>
                    <td className="max-w-[18rem] truncate py-3 pr-4" title={q.customer_name}>
                      {q.customer_name}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{formatDate(q.quotation_date)}</td>
                    <td className="py-3 pr-4 text-right tabular">{q.file_count}</td>
                    <td className="py-3 px-4 text-right tabular">{q.order_count}</td>
                    <RowChevron />
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg text-sm text-slate-600">
              {shown.length} quotation{shown.length === 1 ? "" : "s"}
            </div>
          </>
        )}
      </Card>

      {creating && (
        <QuotationFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {viewingId !== null && (
        <QuotationDetailsModal
          id={viewingId}
          onClose={() => setViewingId(null)}
          onChanged={load}
          onOpenPurchaseOrder={(purchaseOrderId) => {
            setViewingId(null);
            onOpenPurchaseOrder(purchaseOrderId);
          }}
        />
      )}
    </>
  );
}
