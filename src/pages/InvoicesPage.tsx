import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { InvoiceListItem } from "../types/invoice";
import { listInvoices, printInvoice } from "../services/api";
import { errorMessage, formatDate, formatMoney } from "../lib/format";
import { Alert, Button, Card, EmptyState, inputClass, Loading, PageHeader, StatusBadge, useToast } from "../components/ui";
import InvoiceFormModal from "../components/invoices/InvoiceFormModal";
import InvoiceDetailsModal from "../components/invoices/InvoiceDetailsModal";

type Tab = "all" | "due" | "overdue" | "paid" | "draft" | "cancelled";

const TABS: { id: Tab; label: string; match: (i: InvoiceListItem) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "due", label: "Awaiting payment", match: (i) => ["UNPAID", "PARTIALLY PAID", "OVERDUE"].includes(i.payment_status) },
  { id: "overdue", label: "Overdue", match: (i) => i.payment_status === "OVERDUE" },
  { id: "paid", label: "Paid", match: (i) => i.payment_status === "PAID" },
  { id: "draft", label: "Drafts", match: (i) => i.status === "DRAFT" },
  { id: "cancelled", label: "Cancelled", match: (i) => i.status === "CANCELLED" },
];

export default function InvoicesPage() {
  const toast = useToast();
  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setInvoices(await listInvoices({ query: query.trim() || undefined }));
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
    () => Object.fromEntries(TABS.map((t) => [t.id, (invoices ?? []).filter(t.match).length])) as Record<Tab, number>,
    [invoices]
  );
  const visible = useMemo(() => (invoices ?? []).filter(TABS.find((t) => t.id === tab)!.match), [invoices, tab]);
  const visibleDue = visible.reduce((s, i) => s + (i.status === "ISSUED" ? i.outstanding_amount : 0), 0);

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Tax invoices issued to customers."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
            New invoice
          </Button>
        }
      />

      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex gap-1 rounded-md bg-slate-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 h-7 rounded text-[13px] transition-colors ${
                tab === t.id ? "bg-white shadow-sm text-slate-900 font-medium" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
              {invoices && t.id !== "all" && counts[t.id] > 0 && (
                <span className="ml-1.5 text-slate-400">{counts[t.id]}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className={`${inputClass} pl-9`}
            placeholder="Search number, customer, GSTIN, PO"
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
        {invoices === null ? (
          <Loading />
        ) : visible.length === 0 ? (
          <EmptyState
            title={invoices.length === 0 && !query ? "No invoices yet" : "No invoices here"}
            description={invoices.length === 0 && !query ? "Create your first invoice to get started." : undefined}
            action={
              invoices.length === 0 && !query ? (
                <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                  New invoice
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-2.5 px-4 font-medium">Invoice</th>
                  <th className="py-2.5 pr-4 font-medium">Date</th>
                  <th className="py-2.5 pr-4 font-medium">Customer</th>
                  <th className="py-2.5 pr-4 font-medium">Due</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Amount</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Balance</th>
                  <th className="py-2.5 px-4 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((inv) => (
                  <tr key={inv.id} onClick={() => setViewingId(inv.id)} className="cursor-pointer hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">{inv.invoice_number}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                    <td className="py-3 pr-4">{inv.customer_name}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">
                      {inv.status === "ISSUED" ? formatDate(inv.due_date) : "—"}
                    </td>
                    <td className="py-3 pr-4 text-right tabular">{formatMoney(inv.total_amount)}</td>
                    <td className="py-3 pr-4 text-right tabular">
                      {inv.status === "ISSUED" && inv.outstanding_amount > 0 ? formatMoney(inv.outstanding_amount) : "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <StatusBadge status={inv.payment_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-600">
              <span>
                {visible.length} invoice{visible.length === 1 ? "" : "s"}
              </span>
              {visibleDue > 0 && (
                <span>
                  Balance due <span className="font-semibold text-slate-900 tabular">{formatMoney(visibleDue)}</span>
                </span>
              )}
            </div>
          </>
        )}
      </Card>

      {creating && (
        <InvoiceFormModal
          onClose={() => setCreating(false)}
          onSaved={async (saved, print) => {
            setCreating(false);
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

      {viewingId !== null && (
        <InvoiceDetailsModal invoiceId={viewingId} onClose={() => setViewingId(null)} onChanged={load} />
      )}
    </>
  );
}
