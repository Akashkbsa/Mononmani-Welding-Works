import { describe, expect, it } from "vitest";
import { canPreview, documentProblem, fileExtension, fileKind, readFileAsBase64, titleFromFileName } from "./documents";
import { MAX_DOCUMENT_BYTES } from "../types/document";

describe("files for the vault", () => {
  it("accepts any document up to 25 MB", () => {
    expect(documentProblem("deed.pdf", 1)).toBeNull();
    expect(documentProblem("photo.HEIC", 5_000)).toBeNull();
    expect(documentProblem("README", 10)).toBeNull();
    expect(documentProblem("scan.pdf", MAX_DOCUMENT_BYTES)).toBeNull();
  });

  it("refuses empty, oversized and program files", () => {
    expect(documentProblem("a.pdf", 0)).toMatch(/empty/);
    expect(documentProblem("a.pdf", MAX_DOCUMENT_BYTES + 1)).toMatch(/25 MB/);
    for (const name of ["setup.exe", "RUN.BAT", "x.msi", "a.ps1", "link.lnk", "a.vbs"]) {
      expect(documentProblem(name, 10)).toMatch(/programs and scripts/);
    }
  });

  it("finds the extension", () => {
    expect(fileExtension("Deed.Final.PDF")).toBe("pdf");
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".gitignore")).toBe("");
  });

  it("starts the title from the file name", () => {
    expect(titleFromFileName("GST_certificate_2026.pdf")).toBe("GST certificate 2026");
    expect(titleFromFileName("Land deed.final.docx")).toBe("Land deed.final");
    expect(titleFromFileName("README")).toBe("README");
    expect(titleFromFileName("_.pdf")).toBe("_.pdf");
    expect(titleFromFileName(`${"a".repeat(300)}.pdf`)).toHaveLength(200);
  });

  it("names the kind of file", () => {
    expect(fileKind("application/pdf", "a.pdf")).toBe("PDF");
    expect(fileKind("image/jpeg", "a.jpg")).toBe("Photo");
    expect(fileKind("application/octet-stream", "a.docx")).toBe("Word");
    expect(fileKind("text/csv", "a.csv")).toBe("Excel");
    expect(fileKind("application/zip", "a.zip")).toBe("ZIP");
    expect(fileKind("application/octet-stream", "README")).toBe("File");
  });

  it("previews only photos the app can show safely", () => {
    expect(canPreview("image/png")).toBe(true);
    expect(canPreview("image/svg+xml")).toBe(false);
    expect(canPreview("image/heic")).toBe(false);
    expect(canPreview("application/pdf")).toBe(false);
  });

  it("reads a file as base64 without the data: prefix", async () => {
    await expect(readFileAsBase64(new File(["data"], "a.txt"))).resolves.toBe("ZGF0YQ==");
  });
});
