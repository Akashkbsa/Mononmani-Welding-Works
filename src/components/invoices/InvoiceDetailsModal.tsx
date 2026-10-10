import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Printer } from "lucide-react";
import { CopyType, InvoiceWithItems } from "../../types/invoice";
import { InvoicePaymentSummary } from "../../types/payment";
import { deleteInvoice, getInvoice, getInvoicePayments, printInvoice } from "../../services/api";
import { errorMessage, formatDate, formatMoney } from "../../lib/format";
import { Alert, Badge, Button, ConfirmDialog, Loading, Modal, SectionTitle, StatusBadge, useToast } from "../ui";
import InvoiceFormModal from "./InvoiceFormModal";
import PaymentFormModal from "../payments/PaymentFormModal";

interface Props {
  invoiceId: number;
  onClose: () => void;
  /** Called after anything changes so the list behind can refresh. */
  onChanged: () => void;
}

const COPIES: { copy: CopyType; label: string }[] = [
  { copy: "Original", label: "Original for recipient" },
  { copy: "Duplicate", label: "Duplicate for transporter" },
  { copy: "Triplicate", label: "Triplicate for supplier" },
];

function PrintMenu({ onPrint, busy }: { onPrint: (copy: CopyType) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        loading={busy}
        icon={<Printer className="w-4 h-4" />}
        onClick={() => setOpen(!open)}
      >
        Print
        <ChevronDown className="w-3.5 h-3.5 -mr-1" />
      </Button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-md border border-slate-200 bg-white shadow-lg py-1 z-10">
          {COPIES.map(({ copy, label }) => (
            <button
              key={copy}
              className="block w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setOpen(false);
                onPrint(copy);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InvoiceDetailsModal({ invoiceId, onClose, onChanged }: Props) {
  const toast = useToast();
  const [data, setData] = useState<InvoiceWithItems | null>(null);
  const [payments, setPayments] = useState<InvoicePaymentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [inv, pay] = await Promise.all([getInvoice(invoiceId), getInvoicePayments(invoiceId)]);
      if (!inv) throw new Error("This invoice no longer exists.");
      setData(inv);
      setPayments(pay);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  const print = async (copy: CopyType) => {
    setPrinting(true);
    try {
      await printInvoice(invoiceId, copy);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setPrinting(false);
    }
  };

  const refresh = () => {
    load();
    onChanged();
  };

  if (!data || !payments) {
    return (
      <Modal title="Invoice" onClose={onClose} size="lg">
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  const inv = data.invoice;
  const igst = inv.tax_type === "IGST";
  const canTakePayment = inv.status === "ISSUED" && payments.outstanding_amount > 0.01 && inv.customer_id !== null;

  return (
    <>
      <Modal
        title={
          <span className="flex items-center gap-3">
            Invoice {inv.invoice_number}
            <StatusBadge status={payments.payment_status} />
          </span>
        }
        subtitle={`${formatDate(inv.invoice_date)} · Due ${formatDate(inv.due_date)}`}
        onClose={onClose}
        size="lg"
        headerActions={<PrintMenu onPrint={print} busy={printing} />}
        footer={
          <>
            <Button
              variant="dangerText" className="mr-auto"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
            <Button onClick={() => setEditing(true)}>Edit</Button>
            {canTakePayment && (
              <Button variant="primary" onClick={() => setRecordingPayment(true)}>
                Record payment
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-6 text-sm">
          {error && <Alert>{error}</Alert>}

          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-xs text-slate-500 mb-1">Bill to</div>
              <div className="font-medium text-slate-900">{inv.customer_name}</div>
              {inv.customer_address && <div className="text-slate-600">{inv.customer_address}</div>}
              {inv.customer_phone && <div className="text-slate-600">{inv.customer_phone}</div>}
              {inv.customer_gstin && <div className="text-slate-600 font-mono text-xs mt-1">GSTIN {inv.customer_gstin}</div>}
              {inv.customer_state && (
                <div className="text-slate-600 text-xs">
                  {inv.customer_state}
                  {inv.customer_state_code ? ` (${inv.customer_state_code})` : ""}
                </div>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600 content-start">
              {inv.po_number_and_date && <Detail label="PO" value={inv.po_number_and_date} />}
              {inv.vehicle_number && <Detail label="Vehicle" value={inv.vehicle_number} />}
              {inv.date_of_supply && <Detail label="Date of supply" value={inv.date_of_supply} />}
              {inv.place_of_supply && <Detail label="Place of supply" value={inv.place_of_supply} />}
              {inv.our_dc_number_and_date && <Detail label="Our DC" value={inv.our_dc_number_and_date} />}
              {inv.your_dc_number_and_date && <Detail label="Your DC" value={inv.your_dc_number_and_date} />}
            </dl>
          </div>

          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 font-medium w-8">#</th>
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 font-medium">HSN/SAC</th>
                <th className="py-2 font-medium text-right">Qty</th>
                <th className="py-2 font-medium text-right">Rate</th>
                <th className="py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td className="py-2 text-slate-400">{item.sl_no}</td>
                  <td className="py-2">{item.description}</td>
                  <td className="py-2 text-slate-600">{item.hsn_sac}</td>
                  <td className="py-2 text-right tabular">
                    {item.quantity} {item.qum}
                  </td>
                  <td className="py-2 text-right tabular">{formatMoney(item.rate)}</td>
                  <td className="py-2 text-right tabular">{formatMoney(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end">
            <dl className="w-72 space-y-1 tabular">
              <Total label="Subtotal" value={inv.subtotal} />
              {inv.discount > 0 && <Total label="Discount" value={-inv.discount} />}
              {igst ? (
                <Total label={`IGST ${inv.igst_rate}%`} value={inv.igst_amount} />
              ) : (
                <>
                  <Total label={`CGST ${inv.cgst_rate}%`} value={inv.cgst_amount} />
                  <Total label={`SGST ${inv.sgst_rate}%`} value={inv.sgst_amount} />
                </>
              )}
              {inv.round_off !== 0 && <Total label="Round off" value={inv.round_off} />}
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold text-base">
                <dt>Total</dt>
                <dd>{formatMoney(inv.total_amount)}</dd>
              </div>
              {inv.status === "ISSUED" && (
                <>
                  <Total label="Paid" value={payments.total_settled} />
                  <div className="flex justify-between font-semibold">
                    <dt>Balance due</dt>
                    <dd>{formatMoney(payments.outstanding_amount)}</dd>
                  </div>
                </>
              )}
            </dl>
          </div>
          <p className="text-xs text-slate-500 text-right -mt-4">{inv.amount_in_words}</p>

          <div>
            <SectionTitle>Payments</SectionTitle>
            {payments.payments.length === 0 ? (
              <p className="text-slate-500">
                {inv.status === "ISSUED" ? "No payments recorded yet." : "This invoice doesn't take payments."}
              </p>
            ) : (
              <table className="w-full">
                <tbody className="divide-y divide-slate-100">
                  {payments.payments.map((p) => (
                    <tr key={p.payment_number}>
                      <td className="py-2 font-medium">{p.payment_number}</td>
                      <td className="py-2 text-slate-600">{formatDate(p.payment_date)}</td>
                      <td className="py-2 text-slate-600">
                        {p.payment_method}
                        {p.reference_number ? ` · ${p.reference_number}` : ""}
                      </td>
                      <td className="py-2">{!p.is_verified && <Badge tone="amber">Not cleared</Badge>}</td>
                      <td className="py-2 text-right tabular">{formatMoney(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {inv.notes && (
            <div>
              <SectionTitle>Internal note</SectionTitle>
              <p className="text-slate-600 whitespace-pre-line">{inv.notes}</p>
            </div>
          )}
        </div>
      </Modal>

      {editing && (
        <InvoiceFormModal
          invoice={data}
          onClose={() => setEditing(false)}
          onSaved={(_, andPrint) => {
            setEditing(false);
            toast("Invoice saved");
            refresh();
            if (andPrint) print("Original");
          }}
        />
      )}

      {recordingPayment && inv.customer_id !== null && (
        <PaymentFormModal
          initialCustomerId={inv.customer_id}
          initialInvoiceId={inv.id}
          onClose={() => setRecordingPayment(false)}
          onSaved={() => {
            setRecordingPayment(false);
            toast("Payment recorded");
            refresh();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete invoice ${inv.invoice_number}?`}
          message={
            payments.payments.length > 0
              ? "This invoice has payments recorded against it. Delete those payments first, or mark the invoice as cancelled instead."
              : "The invoice will be removed permanently. If it was already sent to the customer, consider marking it as cancelled instead."
          }
          confirmLabel="Delete invoice"
          onConfirm={async () => {
            await deleteInvoice(inv.id);
            toast("Invoice deleted");
            onChanged();
            onClose();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-800">{value}</dd>
    </>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-slate-600">
      <dt>{label}</dt>
      <dd className="text-slate-900">{formatMoney(value)}</dd>
    </div>
  );
}
