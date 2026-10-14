import { useEffect, useState } from "react";
import { House, Plus } from "lucide-react";
import { listRentalPlaces } from "../../services/api";
import { errorMessage, formatMoney } from "../../lib/format";
import { PlaceListItem } from "../../types/rental";
import { Alert, Button, Card, EmptyState, ListSkeleton, RowChevron, rowClass, rowProps, theadClass } from "../ui";
import PlaceFormModal from "./PlaceFormModal";

/** The properties you rent out and who lives in each. Tap a row to see or change it. */
export default function PlacesTab({ openId = null, onOpenHandled }: { openId?: number | null; onOpenHandled?: () => void }) {
  const [places, setPlaces] = useState<PlaceListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a change so the list loads again.
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    if (openId === null) return;
    setEditingId(openId);
    onOpenHandled?.();
  }, [openId, onOpenHandled]);

  useEffect(() => {
    let cancelled = false;
    listRentalPlaces()
      .then((list) => {
        if (cancelled) return;
        setPlaces(list);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const reload = () => setVersion((v) => v + 1);

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
          New place
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {places === null ? (
          <ListSkeleton rows={4} label="Loading places" />
        ) : places.length === 0 ? (
          <EmptyState
            icon={House}
            title="No places yet"
            description="Add each flat, shop or godown you rent out, then add its tenant."
            action={
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                New place
              </Button>
            }
          />
        ) : (
          <table className="mww-fade w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="py-2.5 px-4 font-semibold">Name</th>
                <th className="py-2.5 pr-4 font-semibold">Address</th>
                <th className="py-2.5 pr-4 font-semibold text-right">Usual rent</th>
                <th className="py-2.5 pr-4 font-semibold">Tenant</th>
                <th className="py-2.5 px-4 font-semibold text-right">Files</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {places.map((p) => (
                <tr key={p.id} {...rowProps(() => setEditingId(p.id))} className={rowClass}>
                  <td className="max-w-[14rem] truncate py-3 px-4 font-medium text-slate-900" title={p.name}>
                    {p.name}
                  </td>
                  <td className="max-w-[18rem] truncate py-3 pr-4 text-slate-600" title={p.address ?? undefined}>
                    {p.address ?? "—"}
                  </td>
                  <td className="py-3 pr-4 text-right tabular">{p.monthly_rent > 0 ? formatMoney(p.monthly_rent) : "—"}</td>
                  <td className="max-w-[14rem] truncate py-3 pr-4">
                    {p.current_tenant ? p.current_tenant : <span className="text-slate-500">Vacant</span>}
                  </td>
                  <td className="py-3 px-4 text-right tabular">{p.file_count}</td>
                  <RowChevron />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && (
        <PlaceFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {editingId !== null && (
        <PlaceFormModal
          placeId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            reload();
          }}
        />
      )}
    </>
  );
}
