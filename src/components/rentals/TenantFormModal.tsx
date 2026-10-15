import { useCallback, useEffect, useState } from "react";
import { AttachmentInfo } from "../../types/attachment";
import { PlaceListItem, RentalFileInfo, TenantDetail, TenantInput } from "../../types/rental";
import {
  addRentalFile,
  createRentalTenant,
  getRentalTenant,
  listRentalPlaces,
  openRentalFile,
  removeRentalFile,
  setRentalTenantMovedOut,
  updateRentalTenant,
} from "../../services/api";
import { errorMessage, formatDate, formatPhone, todayISO } from "../../lib/format";
import { Alert, Button, ConfirmDialog, Field, inputClass, Loading, Modal, textareaClass, useDiscardGuard, useToast } from "../ui";
import FileAttachmentsField, { AttachmentErrors } from "../attachments/FileAttachmentsField";
import { useFileAttachments } from "../attachments/useFileAttachments";

interface Props {
  tenantId?: number;
  onClose: () => void;
  /** Called after the tenant was saved, so the list can reload and close the form. */
  onSaved: (id: number) => void;
}

export default function TenantFormModal({ tenantId, onClose, onSaved }: Props) {
  const toast = useToast();
  const isEdit = tenantId !== undefined;
  const guard = useDiscardGuard(onClose);

  const [loading, setLoading] = useState(isEdit);
  const [places, setPlaces] = useState<PlaceListItem[] | null>(null);
  const [detail, setDetail] = useState<TenantDetail | null>(null);

  const [placeId, setPlaceId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [rent, setRent] = useState("");
  const [moveIn, setMoveIn] = useState("");
  const [notes, setNotes] = useState("");
  const [storedFiles, setStoredFiles] = useState<RentalFileInfo[]>([]);
  const [removeFile, setRemoveFile] = useState<AttachmentInfo | null>(null);
  const [movedOutOn, setMovedOutOn] = useState(todayISO());
  const [movingOut, setMovingOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (tenantId === undefined) return;
    const t = await getRentalTenant(tenantId);
    if (!t) throw new Error("This tenant no longer exists.");
    setDetail(t);
    setPlaceId(t.tenant.place_id);
    setName(t.tenant.name);
    setNumber(formatPhone(t.tenant.whatsapp_number));
    setRent(String(t.tenant.monthly_rent));
    setMoveIn(t.tenant.move_in_date ?? "");
    setNotes(t.tenant.notes ?? "");
    setStoredFiles(t.files);
  }, [tenantId]);

  /** Reload only what the saved tenant holds (moved-out date, files), never the fields being typed. */
  const refreshDetail = useCallback(async () => {
    if (tenantId === undefined) return;
    const t = await getRentalTenant(tenantId);
    if (!t) throw new Error("This tenant no longer exists.");
    setDetail(t);
    setStoredFiles(t.files);
  }, [tenantId]);

  const attachments = useFileAttachments({
    ownerId: tenantId,
    addFile: (id, fileName, base64) => addRentalFile("TENANT", id, fileName, base64),
    onStoredChange: refreshDetail,
    onDirty: guard.markDirty,
  });

  useEffect(() => {
    listRentalPlaces()
      .then(setPlaces)
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

  const currentHere = detail !== null && detail.tenant.moved_out_date === null;

  const choosePlace = (value: string) => {
    const id = value === "" ? null : Number(value);
    setPlaceId(id);
    // A new tenant starts with the place's usual rent, unless one was already typed.
    const place = places?.find((p) => p.id === id);
    if (place && rent.trim() === "" && place.monthly_rent > 0) setRent(String(place.monthly_rent));
  };

  const save = async () => {
    setError(null);
    attachments.clearErrors();
    if (placeId === null) return setError("Choose the place.");
    if (!name.trim()) return setError("Enter the tenant's name.");
    if (!number.trim()) return setError("Enter the WhatsApp number.");
    const rentValue = Number(rent);
    if (!(rentValue > 0)) return setError("Monthly rent must be more than zero.");

    const input: TenantInput = {
      place_id: placeId,
      name: name.trim(),
      whatsapp_number: number.trim(),
      monthly_rent: rentValue,
      move_in_date: moveIn || null,
      notes: notes.trim() || null,
    };

    setSaving(true);
    try {
      const saved = isEdit && tenantId !== undefined ? await updateRentalTenant(tenantId, input) : await createRentalTenant(input);
      const savedId = saved.tenant.id;
      const failures = await attachments.uploadPending(savedId);
      if (failures.length > 0) {
        // The tenant is saved, so leave the form and say which files are missing. Staying here in
        // "new" mode would let a second Save create the tenant twice.
        toast(
          `Tenant saved, but ${failures.length === 1 ? "1 file was" : `${failures.length} files were`} not added: ${failures.join("; ")}. Open the tenant to add ${failures.length === 1 ? "it" : "them"} again.`,
          "error"
        );
      } else {
        toast("Tenant saved");
      }
      onSaved(savedId);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  /** Moved out on the chosen date, or back in with `null`. Takes effect straight away. */
  const changeMovedOut = async (date: string | null) => {
    if (tenantId === undefined) return;
    setError(null);
    setMovingOut(true);
    try {
      await setRentalTenantMovedOut(tenantId, date);
      toast(date ? "Marked as moved out" : "Moved back in");
      await refreshDetail();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMovingOut(false);
    }
  };

  if (loading || places === null) {
    return (
      <Modal title="Tenant" onClose={guard.requestClose} size="wide">
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  return (
    <>
      <Modal
        title={isEdit ? "Edit tenant" : "New tenant"}
        subtitle={isEdit ? detail?.tenant.name : undefined}
        onClose={guard.requestClose}
        size="wide"
        footer={
          <>
            <Button onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" loading={saving || attachments.uploading} onClick={save}>
              {isEdit ? "Save changes" : "Save tenant"}
            </Button>
          </>
        }
      >
        <div className="space-y-6" onChangeCapture={(e) => e.currentTarget.contains(e.target as Node) && guard.markDirty()}>
          {error && <Alert>{error}</Alert>}
          <AttachmentErrors attachments={attachments} />
          {places.length === 0 && <Alert tone="info">Add a place in the Places tab first, then come back to add the tenant.</Alert>}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Place" required>
              <select aria-label="Place" className={inputClass} value={placeId ?? ""} onChange={(e) => choosePlace(e.target.value)}>
                <option value="">Choose a place</option>
                {places.map((p) => {
                  const taken = p.current_tenant !== null && !(currentHere && p.id === detail?.tenant.place_id);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {taken ? " (has a tenant)" : ""}
                    </option>
                  );
                })}
              </select>
            </Field>
            <Field label="Name" required>
              <input aria-label="Name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="WhatsApp number" required hint="10-digit mobile, or +country code">
              <input
                aria-label="WhatsApp number"
                type="tel"
                className={`${inputClass} tabular`}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </Field>
            <Field label="Monthly rent (₹)" required>
              <input
                aria-label="Monthly rent"
                type="number"
                min={0}
                step="0.01"
                className={`${inputClass} tabular`}
                value={rent}
                onChange={(e) => setRent(e.target.value)}
              />
            </Field>
            <Field label="Move-in date">
              <input aria-label="Move-in date" type="date" className={inputClass} value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
            </Field>
          </div>

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
            description="Agreement, ID copy or photos. A masked Aadhaar copy is safer than the full number."
            disabled={saving}
          />

          {isEdit && detail && (
            <div className="space-y-2 rounded-md border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Living here</h3>
              {currentHere ? (
                <div className="flex items-end gap-3">
                  <Field label="Moved out on" className="w-44">
                    <input
                      aria-label="Moved out on"
                      type="date"
                      className={inputClass}
                      value={movedOutOn}
                      onChange={(e) => setMovedOutOn(e.target.value)}
                    />
                  </Field>
                  <Button loading={movingOut} disabled={!movedOutOn} onClick={() => changeMovedOut(movedOutOn)}>
                    Mark moved out
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-600">Moved out on {formatDate(detail.tenant.moved_out_date)}.</p>
                  <Button loading={movingOut} onClick={() => changeMovedOut(null)}>
                    Move back in
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {removeFile && (
        <ConfirmDialog
          title={`Remove ${removeFile.file_name}?`}
          message="This file will be removed from the tenant."
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
