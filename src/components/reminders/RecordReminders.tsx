import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BellRing } from "lucide-react";
import { getRemindersForRecord, markReminderDone } from "../../services/api";
import { errorMessage, formatDate } from "../../lib/format";
import { STATE_STYLE, whenText } from "../../lib/reminders";
import { Reminder, ReminderLinkKind } from "../../types/reminder";
import { Button, useToast } from "../ui";
import ReminderFormModal from "./ReminderFormModal";
import { useReminders } from "./RemindersContext";

interface Props {
  kind: ReminderLinkKind;
  id: number;
  /** The record's number or name, shown in the form. */
  label: string;
  suggestedTitle: string;
}

/** A record's open reminders and a "Remind me" button that starts one linked to it. */
export default function RecordReminders({ kind, id, label, suggestedTitle }: Props) {
  const toast = useToast();
  const { changed } = useReminders();
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getRemindersForRecord(kind, id)
      .then((list) => !cancelled && setItems(list))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [kind, id, version]);

  const reload = () => {
    setVersion((v) => v + 1);
    changed();
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Reminders</h3>
        <Button size="sm" icon={<BellRing className="h-4 w-4" />} onClick={() => setCreating(true)}>
          Remind me
        </Button>
      </div>
      {items === null ? null : items.length === 0 ? (
        <p className="text-sm text-slate-500">No reminders for this yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((r) => {
            const style = STATE_STYLE[r.state];
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">{r.title}</div>
                  <div className="text-xs text-slate-500 tabular">
                    {formatDate(r.due_date)} · {whenText(r.days_away)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${style.chip}`}>{style.label}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await markReminderDone(r.id);
                        toast(r.repeat === "NONE" ? "Marked as done" : "Done. Moved to the next date");
                        reload();
                      } catch (err) {
                        toast(errorMessage(err), "error");
                      }
                    }}
                  >
                    Done
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {/* Drawn on the page itself, so it is not boxed inside the window it was opened from. */}
      {creating &&
        createPortal(
          <ReminderFormModal
            link={{ kind, id, label }}
            suggestedTitle={suggestedTitle}
            onClose={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              reload();
            }}
          />,
          document.body
        )}
    </div>
  );
}
