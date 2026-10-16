import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DocumentVaultPage from "./DocumentVaultPage";
import { ToastProvider } from "../components/ui";
import { DocumentSummary, VaultDocument } from "../types/document";
import { field } from "../test/helpers";

const api = vi.hoisted(() => ({
  addDocument: vi.fn(),
  deleteDocument: vi.fn(),
  getDocumentPreview: vi.fn(),
  getDocumentSummary: vi.fn(),
  listDocuments: vi.fn(),
  openDocument: vi.fn(),
  updateDocument: vi.fn(),
}));
vi.mock("../services/api", () => api);

const doc = (over: Partial<VaultDocument> = {}): VaultDocument => ({
  id: 1,
  category: "IMPORTANT",
  title: "Land deed",
  note: null,
  file_name: "deed.pdf",
  mime_type: "application/pdf",
  size_bytes: 2048,
  sha256: "a".repeat(64),
  backed_up: true,
  created_at: "2026-10-16T09:00:00+00:00",
  updated_at: "2026-10-16T09:00:00+00:00",
  ...over,
});

const summary = (over: Partial<DocumentSummary> = {}): DocumentSummary => ({
  important: 2,
  future: 1,
  waiting_for_backup: 0,
  waiting_bytes: 0,
  total_bytes: 3 * 2048,
  ...over,
});

const important = [
  doc(),
  doc({ id: 2, title: "Shop photo", file_name: "shop.jpg", mime_type: "image/jpeg", backed_up: false, note: "Front view" }),
];
const future = [doc({ id: 3, category: "FUTURE", title: "Machine warranty", file_name: "warranty.docx", mime_type: "application/octet-stream" })];

function show() {
  return render(
    <ToastProvider>
      <DocumentVaultPage />
    </ToastProvider>
  );
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listDocuments.mockImplementation(async (filter: { category?: string; query?: string }) => {
    const list = filter.category === "FUTURE" ? future : important;
    return filter.query ? list.filter((d) => d.title.toLowerCase().includes(filter.query!.toLowerCase())) : list;
  });
  api.getDocumentSummary.mockResolvedValue(summary({ waiting_for_backup: 1, waiting_bytes: 2048 }));
  api.openDocument.mockResolvedValue(undefined);
  api.deleteDocument.mockResolvedValue(undefined);
});

describe("Document Vault", () => {
  it("lists the Important documents with their backup state and counts on the tabs", async () => {
    show();
    expect(await screen.findByText("Land deed")).toBeInTheDocument();
    expect(screen.getByText("Front view")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Important 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Keep for Future 1" })).toBeInTheDocument();
    const deed = screen.getByText("Land deed").closest("tr")!;
    expect(within(deed).getByText("Backed up")).toBeInTheDocument();
    expect(within(deed).getByText("PDF")).toBeInTheDocument();
    const photo = screen.getByText("Shop photo").closest("tr")!;
    expect(within(photo).getByText("Waiting for backup")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 document (2.0 KB) waiting for backup");
  });

  it("switches to Keep for Future", async () => {
    show();
    await screen.findByText("Land deed");
    await userEvent.click(screen.getByRole("tab", { name: /Keep for Future/ }));
    expect(await screen.findByText("Machine warranty")).toBeInTheDocument();
    expect(screen.queryByText("Land deed")).toBeNull();
    expect(api.listDocuments).toHaveBeenLastCalledWith({ category: "FUTURE", query: undefined });
    expect(within(screen.getByText("Machine warranty").closest("tr")!).getByText("Word")).toBeInTheDocument();
  });

  it("says everything is backed up when nothing waits", async () => {
    api.getDocumentSummary.mockResolvedValue(summary());
    show();
    expect(await screen.findByText(/All 3 documents are backed up to Google Drive/)).toBeInTheDocument();
  });

  it("searches", async () => {
    show();
    await screen.findByText("Land deed");
    await userEvent.type(screen.getByLabelText("Search documents"), "photo");
    await waitFor(() => expect(screen.queryByText("Land deed")).toBeNull());
    expect(screen.getByText("Shop photo")).toBeInTheDocument();
    expect(api.listDocuments).toHaveBeenLastCalledWith({ category: "IMPORTANT", query: "photo" });
  });

  it("shows an empty group with a way to add", async () => {
    api.listDocuments.mockResolvedValue([]);
    api.getDocumentSummary.mockResolvedValue(summary({ important: 0, future: 0, total_bytes: 0 }));
    show();
    expect(await screen.findByText("Nothing in Important yet")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Nothing in Important yet").parentElement!.parentElement!).getByRole("button", { name: "Add documents" }));
    expect(await screen.findByRole("dialog", { name: /Add documents/ })).toBeInTheDocument();
  });

  it("opens a document and shows the reason when it can't", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Open Land deed" }));
    expect(api.openDocument).toHaveBeenCalledWith(1);
    api.openDocument.mockRejectedValueOnce(new Error('"Land deed" is not on this computer and could not be fetched from Google Drive.'));
    await userEvent.click(screen.getByRole("button", { name: "Open Land deed" }));
    expect(await screen.findByText(/could not be fetched from Google Drive/)).toBeInTheDocument();
  });

  it("previews photos only", async () => {
    api.getDocumentPreview.mockResolvedValue("data:image/jpeg;base64,AAA");
    show();
    await screen.findByText("Land deed");
    expect(screen.queryByRole("button", { name: "Preview Land deed" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Preview Shop photo" }));
    expect(api.getDocumentPreview).toHaveBeenCalledWith(2);
    expect(await screen.findByRole("img")).toHaveAttribute("src", "data:image/jpeg;base64,AAA");
  });

  it("warns that a backed-up document stays on Drive, and deletes after confirming", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Delete Land deed" }));
    expect(screen.getByText(/Its copy on Google Drive is kept for ever/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith(1));
  });

  it("warns that a document not yet backed up is gone for good", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Delete Shop photo" }));
    expect(screen.getByText(/has not been backed up yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.deleteDocument).not.toHaveBeenCalled();
  });

  it("edits the title and moves a document to the other group", async () => {
    api.updateDocument.mockResolvedValue(doc({ category: "FUTURE", title: "Land deed 1998" }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Edit Land deed" }));
    const title = field("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Land deed 1998");
    await userEvent.click(screen.getByText("Keep for Future", { selector: "span" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateDocument).toHaveBeenCalledWith(1, { category: "FUTURE", title: "Land deed 1998", note: null }));
    expect(await screen.findByText("Saved and moved to Keep for Future.")).toBeInTheDocument();
  });

  it("opens the Add window with files dropped on the page", async () => {
    show();
    await screen.findByText("Land deed");
    const file = new File(["x"], "licence.pdf");
    fireEvent.drop(screen.getByText("Document Vault").closest("div")!.parentElement!.parentElement!, {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    expect(await screen.findByLabelText("Title for licence.pdf")).toHaveValue("licence");
  });
});
