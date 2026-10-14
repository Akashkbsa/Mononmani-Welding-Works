import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Customer } from "../../types/customer";
import { AttachmentInfo } from "../../types/attachment";
import { SupplierBillDetail, SupplierBillFileInfo, SupplierBillInput } from "../../types/supplierBill";
import {
  addSupplierBillFile,
  checkDuplicateSupplierBillNumber,
  createSupplierBill,
  getSupplierBill,
  listCustomers,
  removeSupplierBillFile,
  updateSupplierBill,
} from "../../services/api";
import { errorMessage, todayISO } from "../../lib/format";
import { Alert, Button, ConfirmDialog, Field, inputClass, Loading, Modal, textareaClass, useDiscardGuard, useToast } from "../ui";
import CustomerPicker from "../CustomerPicker";
import CustomerFormModal from "../customers/CustomerFormModal";
import FileAttachmentsField, { AttachmentErrors } from "../attachments/FileAttachmentsField";
import { useFileAttachments } from "../attachments/useFileAttachments";

interface Props {
  billId?: number;
  onClose: () => void;
  onSaved: (id: number) => void;
}

export default function SupplierBillFormModal({ billId, onClose, onSaved }: Props) {
  const toast = useToast();
  const isEdit = billId !== undefined;
  const guard = useDiscardGuard(onClose);

  const [loading, setLoading] = useState(isEdit);
  const [suppliers, setSuppliers] = useState<Customer[]>([]);
  const [detail, setDetail] = useState<SupplierBillDetail | null>(null);
  const [addingSupplier, setAddingSupplier] = useState(false);

  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [total, setTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [storedFiles, setStoredFiles] = useState<SupplierBillFileInfo[]>([]);
  const [removeFile, setRemoveFile] = useState<AttachmentInfo | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supplierLocked = (detail?.payments.length ?? 0) > 0;

  const loadDetail = useCallback(async () => {
    if (!billId) return;
    const b = await getSupplierBill(billId);
    if (!b) throw new Error("This supplier bill no longer exists.");
    setDetail(b);
    setSupplierId(b.bill.supplier_id);
    setBillNumber(b.bill.bill_number);
    setBillDate(b.bill.bill_date);
    setTotal(String(b.bill.total_amount));
    setNotes(b.bill.notes ?? "");
    setStoredFiles(b.files);
  }, [billId]);

  /** Reload only what the saved bill holds (files, payments), never the fields being typed. */
  const refreshDetail = useCallback(async () => {
    if (!billId) return;
    const b = await getSupplierBill(billId);
    if (!b) throw new Error("This supplier bill no longer exists.");
    setDetail(b);
    setStoredFiles(b.files);
  }, [billId]);

  const attachments = useFileAttachments({
    ownerId: billId,
    addFile: addSupplierBillFile,
    onStoredChange: refreshDetail,
    onDirty: guard.markDirty,
  });

  useEffect(() => {
    listCustomers("SUPPLIER")
      .then(setSuppliers)
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

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId) ?? null,
    [suppliers, supplierId]
  );

  // Only a warning: a supplier may send a corrected bill under the same number.
  const checkDuplicate = async () => {
    if (supplierId === null || !billNumber.trim()) return setDuplicateWarning(null);
    try {
      const result = await checkDuplicateSupplierBillNumber(supplierId, billNumber.trim(), billId);
      setDuplicateWarning(result.has_duplicate ? `${billNumber.trim()} is already used by this supplier.` : null);
    } catch {
      setDuplicateWarning(null);
    }
  };

  const save = async () => {
    setError(null);
    attachments.clearErrors();
    if (supplierId === null) return setError("Choose a supplier.");
    if (!billNumber.trim()) return setError("Enter the bill number.");
    if (!billDate) return setError("Choose the bill date.");
    const amount = parseFloat(total);
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter the bill total.");

    const input: SupplierBillInput = {
      supplier_id: supplierId,
      bill_number: billNumber.trim(),
      bill_date: billDate,
      total_amount: amount,
      notes: notes.trim() || null,
    };

    setSaving(true);
    try {
      const saved = isEdit && billId ? await updateSupplierBill(billId, input) : await createSupplierBill(input);
      const savedId = saved.bill.id;
      const failures = await attachments.uploadPending(savedId);
      if (failures.length > 0) {
        // The bill itself is saved, so leave the form (the list refreshes) and say which files are
        // missing. Staying here in "new" mode would let a second Save create a duplicate.
        toast(
          `Supplier bill saved, but ${failures.length === 1 ? "1 file was" : `${failures.length} files were`} not added: ${failures.join("; ")}. Open the bill to add ${failures.length === 1 ? "it" : "them"} again.`,
          "error"
        );
      } else {
        toast("Supplier bill saved");
      }
      onSaved(savedId);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Modal title="Supplier bill" onClose={guard.requestClose} size="wide">
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  return (
    <>
      <Modal
        title={isEdit && detail ? `Edit supplier bill ${detail.bill.bill_number}` : "New supplier bill"}
        subtitle={isEdit ? selectedSupplier?.name ?? detail?.bill.supplier_name : undefined}
        onClose={guard.requestClose}
        size="wide"
        footer={
          <>
            <Button onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" loading={saving || attachments.uploading} onClick={save}>
              {isEdit ? "Save changes" : "Save supplier bill"}
            </Button>
          </>
        }
      >
        <div className="space-y-6" onChangeCapture={guard.markDirty}>
          {error && <Alert>{error}</Alert>}
          <AttachmentErrors attachments={attachments} />

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Supplier"
              required
              className="col-span-2"
              hint={supplierLocked ? "Supplier cannot be changed once payments are recorded against this bill." : undefined}
            >
              <div className="flex gap-2">
                <CustomerPicker
                  customers={suppliers}
                  value={supplierId}
                  ariaLabel="Supplier"
                  noun="supplier"
                  disabled={supplierLocked}
                  fallbackLabel={detail?.bill.supplier_name}
                  onChange={(supplier) => {
                    guard.markDirty();
                    setSupplierId(supplier.id);
                    setDuplicateWarning(null);
                  }}
                />
                <Button icon={<Plus className="w-4 h-4" />} disabled={supplierLocked} onClick={() => setAddingSupplier(true)}>
                  New
                </Button>
              </div>
            </Field>
            <Field label="Bill number" required>
              <input
                aria-label="Bill number"
                className={inputClass}
                value={billNumber}
                onChange={(e) => {
                  setBillNumber(e.target.value);
                  setDuplicateWarning(null);
                }}
                onBlur={checkDuplicate}
              />
              {duplicateWarning && <p className="mt-1 text-xs text-amber-700">{duplicateWarning}</p>}
            </Field>
            <Field label="Bill date" required>
              <input aria-label="Bill date" type="date" className={inputClass} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </Field>
            <Field label="Total amount (₹)" required>
              <input
                aria-label="Total amount"
                type="number"
                min={0}
                step="0.01"
                className={`${inputClass} tabular`}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Internal note">
            <textarea
              aria-label="Internal note"
              rows={3}
              className={textareaClass}
              placeholder="For your own reference"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <FileAttachmentsField
            stored={storedFiles}
            attachments={attachments}
            onRequestRemove={setRemoveFile}
            description="Add the photos, PDF or Word files of the bill you received."
            disabled={saving}
          />
        </div>
      </Modal>

      {removeFile && (
        <ConfirmDialog
          title={`Remove ${removeFile.file_name}?`}
          message="This file will be removed from the supplier bill."
          confirmLabel="Remove file"
          onConfirm={async () => {
            await removeSupplierBillFile(removeFile.id);
            toast("File removed");
            await refreshDetail();
          }}
          onClose={() => setRemoveFile(null)}
        />
      )}

      {addingSupplier && (
        <CustomerFormModal
          allowedPartyTypes={["SUPPLIER", "BOTH"]}
          defaultPartyType="SUPPLIER"
          noun="supplier"
          onClose={() => setAddingSupplier(false)}
          onSaved={(c) => {
            setAddingSupplier(false);
            setSuppliers((list) => [c, ...list]);
            guard.markDirty();
            setSupplierId(c.id);
            setDuplicateWarning(null);
          }}
        />
      )}

      {guard.confirm}
    </>
  );
}
