import { useCallback, useEffect, useMemo, useState } from "react";
import { Customer } from "../../types/customer";
import {
  LinkedInvoice,
  PO_STATUS_LABEL,
  PurchaseOrderDetail,
  PurchaseOrderFileInfo,
  PurchaseOrderInput,
  PurchaseOrderStatus,
} from "../../types/purchaseOrder";
import { QuotationListItem } from "../../types/quotation";
import {
  addPurchaseOrderFile,
  checkDuplicatePoNumber,
  createPurchaseOrder,
  getPurchaseOrder,
  listCustomers,
  listQuotations,
  listUnlinkedInvoicesForCustomer,
  removePurchaseOrderFile,
  setInvoicePurchaseOrder,
  updatePurchaseOrder,
} from "../../services/api";
import { errorMessage, formatDate, formatMoney } from "../../lib/format";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  inputClass,
  Loading,
  Modal,
  SearchSelect,
  StatusBadge,
  textareaClass,
  useDiscardGuard,
  useToast,
} from "../ui";
import CustomerPicker from "../CustomerPicker";
import FileAttachmentsField, { AttachmentErrors } from "../attachments/FileAttachmentsField";
import { useFileAttachments } from "../attachments/useFileAttachments";

interface Props {
  purchaseOrderId?: number;
  onClose: () => void;
  onSaved: (id: number) => void;
}

function paymentStatusBadge(invoice: LinkedInvoice) {
  if (invoice.status === "CANCELLED") return <Badge tone="neutral">Cancelled</Badge>;
  if (invoice.status === "DRAFT") return <Badge tone="neutral">Draft</Badge>;
  return <StatusBadge status={invoice.payment_status} />;
}

