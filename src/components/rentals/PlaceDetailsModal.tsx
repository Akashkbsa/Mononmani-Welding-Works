import RecordReminders from "../reminders/RecordReminders";
import { useCallback, useEffect, useState } from "react";
import { PlaceDetail, TenantListItem } from "../../types/rental";
import { deleteRentalPlace, getRentalFilePreview, getRentalPlace, listRentalTenants, openRentalFile } from "../../services/api";
import { errorMessage, formatDate, formatMoney, formatPhone } from "../../lib/format";
import { Alert, Badge, Button, ConfirmDialog, Loading, Modal, rowClass, rowProps, SectionTitle, useToast } from "../ui";
import FileViewer from "../attachments/FileViewer";
import PlaceFormModal from "./PlaceFormModal";
import TenantDetailsModal from "./TenantDetailsModal";

interface Props {
  placeId: number;
  onClose: () => void;
  /** Called after the place (or one of its tenants) was changed or deleted, so the list behind can reload. */
  onChanged: () => void;
}

/** A place at a glance: who lives there now, who lived there before, and its files. */
export default function PlaceDetailsModal({ placeId, onClose, onChanged }: Props) {
  const toast = useToast();
  const [data, setData] = useState<PlaceDetail | null>(null);
  const [tenants, setTenants] = useState<TenantListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openTenantId, setOpenTenantId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, all] = await Promise.all([getRentalPlace(placeId), listRentalTenants(true)]);
      if (!p) throw new Error("This place no longer exists.");
      setData(p);
      // Current tenant first, then the others by when they moved out, latest first.
      setTenants(
        all
          .filter((t) => t.place_id === placeId)
          .sort((a, b) => (a.moved_out_date ?? "9999").localeCompare(b.moved_out_date ?? "9999") * -1)
      );
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [placeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <Modal title="Place" onClose={onClose}>
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  const p = data.place;
  const current = (tenants ?? []).find((t) => !t.moved_out_date);
  const changed = () => {
    load();
    onChanged();
  };

  return (
    <>
      <Modal
        title={p.name}
        subtitle={current ? `Rented to ${current.name}` : "Vacant"}
        onClose={onClose}
        size="lg"
        footer={
          <>
            <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              Delete place
            </Button>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        }
      >
        <div className="space-y-6 text-sm">
          {error && <Alert>{error}</Alert>}
          <dl className="grid grid-cols-3 gap-x-6 gap-y-3">
            <div>
              <dt className="text-xs text-slate-500">Usual rent</dt>
              <dd className="text-base font-semibold tabular">{p.monthly_rent > 0 ? formatMoney(p.monthly_rent) : "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-slate-500">Address</dt>
              <dd className="text-slate-800 whitespace-pre-line">{p.address || "—"}</dd>
            </div>
          </dl>

          {p.notes && (
            <div>
              <SectionTitle>Notes</SectionTitle>
              <p className="text-slate-600 whitespace-pre-line">{p.notes}</p>
            </div>
          )}

          <div>
            <SectionTitle>Tenants</SectionTitle>
            {tenants === null ? (
              <Loading />
            ) : tenants.length === 0 ? (
              <p className="text-slate-500">No tenants yet. Add one in the Tenants tab.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 pl-2 font-medium">Name</th>
                    <th className="py-2 font-medium">WhatsApp</th>
                    <th className="py-2 font-medium">Moved in</th>
                    <th className="py-2 font-medium"></th>
                    <th className="py-2 pr-2 font-medium text-right">Rent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tenants.map((t) => (
                    <tr key={t.id} {...rowProps(() => setOpenTenantId(t.id))} className={rowClass}>
                      <td className="py-2 pl-2 font-medium">{t.name}</td>
                      <td className="py-2 text-slate-600 tabular">{formatPhone(t.whatsapp_number)}</td>
                      <td className="py-2 text-slate-600">{formatDate(t.move_in_date)}</td>
                      <td className="py-2">
                        {t.moved_out_date ? <Badge>Moved out {formatDate(t.moved_out_date)}</Badge> : <Badge tone="green">Living here</Badge>}
                      </td>
                      <td className="py-2 pr-2 text-right tabular">{formatMoney(t.monthly_rent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <SectionTitle>Files</SectionTitle>
            {data.files.length === 0 ? (
              <p className="text-slate-500">No files. Add papers or photos with Edit.</p>
            ) : (
              <FileViewer files={data.files} getPreview={getRentalFilePreview} openFile={openRentalFile} />
            )}
          </div>

          <RecordReminders kind="PLACE" id={p.id} label={p.name} suggestedTitle={p.name} />
        </div>
      </Modal>

      {openTenantId !== null && (
        <TenantDetailsModal tenantId={openTenantId} onClose={() => setOpenTenantId(null)} onChanged={changed} />
      )}

      {editing && (
        <PlaceFormModal
          placeId={p.id}
          onClose={() => {
            // Files change straight away in the form, so reload even without Save.
            setEditing(false);
            changed();
          }}
          onSaved={() => {
            setEditing(false);
            changed();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${p.name}?`}
          message="The place and its files will be deleted. This can't be undone. A place that has had tenants can't be deleted."
          confirmLabel="Delete place"
          onConfirm={async () => {
            await deleteRentalPlace(p.id);
            toast("Place deleted");
            onChanged();
            onClose();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
