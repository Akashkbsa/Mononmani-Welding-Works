import { useCallback, useEffect, useMemo, useState } from "react";
import { Customer } from "../../types/customer";
import { AttachmentInfo } from "../../types/attachment";
import { LinkedOrder, QuotationDetail, QuotationFileInfo, QuotationInput } from "../../types/quotation";
import {
  addQuotationFile,
  checkDuplicateQuotationNumber,
  createQuotation,
  getQuotation,
  listCustomers,
  listUnlinkedPurchaseOrdersForCustomer,
  removeQuotationFile,
  setPurchaseOrderQuotation,
  updateQuotation,
} from "../../services/api";
import { errorMessage, formatDate, todayISO } from "../../lib/format";
import { Alert, Button, ConfirmDialog, Field, inputClass, Loading, Modal, textareaClass, useDiscardGuard, useToast } from "../ui";
import CustomerPicker from "../CustomerPicker";
import FileAttachmentsField, { AttachmentErrors } from "../attachments/FileAttachmentsField";
import { useFileAttachments } from "../attachments/useFileAttachments";
import PurchaseOrderStatusBadge from "../purchaseOrders/PurchaseOrderStatusBadge";

interface Props {
  quotationId?: number;
  onClose: () => void;
  onSaved: (id: number) => void;
}

function invoiceCountLabel(count: number) {
  return `${count} invoice${count === 1 ? "" : "s"}`;
}

