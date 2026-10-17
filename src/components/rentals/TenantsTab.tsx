import { useEffect, useState } from "react";
import { Plus, Users } from "lucide-react";
import { listRentalTenants } from "../../services/api";
import { errorMessage, formatDate, formatMoney, formatPhone } from "../../lib/format";
import { TenantListItem } from "../../types/rental";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, ListSkeleton, RowChevron, rowClass, rowProps, theadClass } from "../ui";
import TenantFormModal from "./TenantFormModal";
import TenantDetailsModal from "./TenantDetailsModal";
import { usePageShortcuts } from "../../lib/usePageShortcuts";

/** The people who rent from you. Tap a row to see or change their details and files. */
export default function TenantsTab({ openId = null, onOpenHandled }: { openId?: number | null; onOpenHandled?: () => void }) {
  const [tenants, setTenants] = useState<TenantListItem[] | null>(null);
  const [showMovedOut, setShowMovedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a change so the list loads again.
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  useEffect(() => {
    if (openId === null) return;
    setViewingId(openId);
    onOpenHandled?.();
  }, [openId, onOpenHandled]);

  useEffect(() => {
    let cancelled = false;
    listRentalTenants(showMovedOut)
      .then((list) => {
        if (cancelled) return;
        setTenants(list);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [showMovedOut, version]);

  const reload = () => setVersion((v) => v + 1);
  usePageShortcuts({ onNew: () => setCreating(true) });

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-4">
        <Checkbox checked={showMovedOut} onChange={setShowMovedOut} label="Show moved out" />
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)} title="New tenant (Ctrl+N)">
          New tenant
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {tenants === null ? (
          <ListSkeleton rows={4} label="Loading tenants" />
        ) : tenants.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No tenants yet"
            description="Add a tenant, then mark each month as paid or not paid."
            action={
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                New tenant
              </Button>
            }
          />
        ) : (
          <table data-hide-narrow="3 5 6" className="mww-fade w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="py-2.5 px-4 font-semibold">Name</th>
                <th className="py-2.5 pr-4 font-semibold">Place</th>
                <th className="py-2.5 pr-4 font-semibold">WhatsApp</th>
                <th className="py-2.5 pr-4 font-semibold text-right">Rent</th>
                <th className="py-2.5 pr-4 font-semibold">Moved in</th>
                <th className="py-2.5 px-4 font-semibold text-right">Files</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenants.map((t) => (
                <tr key={t.id} {...rowProps(() => setViewingId(t.id))} className={rowClass}>
                  <td className="max-w-[20rem] py-3 px-4 font-medium text-slate-900">
                    <div className="flex items-center gap-2">
                      <span className="truncate" title={t.name}>
                        {t.name}
                      </span>
                      {t.moved_out_date && <Badge>Moved out {formatDate(t.moved_out_date)}</Badge>}
                    </div>
                  </td>
                  <td className="max-w-[12rem] truncate py-3 pr-4 text-slate-600" title={t.place_name}>
                    {t.place_name}
                  </td>
                  <td className="py-3 pr-4 text-slate-600 whitespace-nowrap tabular">{formatPhone(t.whatsapp_number)}</td>
                  <td className="py-3 pr-4 text-right tabular">{formatMoney(t.monthly_rent)}</td>
                  <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{formatDate(t.move_in_date)}</td>
                  <td className="py-3 px-4 text-right tabular">{t.file_count}</td>
                  <RowChevron />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && (
        <TenantFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {viewingId !== null && (
        <TenantDetailsModal tenantId={viewingId} onClose={() => setViewingId(null)} onChanged={reload} />
      )}
    </>
  );
}
