import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { deletePurchaseOrder, getPurchaseOrder, getPurchaseOrderFilePreview, openPurchaseOrderFile } from "../../services/api";
import { errorMessage, formatDate, formatMoney } from "../../lib/format";
import { PurchaseOrderDetail, PurchaseOrderFileInfo } from "../../types/purchaseOrder";
import { Alert, Badge, Button, ConfirmDialog, Loading, Modal, SectionTitle, StatusBadge, useToast } from "../ui";
import PurchaseOrderFormModal from "./PurchaseOrderFormModal";

interface Props {
  id: number;
  onClose: () => void;
  onChanged: () => void;
  onOpenInvoice: (invoiceId: number) => void;
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

function fileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

export default function PurchaseOrderDetailsModal({ id, onClose, onChanged, onOpenInvoice }: Props) {
  const toast = useToast();
  const [data, setData] = useState<PurchaseOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});
  const [imagePreview, setImagePreview] = useState<PurchaseOrderFileInfo | null>(null);
  const [openingFileId, setOpeningFileId] = useState<number | null>(null);

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

  useEffect(() => {
    if (!data) return;
    const imageFiles = data.files.filter((file) => file.mime_type.startsWith("image/") && !previewUrls[file.id]);
    if (imageFiles.length === 0) return;
    let cancelled = false;
    Promise.all(
      imageFiles.map(async (file) => ({ id: file.id, url: await getPurchaseOrderFilePreview(file.id) }))
    )
      .then((items) => {
        if (cancelled) return;
        setPreviewUrls((current) => {
          const next = { ...current };
          for (const item of items) next[item.id] = item.url;
          return next;
        });
      })
      .catch(() => {
        // Leave missing previews blank rather than failing the whole modal.
      });
    return () => {
      cancelled = true;
    };
  }, [data, previewUrls]);

  if (!data) {
    return (
      <Modal title="Purchase order" onClose={onClose} size="lg">
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  const imageFiles = data.files.filter((file) => file.mime_type.startsWith("image/"));
  const documentFiles = data.files.filter((file) => !file.mime_type.startsWith("image/"));

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
          </dl>

          <div>
            <SectionTitle>Internal note</SectionTitle>
            <p className="whitespace-pre-line text-slate-600">{data.order.notes?.trim() ? data.order.notes : "No note"}</p>
          </div>

          <div>
            <SectionTitle>Files</SectionTitle>
            <div className="space-y-4">
              {imageFiles.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-500">Photos</div>
                  <div className="grid grid-cols-4 gap-3">
                    {imageFiles.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        className="overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-left hover:border-brand-300"
                        onClick={() => setImagePreview(file)}
                        aria-label={`Preview ${file.file_name}`}
                      >
                        {previewUrls[file.id] ? (
                          <img src={previewUrls[file.id]} alt={file.file_name} className="h-28 w-full object-cover" />
                        ) : (
                          <div className="flex h-28 items-center justify-center text-slate-400">
                            <ImageIcon className="h-6 w-6" />
                          </div>
                        )}
                        <div className="px-3 py-2 text-xs text-slate-600 truncate">{file.file_name}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {documentFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500">Documents</div>
                  {documentFiles.map((file) => (
                    <div key={file.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileText className="h-4 w-4 text-slate-400" />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{file.file_name}</div>
                          <div className="text-xs text-slate-500">{fileSize(file.size_bytes)}</div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        icon={<ExternalLink className="w-4 h-4" />}
                        loading={openingFileId === file.id}
                        onClick={async () => {
                          setOpeningFileId(file.id);
                          try {
                            await openPurchaseOrderFile(file.id);
                          } catch (err) {
                            toast(errorMessage(err), "error");
                          } finally {
                            setOpeningFileId(null);
                          }
                        }}
                      >
                        Open
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {data.files.length === 0 && <p className="text-slate-500">No files attached yet.</p>}
            </div>
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
          message="This purchase order and its attached files will be deleted. This cannot be undone."
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

      {imagePreview && (
        <Modal title={imagePreview.file_name} onClose={() => setImagePreview(null)} size="xl">
          <div className="flex justify-center">
            {previewUrls[imagePreview.id] ? (
              <img src={previewUrls[imagePreview.id]} alt={imagePreview.file_name} className="max-h-[70vh] rounded-md" />
            ) : (
              <Loading />
            )}
          </div>
        </Modal>
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
