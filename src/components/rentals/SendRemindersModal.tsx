import { useEffect, useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";
import { getRentReminder, getRentReminderHistory, openRentReminder } from "../../services/api";
import { errorMessage, formatPhone, monthTitle, shortDate, todayISO } from "../../lib/format";
import { MonthRow, ReminderEntry, RentReminder } from "../../types/rental";
import { Alert, Badge, Button, Modal, Skeleton, useToast } from "../ui";

interface Props {
  /** YYYY-MM */
  month: string;
  /** The tenants who have not paid this month. */
  rows: MonthRow[];
  onClose: () => void;
  /** Called after a reminder was sent, so the list shows the new status. */
  onChanged: () => void;
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth"];

/** "First reminder", "Second reminder (follow-up)", ... */
export function reminderLabel(n: number): string {
  const word = ORDINALS[n - 1] ?? `${n}th`;
  const text = `${word.charAt(0).toUpperCase()}${word.slice(1)} reminder`;
  return n === 1 ? text : `${text} (follow-up)`;
}

/**
 * One block per unpaid tenant. Opening the chat with the message ready counts as sending the
 * reminder; the owner presses Send in WhatsApp.
 */
export default function SendRemindersModal({ month, rows, onClose, onChanged }: Props) {
  const toast = useToast();
  // The message for each tenant, or the reason it could not be built.
  const [reminders, setReminders] = useState<Record<number, RentReminder | string>>({});
  const [histories, setHistories] = useState<Record<number, ReminderEntry[]>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  // A tenant who already got a reminder today must be asked twice before another is opened.
  const [armedId, setArmedId] = useState<number | null>(null);
  // Bumped after each change so the messages and histories load again.
  const [version, setVersion] = useState(0);

  const tenantKey = rows.map((r) => r.tenant_id).join(",");
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      rows.map(async (row) => {
        let reminder: RentReminder | string;
        let history: ReminderEntry[] = [];
        try {
          reminder = await getRentReminder(row.tenant_id, month);
        } catch (err) {
          reminder = errorMessage(err);
        }
        try {
          history = await getRentReminderHistory(row.tenant_id, month);
        } catch {
          // The history is a convenience; the row still works without it.
        }
        return { id: row.tenant_id, reminder, history };
      })
    ).then((items) => {
      if (cancelled) return;
      setReminders(Object.fromEntries(items.map((i) => [i.id, i.reminder])));
      setHistories(Object.fromEntries(items.map((i) => [i.id, i.history])));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantKey, month, version]);

  const run = async (row: MonthRow, action: () => Promise<unknown>) => {
    setBusyId(row.tenant_id);
    setArmedId(null);
    setRowErrors((current) => ({ ...current, [row.tenant_id]: "" }));
    try {
      await action();
      setVersion((v) => v + 1);
      onChanged();
    } catch (err) {
      setRowErrors((current) => ({ ...current, [row.tenant_id]: errorMessage(err) }));
    } finally {
      setBusyId(null);
    }
  };

  const send = (row: MonthRow) => {
    const sentToday = row.last_sent_on === todayISO();
    if (sentToday && armedId !== row.tenant_id) return setArmedId(row.tenant_id);
    run(row, () => openRentReminder(row.tenant_id, month));
  };

  const copy = async (reminder: RentReminder) => {
    try {
      await navigator.clipboard.writeText(reminder.message);
      toast("Message copied");
    } catch {
      toast("Could not copy the message. Select the text and press Ctrl+C.", "error");
    }
  };

  return (
    <Modal
      title="Send reminders"
      subtitle={`${monthTitle(month)} · ${rows.length} not paid`}
      size="xl"
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          WhatsApp opens with the message ready. Press Send there. Opening it from here counts the reminder as sent.
        </p>

        <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {rows.map((row) => {
            const reminder = reminders[row.tenant_id];
            const ready = typeof reminder === "object";
            const history = histories[row.tenant_id] ?? [];
            const sentToday = row.last_sent_on === todayISO();
            const armed = armedId === row.tenant_id;
            const next = ready ? reminder.reminder_number : row.reminders_sent + 1;
            const busy = busyId === row.tenant_id;
            return (
              <div key={row.tenant_id} className="space-y-3 px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {row.tenant_name} <span className="font-normal text-slate-500">· {row.place_name}</span>
                    </div>
                    <div className="text-xs text-slate-500 tabular">{formatPhone(row.whatsapp_number)}</div>
                  </div>
                  <div className="shrink-0">
                    {row.reminders_sent > 0 ? (
                      <Badge tone="green">
                        {row.reminders_sent === 1 ? "1 reminder" : `${row.reminders_sent} reminders`} sent · last {shortDate(row.last_sent_on)}
                      </Badge>
                    ) : (
                      <Badge>Not sent</Badge>
                    )}
                  </div>
                </div>

                {reminder === undefined ? (
                  <Skeleton className="h-4 w-full max-w-lg" />
                ) : ready ? (
                  <div>
                    <div className="mb-1 text-xs font-medium text-slate-500">{reminderLabel(next)}</div>
                    <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{reminder.message}</p>
                  </div>
                ) : (
                  <Alert>{reminder}</Alert>
                )}

                {history.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-slate-600" aria-label={`Reminder history for ${row.tenant_name}`}>
                    {history.map((entry) => (
                      <li key={entry.id} className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
                        <span className="font-medium">{reminderLabel(entry.number)}</span>
                        <span>sent {shortDate(entry.sent_on ?? entry.opened_on)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {sentToday && (
                  <p className="text-xs text-amber-700">
                    A reminder was already sent today{armed ? ". Press the button again only if you want to send another." : "."}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button size="sm" icon={<Copy className="w-4 h-4" />} disabled={!ready} onClick={() => ready && copy(reminder)}>
                    Copy message
                  </Button>
                  <Button
                    size="sm"
                    variant={sentToday ? "secondary" : "primary"}
                    icon={<MessageCircle className="w-4 h-4" />}
                    loading={busy}
                    disabled={!ready || busyId !== null}
                    onClick={() => send(row)}
                  >
                    {armed ? "Yes, send another" : `Send ${ORDINALS[next - 1] ?? `${next}th`} reminder`}
                  </Button>
                </div>

                {rowErrors[row.tenant_id] && <Alert>{rowErrors[row.tenant_id]}</Alert>}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
