import RecordReminders from "../reminders/RecordReminders";
import { useCallback, useEffect, useState } from "react";
import { deletePurchaseOrder, getPurchaseOrder, getPurchaseOrderFilePreview, openPurchaseOrderFile } from "../../services/api";
import { errorMessage, formatDate, formatMoney } from "../../lib/format";
import { PurchaseOrderDetail } from "../../types/purchaseOrder";
import { Alert, Badge, Button, ConfirmDialog, Loading, Modal, SectionTitle, StatusBadge, useToast } from "../ui";
import FileViewer from "../attachments/FileViewer";
import PurchaseOrderFormModal from "./PurchaseOrderFormModal";

interface Props {
  id: number;
  onClose: () => void;
  onChanged: () => void;
  onOpenInvoice: (invoiceId: number) => void;
  onOpenQuotation: (quotationId: number) => void;
}

function poStatusBadge(status: PurchaseOrderDetail["order"]["status"]) {
  if (status === "COMPLETED") return <Badge tone="green">Completed</Badge>;
  if (status === "PARTIAL") return <Badge tone="amber">Partially completed</Badge>;
  return <Badge tone="neutral">Not started</Badge>;
}

function paymentStatusBadge(status: string) {
  if (status === "UNPAID" || status === "PARTIALLY PAID" || status === "PAID") return <StatusBadge status={status} />;
  if (status === "CANCELLED") return <Badge tone="neutral">Cancelled</Badge>;
  if (status === "DRAFT") return <Badge tone="neutral">Draft</Badge>;
  return <Badge tone="neutral">{status}</Badge>;
}

export default function PurchaseOrderDetailsModal({ id, onClose, onChanged, onOpenInvoice, onOpenQuotation }: Props) {
  const toast = useToast();
  const [data, setData] = useState<PurchaseOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const po = await getPurchaseOrder(id);
      if (!po) throw new Error("This purchase order no longer exists.");
      setData(po);
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
      <Modal title="Purchase order" onClose={onClose} size="lg">
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  return (
    <>
      <Modal
        title={
          <span className="flex items-center gap-3">
            Purchase order {data.order.po_number}
            {poStatusBadge(data.order.status)}
          </span>
        }
        subtitle={data.order.customer_name}
        onClose={onClose}
        size="lg"
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
            <Item label="Customer" value={data.order.customer_name} strong />
            <Item label="PO number" value={data.order.po_number} strong />
            <Item label="PO date" value={data.order.po_date ? formatDate(data.order.po_date) : "-"} />
            <Item label="Status" value={data.order.status === "PARTIAL" ? "Partially completed" : data.order.status === "COMPLETED" ? "Completed" : "Not started"} />
            <div>
              <dt className="text-xs text-slate-500">Quotation</dt>
              <dd className="text-slate-800">
                {data.order.quotation_id !== null ? (
                  <button
                    type="button"
                    className="font-medium text-brand-700 hover:underline"
                    onClick={() => onOpenQuotation(data.order.quotation_id as number)}
                  >
                    {data.order.quotation_number ?? "View"}
                    {data.order.quotation_date ? ` — ${formatDate(data.order.quotation_date)}` : ""}
                  </button>
                ) : (
                  "-"
                )}
              </dd>
            </div>
          </dl>

          <div>
            <SectionTitle>Internal note</SectionTitle>
            <p className="whitespace-pre-line text-slate-600">{data.order.notes?.trim() ? data.order.notes : "No note"}</p>
          </div>

          <div>
            <SectionTitle>Files</SectionTitle>
            <FileViewer files={data.files} getPreview={getPurchaseOrderFilePreview} openFile={openPurchaseOrderFile} />
          </div>

          <div>
            <SectionTitle>Invoices</SectionTitle>
            {data.invoices.length === 0 ? (
              <p className="text-slate-500">No invoices linked yet</p>
            ) : (
              <div className="space-y-2">
                {data.invoices.map((invoice) => (
                  <button
                    key={invoice.id}
                    type="button"
                    onClick={() => onOpenInvoice(invoice.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800">{invoice.invoice_number}</div>
                      <div className="text-slate-500">
                        {formatDate(invoice.invoice_date)} · {formatMoney(invoice.total_amount)}
                      </div>
                    </div>
                    <div>{paymentStatusBadge(invoice.payment_status)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <RecordReminders kind="PURCHASE_ORDER" id={data.order.id} label={data.order.po_number} suggestedTitle={`Purchase order ${data.order.po_number}`} />
        </div>
      </Modal>

      {editing && (
        <PurchaseOrderFormModal
          purchaseOrderId={id}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await load();
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete purchase order ${data.order.po_number}?`}
          message={
            data.invoices.length > 0 ? (
              <>
                <strong>{data.order.po_number}</strong> for <strong>{data.order.customer_name}</strong> and any attached files
                will be deleted. The {data.invoices.length} linked invoice{data.invoices.length !== 1 ? "s" : ""} (
                {data.invoices.map((inv) => inv.invoice_number).join(", ")}) will lose their PO reference.
              </>
            ) : (
              <>
                <strong>{data.order.po_number}</strong> for <strong>{data.order.customer_name}</strong> and any attached files
                will be deleted permanently.
              </>
            )
          }
          confirmLabel="Delete purchase order"
          onConfirm={async () => {
            await deletePurchaseOrder(id);
            toast("Purchase order deleted");
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
      <dd className={strong ? "text-base font-semibold text-slate-900" : "text-slate-800"}>{value || "—"}</dd>
    </div>
  );
}
