import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Star, Users } from "lucide-react";
import { Customer } from "../types/customer";
import { listCustomers, listInvoices, searchCustomers, setCustomerFavorite } from "../services/api";
import { errorMessage, formatMoney } from "../lib/format";
import { Alert, Button, Card, EmptyState, inputClass, ListSkeleton, PageHeader, RowChevron, rowClass, rowProps, Skeleton, theadClass, useToast } from "../components/ui";
import CustomerFormModal from "../components/customers/CustomerFormModal";
import CustomerDetailsModal from "../components/customers/CustomerDetailsModal";

export default function CustomersPage() {
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  // What each customer still owes, worked out from their issued invoices. Null while loading.
  const [balances, setBalances] = useState<Map<number, number> | null>(null);
  const [owingOnly, setOwingOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = query.trim();
      setCustomers(q ? await searchCustomers(q) : await listCustomers());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
    // The balance column is a convenience: if it cannot be worked out the list still shows.
    try {
      const owed = new Map<number, number>();
      for (const inv of await listInvoices()) {
        if (inv.status === "ISSUED" && inv.customer_id !== null && inv.outstanding_amount > 0) {
          owed.set(inv.customer_id, (owed.get(inv.customer_id) ?? 0) + inv.outstanding_amount);
        }
      }
      setBalances(owed);
    } catch {
      setBalances(new Map());
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = (customers ?? []).filter((c) => !owingOnly || (balances?.get(c.id) ?? 0) > 0);

  const toggleFavorite = async (c: Customer) => {
    try {
      await setCustomerFavorite(c.id, !c.is_favorite);
      load();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <>
      <PageHeader
        title="Customers"
        description="People and businesses you invoice."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setEditing("new")}>
            New customer
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            aria-label="Search customers"
            className={`${inputClass} pl-9`}
            placeholder="Search name, phone or GSTIN"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          aria-pressed={owingOnly}
          onClick={() => setOwingOnly((v) => !v)}
          className={`mww-btn h-9 rounded-md border px-3 text-sm font-medium ${
            owingOnly
              ? "border-arc-200 bg-arc-50 text-arc-700"
              : "border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
          }`}
        >
          Owing money
        </button>
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {customers === null ? (
          <ListSkeleton label="Loading customers" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Users}
            title={
              owingOnly && customers.length > 0
                ? "Nobody owes you money right now"
                : query
                  ? "No customers match your search"
                  : "No customers yet"
            }
            description={
              owingOnly && customers.length > 0
                ? "Turn off Owing money to see every customer."
                : query
                  ? "Try a different name or number."
                  : "Add a customer to start invoicing."
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="w-10" />
                <th className="py-2.5 pr-4 font-semibold">Name</th>
                <th className="py-2.5 pr-4 font-semibold">Phone</th>
                <th className="py-2.5 pr-4 font-semibold">GSTIN</th>
                <th className="py-2.5 pr-4 font-semibold">Location</th>
                <th className="py-2.5 pr-4 text-right font-semibold">Balance due</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((c) => (
                <tr key={c.id} {...rowProps(() => setViewing(c))} className={rowClass}>
                  <td className="pl-3">
                    <button
                      aria-label={c.is_favorite ? "Remove from frequent customers" : "Mark as frequent customer"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(c);
                      }}
                      className="p-1 rounded hover:bg-slate-100"
                    >
                      <Star className={`w-4 h-4 ${c.is_favorite ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />
                    </button>
                  </td>
                  <td className="max-w-[20rem] truncate py-3 pr-4 font-medium text-slate-900" title={c.name}>
                    {c.name}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{c.phone || "—"}</td>
                  <td className="py-3 pr-4 text-slate-600 font-mono text-xs">{c.gstin || "—"}</td>
                  <td className="py-3 pr-4 text-slate-600">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="py-3 pr-4 text-right tabular">
                    {balances === null ? (
                      <Skeleton className="ml-auto h-4 w-16" />
                    ) : (balances.get(c.id) ?? 0) > 0 ? (
                      <span className="font-medium text-arc-700">{formatMoney(balances.get(c.id) ?? 0)}</span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <RowChevron />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {viewing && (
        <CustomerDetailsModal
          customer={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
          onDeleted={() => {
            setViewing(null);
            toast("Customer deleted");
            load();
          }}
        />
      )}

      {editing && (
        <CustomerFormModal
          customer={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            toast(editing === "new" ? `${saved.name} added` : "Customer updated");
            load();
          }}
        />
      )}
    </>
  );
}