export default function PurchaseOrderFormModal({ purchaseOrderId, onClose, onSaved }: Props) {
  const toast = useToast();
  const isEdit = purchaseOrderId !== undefined;
  const guard = useDiscardGuard(onClose);

  const [loading, setLoading] = useState(isEdit);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [status, setStatus] = useState<PurchaseOrderStatus>("NOT_STARTED");
  const [notes, setNotes] = useState("");
  const [quotationId, setQuotationId] = useState<number | null>(null);
  const [quotations, setQuotations] = useState<QuotationListItem[]>([]);
  const [invoiceIds, setInvoiceIds] = useState<number[]>([]);
  const [availableInvoices, setAvailableInvoices] = useState<LinkedInvoice[]>([]);
  const [storedFiles, setStoredFiles] = useState<PurchaseOrderFileInfo[]>([]);
  const [removeFile, setRemoveFile] = useState<PurchaseOrderFileInfo | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoiceLocked = (detail?.invoices.length ?? 0) > 0;
  // An order that still keeps its quotation keeps its customer; remove the quotation first.
  const quotationLocked = isEdit && detail?.order.quotation_id != null && quotationId === detail.order.quotation_id;
  const customerLocked = invoiceLocked || quotationLocked;

  const loadDetail = useCallback(async () => {
    if (!purchaseOrderId) return;
    const po = await getPurchaseOrder(purchaseOrderId);
    if (!po) throw new Error("This purchase order no longer exists.");
    setDetail(po);
    setCustomerId(po.order.customer_id);
    setPoNumber(po.order.po_number);
    setPoDate(po.order.po_date ?? "");
    setStatus(po.order.status);
    setNotes(po.order.notes ?? "");
    setQuotationId(po.order.quotation_id);
    setStoredFiles(po.files);
    setInvoiceIds([]);
  }, [purchaseOrderId]);

  /** Reload only what the saved order holds (files, linked invoices), never the fields being typed. */
  const refreshDetail = useCallback(async () => {
    if (!purchaseOrderId) return;
    const po = await getPurchaseOrder(purchaseOrderId);
    if (!po) throw new Error("This purchase order no longer exists.");
    setDetail(po);
    setStoredFiles(po.files);
  }, [purchaseOrderId]);

  const attachments = useFileAttachments({
    ownerId: purchaseOrderId,
    addFile: addPurchaseOrderFile,
    onStoredChange: refreshDetail,
    onDirty: guard.markDirty,
  });

  useEffect(() => {
    listCustomers("CUSTOMER")
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
      setAvailableInvoices([]);
      return;
    }
    let cancelled = false;
    setLoadingInvoices(true);
    listUnlinkedInvoicesForCustomer(customerId)
      .then((items) => {
        if (!cancelled) setAvailableInvoices(items);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoadingInvoices(false));
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  useEffect(() => {
    if (customerId === null) {
      setQuotations([]);
      return;
    }
    let cancelled = false;
    listQuotations({ customer_id: customerId })
      .then((list) => !cancelled && setQuotations(list))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const quotationOptions = useMemo(
    () =>
      quotations.map((q) => ({
        id: q.id,
        label: `${q.quotation_number} — ${formatDate(q.quotation_date)}`,
        search: q.quotation_number,
      })),
    [quotations]
  );

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === customerId) ?? null,
    [customers, customerId]
  );

  const checkDuplicate = async () => {
    if (!customerId || !poNumber.trim()) return setDuplicateWarning(null);
    try {
      const result = await checkDuplicatePoNumber(customerId, poNumber.trim(), purchaseOrderId);
      setDuplicateWarning(result.has_duplicate ? "This customer already has a purchase order with this number." : null);
    } catch {
      setDuplicateWarning(null);
    }
  };

  const toggleInvoice = (id: number, checked: boolean) => {
    guard.markDirty();
    setInvoiceIds((current) => (checked ? [...current, id] : current.filter((item) => item !== id)));
  };

  const unlinkInvoice = async (invoiceId: number) => {
    if (!purchaseOrderId) return;
    try {
      await setInvoicePurchaseOrder(invoiceId, null);
      toast("Invoice unlinked");
      await refreshDetail();
      if (customerId !== null) setAvailableInvoices(await listUnlinkedInvoicesForCustomer(customerId));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const save = async () => {
    setError(null);
    attachments.clearErrors();
    if (customerId === null) return setError("Choose a customer.");
    if (!poNumber.trim()) return setError("Enter the purchase order number.");

    const input: PurchaseOrderInput = {
      customer_id: customerId,
      po_number: poNumber.trim(),
      po_date: poDate || null,
      status,
      notes: notes.trim() || null,
      invoice_ids: invoiceIds,
      quotation_id: quotationId,
    };

    setSaving(true);
    try {
      const saved = isEdit && purchaseOrderId ? await updatePurchaseOrder(purchaseOrderId, input) : await createPurchaseOrder(input);
      const savedId = saved.order.id;
      const failures = await attachments.uploadPending(savedId);
      if (failures.length > 0) {
        // The order itself is saved, so leave the form (the list refreshes) and say which files
        // are missing. Staying here in "new" mode would let a second Save create a duplicate.
        toast(
          `Purchase order saved, but ${failures.length === 1 ? "1 file was" : `${failures.length} files were`} not added: ${failures.join("; ")}. Open the purchase order to add ${failures.length === 1 ? "it" : "them"} again.`,
          "error"
        );
      } else {
        toast("Purchase order saved");
      }
      onSaved(savedId);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Modal title="Purchase order" onClose={guard.requestClose} size="wide">
        <Loading />
      </Modal>
    );
  }

  return (
    <>
      <Modal
        title={isEdit && detail ? `Edit purchase order ${detail.order.po_number}` : "New purchase order"}
        subtitle={isEdit ? selectedCustomer?.name ?? detail?.order.customer_name : undefined}
        onClose={guard.requestClose}
        size="wide"
        footer={
          <>
            <Button onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" loading={saving || attachments.uploading} onClick={save}>
              {isEdit ? "Save changes" : "Save purchase order"}
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
              hint={
                invoiceLocked
                  ? "Customer cannot be changed after invoices have been linked to this purchase order."
                  : quotationLocked
                  ? "This order is linked to a quotation, so its customer is fixed. Remove the quotation to change it."
                  : undefined
              }
            >
              <CustomerPicker
                customers={customers}
                value={customerId}
                disabled={customerLocked}
                fallbackLabel={detail?.order.customer_name}
                onChange={(customer) => {
                  guard.markDirty();
                  setCustomerId(customer.id);
                  setQuotationId(null);
                  setInvoiceIds([]);
                  setDuplicateWarning(null);
                }}
              />
            </Field>
            <Field label="PO number" required>
              <input
                aria-label="PO number"
                className={inputClass}
                value={poNumber}
                onChange={(e) => {
                  setPoNumber(e.target.value);
                  setDuplicateWarning(null);
                }}
                onBlur={checkDuplicate}
              />
              {duplicateWarning && <p className="mt-1 text-xs text-amber-700">{duplicateWarning}</p>}
            </Field>
            <Field label="PO date">
              <input aria-label="PO date" type="date" className={inputClass} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            </Field>
            <Field label="Status">
              <select
                aria-label="Status"
                className={inputClass}
                value={status}
                onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus)}
              >
                {(Object.keys(PO_STATUS_LABEL) as PurchaseOrderStatus[]).map((item) => (
                  <option key={item} value={item}>
                    {PO_STATUS_LABEL[item]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {customerId !== null && (
            <Field
              label="Quotation"
              hint={
                quotations.length === 0 && quotationId === null
                  ? "This customer has no quotations yet. You can add one under Quotations."
                  : "Optional. Pick the quotation this order came from."
              }
            >
              <div className="flex gap-2">
                <SearchSelect
                  ariaLabel="Quotation"
                  options={quotationOptions}
                  value={quotationId}
                  placeholder="Search by quotation number"
                  emptyText="No quotation matches."
                  disabled={quotations.length === 0 && quotationId === null}
                  fallbackLabel={quotationId !== null ? detail?.order.quotation_number ?? undefined : undefined}
                  onChange={(id) => {
                    guard.markDirty();
                    setQuotationId(id);
                  }}
                />
                {quotationId !== null && (
                  <Button
                    onClick={() => {
                      guard.markDirty();
                      setQuotationId(null);
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </Field>
          )}

          <Field label="Internal note">
            <textarea
              aria-label="Internal note"
              rows={3}
              className={textareaClass}
              placeholder="For your own reference, not printed"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <FileAttachmentsField
            stored={storedFiles}
            attachments={attachments}
            onRequestRemove={setRemoveFile}
            description="Add photos, PDF or Word files for this purchase order."
            disabled={saving}
          />

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Attach invoices</h3>
            {customerId === null ? (
              <p className="text-sm text-slate-500">Choose a customer to see invoices that can be attached.</p>
            ) : loadingInvoices ? (
              <Loading />
            ) : (
              <div className="space-y-4">
                {availableInvoices.length === 0 ? (
                  <p className="text-sm text-slate-500">No unlinked invoices for this customer.</p>
                ) : (
                  <div className="space-y-2 rounded-md border border-slate-200 p-3">
                    {availableInvoices.map((invoice) => {
                      const checked = invoiceIds.includes(invoice.id);
                      return (
                        <label key={invoice.id} className="flex items-start justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50 cursor-pointer">
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              aria-label={`Attach invoice ${invoice.invoice_number}`}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600"
                              checked={checked}
                              onChange={(e) => toggleInvoice(invoice.id, e.target.checked)}
                            />
                            <div className="text-sm">
                              <div className="font-medium text-slate-800">{invoice.invoice_number}</div>
                              <div className="text-slate-500">
                                {formatDate(invoice.invoice_date)} · {formatMoney(invoice.total_amount)}
                              </div>
                              {invoice.po_number_and_date && (
                                <div className="text-xs text-amber-700">
                                  {`Prints PO "${invoice.po_number_and_date}" now. Attaching replaces it with this order's number.`}
                                </div>
                              )}
                            </div>
                          </div>
                          <div>{paymentStatusBadge(invoice)}</div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {isEdit && detail && (
                  <div>
                    <h4 className="mb-2 text-sm font-medium text-slate-800">Linked invoices</h4>
                    {detail.invoices.length === 0 ? (
                      <p className="text-sm text-slate-500">No invoices linked yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.invoices.map((invoice) => (
                          <div key={invoice.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                            <div className="min-w-0 text-sm">
                              <div className="font-medium text-slate-800">{invoice.invoice_number}</div>
                              <div className="text-slate-500">
                                {formatDate(invoice.invoice_date)} · {formatMoney(invoice.total_amount)}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {paymentStatusBadge(invoice)}
                              <Button size="sm" variant="ghost" onClick={() => unlinkInvoice(invoice.id)}>
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
          message="This file will be removed from the purchase order."
          confirmLabel="Remove file"
          onConfirm={async () => {
            await removePurchaseOrderFile(removeFile.id);
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
