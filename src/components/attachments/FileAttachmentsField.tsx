import { useRef } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { formatFileSize } from "../../lib/format";
import { AttachmentInfo } from "../../types/attachment";
import { Alert, Button } from "../ui";
import { FileAttachments } from "./useFileAttachments";

/** The upload problems from `useFileAttachments`, shown where the form shows its other errors. */
export function AttachmentErrors({ attachments }: { attachments: FileAttachments }) {
  if (attachments.errors.length === 0) return null;
  return (
    <Alert>
      <div className="space-y-1">
        {attachments.errors.map((message) => (
          <div key={message}>{message}</div>
        ))}
      </div>
    </Alert>
  );
}

interface Props {
  stored: AttachmentInfo[];
  attachments: FileAttachments;
  onRequestRemove: (file: AttachmentInfo) => void;
  description: string;
  disabled?: boolean;
}

/** The "Files" section of a form: add files, see the saved and the waiting ones, remove them. */
export default function FileAttachmentsField({ stored, attachments, onRequestRemove, description, disabled }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { pending, uploading, busyFileName } = attachments;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Files</h3>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,image/jpeg,image/png,application/pdf"
            className="hidden"
            onChange={attachments.pickFiles}
          />
          <Button icon={<Paperclip className="w-4 h-4" />} onClick={() => fileInputRef.current?.click()} disabled={disabled || uploading}>
            Add files
          </Button>
        </>
      </div>

      {stored.length > 0 && (
        <div className="space-y-2">
          {stored.map((file) => (
            <div key={file.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{file.file_name}</div>
                <div className="text-xs text-slate-500">{formatFileSize(file.size_bytes)}</div>
              </div>
              <Button
                size="sm"
                variant="dangerText"
                icon={<Trash2 className="w-4 h-4" />}
                disabled={busyFileName === file.file_name}
                onClick={() => onRequestRemove(file)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((file) => (
            <div key={file.key} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{file.fileName}</div>
                <div className="text-xs text-slate-500">{formatFileSize(file.sizeBytes)}</div>
              </div>
              <Button
                size="sm"
                variant="dangerText"
                icon={<Trash2 className="w-4 h-4" />}
                onClick={() => attachments.removePending(file.key)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {stored.length === 0 && pending.length === 0 && <p className="text-sm text-slate-500">No files attached yet.</p>}
    </div>
  );
}
