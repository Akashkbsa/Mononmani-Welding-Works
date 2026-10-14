import RecordReminders from "../reminders/RecordReminders";
import { useCallback, useEffect, useState } from "react";
import { PaymentWithAllocations } from "../../types/payment";
import { deletePayment, getPayment } from "../../services/api";
import { errorMessage, formatDate, formatMoney } from "../../lib/format";
import { Alert, Badge, Button, ConfirmDialog, Loading, Modal, SectionTitle, useToast } from "../ui";
import PaymentFormModal from "./PaymentFormModal";

interface Props {
  paymentId: number;
  onClose: () => void;
  onChanged: () => void;
}

export default function PaymentDetailsModal({ paymentId, onClose, onChanged }: Props) {
  const toast = useToast();
  const [data, setData] = useState<PaymentWithAllocations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await getPayment(paymentId);
      if (!p) throw new Error("This payment no longer exists.");
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
      <Modal title="Payment" onClose={onClose}>
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  const p = data.payment;

  return (
    <>
      <Modal
        title={
          <span className="flex items-center gap-3">
            Payment {p.payment_number}
            {!p.is_verified && <Badge tone="amber">Not cleared</Badge>}
          </span>
        }
        subtitle={`${p.customer_name} · ${formatDate(p.payment_date)}`}
        onClose={onClose}
        size="md"
        footer={
          <>
            <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <Button onClick={onClose}>Close</Button>
            {p.customer_id !== null && (
              <Button variant="primary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-6 text-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Item label="Amount received" value={formatMoney(p.amount_received)} strong />
            <Item label="Method" value={[p.payment_method, p.reference_number].filter(Boolean).join(" · ")} />
            {p.tds_amount > 0 && <Item label={p.tds_recognized ? "TDS deducted" : "TDS (not recognised)"} value={formatMoney(p.tds_amount)} />}
            {p.bank_name && <Item label="Customer's bank" value={p.bank_name} />}
            {p.credit_applied > 0 && <Item label="Advance used" value={formatMoney(p.credit_applied)} />}
            {p.excess_amount > 0 && (
              <Item
                label={
                  p.excess_action === "REFUND" ? "Refunded" : p.excess_action === "ROUNDOFF" ? "Round-off kept" : "Kept as advance"
                }
                value={
                  formatMoney(p.excess_amount) +
                  (p.advance_used > 0 ? ` (${formatMoney(p.advance_used)} since used)` : "")
                }
              />
            )}
            {p.writeoff_amount > 0 && (
              <Item label="Written off (accepted as full payment)" value={formatMoney(p.writeoff_amount)} />
            )}
          </dl>

          <div>
            <SectionTitle>Applied to</SectionTitle>
            {data.allocations.length === 0 ? (
              <p className="text-slate-500">Not applied to any invoice.</p>
            ) : (
              <table className="w-full">
                <tbody className="divide-y divide-slate-100">
                  {data.allocations.map((a) => (
                    <tr key={a.invoice_id}>
                      <td className="py-2 font-medium">{a.invoice_number}</td>
                      <td className="py-2 text-slate-600">{formatDate(a.invoice_date)}</td>
                      <td className="py-2 text-slate-500 text-right tabular">of {formatMoney(a.invoice_total_amount)}</td>
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
          <RecordReminders kind="PAYMENT" id={p.id} label={p.payment_number} suggestedTitle={`Payment ${p.payment_number}`} />
        </div>
      </Modal>

      {editing && (
        <PaymentFormModal
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
          message="The invoices it was applied to will show as unpaid again, and any advance it used is given back to the customer."
          confirmLabel="Delete payment"
          onConfirm={async () => {
            await deletePayment(p.id);
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
