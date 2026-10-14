import { useCallback, useEffect, useState } from "react";
import { HandCoins, Plus, Search } from "lucide-react";
import { PAYMENT_METHODS } from "../types/payment";
import { SupplierPaymentListItem, SupplierPaymentsSummary } from "../types/supplierPayment";
import { getSupplierPaymentsSummary, listSupplierPayments } from "../services/api";
import { errorMessage, formatDate, formatMoney } from "../lib/format";
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
  useToast,
} from "../components/ui";
import SupplierPaymentDetailsModal from "../components/supplierPayments/SupplierPaymentDetailsModal";
import SupplierPaymentFormModal from "../components/supplierPayments/SupplierPaymentFormModal";

interface Props {
  /** A payment to open as soon as the page shows (set by another screen). */
  openPaymentId?: number | null;
  onOpenHandled?: () => void;
}

export default function SupplierPaymentsPage({ openPaymentId = null, onOpenHandled }: Props) {
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [payments, setPayments] = useState<SupplierPaymentListItem[] | null>(null);
  const [summary, setSummary] = useState<SupplierPaymentsSummary | null>(null);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);

  useEffect(() => {
    if (openPaymentId === null) return;
    setViewingId(openPaymentId);
    onOpenHandled?.();
  }, [openPaymentId, onOpenHandled]);

  const load = useCallback(async () => {
    try {
      const [list, totals] = await Promise.all([
        listSupplierPayments({ query: query.trim() || undefined, payment_method: method || undefined }),
        getSupplierPaymentsSummary(),
      ]);
      setPayments(list);
      setSummary(totals);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [query, method]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = query || method;

  return (
    <>
      <PageHeader
        title="Supplier payments"
        description="Money you pay to suppliers."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setRecording(true)}>
            Record payment
          </Button>
        }
      />

      {summary && (
        <div className="mb-5">
          <StatStrip cols={2}>
            <Stat label="Paid this month" value={formatMoney(summary.paid_this_month)} />
            <Stat label="Paid in total" value={formatMoney(summary.total_paid)} />
          </StatStrip>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className="relative w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            aria-label="Search supplier payments"
            className={`${inputClass} pl-9`}
            placeholder="Search supplier, number, reference"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="w-44">
          <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQuery("");
              setMethod("");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {payments === null ? (
          <ListSkeleton label="Loading supplier payments" />
        ) : payments.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title={filtered ? "No supplier payments match these filters" : "No supplier payments yet"}
            description={filtered ? undefined : "Record a payment when you pay a supplier."}
          />
        ) : (
          <table className="mww-fade w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="py-2.5 px-4 font-semibold">Payment</th>
                <th className="py-2.5 pr-4 font-semibold">Date</th>
                <th className="py-2.5 pr-4 font-semibold">Supplier</th>
                <th className="py-2.5 pr-4 font-semibold">Method</th>
                <th className="py-2.5 pr-4 font-semibold">Bills</th>
                <th className="py-2.5 px-4 font-semibold text-right">Amount paid</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => (
                <tr key={p.id} {...rowProps(() => setViewingId(p.id))} className={rowClass}>
                  <td className="py-3 px-4 font-medium text-slate-900">{p.payment_number}</td>
                  <td className="py-3 pr-4 text-slate-600">{formatDate(p.payment_date)}</td>
                  <td className="max-w-[16rem] truncate py-3 pr-4" title={p.supplier_name}>
                    {p.supplier_name}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{p.payment_method}</td>
                  <td className="py-3 pr-4 text-slate-600">
                    {p.bills_covered.length ? p.bills_covered.join(", ") : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="py-3 px-4 text-right tabular font-medium">
                    {formatMoney(p.amount_paid)}
                    {p.writeoff_amount > 0 && (
                      <div className="text-xs font-normal text-slate-500">Written off {formatMoney(p.writeoff_amount)}</div>
                    )}
                    {p.excess_action === "ROUNDOFF" && p.excess_amount > 0 && (
                      <div className="text-xs font-normal text-slate-500">Round-off {formatMoney(p.excess_amount)}</div>
                    )}
                  </td>
                  <RowChevron />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {recording && (
        <SupplierPaymentFormModal
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            toast("Payment recorded");
            load();
          }}
        />
      )}

      {viewingId !== null && (
        <SupplierPaymentDetailsModal paymentId={viewingId} onClose={() => setViewingId(null)} onChanged={load} />
      )}
    </>
  );
}
