import { ChangeEvent, ReactNode } from "react";
import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFileAttachments } from "./useFileAttachments";
import { ToastProvider } from "../ui";

const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

/** A file input's change event holding the given files. */
function pick(files: File[]) {
  const input = document.createElement("input");
  input.type = "file";
  Object.defineProperty(input, "files", { value: files });
  return { target: input } as unknown as ChangeEvent<HTMLInputElement>;
}

const file = (name: string, content = "hello", size?: number) => {
  const f = new File([content], name, { lastModified: 1000 });
  if (size !== undefined) Object.defineProperty(f, "size", { value: size });
  return f;
};

let addFile: Mock<(ownerId: number, fileName: string, base64: string) => Promise<unknown>>;
let onStoredChange: Mock<() => Promise<void>>;
let onDirty: Mock<() => void>;

beforeEach(() => {
  addFile = vi.fn<(ownerId: number, fileName: string, base64: string) => Promise<unknown>>().mockResolvedValue(undefined);
  onStoredChange = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  onDirty = vi.fn<() => void>();
});

const setup = (ownerId?: number) =>
  renderHook(() => useFileAttachments({ ownerId, addFile, onStoredChange, onDirty }), { wrapper });

describe("useFileAttachments for a new record", () => {
  it("keeps picked files until the record is saved", async () => {
    const { result } = setup();
    await act(() => result.current.pickFiles(pick([file("drawing.pdf", "abc")])));
    expect(result.current.pending).toEqual([
      { key: "drawing.pdf-3-1000", fileName: "drawing.pdf", sizeBytes: 3, base64: btoa("abc") },
    ]);
    expect(addFile).not.toHaveBeenCalled();
    expect(onDirty).toHaveBeenCalledOnce();
    expect(result.current.errors).toEqual([]);
  });

  it("checks the extension, whatever its case", async () => {
    const { result } = setup();
    await act(() => result.current.pickFiles(pick([file("photo.JPG"), file("notes.txt"), file("noext")])));
    expect(result.current.pending.map((p) => p.fileName)).toEqual(["photo.JPG"]);
    expect(result.current.errors).toEqual([
      "notes.txt: only JPG, JPEG, PNG, PDF, DOC and DOCX files are allowed.",
      "noext: only JPG, JPEG, PNG, PDF, DOC and DOCX files are allowed.",
    ]);
  });

  it("refuses files over 10 MB", async () => {
    const { result } = setup();
    await act(() => result.current.pickFiles(pick([file("big.pdf", "x", 10 * 1024 * 1024 + 1), file("ok.pdf", "x", 10 * 1024 * 1024)])));
    expect(result.current.errors).toEqual(["big.pdf: file is larger than 10 MB."]);
    expect(result.current.pending.map((p) => p.fileName)).toEqual(["ok.pdf"]);
  });

  it("does nothing, not even marking the form changed, when every file is refused", async () => {
    const { result } = setup();
    await act(() => result.current.pickFiles(pick([file("virus.exe")])));
    expect(onDirty).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual([]);
  });

  it("does nothing when the picker was cancelled", async () => {
    const { result } = setup();
    await act(() => result.current.pickFiles(pick([])));
    expect(onDirty).not.toHaveBeenCalled();
  });

  it("clears the input so the same file can be picked again", async () => {
    const { result } = setup();
    const event = pick([file("a.pdf")]);
    const setter = vi.spyOn(event.target, "value", "set");
    await act(() => result.current.pickFiles(event));
    expect(setter).toHaveBeenCalledWith("");
  });

  it("adds to files picked before", async () => {
    const { result } = setup();
    await act(() => result.current.pickFiles(pick([file("a.pdf")])));
    await act(() => result.current.pickFiles(pick([file("b.png")])));
    expect(result.current.pending.map((p) => p.fileName)).toEqual(["a.pdf", "b.png"]);
  });

  it("removes a kept file", async () => {
    const { result } = setup();
    await act(() => result.current.pickFiles(pick([file("a.pdf"), file("b.png")])));
    act(() => result.current.removePending("a.pdf-5-1000"));
    expect(result.current.pending.map((p) => p.fileName)).toEqual(["b.png"]);
    expect(onDirty).toHaveBeenCalledTimes(2);
  });

  it("uploads the kept files once saved and reports each failure", async () => {
    addFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Error: disk full"));
    const { result } = setup();
    await act(() => result.current.pickFiles(pick([file("a.pdf"), file("b.png")])));
    let failures: string[] = [];
    await act(async () => {
      failures = await result.current.uploadPending(77);
    });
    expect(addFile.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [77, "a.pdf"],
      [77, "b.png"],
    ]);
    expect(failures).toEqual(["b.png: disk full"]);
    expect(result.current.uploading).toBe(false);
    expect(result.current.busyFileName).toBeNull();
  });

  it("uploads nothing when nothing was kept", async () => {
    const { result } = setup();
    await expect(result.current.uploadPending(1)).resolves.toEqual([]);
    expect(addFile).not.toHaveBeenCalled();
  });
});

describe("useFileAttachments for a saved record", () => {
  it("uploads straight away and reloads the list", async () => {
    const { result } = setup(5);
    await act(() => result.current.pickFiles(pick([file("a.pdf", "abc")])));
    expect(addFile).toHaveBeenCalledWith(5, "a.pdf", btoa("abc"));
    expect(result.current.pending).toEqual([]);
    expect(onStoredChange).toHaveBeenCalledOnce();
    expect(result.current.uploading).toBe(false);
  });

  it("shows upload failures and still reloads the list", async () => {
    addFile.mockRejectedValueOnce(new Error("Too many files"));
    const { result } = setup(5);
    await act(() => result.current.pickFiles(pick([file("a.pdf"), file("b.pdf")])));
    expect(result.current.errors).toEqual(["a.pdf: Too many files"]);
    expect(onStoredChange).toHaveBeenCalledOnce();
  });

  it("clearErrors empties the list of problems", async () => {
    const { result } = setup(5);
    await act(() => result.current.pickFiles(pick([file("x.exe")])));
    expect(result.current.errors).toHaveLength(1);
    act(() => result.current.clearErrors());
    expect(result.current.errors).toEqual([]);
  });
});
