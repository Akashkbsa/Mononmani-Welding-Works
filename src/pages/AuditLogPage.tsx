import { useCallback, useEffect, useState } from "react";
import { AuditLogEntry } from "../types/audit";
import { listAuditLog } from "../services/api";
import { errorMessage, formatDate } from "../lib/format";
import { Alert, Button, Card, Loading, PageHeader } from "../components/ui";

const TABLE_LABELS: Record<string, string> = {
  customers: "Customer",
  invoices: "Invoice",
  invoice_items: "Invoice line",
  payments: "Payment",
  payment_allocations: "Payment allocation",
  customer_credits: "Customer advance",
  supplier_bills: "Supplier bill",
  supplier_payments: "Supplier payment",
  purchase_orders: "Purchase order",
  quotations: "Quotation",
  pay_months: "Pay month",
  pay_incentives: "Pay incentive",
  employee_payments: "Employee payment",
  employees: "Employee",
  rental_places: "Rental place",
  rental_tenants: "Rental tenant",
  rent_payments: "Rent payment",
  reminders: "Reminder",
  documents: "Document",
  document_drive_copies: "Document backup",
};

function tableLabel(name: string): string {
  return TABLE_LABELS[name] ?? name;
}

function opLabel(op: string): string {
  if (op === "INSERT") return "Added";
  if (op === "UPDATE") return "Edited";
  if (op === "DELETE") return "Deleted";
  return op;
}

function opClass(op: string): string {
  if (op === "INSERT") return "bg-green-100 text-green-800";
  if (op === "UPDATE") return "bg-amber-100 text-amber-800";
  if (op === "DELETE") return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

/** "2026-10-19 14:30:00" → "19-10-2026 14:30" */
function formatChangedAt(s: string): string {
  const date = s.slice(0, 10);
  const time = s.slice(11, 16);
  return `${formatDate(date)} ${time}`;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await listAuditLog();
      setEntries(result.entries);
      setHasMore(result.has_more);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (entries.length === 0) return;
    const beforeSeq = entries[entries.length - 1].seq;
    setLoadingMore(true);
    try {
      const result = await listAuditLog({ before_seq: beforeSeq });
      setEntries((prev) => [...prev, ...result.entries]);
      setHasMore(result.has_more);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change made to your records, newest first."
      />

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <Loading />
      ) : entries.length === 0 ? (
        <p className="text-slate-500 text-sm">No changes recorded yet.</p>
      ) : (
        <Card>
          <table className="w-full text-sm" data-hide-narrow="3">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">What</th>
                <th className="px-4 py-2 text-left">Record</th>
                <th className="px-4 py-2 text-right tabular">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.seq}>
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{formatChangedAt(e.changed_at)}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${opClass(e.op)}`}>
                      {opLabel(e.op)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{tableLabel(e.table_name)}</td>
                  <td className="px-4 py-2 text-right tabular text-slate-500">{e.row_id}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasMore && (
            <div className="border-t border-slate-100 px-4 py-3">
              <Button size="sm" loading={loadingMore} onClick={loadMore}>
                Load more
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
