import RecordReminders from "../reminders/RecordReminders";
import { useCallback, useEffect, useState } from "react";
import { deleteSupplierBill, getSupplierBill, getSupplierBillFilePreview, openSupplierBillFile } from "../../services/api";
import { errorMessage, formatDate, formatMoney } from "../../lib/format";
import { SupplierBillDetail } from "../../types/supplierBill";
import { Alert, Button, ConfirmDialog, Loading, Modal, rowClass, rowProps, SectionTitle, useToast } from "../ui";
import FileViewer from "../attachments/FileViewer";
import SupplierPaymentFormModal from "../supplierPayments/SupplierPaymentFormModal";
import SupplierBillFormModal from "./SupplierBillFormModal";
import SupplierBillStatusBadge from "./SupplierBillStatusBadge";

interface Props {
  id: number;
  onClose: () => void;
  onChanged: () => void;
  onOpenPayment: (paymentId: number) => void;
}

export default function SupplierBillDetailsModal({ id, onClose, onChanged, onOpenPayment }: Props) {
  const toast = useToast();
  const [data, setData] = useState<SupplierBillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await getSupplierBill(id);
      if (!b) throw new Error("This supplier bill no longer exists.");
      setData(b);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <Modal title="Supplier bill" onClose={onClose} size="lg">
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  const { bill } = data;

  return (
    <>
      <Modal
        title={
          <span className="flex items-center gap-3">
            Supplier bill {bill.bill_number}
            <SupplierBillStatusBadge status={data.status} />
          </span>
        }
        subtitle={bill.supplier_name}
        onClose={onClose}
        size="lg"
        footer={
          <>
            <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <Button onClick={onClose}>Close</Button>
            {data.status !== "PAID" && (
              <Button variant="primary" onClick={() => setPaying(true)}>
                Record payment
              </Button>
            )}
            <Button onClick={() => setEditing(true)}>Edit</Button>
          </>
        }
      >
        <div className="space-y-6 text-sm">
          {error && <Alert>{error}</Alert>}

          <dl className="grid grid-cols-3 gap-x-6 gap-y-3">
            <Item label="Supplier" value={bill.supplier_name} strong />
            <Item label="Bill number" value={bill.bill_number} strong />
            <Item label="Bill date" value={formatDate(bill.bill_date)} />
            <Item label="Total" value={formatMoney(bill.total_amount)} strong />
            <Item label="Settled" value={formatMoney(data.settled_amount)} />
            <Item label="Balance due" value={formatMoney(data.outstanding_amount)} strong />
          </dl>

          <div>
            <SectionTitle>Internal note</SectionTitle>
            <p className="whitespace-pre-line text-slate-600">{bill.notes?.trim() ? bill.notes : "No note"}</p>
          </div>

          <div>
            <SectionTitle>Files</SectionTitle>
            <FileViewer files={data.files} getPreview={getSupplierBillFilePreview} openFile={openSupplierBillFile} />
          </div>

          <div>
            <SectionTitle>Payments</SectionTitle>
            {data.payments.length === 0 ? (
              <p className="text-slate-500">No payments yet</p>
            ) : (
              <table className="w-full">
                <tbody className="divide-y divide-slate-100">
                  {data.payments.map((p) => (
                    <tr key={p.payment_id} {...rowProps(() => onOpenPayment(p.payment_id))} className={rowClass}>
                      <td className="py-2 font-medium">{p.payment_number}</td>
                      <td className="py-2 text-slate-600">{formatDate(p.payment_date)}</td>
                      <td className="py-2 text-slate-600">{[p.payment_method, p.reference_number].filter(Boolean).join(" · ")}</td>
                      <td className="py-2 text-right tabular">{formatMoney(p.amount_settled)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <RecordReminders kind="SUPPLIER_BILL" id={bill.id} label={bill.bill_number} suggestedTitle={`Pay supplier bill ${bill.bill_number}`} />
        </div>
      </Modal>

      {editing && (
        <SupplierBillFormModal
          billId={id}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await load();
            onChanged();
          }}
        />
      )}

      {paying && (
        <SupplierPaymentFormModal
          initialSupplierId={bill.supplier_id}
          initialBillId={id}
          onClose={() => setPaying(false)}
          onSaved={async () => {
            setPaying(false);
            toast("Payment recorded");
            await load();
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete supplier bill ${bill.bill_number}?`}
          message="This supplier bill and its attached files will be deleted. This cannot be undone."
          confirmLabel="Delete supplier bill"
          onConfirm={async () => {
            await deleteSupplierBill(id);
            toast("Supplier bill deleted");
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
      <dd className={strong ? "text-base font-semibold text-slate-900 tabular" : "text-slate-800 tabular"}>{value || "—"}</dd>
    </div>
  );
}
