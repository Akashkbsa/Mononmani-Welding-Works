import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Star, Users } from "lucide-react";
import { Customer } from "../types/customer";
import PartyTypeBadge from "../components/customers/PartyTypeBadge";
import { listCustomers, listInvoices, searchCustomers, setCustomerFavorite } from "../services/api";
import { errorMessage, formatMoney } from "../lib/format";
import { Alert, Button, Card, EmptyState, inputClass, ListSkeleton, PageHeader, RowChevron, rowClass, rowProps, Skeleton, theadClass, useToast } from "../components/ui";
import CustomerFormModal from "../components/customers/CustomerFormModal";
import CustomerDetailsModal from "../components/customers/CustomerDetailsModal";

type TypeFilter = "ALL" | "CUSTOMERS" | "SUPPLIERS" | "BOTH";

// Customers = Customer and Both; Suppliers = Supplier and Both; Both = Both only.
const TYPE_FILTERS: { id: TypeFilter; label: string; match: (c: Customer) => boolean }[] = [
  { id: "ALL", label: "All", match: () => true },
  { id: "CUSTOMERS", label: "Customers", match: (c) => c.party_type !== "SUPPLIER" },
  { id: "SUPPLIERS", label: "Suppliers", match: (c) => c.party_type !== "CUSTOMER" },
  { id: "BOTH", label: "Both", match: (c) => c.party_type === "BOTH" },
];

export default function CustomersPage({ openId = null, onOpenHandled }: { openId?: number | null; onOpenHandled?: () => void }) {
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  // What each customer still owes, worked out from their issued invoices. Null while loading.
  const [balances, setBalances] = useState<Map<number, number> | null>(null);
  const [owingOnly, setOwingOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");

  // Open a company another screen asked for (for example from a reminder) once the list has loaded.
  useEffect(() => {
    if (openId === null || customers === null) return;
    const found = customers.find((c) => c.id === openId);
    if (found) setViewing(found);
    onOpenHandled?.();
  }, [openId, customers, onOpenHandled]);

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

  const matchesType = TYPE_FILTERS.find((f) => f.id === typeFilter)!.match;
  const visible = (customers ?? []).filter((c) => matchesType(c) && (!owingOnly || (balances?.get(c.id) ?? 0) > 0));

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
        title="Customers & suppliers"
        description="Companies you invoice or buy from."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setEditing("new")}>
            New company
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            aria-label="Search companies"
            className={`${inputClass} pl-9`}
            placeholder="Search name, phone or GSTIN"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div role="group" aria-label="Show" className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={typeFilter === f.id}
              onClick={() => setTypeFilter(f.id)}
              className={`rounded px-3 py-1 transition-colors ${
                typeFilter === f.id ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {f.label}
            </button>
          ))}
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
          <ListSkeleton label="Loading companies" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Users}
            title={
              owingOnly && customers.length > 0
                ? "Nobody owes you money right now"
                : query
                  ? "No companies match your search"
                  : typeFilter !== "ALL" && customers.length > 0
                    ? "No companies of this type"
                    : "No companies yet"
            }
            description={
              owingOnly && customers.length > 0
                ? "Turn off Owing money to see every company."
                : query
                  ? "Try a different name or number."
                  : typeFilter !== "ALL" && customers.length > 0
                    ? "Choose All to see every company."
                    : "Add a company to start invoicing or recording supplier bills."
            }
          />
        ) : (
          <table className="mww-fade w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="w-10" />
                <th className="py-2.5 pr-4 font-semibold">Name</th>
                <th className="py-2.5 pr-4 font-semibold">Type</th>
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
                  <td className="py-3 pr-4">
                    <PartyTypeBadge type={c.party_type} />
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{c.phone || "—"}</td>
                  <td className="py-3 pr-4 text-slate-600 font-mono text-xs">{c.gstin || "—"}</td>
                  <td className="py-3 pr-4 text-slate-600">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="py-3 pr-4 text-right tabular">
                    {c.party_type === "SUPPLIER" ? (
                      <span className="text-slate-500">—</span>
                    ) : balances === null ? (
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
            toast("Company deleted");
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
            toast(editing === "new" ? `${saved.name} added` : "Company updated");
            load();
          }}
        />
      )}
    </>
  );
}
