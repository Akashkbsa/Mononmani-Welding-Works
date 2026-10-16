/** The two groups of the Document Vault. */
export type DocumentCategory = "IMPORTANT" | "FUTURE";

export const DOCUMENT_CATEGORIES: { id: DocumentCategory; label: string; hint: string }[] = [
  { id: "IMPORTANT", label: "Important", hint: "Documents needed now: licences, certificates, agreements." },
  { id: "FUTURE", label: "Keep for Future", hint: "Important papers that will be useful later: deeds, warranties, old records." },
];

/** A document kept in the vault. The file itself is never sent to the screen, only opened. */
export interface VaultDocument {
  id: number;
  category: DocumentCategory;
  title: string;
  note: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  /** A copy is on Google Drive (and is never deleted there). */
  backed_up: boolean;
  created_at: string;
  updated_at: string;
}

export interface DocumentInput {
  category: DocumentCategory;
  title: string;
  note: string | null;
}

export interface DocumentFilter {
  category?: DocumentCategory;
  query?: string;
}

export interface DocumentSummary {
  important: number;
  future: number;
  waiting_for_backup: number;
  waiting_bytes: number;
  total_bytes: number;
}

/** Largest file the vault takes, in bytes (25 MB). The backend checks it again. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Programs and scripts are refused: they are not documents and could run a virus. */
export const BLOCKED_DOCUMENT_EXTENSIONS = [
  "exe", "msi", "msp", "bat", "cmd", "com", "scr", "pif", "cpl", "dll", "sys", "ps1", "psm1", "vbs", "vbe", "js",
  "jse", "wsf", "wsh", "hta", "lnk", "reg", "jar", "appx", "msix", "appinstaller", "scf", "inf", "gadget",
];
