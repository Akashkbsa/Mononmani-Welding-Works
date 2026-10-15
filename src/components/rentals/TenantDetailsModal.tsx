import RecordReminders from "../reminders/RecordReminders";
import { useCallback, useEffect, useState } from "react";
import { RentHistoryRow, TenantDetail } from "../../types/rental";
import { deleteRentalTenant, getRentalFilePreview, getRentalTenant, getTenantRentHistory, openRentalFile } from "../../services/api";
import { errorMessage, formatDate, formatMoney, formatPhone, monthTitle } from "../../lib/format";
import { Alert, Badge, Button, ConfirmDialog, Loading, Modal, SectionTitle, useToast } from "../ui";
import FileViewer from "../attachments/FileViewer";
import TenantFormModal from "./TenantFormModal";

interface Props {
  tenantId: number;
  onClose: () => void;
  /** Called after the tenant was changed or deleted, so the list behind can reload. */
  onChanged: () => void;
}

/** A tenant at a glance: where they live, their rent, the last 12 months paid or not, and their files. */
export default function TenantDetailsModal({ tenantId, onClose, onChanged }: Props) {
  const toast = useToast();
  const [data, setData] = useState<TenantDetail | null>(null);
  const [history, setHistory] = useState<RentHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, months] = await Promise.all([getRentalTenant(tenantId), getTenantRentHistory(tenantId)]);
      if (!t) throw new Error("This tenant no longer exists.");
      setData(t);
      setHistory(months);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <Modal title="Tenant" onClose={onClose}>
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  const t = data.tenant;
  const unpaid = (history ?? []).filter((h) => !h.paid);

  return (
    <>
      <Modal
        title={t.name}
        subtitle={
          <span className="flex items-center gap-2">
            {t.place_name}
            {t.moved_out_date ? <Badge>Moved out {formatDate(t.moved_out_date)}</Badge> : <Badge tone="green">Living here</Badge>}
          </span>
        }
        onClose={onClose}
        size="lg"
        footer={
          <>
            <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              Delete tenant
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
          <dl className="grid grid-cols-4 gap-x-6 gap-y-3">
            <Item label="Monthly rent" value={formatMoney(t.monthly_rent)} strong />
            <Item label="WhatsApp" value={formatPhone(t.whatsapp_number)} />
            <Item label="Moved in" value={formatDate(t.move_in_date)} />
            <Item label="Not paid (last 12 months)" value={unpaid.length ? `${unpaid.length} · ${formatMoney(unpaid.reduce((s, h) => s + h.amount, 0))}` : "None"} />
          </dl>

          {t.notes && (
            <div>
              <SectionTitle>Notes</SectionTitle>
              <p className="text-slate-600 whitespace-pre-line">{t.notes}</p>
            </div>
          )}

          <div>
            <SectionTitle>Rent</SectionTitle>
            {history === null ? (
              <Loading />
            ) : history.length === 0 ? (
              <p className="text-slate-500">No months yet.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 font-medium">Month</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Paid on</th>
                    <th className="py-2 font-medium">Reminders</th>
                    <th className="py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((h) => (
                    <tr key={h.month}>
                      <td className="py-2 font-medium">{monthTitle(h.month)}</td>
                      <td className="py-2">{h.paid ? <Badge tone="green">Paid</Badge> : <Badge tone="amber">Not paid</Badge>}</td>
                      <td className="py-2 text-slate-600">
                        {h.paid ? formatDate(h.paid_on) : "—"}
                        {h.note && <div className="text-xs text-slate-500">{h.note}</div>}
                      </td>
                      <td className="py-2 text-slate-600 tabular">{h.reminders_sent > 0 ? `${h.reminders_sent} sent` : "—"}</td>
                      <td className="py-2 text-right tabular">{formatMoney(h.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <SectionTitle>Files</SectionTitle>
            {data.files.length === 0 ? (
              <p className="text-slate-500">No files. Add the agreement or an ID copy with Edit.</p>
            ) : (
              <FileViewer files={data.files} getPreview={getRentalFilePreview} openFile={openRentalFile} />
            )}
          </div>

          <RecordReminders kind="TENANT" id={t.id} label={t.name} suggestedTitle={`Collect rent from ${t.name}`} />
        </div>
      </Modal>

      {editing && (
        <TenantFormModal
          tenantId={t.id}
          onClose={() => {
            // Moving out or files change straight away in the form, so reload even without Save.
            setEditing(false);
            load();
            onChanged();
          }}
          onSaved={() => {
            setEditing(false);
            load();
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${t.name}?`}
          message="The tenant and their files will be deleted. This can't be undone. A tenant with rent records can't be deleted; mark them as moved out instead."
          confirmLabel="Delete tenant"
          onConfirm={async () => {
            await deleteRentalTenant(t.id);
            toast("Tenant deleted");
            onChanged();
            onClose();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={strong ? "text-base font-semibold tabular" : "text-slate-800 tabular"}>{value || "—"}</dd>
    </div>
  );
}
