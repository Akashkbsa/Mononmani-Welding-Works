import { useCallback, useEffect, useState } from "react";
import { EmployeeDetail, PayMonthSummary } from "../../types/payroll";
import {
  deleteEmployee,
  getEmployee,
  getEmployeeFilePreview,
  getEmployeePayHistory,
  markEmployeeLeft,
  openEmployeeFile,
  rejoinEmployee,
} from "../../services/api";
import { errorMessage, formatDate, formatMoney, formatPhone, monthTitle, todayISO } from "../../lib/format";
import { settleNotes, statusText, statusTone } from "../../lib/payroll";
import { Alert, Badge, Button, ConfirmDialog, Field, inputClass, Loading, Modal, SectionTitle, rowClass, rowProps, useToast } from "../ui";
import FileViewer from "../attachments/FileViewer";
import EmployeeFormModal from "./EmployeeFormModal";

interface Props {
  employeeId: number;
  onClose: () => void;
  /** Called after the employee was changed or deleted, so the list behind can reload. */
  onChanged: () => void;
  /** Open one month's pay on top of this window. */
  onOpenMonth?: (month: string) => void;
  /** Bumped by the parent after a month window closes, so the months reload. */
  refreshKey?: number;
}

/** An employee at a glance: wage, OT rate, the last 12 months of pay, and files. */
export default function EmployeeDetailsModal({ employeeId, onClose, onChanged, onOpenMonth, refreshKey = 0 }: Props) {
  const toast = useToast();
  const [data, setData] = useState<EmployeeDetail | null>(null);
  const [history, setHistory] = useState<PayMonthSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** "left" asks for the leaving date, "rejoin" for the rejoining date. */
  const [dateAction, setDateAction] = useState<null | "left" | "rejoin">(null);

  const load = useCallback(async () => {
    try {
      const [d, months] = await Promise.all([getEmployee(employeeId), getEmployeePayHistory(employeeId)]);
      if (!d) throw new Error("This employee no longer exists.");
      setData(d);
      setHistory(months);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!data) {
    return (
      <Modal title="Employee" onClose={onClose}>
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  const e = data.employee;

  return (
    <>
      <Modal
        title={e.name}
        subtitle={
          <span className="flex items-center gap-2">
            {e.role ?? "Employee"}
            {e.left_on ? <Badge>Left {formatDate(e.left_on)}</Badge> : <Badge tone="green">Working</Badge>}
          </span>
        }
        onClose={onClose}
        size="lg"
        footer={
          <>
            <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              Delete employee
            </Button>
            <Button onClick={() => setDateAction(e.left_on ? "rejoin" : "left")}>{e.left_on ? "Rejoin" : "Mark as left"}</Button>
            <Button variant="primary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        }
      >
        <div className="space-y-6 text-sm">
          {error && <Alert>{error}</Alert>}
          <dl className="grid grid-cols-4 gap-x-6 gap-y-3">
            <Item label="Daily wage" value={formatMoney(e.daily_wage)} strong />
            <Item label="OT rate per hour" value={e.ot_rate > 0 ? formatMoney(e.ot_rate) : "No OT pay"} />
            <Item label="Joined" value={formatDate(e.joined_on)} />
            <Item label="Phone" value={e.phone ? formatPhone(e.phone) : ""} />
          </dl>

          {(e.address || e.notes) && (
            <div className="grid grid-cols-2 gap-6">
              {e.address && (
                <div>
                  <SectionTitle>Address</SectionTitle>
                  <p className="text-slate-600 whitespace-pre-line">{e.address}</p>
                </div>
              )}
              {e.notes && (
                <div>
                  <SectionTitle>Notes</SectionTitle>
                  <p className="text-slate-600 whitespace-pre-line">{e.notes}</p>
                </div>
              )}
            </div>
          )}

          <div>
            <SectionTitle>Last 12 months</SectionTitle>
            {history === null ? (
              <Loading />
            ) : history.length === 0 ? (
              <p className="text-slate-500">No months yet.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 font-medium">Month</th>
                    <th className="py-2 font-medium text-right">Days</th>
                    <th className="py-2 font-medium text-right">OT hrs</th>
                    <th className="py-2 font-medium text-right">Earned</th>
                    <th className="py-2 font-medium text-right">Paid</th>
                    <th className="py-2 pl-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((h) => (
                    <tr
                      key={h.month}
                      {...(onOpenMonth ? rowProps(() => onOpenMonth(h.month)) : {})}
                      className={onOpenMonth ? rowClass : undefined}
                    >
                      <td className="py-2 font-medium">{monthTitle(h.month)}</td>
                      <td className="py-2 text-right tabular">{h.row ? h.row.days_worked : "—"}</td>
                      <td className="py-2 text-right tabular">{h.row ? h.row.ot_hours : "—"}</td>
                      <td className="py-2 text-right tabular">{h.row ? formatMoney(h.figures.earned) : "—"}</td>
                      <td className="py-2 text-right tabular">
                        {h.figures.given > 0 ? formatMoney(h.figures.given) : "—"}
                        {settleNotes(h.figures).map((n) => (
                          <div key={n} className="text-xs text-slate-500">
                            {n}
                          </div>
                        ))}
                      </td>
                      <td className="py-2 pl-4">
                        <Badge tone={statusTone(h.status, h.figures)}>{statusText(h.status, h.figures)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <SectionTitle>Files</SectionTitle>
            {data.files.length === 0 ? (
              <p className="text-slate-500">No files. Add an ID copy with Edit.</p>
            ) : (
              <FileViewer files={data.files} getPreview={getEmployeeFilePreview} openFile={openEmployeeFile} />
            )}
          </div>
        </div>
      </Modal>

      {editing && (
        <EmployeeFormModal
          employeeId={e.id}
          onClose={() => {
            // Files change straight away in the form, so reload even without Save.
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

      {dateAction && (
        <DateModal
          title={dateAction === "left" ? `Mark ${e.name} as left` : `${e.name} rejoins`}
          label={dateAction === "left" ? "Left on" : "Rejoined on"}
          note={
            dateAction === "left"
              ? "They stay in the list under Left, with all their pay records."
              : "The rejoining date becomes the new joining date. Earlier months with pay records stay."
          }
          confirmLabel={dateAction === "left" ? "Mark as left" : "Rejoin"}
          onSubmit={async (date) => {
            if (dateAction === "left") await markEmployeeLeft(e.id, date);
            else await rejoinEmployee(e.id, date);
            toast(dateAction === "left" ? "Marked as left" : "Rejoined");
            setDateAction(null);
            load();
            onChanged();
          }}
          onClose={() => setDateAction(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${e.name}?`}
          message="The employee and their files will be deleted. This can't be undone. An employee with pay records can't be deleted; mark them as left instead."
          confirmLabel="Delete employee"
          onConfirm={async () => {
            await deleteEmployee(e.id);
            toast("Employee deleted");
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

/** A small window that asks for one date (today by default). */
function DateModal({
  title,
  label,
  note,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  note: string;
  confirmLabel: string;
  onSubmit: (date: string) => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(date);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!date} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error && <Alert>{error}</Alert>}
        <Field label={label} required>
          <input aria-label={label} type="date" className={inputClass} value={date} onChange={(ev) => setDate(ev.target.value)} />
        </Field>
        <p className="text-slate-600">{note}</p>
      </div>
    </Modal>
  );
}
