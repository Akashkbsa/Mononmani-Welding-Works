import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { FilePlus2, Trash2, Upload } from "lucide-react";
import { addDocument } from "../../services/api";
import { errorMessage, formatFileSize } from "../../lib/format";
import { documentProblem, readFileAsBase64, titleFromFileName } from "../../lib/documents";
import { DOCUMENT_CATEGORIES, DocumentCategory } from "../../types/document";
import { Alert, Button, Field, inputClass, Modal, textareaClass, useDiscardGuard } from "../ui";
import CategoryChoice from "./CategoryChoice";

interface Chosen {
  key: string;
  file: File;
  title: string;
}

interface Props {
  category: DocumentCategory;
  /** Files dropped on the page before this window opened. */
  initialFiles?: File[];
  onClose: () => void;
  /** Called once with how many documents were added. */
  onAdded: (count: number) => void;
}

const keyOf = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

/** Pick or drop one or more files, choose the group, give each a title, and keep them in the vault. */
export default function AddDocumentsModal({ category: startCategory, initialFiles = [], onClose, onAdded }: Props) {
  const [category, setCategory] = useState<DocumentCategory>(startCategory);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { markDirty, requestClose, confirm } = useDiscardGuard(onClose);

  const accept = (list: File[]) => {
    const problems: string[] = [];
    const ok: Chosen[] = [];
    for (const file of list) {
      const problem = documentProblem(file.name, file.size);
      if (problem) problems.push(problem);
      else ok.push({ key: keyOf(file), file, title: titleFromFileName(file.name) });
    }
    return { ok, problems };
  };

  const [chosen, setChosen] = useState<Chosen[]>(() => accept(initialFiles).ok);
  const [initialProblems] = useState(() => accept(initialFiles).problems);
  const shownErrors = errors.length > 0 ? errors : initialProblems;

  const addFiles = (list: File[]) => {
    if (list.length === 0) return;
    const { ok, problems } = accept(list);
    setErrors(problems);
    if (ok.length > 0) {
      markDirty();
      setChosen((current) => [...current, ...ok.filter((o) => !current.some((c) => c.key === o.key))]);
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(event.target.files ?? []);
    event.target.value = "";
    addFiles(list);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const save = async () => {
    if (chosen.length === 0) {
      setErrors(["Choose at least one file."]);
      return;
    }
    setSaving(true);
    setErrors([]);
    const failures: string[] = [];
    const left: Chosen[] = [];
    let added = 0;
    for (const [i, item] of chosen.entries()) {
      setProgress(`Saving ${i + 1} of ${chosen.length}: ${item.file.name}`);
      try {
        const base64 = await readFileAsBase64(item.file);
        await addDocument({ category, title: item.title.trim(), note: note.trim() || null }, item.file.name, base64);
        added += 1;
      } catch (err) {
        failures.push(`${item.file.name}: ${errorMessage(err)}`);
        left.push(item);
      }
    }
    setProgress(null);
    setSaving(false);
    if (failures.length === 0) {
      onAdded(added);
      return;
    }
    // Keep only the files that failed, so the owner can fix or remove them and try again.
    if (added > 0) onAdded(added);
    setChosen(left);
    setErrors(failures);
  };

  const label = DOCUMENT_CATEGORIES.find((c) => c.id === category)?.label ?? "";

  return (
    <>
      <Modal
        title="Add documents"
        subtitle="Kept on this computer and copied to Google Drive with the next backup. The Drive copy is never deleted."
        size="lg"
        onClose={requestClose}
        footer={
          <>
            <Button onClick={requestClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" icon={<FilePlus2 className="w-4 h-4" />} loading={saving} onClick={save} disabled={chosen.length === 0}>
              {chosen.length > 1 ? `Add ${chosen.length} documents to ${label}` : `Add to ${label}`}
            </Button>
          </>
        }
      >
        <div className="space-y-5" onChangeCapture={markDirty}>
          <CategoryChoice
            value={category}
            onChange={(c) => {
              markDirty();
              setCategory(c);
            }}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors duration-150 ${
              dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50"
            }`}
          >
            <Upload className="mx-auto mb-2 h-6 w-6 text-slate-400" aria-hidden />
            <p className="text-sm text-slate-700">Drop files here, or</p>
            <Button className="mt-2" size="sm" onClick={() => inputRef.current?.click()} disabled={saving}>
              Choose files
            </Button>
            <p className="mt-2 text-xs text-slate-500">PDF, Word, Excel, photos or any other document, up to 25 MB each.</p>
            <input ref={inputRef} type="file" multiple className="hidden" aria-label="Choose files" onChange={onPick} />
          </div>

          {chosen.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {chosen.map((item) => (
                <li key={item.key} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <input
                      aria-label={`Title for ${item.file.name}`}
                      className={inputClass}
                      value={item.title}
                      maxLength={200}
                      placeholder={item.file.name}
                      onChange={(e) =>
                        setChosen((current) => current.map((c) => (c.key === item.key ? { ...c, title: e.target.value } : c)))
                      }
                    />
                    <p className="mt-1 truncate text-xs text-slate-500" title={item.file.name}>
                      {item.file.name} · {formatFileSize(item.file.size)}
                    </p>
                  </div>
                  <Button
                    variant="dangerText"
                    size="sm"
                    aria-label={`Remove ${item.file.name}`}
                    icon={<Trash2 className="w-4 h-4" />}
                    disabled={saving}
                    onClick={() => {
                      markDirty();
                      setChosen((current) => current.filter((c) => c.key !== item.key));
                    }}
                  />
                </li>
              ))}
            </ul>
          )}

          <Field label="Note (optional)" hint="Where the original is kept, renewal date, anything worth remembering.">
            <textarea className={textareaClass} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {progress && <p className="text-sm text-slate-600" role="status">{progress}</p>}
          {shownErrors.length > 0 && (
            <Alert>
              <ul className="space-y-1">
                {shownErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      </Modal>
      {confirm}
    </>
  );
}
