import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { Page } from "../App";
import { InvoiceListItem } from "../types/invoice";
import { PaymentListItem, PaymentsSummary } from "../types/payment";
import { getPaymentsSummary, listInvoices, listPayments, printInvoice } from "../services/api";
import { errorMessage, formatDate, formatMoney } from "../lib/format";
import { Alert, Button, Card, Loading, PageHeader, SectionTitle, Stat, StatusBadge, useToast } from "../components/ui";
import InvoiceFormModal from "../components/invoices/InvoiceFormModal";
import InvoiceDetailsModal from "../components/invoices/InvoiceDetailsModal";
import PaymentFormModal from "../components/payments/PaymentFormModal";

export default function DashboardPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const toast = useToast();
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [awaiting, setAwaiting] = useState<InvoiceListItem[]>([]);
  const [recentPayments, setRecentPayments] = useState<PaymentListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [viewingInvoiceId, setViewingInvoiceId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [kpis, invoices, payments] = await Promise.all([getPaymentsSummary(), listInvoices(), listPayments()]);
      setSummary(kpis);
      // Overdue first, then those due soonest.
      setAwaiting(
        invoices
          .filter((i) => i.status === "ISSUED" && i.outstanding_amount > 0)
          .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
          .slice(0, 6)
      );
      setRecentPayments(payments.slice(0, 5));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-8">
            <Stat
              label="Overdue"
              value={formatMoney(summary.overdue_invoices_value)}
              note={`${summary.overdue_invoices_count} invoice${summary.overdue_invoices_count === 1 ? "" : "s"} past due`}
              tone={summary.overdue_invoices_count > 0 ? "red" : undefined}
              onClick={() => onNavigate("invoices")}
            />
            <Stat
              label="Balance due"
              value={formatMoney(summary.total_outstanding)}
              note={`${summary.unpaid_invoices_count} unpaid invoice${summary.unpaid_invoices_count === 1 ? "" : "s"}`}
              onClick={() => onNavigate("invoices")}
            />
            <Stat
              label="Invoiced this month"
              value={formatMoney(summary.invoiced_this_month)}
              onClick={() => onNavigate("invoices")}
            />
            <Stat
              label="Received this month"
              value={formatMoney(summary.received_this_month)}
              note={summary.advances_held > 0 ? `${formatMoney(summary.advances_held)} held as advance` : undefined}
              onClick={() => onNavigate("payments")}
            />
          </div>

          <div className="grid grid-cols-5 gap-6">
            <Card className="col-span-3 p-5">
              <SectionTitle
                action={
                  <Button size="sm" variant="ghost" onClick={() => onNavigate("invoices")}>
                    All invoices
                  </Button>
                }
              >
                Waiting for payment
              </SectionTitle>
              {awaiting.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">Everything is paid up.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {awaiting.map((inv) => (
                      <tr
                        key={inv.id}
                        onClick={() => setViewingInvoiceId(inv.id)}
                        className="cursor-pointer hover:bg-slate-50"
                      >
                        <td className="py-2.5">
                          <div className="font-medium text-slate-900">{inv.customer_name}</div>
                          <div className="text-xs text-slate-500">
                            {inv.invoice_number} · due {formatDate(inv.due_date)}
                          </div>
                        </td>
                        <td className="py-2.5 text-right tabular">{formatMoney(inv.outstanding_amount)}</td>
                        <td className="py-2.5 pl-3 text-right w-24">
                          <StatusBadge status={inv.payment_status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card className="col-span-2 p-5">
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
                <p className="text-sm text-slate-500 py-6 text-center">No payments yet.</p>
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
