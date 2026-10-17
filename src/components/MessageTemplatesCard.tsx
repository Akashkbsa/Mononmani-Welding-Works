import { useEffect, useRef, useState } from "react";
import { getMessageTemplates, saveMessageTemplate } from "../services/api";
import { errorMessage } from "../lib/format";
import { fillTemplate, insertAt, unknownKeywords } from "../lib/messageTemplate";
import { MessageKind, MessageTemplate } from "../types/messages";
import { Alert, Button, Card, Loading, textareaClass, useToast } from "./ui";

const MAX_LENGTH = 2000;

/**
 * The WhatsApp messages the app types in for the owner: supplier payment, rent reminder and
 * employee pay. Keywords such as {employee_name} become each person's own details when sent.
 */
export default function MessageTemplatesCard() {
  const toast = useToast();
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<MessageKind, string>>>({});
  const [kind, setKind] = useState<MessageKind>("EMPLOYEE_PAY");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);

  useEffect(() => {
    getMessageTemplates()
      .then(setTemplates)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  // Put the caret back after a keyword is inserted.
  useEffect(() => {
    if (caret.current !== null && box.current) {
      box.current.focus();
      box.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  const current = templates?.find((t) => t.kind === kind) ?? null;
  const text = current ? (drafts[kind] ?? current.template) : "";
  const setText = (value: string) => setDrafts((d) => ({ ...d, [kind]: value }));
  const changed = current !== null && text !== current.template;
  const unknown = current ? unknownKeywords(text, current.keywords.map((k) => k.key)) : [];
  const samples = Object.fromEntries((current?.keywords ?? []).map((k) => [k.key, k.sample]));
  const tooLong = text.length > MAX_LENGTH;

  const insertKeyword = (key: string) => {
    const el = box.current;
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const next = insertAt(text, `{${key}}`, start, end);
    caret.current = next.caret;
    setText(next.text);
  };

  const save = async () => {
    if (!current) return;
    setError(null);
    setSaving(true);
    try {
      const saved = await saveMessageTemplate(kind, text);
      setTemplates((list) => (list ? list.map((t) => (t.kind === kind ? saved : t)) : list));
      setDrafts((d) => ({ ...d, [kind]: undefined }));
      toast(`${saved.title} message saved`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 max-w-3xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">WhatsApp messages</h2>
        <p className="text-sm text-slate-600 mt-1">
          Write each message once. Click a keyword to put it where the cursor is; when you send, it becomes that person's own
          details, such as their name and amount. WhatsApp opens with the message typed in and you press Send there.
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {!templates ? (
        !error && <Loading />
      ) : (
        <>
          <div role="group" aria-label="Which message" className="inline-flex flex-wrap rounded-md border border-slate-300 bg-white p-0.5 text-sm">
            {templates.map((t) => (
              <button
                key={t.kind}
                type="button"
                aria-pressed={kind === t.kind}
                onClick={() => {
                  setKind(t.kind);
                  setError(null);
                }}
                className={`rounded px-3 py-1 transition-colors ${kind === t.kind ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {t.title}
                {drafts[t.kind] !== undefined && drafts[t.kind] !== t.template && <span aria-label="not saved"> •</span>}
              </button>
            ))}
          </div>

          {current && (
            <div className="@container space-y-4">
              <p className="text-xs text-slate-500">{current.used_for}</p>
              <div className="grid gap-4 @min-[36rem]:grid-cols-2">
                <div>
                  <label htmlFor="message-template" className="mb-1 block text-[13px] font-medium text-slate-700">
                    Message
                  </label>
                  <textarea
                    id="message-template"
                    ref={box}
                    rows={11}
                    className={`${textareaClass} font-sans leading-relaxed ${tooLong || unknown.length > 0 ? "border-red-400" : ""}`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <div className="mt-1 flex justify-between gap-3 text-xs">
                    <span className="text-red-600">
                      {unknown.length > 0
                        ? `${unknown.map((k) => `{${k}}`).join(", ")} ${unknown.length === 1 ? "is not a keyword" : "are not keywords"} for this message.`
                        : ""}
                    </span>
                    <span className={`tabular ${tooLong ? "text-red-600" : "text-slate-500"}`}>
                      {text.length} / {MAX_LENGTH}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="mb-1 block text-[13px] font-medium text-slate-700">Preview with sample details</span>
                  <div
                    aria-label="Preview"
                    className="min-h-[10rem] whitespace-pre-wrap break-words rounded-md rounded-tr-none bg-emerald-50 px-3 py-2.5 text-sm text-slate-800 shadow-sm"
                  >
                    {fillTemplate(text, samples) || <span className="text-slate-500">The message is empty.</span>}
                  </div>
                </div>
              </div>

              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Keywords (click to insert)</span>
                <div className="flex flex-wrap gap-1.5">
                  {current.keywords.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => insertKeyword(k.key)}
                      title={`Inserts {${k.key}}, e.g. ${k.sample.split("\n")[0]}`}
                      className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 transition-colors hover:border-brand-500 hover:bg-brand-100"
                    >
                      + {k.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <Button variant="ghost" className="mr-auto" disabled={text === current.default_template} onClick={() => setText(current.default_template)}>
                  Use the default message
                </Button>
                {changed && <Button onClick={() => setText(current.template)}>Undo changes</Button>}
                <Button variant="primary" loading={saving} disabled={!changed || tooLong || unknown.length > 0 || text.trim() === ""} onClick={save}>
                  Save message
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
