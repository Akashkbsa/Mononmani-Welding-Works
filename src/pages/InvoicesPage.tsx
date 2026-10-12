import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Plus, Search } from "lucide-react";
import { InvoiceListItem } from "../types/invoice";
import { downloadMonthInvoices, listInvoices, printInvoice } from "../services/api";
import { errorMessage, formatDate, formatMoney, todayISO } from "../lib/format";
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
  StatusBadge,
  theadClass,
  useToast,
} from "../components/ui";
import InvoiceFormModal from "../components/invoices/InvoiceFormModal";
import InvoiceDetailsModal from "../components/invoices/InvoiceDetailsModal";

type Tab = "all" | "due" | "paid" | "draft" | "cancelled";

const TABS: { id: Tab; label: string; match: (i: InvoiceListItem) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "due", label: "Awaiting payment", match: (i) => ["UNPAID", "PARTIALLY PAID"].includes(i.payment_status) },
  { id: "paid", label: "Paid", match: (i) => i.payment_status === "PAID" },
  { id: "draft", label: "Drafts", match: (i) => i.status === "DRAFT" },
  { id: "cancelled", label: "Cancelled", match: (i) => i.status === "CANCELLED" },
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-10" -> "October 2026" */
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

export default function InvoicesPage() {
  const toast = useToast();
  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [month, setMonth] = useState(() => todayISO().slice(0, 7)); // this month; "" = all months, otherwise "YYYY-MM"
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  // The invoice that was just saved glows briefly in the list, so the eye finds it.
  const [flashId, setFlashId] = useState<number | null>(null);
  useEffect(() => {
    if (flashId === null) return;
    const timer = window.setTimeout(() => setFlashId(null), 900);
    return () => window.clearTimeout(timer);
  }, [flashId]);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" jumps to search, unless the user is already typing somewhere.
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

  // Months that have invoices, newest first. The chosen month stays listed even if a search hides it.
  const months = useMemo(() => {
    const keys = new Set((invoices ?? []).map((i) => i.invoice_date.slice(0, 7)));
    if (month) keys.add(month);
    return Array.from(keys).sort().reverse();
  }, [invoices, month]);

  const inMonth = useMemo(
    () => (invoices ?? []).filter((i) => !month || i.invoice_date.startsWith(month)),
    [invoices, month]
  );
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.id, inMonth.filter(t.match).length])) as Record<Tab, number>,
    [inMonth]
  );
  const visible = useMemo(() => inMonth.filter(TABS.find((t) => t.id === tab)!.match), [inMonth, tab]);
  const visibleDue = visible.reduce((s, i) => s + (i.status === "ISSUED" ? i.outstanding_amount : 0), 0);
  const visibleTotal = visible.reduce((s, i) => s + (i.status === "ISSUED" ? i.total_amount : 0), 0);
  const monthPdfCount = inMonth.filter((i) => i.status === "ISSUED" || i.status === "CANCELLED").length;

  const exportMonth = async () => {
    const [y, m] = month.split("-").map(Number);
    setExporting(true);
    try {
      const result = await downloadMonthInvoices(y, m);
      toast(`${result.invoice_count} invoice${result.invoice_count === 1 ? "" : "s"} saved as one PDF`);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setExporting(false);
    }
  };

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

      <div className="flex items-end justify-between gap-4 mb-4 border-b border-slate-200">
        <div role="tablist" aria-label="Invoice status" className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 h-9 -mb-px border-b-2 text-sm transition-colors ${
                tab === t.id
                  ? "border-brand-600 text-brand-700 font-medium"
                  : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
              }`}
            >
              {t.label}
              {invoices && t.id !== "all" && counts[t.id] > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 tabular">{counts[t.id]}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-72 mb-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchRef}
            aria-label="Search invoices"
            className={`${inputClass} pl-9`}
            placeholder="Search number, customer, GSTIN, PO   ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <select
          aria-label="Month"
          className={`${inputClass} w-48`}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          <option value="">All months</option>
          {months.map((k) => (
            <option key={k} value={k}>
              {monthLabel(k)}
            </option>
          ))}
        </select>
        {month && (
          <>
            <Button
              icon={<Download className="w-4 h-4" />}
              loading={exporting}
              disabled={monthPdfCount === 0}
              title="One PDF with every invoice of this month, to send to the accountant"
              onClick={exportMonth}
            >
              Download {monthLabel(month)} (PDF)
            </Button>
            <span className="text-xs text-slate-500">
              {monthPdfCount} invoice{monthPdfCount === 1 ? "" : "s"} in the PDF, cancelled ones marked; drafts are left out
            </span>
          </>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {invoices === null ? (
          <ListSkeleton label="Loading invoices" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={invoices.length === 0 && !query ? "No invoices yet" : "No invoices here"}
            description={
              invoices.length === 0 && !query
                ? "Create your first invoice to get started."
                : "Try another tab, or clear the search box."
            }
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
              <thead className={theadClass}>
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Invoice</th>
                  <th className="py-2.5 pr-4 font-semibold">Date</th>
                  <th className="py-2.5 pr-4 font-semibold">Customer</th>
                  <th className="py-2.5 pr-4 font-semibold text-right">Amount</th>
                  <th className="py-2.5 pr-4 font-semibold text-right">Balance</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((inv) => (
                  <tr
                    key={inv.id}
                    {...rowProps(() => setViewingId(inv.id))}
                    className={`${rowClass} ${inv.id === flashId ? "mww-flash" : ""}`}
                  >
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">{inv.invoice_number}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                    <td className="max-w-[18rem] truncate py-3 pr-4" title={inv.customer_name}>
                      {inv.customer_name}
                    </td>
                    <td className="py-3 pr-4 text-right tabular">{formatMoney(inv.total_amount)}</td>
                    <td className="py-3 pr-4 text-right tabular">
                      {inv.status === "ISSUED" && inv.outstanding_amount > 0 ? formatMoney(inv.outstanding_amount) : "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <StatusBadge status={inv.payment_status} />
                    </td>
                    <RowChevron />
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg text-sm text-slate-600">
              <span>
                {visible.length} invoice{visible.length === 1 ? "" : "s"}
              </span>
              <span className="flex gap-5">
                {month && visibleTotal > 0 && (
                  <span>
                    Invoiced <span className="font-semibold text-slate-900 tabular">{formatMoney(visibleTotal)}</span>
                  </span>
                )}
                {visibleDue > 0 && (
                  <span>
                    Balance due <span className="font-semibold text-slate-900 tabular">{formatMoney(visibleDue)}</span>
                  </span>
                )}
              </span>
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
            setFlashId(saved.invoice.id);
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
        <InvoiceDetailsModal
          invoiceId={viewingId}
          onClose={() => setViewingId(null)}
          onChanged={() => {
            setFlashId(viewingId);
            load();
          }}
        />
      )}
    </>
  );
}
