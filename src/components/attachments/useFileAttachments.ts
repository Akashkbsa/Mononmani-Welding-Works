import { ChangeEvent, useState } from "react";
import { errorMessage } from "../../lib/format";
import { ALLOWED_ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_BYTES } from "../../types/attachment";
import { useToast } from "../ui";

export interface PendingUpload {
  key: string;
  fileName: string;
  sizeBytes: number;
  base64: string;
}

interface Options {
  /** The saved record the files belong to. Undefined while the record is still being created. */
  ownerId?: number;
  addFile: (ownerId: number, fileName: string, base64: string) => Promise<unknown>;
  /** Called after files were added to a saved record, so the screen can reload its file list. */
  onStoredChange: () => Promise<void>;
  onDirty: () => void;
}

const readFile = (file: File) =>
  new Promise<PendingUpload>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) return reject(new Error("Could not read the file."));
      resolve({
        key: `${file.name}-${file.size}-${file.lastModified}`,
        fileName: file.name,
        sizeBytes: file.size,
        base64: result.slice(comma + 1),
      });
    };
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });

/**
 * Picking, checking and uploading the files of a purchase order or quotation. A saved record
 * uploads straight away; a new one keeps the files until `uploadPending` is called with its id.
 */
export function useFileAttachments({ ownerId, addFile, onStoredChange, onDirty }: Options) {
  const toast = useToast();
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busyFileName, setBusyFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const pickFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (list.length === 0) return;
    const nextErrors: string[] = [];
    const accepted: PendingUpload[] = [];

    for (const file of list) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext)) {
        nextErrors.push(`${file.name}: only JPG, JPEG, PNG, PDF, DOC and DOCX files are allowed.`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        nextErrors.push(`${file.name}: file is larger than 10 MB.`);
        continue;
      }
      try {
        accepted.push(await readFile(file));
      } catch (err) {
        nextErrors.push(`${file.name}: ${errorMessage(err)}`);
      }
    }

    setErrors(nextErrors);
    if (nextErrors.length > 0) toast(nextErrors[0], "error");

    if (accepted.length === 0) return;

    onDirty();
    if (ownerId === undefined) {
      setPending((current) => [...current, ...accepted]);
      return;
    }

    setUploading(true);
    const failures: string[] = [];
    for (const file of accepted) {
      try {
        setBusyFileName(file.fileName);
        await addFile(ownerId, file.fileName, file.base64);
      } catch (err) {
        failures.push(`${file.fileName}: ${errorMessage(err)}`);
      }
    }
    setBusyFileName(null);
    setUploading(false);
    if (failures.length > 0) {
      setErrors(failures);
      toast(failures[0], "error");
    } else {
      setErrors([]);
    }
    await onStoredChange();
  };

  /** Upload the files kept while the record was new. Returns one message per file that failed. */
  const uploadPending = async (savedId: number) => {
    if (pending.length === 0) return [] as string[];
    setUploading(true);
    const failures: string[] = [];
    for (const file of pending) {
      try {
        setBusyFileName(file.fileName);
        await addFile(savedId, file.fileName, file.base64);
      } catch (err) {
        failures.push(`${file.fileName}: ${errorMessage(err)}`);
      }
    }
    setBusyFileName(null);
    setUploading(false);
    return failures;
  };

  const removePending = (key: string) => {
    onDirty();
    setPending((current) => current.filter((item) => item.key !== key));
  };

  return {
    pending,
    uploading,
    busyFileName,
    errors,
    clearErrors: () => setErrors([]),
    pickFiles,
    removePending,
    uploadPending,
  };
}

export type FileAttachments = ReturnType<typeof useFileAttachments>;
