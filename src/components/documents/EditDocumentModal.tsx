import { useState } from "react";
import { updateDocument } from "../../services/api";
import { errorMessage } from "../../lib/format";
import { DocumentCategory, VaultDocument } from "../../types/document";
import { Alert, Button, Field, inputClass, Modal, textareaClass, useDiscardGuard } from "../ui";
import CategoryChoice from "./CategoryChoice";

interface Props {
  document: VaultDocument;
  onClose: () => void;
  onSaved: (doc: VaultDocument) => void;
}

/** Change a document's title, note or group. The file itself never changes. */
export default function EditDocumentModal({ document: doc, onClose, onSaved }: Props) {
  const [category, setCategory] = useState<DocumentCategory>(doc.category);
  const [title, setTitle] = useState(doc.title);
  const [note, setNote] = useState(doc.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { markDirty, requestClose, confirm } = useDiscardGuard(onClose);

  const save = async () => {
    if (!title.trim()) {
      setError("Enter a title.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateDocument(doc.id, { category, title: title.trim(), note: note.trim() || null }));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        title="Edit document"
        subtitle={doc.file_name}
        onClose={requestClose}
        footer={
          <>
            <Button onClick={requestClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
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
          <Field label="Title" required>
            <input className={inputClass} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Note (optional)">
            <textarea className={textareaClass} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && <Alert>{error}</Alert>}
        </div>
      </Modal>
      {confirm}
    </>
  );
}
