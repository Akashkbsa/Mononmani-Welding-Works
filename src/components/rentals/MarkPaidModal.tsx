import { useState } from "react";
import { markRentPaid } from "../../services/api";
import { errorMessage, monthTitle, todayISO } from "../../lib/format";
import { MonthRow } from "../../types/rental";
import { Alert, Button, Field, inputClass, Modal, useToast } from "../ui";

interface Props {
  row: MonthRow;
  /** YYYY-MM */
  month: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Record that one tenant paid for one month: the date, how much, and an optional note. */
export default function MarkPaidModal({ row, month, onClose, onSaved }: Props) {
  const toast = useToast();
  const [paidOn, setPaidOn] = useState(todayISO());
  const [amount, setAmount] = useState(String(row.rent_amount));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!paidOn) return setError("Choose the date paid.");
    const value = amount.trim() === "" ? null : Number(amount);
    if (value !== null && !(value > 0)) return setError("Amount must be more than zero.");

    setSaving(true);
    try {
      await markRentPaid({
        tenant_id: row.tenant_id,
        month,
        paid_on: paidOn,
        amount: value,
        note: note.trim() || null,
      });
      toast("Marked as paid");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  };

  return (
    <Modal
      title="Mark paid"
      subtitle={`${row.tenant_name} · ${row.place_name} · ${monthTitle(month)}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date paid" required>
            <input
              aria-label="Date paid"
              type="date"
              className={inputClass}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              onKeyDown={submitOnEnter}
            />
          </Field>
          <Field label="Amount (₹)" hint="Change it if the tenant paid a different amount.">
            <input
              aria-label="Amount"
              type="number"
              min={0}
              step="0.01"
              className={`${inputClass} tabular`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={submitOnEnter}
            />
          </Field>
        </div>
        <Field label="Note">
          <input
            aria-label="Note"
            className={inputClass}
            placeholder="For example: paid by UPI"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={submitOnEnter}
          />
        </Field>
      </div>
    </Modal>
  );
}
