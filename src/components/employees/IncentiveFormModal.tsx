import { useEffect, useState } from "react";
import { Incentive, PayMonthDetail } from "../../types/payroll";
import { addIncentive, deleteIncentive, listIncentiveReasons, updateIncentive } from "../../services/api";
import { errorMessage, monthTitle } from "../../lib/format";
import { Alert, Button, ConfirmDialog, Field, inputClass, Modal, useToast } from "../ui";

interface Props {
  detail: PayMonthDetail;
  existing?: Incentive;
  onClose: () => void;
  /** The month's new detail after a save or delete. */
  onSaved: (detail: PayMonthDetail) => void;
}

/** Add or change one incentive on an employee's month. It is saved at once, like an advance. */
export default function IncentiveFormModal({ detail, existing, onClose, onSaved }: Props) {
  const toast = useToast();
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [reasons, setReasons] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reasons given before, offered while typing. Nothing is lost without them.
  useEffect(() => {
    listIncentiveReasons()
      .then(setReasons)
      .catch(() => setReasons([]));
  }, []);

  const save = async () => {
    setError(null);
    const value = Number(amount);
    if (reason.trim() === "") return setError("Type a reason, e.g. Night work.");
    if (amount.trim() === "" || !(value > 0)) return setError("Enter an amount more than 0.");
    const input = { reason: reason.trim(), amount: value };
    setSaving(true);
    try {
      const d = existing ? await updateIncentive(existing.id, input) : await addIncentive(detail.employee.id, detail.month, input);
      toast("Incentive saved");
      onSaved(d);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        title={existing ? "Edit incentive" : "Add incentive"}
        subtitle={`${detail.employee.name} · ${monthTitle(detail.month)}`}
        onClose={onClose}
        size="md"
        footer={
          <>
            {existing && (
              <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        <form
          className="space-y-4 text-sm"
          onSubmit={(ev) => {
            ev.preventDefault();
            save();
          }}
        >
          {error && <Alert>{error}</Alert>}
          <Field label="Reason" required hint="Night work, site job, target met…">
            <input
              aria-label="Reason"
              list="incentive-reasons"
              maxLength={80}
              autoFocus
              className={inputClass}
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
            />
            <datalist id="incentive-reasons">
              {reasons.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>
          <Field label="Amount (₹)" required>
            <input
              aria-label="Amount"
              type="number"
              min={0}
              step="0.01"
              className={`${inputClass} tabular`}
              value={amount}
              onChange={(ev) => setAmount(ev.target.value)}
            />
          </Field>
          <button type="submit" hidden />
        </form>
      </Modal>

      {confirmDelete && existing && (
        <ConfirmDialog
          title="Delete this incentive?"
          message={`${existing.reason} will be taken off ${monthTitle(detail.month)} pay.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            const d = await deleteIncentive(existing.id);
            toast("Incentive deleted");
            onSaved(d);
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
