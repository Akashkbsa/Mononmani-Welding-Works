import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, FileText, Plus, Wallet } from "lucide-react";
import type { Page } from "../App";
import { InvoiceListItem } from "../types/invoice";
import { PaymentListItem, PaymentsSummary } from "../types/payment";
import { getPaymentsSummary, listInvoices, listPayments, printInvoice } from "../services/api";
import { ageLabel, daysSince, errorMessage, formatDate, formatMoney } from "../lib/format";
import {
  Alert,
  Button,
  Card,
  PageHeader,
  RowChevron,
  rowClass,
  rowProps,
  SectionTitle,
  Skeleton,
  Stat,
  StatStrip,
  StatusBadge,
  useToast,
} from "../components/ui";
import InvoiceFormModal from "../components/invoices/InvoiceFormModal";
import InvoiceDetailsModal from "../components/invoices/InvoiceDetailsModal";
import PaymentFormModal from "../components/payments/PaymentFormModal";

// The first dashboard load of a session gets one gentle reveal. Coming back to the dashboard, or
// reloading its data after a save, never replays it: people see this screen all day.
let dashboardRevealed = false;

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading the dashboard">
      <Card className="mb-6 grid grid-cols-3 divide-x divide-slate-200 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3 px-5 py-4">
            <Skeleton className="mt-0.5 h-8 w-8" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-32" />
            </div>
          </div>
        ))}
      </Card>
      <div className="grid grid-cols-5 gap-5">
        {[3, 2].map((span) => (
          <Card key={span} className={`${span === 3 ? "col-span-3" : "col-span-2"} space-y-4 p-5`}>
            <Skeleton className="h-4 w-48" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const toast = useToast();
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [awaiting, setAwaiting] = useState<InvoiceListItem[]>([]);
  const [awaitingTotal, setAwaitingTotal] = useState(0);
  const reveal = useRef(!dashboardRevealed).current;
  const [recentPayments, setRecentPayments] = useState<PaymentListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [viewingInvoiceId, setViewingInvoiceId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [kpis, invoices, payments] = await Promise.all([getPaymentsSummary(), listInvoices(), listPayments()]);
      setSummary(kpis);
      // Oldest invoices first.
      const waiting = invoices
        .filter((i) => i.status === "ISSUED" && i.outstanding_amount > 0)
        .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
      setAwaitingTotal(waiting.length);
      setAwaiting(waiting.slice(0, 6));
      setRecentPayments(payments.slice(0, 5));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (summary) dashboardRevealed = true;
  }, [summary]);

  // Ctrl+N starts a new invoice, unless the user is typing or a dialog is already open.
  const modalOpen = creatingInvoice || recordingPayment || viewingInvoiceId !== null;
  useEffect(() => {
    if (modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "n") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      setCreatingInvoice(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          <>
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              title="New invoice (Ctrl+N)"
              onClick={() => setCreatingInvoice(true)}
            >
              New invoice
            </Button>
            <Button onClick={() => setRecordingPayment(true)}>Record payment</Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {!summary ? (
        error ? null : <DashboardSkeleton />
      ) : (
        <>
          <div className={`mb-6 ${reveal ? "mww-reveal" : ""}`} style={{ "--i": 0 } as React.CSSProperties}>
            <StatStrip cols={3}>
            <Stat
              icon={Wallet}
              tone={summary.total_outstanding > 0 ? "attention" : "default"}
              label="Balance due"
              value={formatMoney(summary.total_outstanding)}
              note={`${summary.unpaid_invoices_count} unpaid invoice${summary.unpaid_invoices_count === 1 ? "" : "s"}`}
              onClick={() => onNavigate("invoices")}
            />
            <Stat
              icon={FileText}
              label="Invoiced this month"
              value={formatMoney(summary.invoiced_this_month)}
              onClick={() => onNavigate("invoices")}
            />
            <Stat
              icon={CreditCard}
              label="Received this month"
              value={formatMoney(summary.received_this_month)}
              note={summary.advances_held > 0 ? `${formatMoney(summary.advances_held)} held as advance` : undefined}
              onClick={() => onNavigate("payments")}
            />
            </StatStrip>
          </div>

          <div className="grid grid-cols-5 gap-5">
            <Card
              className={`col-span-3 p-5 self-start ${reveal ? "mww-reveal" : ""}`}
              style={{ "--i": 1 } as React.CSSProperties}
            >
              <SectionTitle
                action={
                  <Button size="sm" variant="ghost" onClick={() => onNavigate("invoices")}>
                    All invoices
                  </Button>
                }
              >
                Waiting for payment, oldest first
              </SectionTitle>
              {awaiting.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">Nothing is waiting. Every issued invoice is paid.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {awaiting.map((inv) => (
                      <tr key={inv.id} {...rowProps(() => setViewingInvoiceId(inv.id))} className={rowClass}>
                        <td className="w-full max-w-0 py-2.5">
                          <div className="truncate font-medium text-slate-900" title={inv.customer_name}>
                            {inv.customer_name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {inv.invoice_number} · {formatDate(inv.invoice_date)} ·{" "}
                            <span className={daysSince(inv.invoice_date) > 30 ? "font-medium text-amber-700" : ""}>
                              {ageLabel(inv.invoice_date)}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right tabular">{formatMoney(inv.outstanding_amount)}</td>
                        <td className="py-2.5 pl-3 text-right w-24">
                          <StatusBadge status={inv.payment_status} />
                        </td>
                        <RowChevron />
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {awaitingTotal > awaiting.length && (
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  Showing the oldest {awaiting.length} of {awaitingTotal} waiting invoices.
                </p>
              )}
            </Card>

            <Card
              className={`col-span-2 p-5 self-start ${reveal ? "mww-reveal" : ""}`}
              style={{ "--i": 2 } as React.CSSProperties}
            >
              <SectionTitle
                action={
                  <Button size="sm" variant="ghost" onClick={() => onNavigate("payments")}>
                    All payments
                  </Button>
                }
              >
                Recent payments
              </SectionTitle>
              {recentPayments.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">No payments yet. Use Record payment when a customer pays.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {recentPayments.map((p) => (
                    <li key={p.id} className="py-2.5 flex justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{p.customer_name}</div>
                        <div className="text-xs text-slate-500">
                          {formatDate(p.payment_date)} · {p.payment_method}
                        </div>
                      </div>
                      <div className="tabular whitespace-nowrap">{formatMoney(p.amount_received)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      {creatingInvoice && (
        <InvoiceFormModal
          onClose={() => setCreatingInvoice(false)}
          onSaved={async (saved, print) => {
            setCreatingInvoice(false);
            toast(`Invoice ${saved.invoice.invoice_number} saved`);
            load();
            if (print) {
              try {
                await printInvoice(saved.invoice.id, "Original");
              } catch (err) {
                toast(errorMessage(err), "error");
              }
            }
          }}
        />
      )}

      {recordingPayment && (
        <PaymentFormModal
          onClose={() => setRecordingPayment(false)}
          onSaved={() => {
            setRecordingPayment(false);
            toast("Payment recorded");
            load();
          }}
        />
      )}

      {viewingInvoiceId !== null && (
        <InvoiceDetailsModal invoiceId={viewingInvoiceId} onClose={() => setViewingInvoiceId(null)} onChanged={load} />
      )}
    </>
  );
}
