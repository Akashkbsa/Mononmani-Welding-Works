import { useCallback, useEffect, useState } from "react";
import { AttachmentInfo } from "../../types/attachment";
import { PlaceDetail, PlaceInput, RentalFileInfo } from "../../types/rental";
import {
  addRentalFile,
  createRentalPlace,
  getRentalPlace,
  openRentalFile,
  removeRentalFile,
  updateRentalPlace,
} from "../../services/api";
import { errorMessage } from "../../lib/format";
import { Alert, Button, ConfirmDialog, Field, inputClass, Loading, Modal, textareaClass, useDiscardGuard, useToast } from "../ui";
import FileAttachmentsField, { AttachmentErrors } from "../attachments/FileAttachmentsField";
import { useFileAttachments } from "../attachments/useFileAttachments";

interface Props {
  placeId?: number;
  onClose: () => void;
  /** Called after the place was saved, so the list can reload and close the form. */
  onSaved: (id: number) => void;
}

export default function PlaceFormModal({ placeId, onClose, onSaved }: Props) {
  const toast = useToast();
  const isEdit = placeId !== undefined;
  const guard = useDiscardGuard(onClose);

  const [loading, setLoading] = useState(isEdit);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [rent, setRent] = useState("");
  const [notes, setNotes] = useState("");
  const [storedFiles, setStoredFiles] = useState<RentalFileInfo[]>([]);
  const [removeFile, setRemoveFile] = useState<AttachmentInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (placeId === undefined) return;
    const p = await getRentalPlace(placeId);
    if (!p) throw new Error("This place no longer exists.");
    setDetail(p);
    setName(p.place.name);
    setAddress(p.place.address ?? "");
    setRent(p.place.monthly_rent > 0 ? String(p.place.monthly_rent) : "");
    setNotes(p.place.notes ?? "");
    setStoredFiles(p.files);
  }, [placeId]);

  /** Reload only the saved files, never the fields being typed. */
  const refreshDetail = useCallback(async () => {
    if (placeId === undefined) return;
    const p = await getRentalPlace(placeId);
    if (!p) throw new Error("This place no longer exists.");
    setDetail(p);
    setStoredFiles(p.files);
  }, [placeId]);

  const attachments = useFileAttachments({
    ownerId: placeId,
    addFile: (id, fileName, base64) => addRentalFile("PLACE", id, fileName, base64),
    onStoredChange: refreshDetail,
    onDirty: guard.markDirty,
  });

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

  const save = async () => {
    setError(null);
    attachments.clearErrors();
    if (!name.trim()) return setError("Enter the place name.");
    const rentValue = rent.trim() === "" ? 0 : Number(rent);
    if (!(rentValue >= 0)) return setError("Monthly rent can't be negative.");

    const input: PlaceInput = {
      name: name.trim(),
      address: address.trim() || null,
      monthly_rent: rentValue,
      notes: notes.trim() || null,
    };

    setSaving(true);
    try {
      const saved = isEdit && placeId !== undefined ? await updateRentalPlace(placeId, input) : await createRentalPlace(input);
      const savedId = saved.place.id;
      const failures = await attachments.uploadPending(savedId);
      if (failures.length > 0) {
        // The place is saved, so leave the form and say which files are missing. Staying here in
        // "new" mode would let a second Save create the place twice.
        toast(
          `Place saved, but ${failures.length === 1 ? "1 file was" : `${failures.length} files were`} not added: ${failures.join("; ")}. Open the place to add ${failures.length === 1 ? "it" : "them"} again.`,
          "error"
        );
      } else {
        toast("Place saved");
      }
      onSaved(savedId);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Modal title="Place" onClose={guard.requestClose} size="wide">
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  return (
    <>
      <Modal
        title={isEdit ? "Edit place" : "New place"}
        subtitle={isEdit ? detail?.place.name : undefined}
        onClose={guard.requestClose}
        size="wide"
        footer={
          <>
            <Button onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" loading={saving || attachments.uploading} onClick={save}>
              {isEdit ? "Save changes" : "Save place"}
            </Button>
          </>
        }
      >
        <div className="space-y-6" onChangeCapture={(e) => e.currentTarget.contains(e.target as Node) && guard.markDirty()}>
          {error && <Alert>{error}</Alert>}
          <AttachmentErrors attachments={attachments} />

          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" required hint="For example: Flat 2B, Shop 1, Godown">
              <input aria-label="Name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Usual monthly rent (₹)" hint="Fills in the rent when you add a tenant here.">
              <input
                aria-label="Usual monthly rent"
                type="number"
                min={0}
                step="0.01"
                className={`${inputClass} tabular`}
                value={rent}
                onChange={(e) => setRent(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Address">
            <textarea
              aria-label="Address"
              rows={2}
              className={textareaClass}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>

          <Field label="Notes">
            <textarea
              aria-label="Notes"
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
            openFile={openRentalFile}
            description="Ownership papers, electricity bill, property tax receipts or photos."
            disabled={saving}
          />
        </div>
      </Modal>

      {removeFile && (
        <ConfirmDialog
          title={`Remove ${removeFile.file_name}?`}
          message="This file will be removed from the place."
          confirmLabel="Remove file"
          onConfirm={async () => {
            await removeRentalFile(removeFile.id);
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
