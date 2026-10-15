import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Plus, Search } from "lucide-react";
import { PAYMENT_METHODS, PaymentListItem, PaymentsSummary } from "../types/payment";
import { getPaymentsSummary, listPayments } from "../services/api";
import { errorMessage, formatDate, formatMoney, todayISO } from "../lib/format";
import { Alert, Badge, Button, Card, EmptyState, inputClass, ListSkeleton, PageHeader, RowChevron, rowClass, rowProps, Stat, StatStrip, theadClass, useToast } from "../components/ui";
import PaymentFormModal from "../components/payments/PaymentFormModal";
import PaymentDetailsModal from "../components/payments/PaymentDetailsModal";
import { usePageShortcuts } from "../lib/usePageShortcuts";
import MonthFilter, { inMonth } from "../components/MonthFilter";
import { periodTitle } from "../lib/period";

export default function PaymentsPage({ openId = null, onOpenHandled }: { openId?: number | null; onOpenHandled?: () => void }) {
  const toast = useToast();
  const [payments, setPayments] = useState<PaymentListItem[] | null>(null);
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("");
  const [unclearedOnly, setUnclearedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  // Open a payment another screen asked for (for example from a reminder).
  useEffect(() => {
    if (openId === null) return;
    setViewingId(openId);
    onOpenHandled?.();
  }, [openId, onOpenHandled]);

  const load = useCallback(async () => {
    try {
      const [list, kpis] = await Promise.all([
        listPayments({
          query: query.trim() || undefined,
          payment_method: method || undefined,
          is_verified: unclearedOnly ? false : undefined,
        }),
        getPaymentsSummary(),
      ]);
      setPayments(list);
      setSummary(kpis);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [query, method, unclearedOnly]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = query || method || unclearedOnly;

  // Opens on this month; "" shows every month.
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const shown = useMemo(() => (payments ?? []).filter((p) => inMonth(p.payment_date, month)), [payments, month]);
  const shownTotal = shown.reduce((sum, p) => sum + p.amount_received, 0);
  const searchRef = useRef<HTMLInputElement>(null);
  usePageShortcuts({ searchRef, onNew: () => setRecording(true) });

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received from customers."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setRecording(true)} title="Record payment (Ctrl+N)">
            Record payment
          </Button>
        }
      />

      {summary && (
        <div className="mb-5">
          <StatStrip cols={4}>
          <Stat label="Received this month" value={formatMoney(summary.received_this_month)} />
          <Stat label="Received in total" value={formatMoney(summary.total_received)} />
          <Stat label="Advances held" value={formatMoney(summary.advances_held)} />
          <Stat
            label="Not yet cleared"
            value={`${summary.unverified_count} payment${summary.unverified_count === 1 ? "" : "s"}`}
          />
          </StatStrip>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-80 max-w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchRef}
            aria-label="Search payments"
            className={`${inputClass} pl-9`}
            placeholder="Search customer, number, reference   ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <MonthFilter dates={(payments ?? []).map((r) => r.payment_date)} value={month} onChange={setMonth} />
        <div className="w-44">
          <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={unclearedOnly}
            onChange={(e) => setUnclearedOnly(e.target.checked)}
          />
          Not yet cleared
        </label>
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQuery("");
              setMethod("");
              setUnclearedOnly(false);
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
          <ListSkeleton label="Loading payments" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title={filtered ? "No payments match these filters" : month && payments.length > 0 ? `No payments in ${periodTitle(month)}` : "No payments recorded yet"}
            description={filtered || (month && payments.length > 0) ? undefined : "Record a payment when a customer pays an invoice."}
          />
        ) : (
          <>
          <table className="mww-fade w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="py-2.5 px-4 font-semibold">Payment</th>
                <th className="py-2.5 pr-4 font-semibold">Date</th>
                <th className="py-2.5 pr-4 font-semibold">Customer</th>
                <th className="py-2.5 pr-4 font-semibold">Method</th>
                <th className="py-2.5 pr-4 font-semibold">Invoices</th>
                <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((p) => (
                <tr key={p.id} {...rowProps(() => setViewingId(p.id))} className={rowClass}>
                  <td className="py-3 px-4 font-medium text-slate-900">{p.payment_number}</td>
                  <td className="py-3 pr-4 text-slate-600">{formatDate(p.payment_date)}</td>
                  <td className="max-w-[16rem] truncate py-3 pr-4" title={p.customer_name}>
                    {p.customer_name}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    <div className="flex items-center gap-2">
                      {p.payment_method}
                      {!p.is_verified && <Badge tone="amber">Not cleared</Badge>}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    {p.invoices_covered.length ? p.invoices_covered.join(", ") : <span className="text-slate-500">Advance</span>}
                  </td>
                  <td className="py-3 px-4 text-right tabular font-medium">
                    {formatMoney(p.amount_received)}
                    {p.writeoff_amount > 0 && (
                      <div className="text-xs font-normal text-slate-500">Written off {formatMoney(p.writeoff_amount)}</div>
                    )}
                    {p.excess_action === "ROUNDOFF" && p.excess_amount > 0 && (
                      <div className="text-xs font-normal text-slate-500">Round-off {formatMoney(p.excess_amount)}</div>
                    )}
                    {p.tds_amount > 0 && (
                      <div className="text-xs font-normal text-slate-500">{p.tds_recognized ? "+ " : "TDS not counted: "}{formatMoney(p.tds_amount)}{p.tds_recognized ? " TDS" : ""}</div>
                    )}
                  </td>
                  <RowChevron />
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg text-sm text-slate-600">
            <span>
              {shown.length} payment{shown.length === 1 ? "" : "s"}
            </span>
            <span>
              Received <span className="font-semibold text-slate-900 tabular">{formatMoney(shownTotal)}</span>
            </span>
          </div>
          </>
        )}
      </Card>

      {recording && (
        <PaymentFormModal
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            toast("Payment recorded");
            load();
          }}
        />
      )}

      {viewingId !== null && (
        <PaymentDetailsModal paymentId={viewingId} onClose={() => setViewingId(null)} onChanged={load} />
      )}
    </>
  );
}