export default function QuotationFormModal({ quotationId, onClose, onSaved }: Props) {
  const toast = useToast();
  const isEdit = quotationId !== undefined;
  const guard = useDiscardGuard(onClose);

  const [loading, setLoading] = useState(isEdit);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [detail, setDetail] = useState<QuotationDetail | null>(null);

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [quotationNumber, setQuotationNumber] = useState("");
  const [quotationDate, setQuotationDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [orderIds, setOrderIds] = useState<number[]>([]);
  const [availableOrders, setAvailableOrders] = useState<LinkedOrder[]>([]);
  const [storedFiles, setStoredFiles] = useState<QuotationFileInfo[]>([]);
  const [removeFile, setRemoveFile] = useState<AttachmentInfo | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customerLocked = (detail?.orders.length ?? 0) > 0;

  const loadDetail = useCallback(async () => {
    if (!quotationId) return;
    const q = await getQuotation(quotationId);
    if (!q) throw new Error("This quotation no longer exists.");
    setDetail(q);
    setCustomerId(q.quotation.customer_id);
    setQuotationNumber(q.quotation.quotation_number);
    setQuotationDate(q.quotation.quotation_date);
    setNotes(q.quotation.notes ?? "");
    setStoredFiles(q.files);
    setOrderIds([]);
  }, [quotationId]);

  /** Reload only what the saved quotation holds (files, linked orders), never the fields being typed. */
  const refreshDetail = useCallback(async () => {
    if (!quotationId) return;
    const q = await getQuotation(quotationId);
    if (!q) throw new Error("This quotation no longer exists.");
    setDetail(q);
    setStoredFiles(q.files);
  }, [quotationId]);

  const attachments = useFileAttachments({
    ownerId: quotationId,
    addFile: addQuotationFile,
    onStoredChange: refreshDetail,
    onDirty: guard.markDirty,
  });

  useEffect(() => {
    listCustomers()
      .then(setCustomers)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    setLoading(true);
    loadDetail()
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isEdit, loadDetail]);

  useEffect(() => {
    if (customerId === null) {
      setAvailableOrders([]);
      return;
    }
    let cancelled = false;
    setLoadingOrders(true);
    listUnlinkedPurchaseOrdersForCustomer(customerId)
      .then((items) => {
        if (!cancelled) setAvailableOrders(items);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoadingOrders(false));
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === customerId) ?? null,
    [customers, customerId]
  );

  // Only a warning: a revised quotation may be sent again under the same number.
  const checkDuplicate = async () => {
    if (!quotationNumber.trim()) return setDuplicateWarning(null);
    try {
      const result = await checkDuplicateQuotationNumber(quotationNumber.trim(), quotationId);
      setDuplicateWarning(
        result.has_duplicate
          ? `${quotationNumber.trim()} is already used for ${result.existing_customer_name ?? "another customer"}.`
          : null
      );
    } catch {
      setDuplicateWarning(null);
    }
  };

  const toggleOrder = (id: number, checked: boolean) => {
    guard.markDirty();
    setOrderIds((current) => (checked ? [...current, id] : current.filter((item) => item !== id)));
  };

  const unlinkOrder = async (purchaseOrderId: number) => {
    if (!quotationId) return;
    try {
      await setPurchaseOrderQuotation(purchaseOrderId, null);
      toast("Purchase order unlinked");
      await refreshDetail();
      if (customerId !== null) setAvailableOrders(await listUnlinkedPurchaseOrdersForCustomer(customerId));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const save = async () => {
    setError(null);
    attachments.clearErrors();
    if (customerId === null) return setError("Choose a customer.");
    if (!quotationNumber.trim()) return setError("Enter the quotation number.");
    if (!quotationDate) return setError("Choose the quotation date.");

    const input: QuotationInput = {
      customer_id: customerId,
      quotation_number: quotationNumber.trim(),
      quotation_date: quotationDate,
      notes: notes.trim() || null,
      purchase_order_ids: orderIds,
    };

    setSaving(true);
    try {
      const saved = isEdit && quotationId ? await updateQuotation(quotationId, input) : await createQuotation(input);
      const savedId = saved.quotation.id;
      const failures = await attachments.uploadPending(savedId);
      if (failures.length > 0) {
        // The quotation itself is saved, so leave the form (the list refreshes) and say which files
        // are missing. Staying here in "new" mode would let a second Save create a duplicate.
        toast(
          `Quotation saved, but ${failures.length === 1 ? "1 file was" : `${failures.length} files were`} not added: ${failures.join("; ")}. Open the quotation to add ${failures.length === 1 ? "it" : "them"} again.`,
          "error"
        );
      } else {
        toast("Quotation saved");
      }
      onSaved(savedId);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Modal title="Quotation" onClose={guard.requestClose} size="lg">
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  return (
    <>
      <Modal
        title={isEdit && detail ? `Edit quotation ${detail.quotation.quotation_number}` : "New quotation"}
        subtitle={isEdit ? selectedCustomer?.name ?? detail?.quotation.customer_name : undefined}
        onClose={guard.requestClose}
        size="lg"
        footer={
          <>
            <Button onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" loading={saving || attachments.uploading} onClick={save}>
              {isEdit ? "Save changes" : "Save quotation"}
            </Button>
          </>
        }
      >
        <div className="space-y-6" onChangeCapture={guard.markDirty}>
          {error && <Alert>{error}</Alert>}
          <AttachmentErrors attachments={attachments} />

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Customer"
              required
              hint={customerLocked ? "Customer cannot be changed while purchase orders are linked to this quotation." : undefined}
            >
              <CustomerPicker
                customers={customers}
                value={customerId}
                disabled={customerLocked}
                fallbackLabel={detail?.quotation.customer_name}
                onChange={(customer) => {
                  guard.markDirty();
                  setCustomerId(customer.id);
                  setOrderIds([]);
                }}
              />
            </Field>
            <Field label="Quotation number" required>
              <input
                aria-label="Quotation number"
                className={inputClass}
                value={quotationNumber}
                onChange={(e) => {
                  setQuotationNumber(e.target.value);
                  setDuplicateWarning(null);
                }}
                onBlur={checkDuplicate}
              />
              {duplicateWarning && <p className="mt-1 text-xs text-amber-700">{duplicateWarning}</p>}
            </Field>
            <Field label="Quotation date" required>
              <input
                aria-label="Quotation date"
                type="date"
                className={inputClass}
                value={quotationDate}
                onChange={(e) => setQuotationDate(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Internal note">
            <textarea
              aria-label="Internal note"
              rows={3}
              className={textareaClass}
              placeholder="For your own reference, not sent to the company"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <FileAttachmentsField
            stored={storedFiles}
            attachments={attachments}
            onRequestRemove={setRemoveFile}
            description="Add the photos, PDF or Word files of the quotation you sent."
            disabled={saving}
          />

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Attach purchase orders</h3>
            {customerId === null ? (
              <p className="text-sm text-slate-500">Choose a customer to see purchase orders that can be attached.</p>
            ) : loadingOrders ? (
              <Loading />
            ) : (
              <div className="space-y-4">
                {availableOrders.length === 0 ? (
                  <p className="text-sm text-slate-500">No purchase orders without a quotation for this customer.</p>
                ) : (
                  <div className="space-y-2 rounded-md border border-slate-200 p-3">
                    {availableOrders.map((order) => (
                      <label key={order.id} className="flex items-start justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50 cursor-pointer">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            aria-label={`Attach purchase order ${order.po_number}`}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600"
                            checked={orderIds.includes(order.id)}
                            onChange={(e) => toggleOrder(order.id, e.target.checked)}
                          />
                          <div className="text-sm">
                            <div className="font-medium text-slate-800">{order.po_number}</div>
                            <div className="text-slate-500">
                              {order.po_date ? formatDate(order.po_date) : "No date"} · {invoiceCountLabel(order.invoice_count)}
                            </div>
                          </div>
                        </div>
                        <PurchaseOrderStatusBadge status={order.status} />
                      </label>
                    ))}
                  </div>
                )}

                {isEdit && detail && (
                  <div>
                    <h4 className="mb-2 text-sm font-medium text-slate-800">Linked purchase orders</h4>
                    {detail.orders.length === 0 ? (
                      <p className="text-sm text-slate-500">No purchase orders linked yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.orders.map((order) => (
                          <div key={order.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                            <div className="min-w-0 text-sm">
                              <div className="font-medium text-slate-800">{order.po_number}</div>
                              <div className="text-slate-500">
                                {order.po_date ? formatDate(order.po_date) : "No date"} · {invoiceCountLabel(order.invoice_count)}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <PurchaseOrderStatusBadge status={order.status} />
                              <Button size="sm" variant="ghost" onClick={() => unlinkOrder(order.id)}>
                                Unlink
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {removeFile && (
        <ConfirmDialog
          title={`Remove ${removeFile.file_name}?`}
          message="This file will be removed from the quotation."
          confirmLabel="Remove file"
          onConfirm={async () => {
            await removeQuotationFile(removeFile.id);
            toast("File removed");
            await refreshDetail();
          }}
          onClose={() => setRemoveFile(null)}
        />
      )}

      {guard.confirm}
    </>
  );
}
