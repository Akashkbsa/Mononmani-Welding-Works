import { DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { CloudCheck, CloudUpload, ExternalLink, Eye, Pencil, Plus, Search, Trash2, FolderLock } from "lucide-react";
import { deleteDocument, getDocumentPreview, getDocumentSummary, listDocuments, openDocument } from "../services/api";
import { errorMessage, formatDate, formatFileSize } from "../lib/format";
import { canPreview, fileKind } from "../lib/documents";
import { DOCUMENT_CATEGORIES, DocumentCategory, DocumentSummary, VaultDocument } from "../types/document";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, inputClass, ListSkeleton, onTabListKeyDown, PageHeader, theadClass, useToast } from "../components/ui";
import { usePageShortcuts } from "../lib/usePageShortcuts";
import AddDocumentsModal from "../components/documents/AddDocumentsModal";
import EditDocumentModal from "../components/documents/EditDocumentModal";
import ImageLightbox from "../components/attachments/ImageLightbox";

/** The owner's own documents in two groups, each file backed up once to Google Drive and never deleted there. */
export default function DocumentVaultPage() {
  const toast = useToast();
  const [tab, setTab] = useState<DocumentCategory>("IMPORTANT");
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState<VaultDocument[] | null>(null);
  const [summary, setSummary] = useState<DocumentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<File[] | null>(null);
  const [editing, setEditing] = useState<VaultDocument | null>(null);
  const [deleting, setDeleting] = useState<VaultDocument | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ doc: VaultDocument; url: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  usePageShortcuts({ searchRef, onNew: () => setAdding([]) });

  const load = useCallback(async () => {
    try {
      const [list, counts] = await Promise.all([listDocuments({ category: tab, query: query.trim() || undefined }), getDocumentSummary()]);
      setDocuments(list);
      setSummary(counts);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [tab, query]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const open = async (doc: VaultDocument) => {
    setBusyId(doc.id);
    try {
      await openDocument(doc.id);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusyId(null);
    }
  };

  const showPreview = async (doc: VaultDocument) => {
    setBusyId(doc.id);
    try {
      setPreview({ doc, url: await getDocumentPreview(doc.id) });
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusyId(null);
    }
  };

  // Files dropped anywhere on the page open the Add window with them.
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) setAdding(files);
  };

  const count = (c: DocumentCategory) => (summary ? (c === "IMPORTANT" ? summary.important : summary.future) : null);
  const tabLabel = DOCUMENT_CATEGORIES.find((c) => c.id === tab)!.label;
  const nothingYet = documents !== null && documents.length === 0 && !query.trim();
  const total = summary ? summary.important + summary.future : 0;

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
      className={`rounded-lg transition-[box-shadow] duration-150 ${dragging ? "ring-2 ring-brand-400 ring-offset-4" : ""}`}
    >
      <PageHeader
        title="Document Vault"
        description="Your important papers in one place. Each file is copied to Google Drive once and the copy there is never deleted."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding([])} title="Add documents (Ctrl+N)">
            Add documents
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" onKeyDown={onTabListKeyDown} aria-label="Groups" className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
          {DOCUMENT_CATEGORIES.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={tab === c.id}
              onClick={() => setTab(c.id)}
              className={`h-8 rounded-md px-4 text-sm transition-[background-color,color,box-shadow] duration-150 ${
                tab === c.id ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {c.label}
              {count(c.id) !== null && (
                <>
                  {" "}
                  <span className="ml-1 tabular text-xs text-slate-500">{count(c.id)}</span>
                </>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchRef}
            aria-label="Search documents"
            className={`${inputClass} pl-9`}
            placeholder="Search title, file name or note   ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {summary && total > 0 && (
        <p className="mb-4 flex items-center gap-2 text-sm text-slate-600" role="status">
          {summary.waiting_for_backup > 0 ? (
            <>
              <CloudUpload className="h-4 w-4 text-amber-600" aria-hidden />
              {summary.waiting_for_backup} document{summary.waiting_for_backup === 1 ? "" : "s"} ({formatFileSize(summary.waiting_bytes)}) waiting
              for backup. They go to Google Drive with the next backup.
            </>
          ) : (
            <>
              <CloudCheck className="h-4 w-4 text-emerald-600" aria-hidden />
              All {total} document{total === 1 ? " is" : "s are"} backed up to Google Drive ({formatFileSize(summary.total_bytes)}).
            </>
          )}
        </p>
      )}

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {documents === null ? (
          <ListSkeleton label="Loading documents" />
        ) : documents.length === 0 ? (
          <EmptyState
            icon={FolderLock}
            title={nothingYet ? `Nothing in ${tabLabel} yet` : "No documents found"}
            description={
              nothingYet
                ? `${DOCUMENT_CATEGORIES.find((c) => c.id === tab)!.hint} Add them here, or drop files on this page.`
                : "Try another word, or clear the search box."
            }
            action={
              nothingYet ? (
                <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding([])}>
                  Add documents
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <table data-hide-narrow="2 3 4" className="mww-fade w-full text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Title</th>
                  <th className="py-2.5 pr-4 font-semibold">File</th>
                  <th className="py-2.5 pr-4 font-semibold text-right">Size</th>
                  <th className="py-2.5 pr-4 font-semibold">Added</th>
                  <th className="py-2.5 pr-4 font-semibold">Backup</th>
                  <th className="py-2.5 px-4 font-semibold text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50">
                    <td className="max-w-[22rem] py-3 px-4">
                      <div className="truncate font-medium text-slate-900" title={doc.title}>
                        {doc.title}
                      </div>
                      {doc.note && (
                        <div className="truncate text-xs text-slate-500" title={doc.note}>
                          {doc.note}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[16rem] py-3 pr-4">
                      <span className="mr-2 text-xs font-medium text-slate-500">{fileKind(doc.mime_type, doc.file_name)}</span>
                      <span className="text-slate-600" title={doc.file_name}>
                        {doc.file_name.length > 32 ? `${doc.file_name.slice(0, 29)}…` : doc.file_name}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right tabular text-slate-600 whitespace-nowrap">{formatFileSize(doc.size_bytes)}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{formatDate(doc.created_at.slice(0, 10))}</td>
                    <td className="py-3 pr-4">
                      {doc.backed_up ? <Badge tone="green">Backed up</Badge> : <Badge tone="amber">Waiting for backup</Badge>}
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex justify-end gap-1">
                        {canPreview(doc.mime_type) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Preview ${doc.title}`}
                            icon={<Eye className="w-4 h-4" />}
                            disabled={busyId === doc.id}
                            onClick={() => showPreview(doc)}
                          />
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<ExternalLink className="w-4 h-4" />}
                          loading={busyId === doc.id}
                          onClick={() => open(doc)}
                          aria-label={`Open ${doc.title}`}
                        >
                          Open
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Edit ${doc.title}`} icon={<Pencil className="w-4 h-4" />} onClick={() => setEditing(doc)} />
                        <Button
                          size="sm"
                          variant="dangerText"
                          aria-label={`Delete ${doc.title}`}
                          icon={<Trash2 className="w-4 h-4" />}
                          onClick={() => setDeleting(doc)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg text-sm text-slate-600">
              {documents.length} document{documents.length === 1 ? "" : "s"}
            </div>
          </>
        )}
      </Card>

      {adding !== null && (
        <AddDocumentsModal
          category={tab}
          initialFiles={adding}
          onClose={() => setAdding(null)}
          onAdded={(n) => {
            setAdding(null);
            toast(`${n} document${n === 1 ? "" : "s"} added. ${n === 1 ? "It goes" : "They go"} to Google Drive with the next backup.`);
            load();
          }}
        />
      )}

      {editing && (
        <EditDocumentModal
          document={editing}
          onClose={() => setEditing(null)}
          onSaved={(doc) => {
            setEditing(null);
            toast(doc.category === tab ? "Saved." : `Saved and moved to ${DOCUMENT_CATEGORIES.find((c) => c.id === doc.category)!.label}.`);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this document?"
          message={
            deleting.backed_up ? (
              <>
                <strong>{deleting.title}</strong> is removed from this computer. Its copy on Google Drive is kept for ever, in
                the Mononmani Documents folder.
              </>
            ) : (
              <>
                <strong>{deleting.title}</strong> has not been backed up yet. Deleting it now removes it for good.
              </>
            )
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            await deleteDocument(deleting.id);
            toast("Document deleted from this computer.");
            await load();
          }}
          onClose={() => setDeleting(null)}
        />
      )}

      {preview && (
        <ImageLightbox
          images={[{ id: preview.doc.id, file_name: preview.doc.file_name, mime_type: preview.doc.mime_type, size_bytes: preview.doc.size_bytes }]}
          startId={preview.doc.id}
          urls={{ [preview.doc.id]: preview.url }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
