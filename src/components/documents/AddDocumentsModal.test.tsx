import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddDocumentsModal from "./AddDocumentsModal";
import { ToastProvider } from "../ui";
import { field, fileInput, makeFile } from "../../test/helpers";
import { DocumentCategory } from "../../types/document";

const api = vi.hoisted(() => ({ addDocument: vi.fn() }));
vi.mock("../../services/api", () => api);

let onClose: Mock<() => void>;
let onAdded: Mock<(n: number) => void>;

function show(category: DocumentCategory = "IMPORTANT", initialFiles: File[] = []) {
  return render(
    <ToastProvider>
      <AddDocumentsModal category={category} initialFiles={initialFiles} onClose={onClose} onAdded={onAdded} />
    </ToastProvider>
  );
}

function choose(...files: File[]) {
  fireEvent.change(fileInput(), { target: { files } });
}

beforeEach(() => {
  api.addDocument.mockReset();
  api.addDocument.mockImplementation(async (input) => ({ id: 1, ...input }));
  onClose = vi.fn();
  onAdded = vi.fn();
});

describe("adding documents", () => {
  it("adds every chosen file to the chosen group with its title and the note", async () => {
    show();
    choose(makeFile("GST_certificate.pdf"), makeFile("shop photo.jpg", "img"));
    expect(screen.getByLabelText("Title for GST_certificate.pdf")).toHaveValue("GST certificate");
    await userEvent.clear(screen.getByLabelText("Title for shop photo.jpg"));
    await userEvent.type(screen.getByLabelText("Title for shop photo.jpg"), "Shop front");
    await userEvent.click(screen.getByText("Keep for Future"));
    await userEvent.type(field("Note (optional)"), "Original in the cupboard");
    await userEvent.click(screen.getByRole("button", { name: "Add 2 documents to Keep for Future" }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(2));
    expect(api.addDocument).toHaveBeenNthCalledWith(
      1,
      { category: "FUTURE", title: "GST certificate", note: "Original in the cupboard" },
      "GST_certificate.pdf",
      "ZGF0YQ=="
    );
    expect(api.addDocument).toHaveBeenNthCalledWith(2, { category: "FUTURE", title: "Shop front", note: "Original in the cupboard" }, "shop photo.jpg", "aW1n");
  });

  it("starts in the group of the tab it was opened from", () => {
    show("FUTURE", [makeFile("deed.pdf")]);
    expect(screen.getByRole("radio", { name: /Keep for Future/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Add to Keep for Future" })).toBeEnabled();
  });

  it("refuses program files and files over 25 MB before anything is sent", () => {
    show();
    const big = makeFile("scan.pdf");
    Object.defineProperty(big, "size", { value: 25 * 1024 * 1024 + 1 });
    choose(makeFile("setup.exe"), big, makeFile("ok.pdf"));
    expect(screen.getByText("setup.exe: programs and scripts can't be kept in the vault.")).toBeInTheDocument();
    expect(screen.getByText("scan.pdf: the file is larger than 25 MB.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title for ok.pdf")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title for setup.exe")).toBeNull();
  });

  it("shows problems with files dropped on the page", () => {
    show("IMPORTANT", [makeFile("virus.bat"), makeFile("ok.pdf")]);
    expect(screen.getByText("virus.bat: programs and scripts can't be kept in the vault.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title for ok.pdf")).toBeInTheDocument();
  });

  it("keeps only the files that failed, with the reason, so they can be tried again", async () => {
    api.addDocument.mockImplementation(async (_input, name: string) => {
      if (name === "dup.pdf") throw new Error('This file is already in the vault as "Deed" (Important).');
      return { id: 2 };
    });
    show();
    choose(makeFile("new.pdf", "new"), makeFile("dup.pdf", "dup"));
    await userEvent.click(screen.getByRole("button", { name: "Add 2 documents to Important" }));

    expect(await screen.findByText('dup.pdf: This file is already in the vault as "Deed" (Important).')).toBeInTheDocument();
    expect(onAdded).toHaveBeenCalledWith(1);
    expect(screen.queryByLabelText("Title for new.pdf")).toBeNull();
    expect(screen.getByLabelText("Title for dup.pdf")).toBeInTheDocument();
  });

  it("removes a chosen file and needs at least one file", async () => {
    show();
    choose(makeFile("a.pdf"));
    await userEvent.click(screen.getByRole("button", { name: "Remove a.pdf" }));
    expect(screen.getByRole("button", { name: "Add to Important" })).toBeDisabled();
  });

  it("asks before throwing away chosen files", async () => {
    show();
    choose(makeFile("a.pdf"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Discard your changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
