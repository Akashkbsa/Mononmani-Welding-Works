import { describe, expect, it } from "vitest";
import { plainError, plainReason } from "./errors";

describe("plain messages for PC problems", () => {
  it("explains a full disk", () => {
    const raw = "Could not save the document: There is not enough space on the disk. (os error 112)";
    expect(plainError(raw)).toMatch(/^The computer's disk is full\..* Details: Could not save the document/);
    expect(plainReason("Failed to save invoice: database or disk is full")).toMatch(/disk is full/);
  });

  it("explains antivirus or permission blocks", () => {
    expect(plainReason("Failed to create directory C:\\x: Access is denied. (os error 5)")).toMatch(/antivirus/);
    expect(plainReason("attempt to write a readonly database")).toMatch(/antivirus/);
  });

  it("explains a file open in another program", () => {
    expect(plainReason("The process cannot access the file because it is being used by another process. (os error 32)")).toMatch(
      /open in another program/
    );
  });

  it("explains a damaged or busy database", () => {
    expect(plainReason("database disk image is malformed")).toMatch(/Restore the latest backup/);
    expect(plainReason("database is locked")).toMatch(/busy/);
  });

  it("does not mistake other error numbers", () => {
    expect(plainReason("(os error 50)")).toBeNull();
    expect(plainReason("(os error 1120)")).toBeNull();
  });

  it("leaves ordinary messages alone", () => {
    expect(plainError("Enter the customer name.")).toBe("Enter the customer name.");
  });

  it("does not repeat itself and keeps long details short", () => {
    const once = plainError("x (os error 112)");
    expect(plainError(once)).toBe(once);
    expect(plainError(`${"a".repeat(500)} (os error 112)`).length).toBeLessThan(400);
  });
});
