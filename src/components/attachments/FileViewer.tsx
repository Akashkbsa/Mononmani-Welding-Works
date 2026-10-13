import { useEffect, useState } from "react";
import { ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { errorMessage, formatFileSize } from "../../lib/format";
import { AttachmentInfo } from "../../types/attachment";
import { Button, Loading, Modal, useToast } from "../ui";

interface Props {
  files: AttachmentInfo[];
  /** A photo as a data: URL. */
  getPreview: (fileId: number) => Promise<string>;
  /** Opens the file in the program Windows uses for it. */
  openFile: (fileId: number) => Promise<void>;
}

/** The files of a record in a details window: photo grid (click to enlarge) and documents with Open. */
export default function FileViewer({ files, getPreview, openFile }: Props) {
  const toast = useToast();
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});
  const [imagePreview, setImagePreview] = useState<AttachmentInfo | null>(null);
  const [openingFileId, setOpeningFileId] = useState<number | null>(null);

  useEffect(() => {
    const missing = files.filter((file) => file.mime_type.startsWith("image/") && !previewUrls[file.id]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map(async (file) => ({ id: file.id, url: await getPreview(file.id) })))
      .then((items) => {
        if (cancelled) return;
        setPreviewUrls((current) => {
          const next = { ...current };
          for (const item of items) next[item.id] = item.url;
          return next;
        });
      })
      .catch(() => {
        // Leave missing previews blank rather than failing the whole window.
      });
    return () => {
      cancelled = true;
    };
  }, [files, previewUrls, getPreview]);

  const imageFiles = files.filter((file) => file.mime_type.startsWith("image/"));
  const documentFiles = files.filter((file) => !file.mime_type.startsWith("image/"));

  return (
    <>
      <div className="space-y-4">
        {imageFiles.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">Photos</div>
            <div className="grid grid-cols-4 gap-3">
              {imageFiles.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  className="overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-left hover:border-brand-300"
                  onClick={() => setImagePreview(file)}
                  aria-label={`Preview ${file.file_name}`}
                >
                  {previewUrls[file.id] ? (
                    <img src={previewUrls[file.id]} alt={file.file_name} className="h-28 w-full object-cover" />
                  ) : (
                    <div className="flex h-28 items-center justify-center text-slate-400">
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}
                  <div className="px-3 py-2 text-xs text-slate-600 truncate">{file.file_name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {documentFiles.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-500">Documents</div>
            {documentFiles.map((file) => (
              <div key={file.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-4 w-4 text-slate-400" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800">{file.file_name}</div>
                    <div className="text-xs text-slate-500">{formatFileSize(file.size_bytes)}</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  icon={<ExternalLink className="w-4 h-4" />}
                  loading={openingFileId === file.id}
                  onClick={async () => {
                    setOpeningFileId(file.id);
                    try {
                      await openFile(file.id);
                    } catch (err) {
                      toast(errorMessage(err), "error");
                    } finally {
                      setOpeningFileId(null);
                    }
                  }}
                >
                  Open
                </Button>
              </div>
            ))}
          </div>
        )}

        {files.length === 0 && <p className="text-slate-500">No files attached yet.</p>}
      </div>

      {imagePreview && (
        <Modal title={imagePreview.file_name} onClose={() => setImagePreview(null)} size="xl">
          <div className="flex justify-center">
            {previewUrls[imagePreview.id] ? (
              <img src={previewUrls[imagePreview.id]} alt={imagePreview.file_name} className="max-h-[70vh] rounded-md" />
            ) : (
              <Loading />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
