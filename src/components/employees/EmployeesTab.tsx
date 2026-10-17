import { useEffect, useMemo, useRef, useState } from "react";
import { HardHat, Plus, Search } from "lucide-react";
import { listEmployees } from "../../services/api";
import { errorMessage, formatDate, formatMoney, formatPhone } from "../../lib/format";
import { EmployeeListItem } from "../../types/payroll";
import { Alert, Badge, Button, Card, EmptyState, inputClass, ListSkeleton, RowChevron, rowClass, rowProps, theadClass } from "../ui";
import { usePageShortcuts } from "../../lib/usePageShortcuts";
import EmployeeFormModal from "./EmployeeFormModal";
import EmployeeDetailsModal from "./EmployeeDetailsModal";
import PayMonthModal from "./PayMonthModal";

type Filter = "working" | "left" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "working", label: "Working" },
  { id: "left", label: "Left" },
  { id: "all", label: "All" },
];

/** Everyone who works or has worked here. Click a row for their details, pay and files. */
export default function EmployeesTab() {
  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>("working");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Bumped after a change so the list loads again.
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  // Bumped when a month window closes, so the employee window reloads its months.
  const [monthsVersion, setMonthsVersion] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    listEmployees()
      .then((list) => {
        if (cancelled) return;
        setEmployees(list);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const reload = () => setVersion((v) => v + 1);
  usePageShortcuts({ searchRef, onNew: () => setCreating(true) });

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (employees ?? []).filter((e) => {
      if (filter === "working" && e.left_on) return false;
      if (filter === "left" && !e.left_on) return false;
      const text = `${e.name} ${e.role ?? ""} ${e.phone ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [employees, filter, query]);

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchRef}
            aria-label="Search employees"
            className={`${inputClass} pl-9`}
            placeholder="Search name, role or phone   ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div role="group" aria-label="Show" className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded px-3 py-1 transition-colors ${filter === f.id ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button variant="primary" className="ml-auto" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)} title="New employee (Ctrl+N)">
          New employee
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {employees === null ? (
          <ListSkeleton rows={4} label="Loading employees" />
        ) : employees.length === 0 ? (
          <EmptyState
            icon={HardHat}
            title="No employees yet"
            description="Add your employees with their daily wage and OT rate, then enter their days each month."
            action={
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                New employee
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">No employees match.</p>
        ) : (
          <table data-hide-narrow="3 5 6" className="mww-fade w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="py-2.5 px-4 font-semibold">Name</th>
                <th className="py-2.5 pr-4 font-semibold">Role</th>
                <th className="py-2.5 pr-4 font-semibold">Phone</th>
                <th className="py-2.5 pr-4 font-semibold text-right">Daily wage</th>
                <th className="py-2.5 pr-4 font-semibold text-right">OT rate/hr</th>
                <th className="py-2.5 px-4 font-semibold">Joined</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((e) => (
                <tr key={e.id} {...rowProps(() => setViewingId(e.id))} className={rowClass}>
                  <td className="max-w-[20rem] py-3 px-4 font-medium text-slate-900">
                    <div className="flex items-center gap-2">
                      <span className="truncate" title={e.name}>
                        {e.name}
                      </span>
                      {e.left_on && <Badge>Left {formatDate(e.left_on)}</Badge>}
                    </div>
                  </td>
                  <td className="max-w-[12rem] truncate py-3 pr-4 text-slate-600">{e.role ?? "—"}</td>
                  <td className="py-3 pr-4 text-slate-600 whitespace-nowrap tabular">{e.phone ? formatPhone(e.phone) : "—"}</td>
                  <td className="py-3 pr-4 text-right tabular">{formatMoney(e.daily_wage)}</td>
                  <td className="py-3 pr-4 text-right tabular">{e.ot_rate > 0 ? formatMoney(e.ot_rate) : "—"}</td>
                  <td className="py-3 px-4 text-slate-600 whitespace-nowrap">{formatDate(e.joined_on)}</td>
                  <RowChevron />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && (
        <EmployeeFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {viewingId !== null && (
        <EmployeeDetailsModal
          employeeId={viewingId}
          onClose={() => setViewingId(null)}
          onChanged={reload}
          onOpenMonth={setOpenMonth}
          refreshKey={monthsVersion}
        />
      )}

      {viewingId !== null && openMonth !== null && (
        <PayMonthModal
          employeeId={viewingId}
          month={openMonth}
          onClose={() => {
            setOpenMonth(null);
            setMonthsVersion((v) => v + 1);
          }}
          onChanged={() => setMonthsVersion((v) => v + 1)}
        />
      )}
    </>
  );
}
