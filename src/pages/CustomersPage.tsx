import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Star } from "lucide-react";
import { Customer } from "../types/customer";
import { listCustomers, searchCustomers, setCustomerFavorite } from "../services/api";
import { errorMessage } from "../lib/format";
import { Alert, Button, Card, EmptyState, inputClass, Loading, PageHeader, useToast } from "../components/ui";
import CustomerFormModal from "../components/customers/CustomerFormModal";
import CustomerDetailsModal from "../components/customers/CustomerDetailsModal";

export default function CustomersPage() {
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const q = query.trim();
      setCustomers(q ? await searchCustomers(q) : await listCustomers());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

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

      <div className="relative max-w-sm mb-4">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          className={`${inputClass} pl-9`}
          placeholder="Search name, phone or GSTIN"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {customers === null ? (
          <Loading />
        ) : customers.length === 0 ? (
          <EmptyState
            title={query ? "No customers match your search" : "No customers yet"}
            description={query ? "Try a different name or number." : "Add a customer to start invoicing."}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="w-10" />
                <th className="py-2.5 pr-4 font-medium">Name</th>
                <th className="py-2.5 pr-4 font-medium">Phone</th>
                <th className="py-2.5 pr-4 font-medium">GSTIN</th>
                <th className="py-2.5 pr-4 font-medium">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr key={c.id} onClick={() => setViewing(c)} className="cursor-pointer hover:bg-slate-50">
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
                  <td className="py-3 pr-4 font-medium text-slate-900">{c.name}</td>
                  <td className="py-3 pr-4 text-slate-600">{c.phone || "—"}</td>
                  <td className="py-3 pr-4 text-slate-600 font-mono text-xs">{c.gstin || "—"}</td>
                  <td className="py-3 pr-4 text-slate-600">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
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
