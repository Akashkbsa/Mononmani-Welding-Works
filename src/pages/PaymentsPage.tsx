import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { PAYMENT_METHODS, PaymentListItem, PaymentsSummary } from "../types/payment";
import { getPaymentsSummary, listPayments } from "../services/api";
import { errorMessage, formatDate, formatMoney } from "../lib/format";
import { Alert, Badge, Button, Card, EmptyState, inputClass, Loading, PageHeader, Stat, useToast } from "../components/ui";
import PaymentFormModal from "../components/payments/PaymentFormModal";
import PaymentDetailsModal from "../components/payments/PaymentDetailsModal";

export default function PaymentsPage() {
  const toast = useToast();
  const [payments, setPayments] = useState<PaymentListItem[] | null>(null);
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("");
  const [unclearedOnly, setUnclearedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

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

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received from customers."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setRecording(true)}>
            Record payment
          </Button>
        }
      />

      {summary && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Stat label="Received this month" value={formatMoney(summary.received_this_month)} />
          <Stat label="Received in total" value={formatMoney(summary.total_received)} />
          <Stat label="Advances held" value={formatMoney(summary.advances_held)} />
          <Stat
            label="Not yet cleared"
            value={`${summary.unverified_count} payment${summary.unverified_count === 1 ? "" : "s"}`}
          />
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className="relative w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className={`${inputClass} pl-9`}
            placeholder="Search customer, number, reference"
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
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 accent-slate-900"
            checked={unclearedOnly}
            onChange={(e) => setUnclearedOnly(e.target.checked)}
          />
          Not yet cleared
        </label>
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {payments === null ? (
          <Loading />
        ) : payments.length === 0 ? (
          <EmptyState
            title={filtered ? "No payments match these filters" : "No payments recorded yet"}
            description={filtered ? undefined : "Record a payment when a customer pays an invoice."}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2.5 px-4 font-medium">Payment</th>
                <th className="py-2.5 pr-4 font-medium">Date</th>
                <th className="py-2.5 pr-4 font-medium">Customer</th>
                <th className="py-2.5 pr-4 font-medium">Method</th>
                <th className="py-2.5 pr-4 font-medium">Invoices</th>
                <th className="py-2.5 px-4 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => (
                <tr key={p.id} onClick={() => setViewingId(p.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-900">{p.payment_number}</td>
                  <td className="py-3 pr-4 text-slate-600">{formatDate(p.payment_date)}</td>
                  <td className="py-3 pr-4">{p.customer_name}</td>
                  <td className="py-3 pr-4 text-slate-600">
                    <div className="flex items-center gap-2">
                      {p.payment_method}
                      {!p.is_verified && <Badge tone="amber">Not cleared</Badge>}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    {p.invoices_covered.length ? p.invoices_covered.join(", ") : <span className="text-slate-400">Advance</span>}
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
                </tr>
              ))}
            </tbody>
          </table>
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

