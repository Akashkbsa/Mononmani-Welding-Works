import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BellRing, Plus } from "lucide-react";
import { deleteReminder, listReminders, markReminderDone, markReminderNotDone, setReminderDismissed } from "../services/api";
import { errorMessage, formatDate } from "../lib/format";
import { remindText, repeatText, STATE_STYLE, whenText } from "../lib/reminders";
import { LINK_KIND_LABEL, Reminder, ReminderLinkKind, ReminderTab } from "../types/reminder";
import { Alert, Button, Card, ConfirmDialog, EmptyState, ListSkeleton, PageHeader, theadClass, useToast } from "../components/ui";
import ReminderFormModal from "../components/reminders/ReminderFormModal";

const TABS: { id: ReminderTab; label: string; empty: string }[] = [
  { id: "DUE", label: "Due now", empty: "Nothing is due. Reminders show here from their \"remind me\" day." },
  { id: "UPCOMING", label: "Upcoming", empty: "No upcoming reminders." },
  { id: "DONE", label: "Done", empty: "Finished one-time reminders show here." },
];

interface Props {
  /** Opens the record a reminder is linked to. */
  onOpenRecord: (kind: ReminderLinkKind, id: number) => void;
  /** Called after any change, so the banner at the top refreshes. */
  onChanged: () => void;
}

export default function RemindersPage({ onOpenRecord, onChanged }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<ReminderTab>("DUE");
  const [rows, setRows] = useState<Reminder[] | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Reminder | "new" | null>(null);
  const [deleting, setDeleting] = useState<Reminder | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [slider, setSlider] = useState<{ x: number; w: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    Promise.all([listReminders(tab), listReminders("DUE")])
      .then(([list, due]) => {
        if (cancelled) return;
        setRows(list);
        setDueCount(due.length);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [tab, version]);

  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    if (el) setSlider({ x: el.offsetLeft, w: el.offsetWidth });
  }, [tab, dueCount]);

  const changed = () => {
    setVersion((v) => v + 1);
    onChanged();
  };

  const act = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast(message);
      changed();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const empty = TABS.find((t) => t.id === tab)!.empty;

  return (
    <>
      <PageHeader
        title="Reminders"
        description="Things to do on a date, shown at the top of the app when they are due."
        actions={
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setEditing("new")}>
            New reminder
          </Button>
        }
      />

      <div className="mb-4 border-b border-slate-200">
        <div role="tablist" aria-label="Reminders" className="relative flex w-fit gap-1">
          <span
            aria-hidden="true"
            className="mww-slider pointer-events-none absolute -bottom-px left-0 h-0.5 w-[100px] origin-left bg-brand-600"
            style={{ transform: slider ? `translateX(${slider.x}px) scaleX(${slider.w / 100})` : "scaleX(0)" }}
          />
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 h-9 text-sm transition-colors ${tab === t.id ? "text-brand-700 font-medium" : "text-slate-600 hover:text-slate-900"}`}
            >
              {t.label}
              {t.id === "DUE" && dueCount > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 tabular">{dueCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {rows === null ? (
          <ListSkeleton rows={4} label="Loading reminders" />
        ) : rows.length === 0 ? (
          <EmptyState icon={BellRing} title="No reminders here" description={empty} />
        ) : (
          <table className="mww-fade w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="py-2.5 px-4 font-semibold">State</th>
                <th className="py-2.5 pr-4 font-semibold">What</th>
                <th className="py-2.5 pr-4 font-semibold">Date</th>
                <th className="py-2.5 pr-4 font-semibold">Repeat</th>
                <th className="py-2.5 pr-4 font-semibold">Linked to</th>
                <th className="py-2.5 px-4 font-semibold text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const style = STATE_STYLE[r.state];
                return (
                  <tr key={r.id} className="align-top">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${style.chip}`}>{style.label}</span>
                      {r.dismissed && r.state !== "DONE" && <div className="mt-1 text-xs text-slate-500">Hidden from the top</div>}
                    </td>
                    <td className="max-w-[22rem] py-3 pr-4">
                      <div className="font-medium text-slate-900">{r.title}</div>
                      {r.note && <div className="mt-0.5 text-xs text-slate-500">{r.note}</div>}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <div className="tabular">{formatDate(r.due_date)}</div>
                      <div className="text-xs text-slate-500">
                        {r.state === "DONE" ? `Done ${formatDate(r.done_on)}` : `${whenText(r.days_away)} · ${remindText(r.remind_days)}`}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{repeatText(r) || "—"}</td>
                    <td className="py-3 pr-4">
                      {r.link_kind && r.link_id !== null ? (
                        r.link_missing ? (
                          <span className="text-slate-500">link removed</span>
                        ) : (
                          <button
                            type="button"
                            className="text-left text-brand-700 hover:underline"
                            onClick={() => onOpenRecord(r.link_kind!, r.link_id!)}
                          >
                            <span className="text-xs text-slate-500">{LINK_KIND_LABEL[r.link_kind]} </span>
                            {r.link_label}
                          </button>
                        )
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex justify-end gap-1">
                        {r.state === "DONE" ? (
                          <Button size="sm" onClick={() => act(() => markReminderNotDone(r.id), "Marked as not done")}>
                            Not done
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => act(() => markReminderDone(r.id), r.repeat === "NONE" ? "Marked as done" : "Moved to the next date")}>
                            Done
                          </Button>
                        )}
                        {r.dismissed && r.state !== "DONE" && (
                          <Button size="sm" variant="ghost" onClick={() => act(() => setReminderDismissed(r.id, false), "Shown at the top again")}>
                            Show at top
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="dangerText" onClick={() => setDeleting(r)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {editing && (
        <ReminderFormModal
          reminder={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            changed();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          message={deleting.repeat === "NONE" ? "This reminder will be deleted." : "This repeating reminder and all its future dates will be deleted."}
          confirmLabel="Delete reminder"
          onConfirm={async () => {
            await deleteReminder(deleting.id);
            toast("Reminder deleted");
            changed();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
