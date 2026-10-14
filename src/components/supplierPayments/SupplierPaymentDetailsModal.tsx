import RecordReminders from "../reminders/RecordReminders";
import { useCallback, useEffect, useState } from "react";
import { SupplierPaymentWithAllocations } from "../../types/supplierPayment";
import { deleteSupplierPayment, getSupplierPayment } from "../../services/api";
import { errorMessage, formatDate, formatMoney } from "../../lib/format";
import { Alert, Button, ConfirmDialog, Loading, Modal, SectionTitle, useToast } from "../ui";
import SupplierPaymentFormModal from "./SupplierPaymentFormModal";

interface Props {
  paymentId: number;
  onClose: () => void;
  onChanged: () => void;
}

export default function SupplierPaymentDetailsModal({ paymentId, onClose, onChanged }: Props) {
  const toast = useToast();
  const [data, setData] = useState<SupplierPaymentWithAllocations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await getSupplierPayment(paymentId);
      if (!p) throw new Error("This supplier payment no longer exists.");
      setData(p);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [paymentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <Modal title="Supplier payment" onClose={onClose}>
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  const p = data.payment;

  return (
    <>
      <Modal
        title={`Payment ${p.payment_number}`}
        subtitle={`${p.supplier_name} · ${formatDate(p.payment_date)}`}
        onClose={onClose}
        size="md"
        footer={
          <>
            <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              Delete
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
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Item label="Amount paid" value={formatMoney(p.amount_paid)} strong />
            <Item label="Method" value={[p.payment_method, p.reference_number].filter(Boolean).join(" · ")} />
            {p.bank_name && <Item label="Bank" value={p.bank_name} />}
            {p.excess_amount > 0 && <Item label="Round-off (extra paid, counted as paid)" value={formatMoney(p.excess_amount)} />}
            {p.writeoff_amount > 0 && (
              <Item label="Written off (accepted as full payment)" value={formatMoney(p.writeoff_amount)} />
            )}
          </dl>

          <div>
            <SectionTitle>Applied to</SectionTitle>
            {data.allocations.length === 0 ? (
              <p className="text-slate-500">Not applied to any bill.</p>
            ) : (
              <table className="w-full">
                <tbody className="divide-y divide-slate-100">
                  {data.allocations.map((a) => (
                    <tr key={a.bill_id}>
                      <td className="py-2 font-medium">{a.bill_number}</td>
                      <td className="py-2 text-slate-600">{formatDate(a.bill_date)}</td>
                      <td className="py-2 text-slate-500 text-right tabular">of {formatMoney(a.bill_total_amount)}</td>
                      <td className="py-2 text-right tabular">{formatMoney(a.allocated_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {p.remarks && (
            <div>
              <SectionTitle>Remarks</SectionTitle>
              <p className="text-slate-600 whitespace-pre-line">{p.remarks}</p>
            </div>
          )}
          <RecordReminders kind="SUPPLIER_PAYMENT" id={p.id} label={p.payment_number} suggestedTitle={`Supplier payment ${p.payment_number}`} />
        </div>
      </Modal>

      {editing && (
        <SupplierPaymentFormModal
          payment={data}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast("Payment updated");
            load();
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete payment ${p.payment_number}?`}
          message="The bills it was applied to will show as unpaid again."
          confirmLabel="Delete payment"
          onConfirm={async () => {
            await deleteSupplierPayment(p.id);
            toast("Payment deleted");
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
      <dd className={strong ? "text-base font-semibold tabular" : "text-slate-800"}>{value || "—"}</dd>
    </div>
  );
}
