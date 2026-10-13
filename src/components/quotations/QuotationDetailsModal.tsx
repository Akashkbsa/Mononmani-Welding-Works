import { useCallback, useEffect, useState } from "react";
import { deleteQuotation, getQuotation, getQuotationFilePreview, openQuotationFile } from "../../services/api";
import { errorMessage, formatDate } from "../../lib/format";
import { QuotationDetail } from "../../types/quotation";
import { Alert, Button, ConfirmDialog, Loading, Modal, SectionTitle, useToast } from "../ui";
import FileViewer from "../attachments/FileViewer";
import PurchaseOrderStatusBadge from "../purchaseOrders/PurchaseOrderStatusBadge";
import QuotationFormModal from "./QuotationFormModal";

interface Props {
  id: number;
  onClose: () => void;
  onChanged: () => void;
  onOpenPurchaseOrder: (purchaseOrderId: number) => void;
}

export default function QuotationDetailsModal({ id, onClose, onChanged, onOpenPurchaseOrder }: Props) {
  const toast = useToast();
  const [data, setData] = useState<QuotationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = await getQuotation(id);
      if (!q) throw new Error("This quotation no longer exists.");
      setData(q);
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
      <Modal title="Quotation" onClose={onClose} size="lg">
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  const { quotation } = data;

  return (
    <>
      <Modal
        title={`Quotation ${quotation.quotation_number}`}
        subtitle={quotation.customer_name}
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
            <Item label="Company" value={quotation.customer_name} strong />
            <Item label="Quotation number" value={quotation.quotation_number} strong />
            <Item label="Quotation date" value={formatDate(quotation.quotation_date)} />
          </dl>

          <div>
            <SectionTitle>Internal note</SectionTitle>
            <p className="whitespace-pre-line text-slate-600">{quotation.notes?.trim() ? quotation.notes : "No note"}</p>
          </div>

          <div>
            <SectionTitle>Files</SectionTitle>
            <FileViewer files={data.files} getPreview={getQuotationFilePreview} openFile={openQuotationFile} />
          </div>

          <div>
            <SectionTitle>Purchase orders</SectionTitle>
            {data.orders.length === 0 ? (
              <p className="text-slate-500">No purchase orders linked yet</p>
            ) : (
              <div className="space-y-2">
                {data.orders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => onOpenPurchaseOrder(order.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800">{order.po_number}</div>
                      <div className="text-slate-500">
                        {order.po_date ? formatDate(order.po_date) : "No date"} · {order.invoice_count}{" "}
                        {order.invoice_count === 1 ? "invoice" : "invoices"}
                      </div>
                    </div>
                    <PurchaseOrderStatusBadge status={order.status} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {editing && (
        <QuotationFormModal
          quotationId={id}
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
          title={`Delete quotation ${quotation.quotation_number}?`}
          message="This quotation and its attached files will be deleted. This cannot be undone."
          confirmLabel="Delete quotation"
          onConfirm={async () => {
            await deleteQuotation(id);
            toast("Quotation deleted");
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
