import { useState } from "react";
import { createReminder, updateReminder } from "../../services/api";
import { errorMessage, todayISO } from "../../lib/format";
import { remindText } from "../../lib/reminders";
import { LINK_KIND_LABEL, Reminder, ReminderInput, ReminderLinkKind, ReminderRepeat, REMIND_BEFORE_CHOICES } from "../../types/reminder";
import { Alert, Button, Checkbox, Field, inputClass, Modal, textareaClass, useDiscardGuard, useToast } from "../ui";

export interface ReminderLink {
  kind: ReminderLinkKind;
  id: number;
  label: string;
}

interface Props {
  /** The reminder being edited; none for a new one. */
  reminder?: Reminder;
  /** A new reminder made from a record starts linked to it. */
  link?: ReminderLink;
  suggestedTitle?: string;
  onClose: () => void;
  onSaved: () => void;
}

const REPEATS: { value: ReminderRepeat; label: string }[] = [
  { value: "NONE", label: "Does not repeat" },
  { value: "WEEKLY", label: "Every week" },
  { value: "MONTHLY", label: "Every month" },
  { value: "YEARLY", label: "Every year" },
];

export default function ReminderFormModal({ reminder, link, suggestedTitle, onClose, onSaved }: Props) {
  const toast = useToast();
  const guard = useDiscardGuard(onClose);
  const startLink: ReminderLink | null = reminder
    ? reminder.link_kind && reminder.link_id !== null
      ? { kind: reminder.link_kind, id: reminder.link_id, label: reminder.link_label ?? "link removed" }
      : null
    : link ?? null;

  const [title, setTitle] = useState(reminder?.title ?? suggestedTitle ?? "");
  const [date, setDate] = useState(reminder?.due_date ?? todayISO());
  const initialDays = reminder?.remind_days ?? 0;
  const [custom, setCustom] = useState(!REMIND_BEFORE_CHOICES.includes(initialDays));
  const [days, setDays] = useState(String(initialDays));
  const [repeat, setRepeat] = useState<ReminderRepeat>(reminder?.repeat ?? "NONE");
  const [monthEnd, setMonthEnd] = useState(reminder?.month_end ?? false);
  const [note, setNote] = useState(reminder?.note ?? "");
  const [linked, setLinked] = useState<ReminderLink | null>(startLink);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!title.trim()) return setError("Enter what the reminder is for.");
    if (!date) return setError("Choose the date.");
    const remindDays = Number(days);
    if (!Number.isInteger(remindDays) || remindDays < 0 || remindDays > 365) {
      return setError("Remind me can be 0 to 365 days before.");
    }
    const input: ReminderInput = {
      title: title.trim(),
      note: note.trim() || null,
      due_date: date,
      remind_days: remindDays,
      repeat,
      month_end: repeat === "MONTHLY" && monthEnd,
      link_kind: linked?.kind ?? null,
      link_id: linked?.id ?? null,
    };
    setSaving(true);
    try {
      if (reminder) await updateReminder(reminder.id, input);
      else await createReminder(input);
      toast("Reminder saved");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        title={reminder ? "Edit reminder" : "New reminder"}
        onClose={guard.requestClose}
        size="md"
        footer={
          <>
            <Button onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {reminder ? "Save changes" : "Save reminder"}
            </Button>
          </>
        }
      >
        <div className="space-y-5" onChangeCapture={guard.markDirty}>
          {error && <Alert>{error}</Alert>}
          <Field label="What to do" required>
            <input
              aria-label="What to do"
              autoFocus
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Date" required>
              <input aria-label="Date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Remind me" hint="It shows at the top of the app from then on.">
              <div className="flex gap-2">
                <select
                  aria-label="Remind me"
                  className={inputClass}
                  value={custom ? "custom" : days}
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      setCustom(true);
                    } else {
                      setCustom(false);
                      setDays(e.target.value);
                    }
                  }}
                >
                  {REMIND_BEFORE_CHOICES.map((n) => (
                    <option key={n} value={String(n)}>
                      {remindText(n)}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
                {custom && (
                  <input
                    aria-label="Days before"
                    type="number"
                    min={0}
                    max={365}
                    className={`${inputClass} w-24 tabular`}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                  />
                )}
              </div>
            </Field>
          </div>

          <div className="space-y-2">
            <Field label="Repeat">
              <select aria-label="Repeat" className={inputClass} value={repeat} onChange={(e) => setRepeat(e.target.value as ReminderRepeat)}>
                {REPEATS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            {repeat === "MONTHLY" && (
              <Checkbox
                checked={monthEnd}
                onChange={(v) => {
                  guard.markDirty();
                  setMonthEnd(v);
                }}
                label="On the last day of each month"
              />
            )}
          </div>

          <Field label="Note">
            <textarea aria-label="Note" rows={2} className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {linked && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span>
                <span className="text-slate-500">Linked to {LINK_KIND_LABEL[linked.kind].toLowerCase()}: </span>
                <span className="font-medium text-slate-900">{linked.label}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  guard.markDirty();
                  setLinked(null);
                }}
              >
                Remove link
              </Button>
            </div>
          )}
        </div>
      </Modal>
      {guard.confirm}
    </>
  );
}
