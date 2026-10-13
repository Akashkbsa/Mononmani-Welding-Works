/** A file attached to a purchase order or a quotation. The contents are never listed, only opened. */
export interface AttachmentInfo {
  id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

/** Largest file that can be attached, in bytes (10 MB). The backend checks it again. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_EXTENSIONS = ["jpg", "jpeg", "png", "pdf", "doc", "docx"];
