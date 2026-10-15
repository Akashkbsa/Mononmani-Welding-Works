import { useCallback, useEffect, useState } from "react";
import { AttachmentInfo } from "../../types/attachment";
import { EmployeeDetail, EmployeeFileInfo, EmployeeInput, EmployeeListItem } from "../../types/payroll";
import {
  addEmployeeFile,
  createEmployee,
  findEmployeesByName,
  getEmployee,
  openEmployeeFile,
  removeEmployeeFile,
  updateEmployee,
} from "../../services/api";
import { errorMessage, todayISO } from "../../lib/format";
import { Alert, Button, ConfirmDialog, Field, inputClass, Loading, Modal, textareaClass, useDiscardGuard, useToast } from "../ui";
import FileAttachmentsField, { AttachmentErrors } from "../attachments/FileAttachmentsField";
import { useFileAttachments } from "../attachments/useFileAttachments";

interface Props {
  employeeId?: number;
  onClose: () => void;
  /** Called after the employee was saved, so the list can reload and close the form. */
  onSaved: (detail: EmployeeDetail) => void;
}

/** Add or edit an employee: name, role, contact, joining date, daily wage, OT rate and files. */
export default function EmployeeFormModal({ employeeId, onClose, onSaved }: Props) {
  const toast = useToast();
  const isEdit = employeeId !== undefined;
  const guard = useDiscardGuard(onClose);

  const [loading, setLoading] = useState(isEdit);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [joinedOn, setJoinedOn] = useState(todayISO());
  const [wage, setWage] = useState("");
  const [otRate, setOtRate] = useState("0");
  const [notes, setNotes] = useState("");
  const [storedFiles, setStoredFiles] = useState<EmployeeFileInfo[]>([]);
  const [removeFile, setRemoveFile] = useState<AttachmentInfo | null>(null);
  const [sameName, setSameName] = useState<EmployeeListItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Reload only the saved files, never the fields being typed. */
  const refreshFiles = useCallback(async () => {
    if (employeeId === undefined) return;
    const d = await getEmployee(employeeId);
    if (!d) throw new Error("This employee no longer exists.");
    setStoredFiles(d.files);
  }, [employeeId]);

  const attachments = useFileAttachments({
    ownerId: employeeId,
    addFile: (id, fileName, base64) => addEmployeeFile(id, fileName, base64),
    onStoredChange: refreshFiles,
    onDirty: guard.markDirty,
  });

  useEffect(() => {
    if (employeeId === undefined) return;
    let cancelled = false;
    getEmployee(employeeId)
      .then((d) => {
        if (cancelled) return;
        if (!d) throw new Error("This employee no longer exists.");
        const e = d.employee;
        setName(e.name);
        setRole(e.role ?? "");
        setPhone(e.phone ?? "");
        setAddress(e.address ?? "");
        setJoinedOn(e.joined_on);
        setWage(String(e.daily_wage));
        setOtRate(String(e.ot_rate));
        setNotes(e.notes ?? "");
        setStoredFiles(d.files);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const checkName = async () => {
    try {
      setSameName(name.trim() ? await findEmployeesByName(name.trim(), employeeId) : []);
    } catch {
      setSameName([]);
    }
  };

  const save = async () => {
    setError(null);
    attachments.clearErrors();
    if (!name.trim()) return setError("Enter the employee's name.");
    if (!joinedOn) return setError("Enter the joining date.");
    const wageValue = Number(wage);
    if (!(wageValue > 0)) return setError("Daily wage must be more than 0.");
    const rateValue = otRate.trim() === "" ? 0 : Number(otRate);
    if (!(rateValue >= 0)) return setError("OT rate can't be negative.");

    const input: EmployeeInput = {
      name: name.trim(),
      role: role.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      joined_on: joinedOn,
      daily_wage: wageValue,
      ot_rate: rateValue,
      notes: notes.trim() || null,
    };

    setSaving(true);
    try {
      const saved = employeeId !== undefined ? await updateEmployee(employeeId, input) : await createEmployee(input);
      const failures = await attachments.uploadPending(saved.employee.id);
      if (failures.length > 0) {
        // The employee is saved, so leave the form and say which files are missing. Staying here in
        // "new" mode would let a second Save add the employee twice.
        toast(
          `Employee saved, but ${failures.length === 1 ? "1 file was" : `${failures.length} files were`} not added: ${failures.join("; ")}. Open the employee to add ${failures.length === 1 ? "it" : "them"} again.`,
          "error"
        );
      } else {
        toast("Employee saved");
      }
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Modal title="Employee" onClose={guard.requestClose} size="wide">
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  return (
    <>
      <Modal
        title={isEdit ? "Edit employee" : "New employee"}
        subtitle={isEdit ? name : undefined}
        onClose={guard.requestClose}
        size="wide"
        footer={
          <>
            <Button onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" loading={saving || attachments.uploading} onClick={save}>
              {isEdit ? "Save changes" : "Save employee"}
            </Button>
          </>
        }
      >
        <div className="space-y-6" onChangeCapture={(e) => e.currentTarget.contains(e.target as Node) && guard.markDirty()}>
          {error && <Alert>{error}</Alert>}
          <AttachmentErrors attachments={attachments} />

          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" required>
              <input
                aria-label="Name"
                className={inputClass}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSameName([]);
                }}
                onBlur={checkName}
              />
              {sameName.length > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  There is already an employee named{" "}
                  {sameName.map((s) => (s.role ? `${s.name} (${s.role})` : s.name)).join(", ")}. Saving adds another.
                </p>
              )}
            </Field>
            <Field label="Role" hint="e.g. Welder, Helper">
              <input aria-label="Role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} />
            </Field>
            <Field label="Phone">
              <input aria-label="Phone" type="tel" className={`${inputClass} tabular`} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Joined on" required>
              <input aria-label="Joined on" type="date" className={inputClass} value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} />
            </Field>
            <Field label="Daily wage (₹)" required>
              <input
                aria-label="Daily wage"
                type="number"
                min={0}
                step="0.01"
                className={`${inputClass} tabular`}
                value={wage}
                onChange={(e) => setWage(e.target.value)}
              />
            </Field>
            <Field label="OT rate per hour (₹)" hint="0 if no overtime pay">
              <input
                aria-label="OT rate per hour"
                type="number"
                min={0}
                step="0.01"
                className={`${inputClass} tabular`}
                value={otRate}
                onChange={(e) => setOtRate(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Address">
            <textarea aria-label="Address" rows={2} className={textareaClass} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>

          <Field label="Notes">
            <textarea
              aria-label="Notes"
              rows={2}
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
            openFile={openEmployeeFile}
            description="ID copy or photo. A masked Aadhaar copy is safer than the full number."
            disabled={saving}
          />
        </div>
      </Modal>

      {removeFile && (
        <ConfirmDialog
          title={`Remove ${removeFile.file_name}?`}
          message="This file will be removed from the employee."
          confirmLabel="Remove file"
          onConfirm={async () => {
            await removeEmployeeFile(removeFile.id);
            toast("File removed");
            await refreshFiles();
          }}
          onClose={() => setRemoveFile(null)}
        />
      )}

      {guard.confirm}
    </>
  );
}
