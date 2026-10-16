import { BLOCKED_DOCUMENT_EXTENSIONS, MAX_DOCUMENT_BYTES } from "../types/document";

/** The extension in lower case, or "" when the name has none. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).trim().toLowerCase() : "";
}

/** Why this file can't go into the vault, or null when it can. */
export function documentProblem(fileName: string, sizeBytes: number): string | null {
  if (sizeBytes === 0) return `${fileName}: the file is empty.`;
  if (sizeBytes > MAX_DOCUMENT_BYTES) return `${fileName}: the file is larger than 25 MB.`;
  if (BLOCKED_DOCUMENT_EXTENSIONS.includes(fileExtension(fileName))) {
    return `${fileName}: programs and scripts can't be kept in the vault.`;
  }
  return null;
}

/** A starting title from the file name: no extension, underscores and dashes as spaces. */
export function titleFromFileName(fileName: string): string {
  const ext = fileExtension(fileName);
  const stem = ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  const title = stem.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (title || fileName).slice(0, 200);
}

/** A short word for the kind of file, for the list. */
export function fileKind(mimeType: string, fileName: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "Photo";
  const ext = fileExtension(fileName);
  if (ext === "doc" || ext === "docx" || ext === "odt" || ext === "rtf") return "Word";
  if (ext === "xls" || ext === "xlsx" || ext === "ods" || ext === "csv") return "Excel";
  if (ext === "ppt" || ext === "pptx") return "PowerPoint";
  return ext ? ext.toUpperCase() : "File";
}

/** Photos the app can show itself (the backend makes the same choice). */
export function canPreview(mimeType: string): boolean {
  return ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"].includes(mimeType);
}

/** The file's bytes as base64 text, without the `data:` prefix. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("Could not read the file."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}
