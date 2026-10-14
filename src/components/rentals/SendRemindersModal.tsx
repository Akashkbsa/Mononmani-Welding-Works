import { useEffect, useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";
import { getRentReminder, openRentReminder } from "../../services/api";
import { errorMessage, formatPhone, monthTitle, shortDate, todayISO } from "../../lib/format";
import { MonthRow, RentReminder } from "../../types/rental";
import { Alert, Button, Modal, Skeleton, useToast } from "../ui";

interface Props {
  /** YYYY-MM */
  month: string;
  /** The tenants who have not paid this month. */
  rows: MonthRow[];
  onClose: () => void;
  /** Called after a reminder was opened, so the list can show the new "Reminder opened" date. */
  onChanged: () => void;
}

/** One line per unpaid tenant with the message ready. The owner presses Send in WhatsApp. */
export default function SendRemindersModal({ month, rows, onClose, onChanged }: Props) {
  const toast = useToast();
  // The message for each tenant, or the reason it could not be built.
  const [reminders, setReminders] = useState<Record<number, RentReminder | string>>({});
  const [openedToday, setOpenedToday] = useState<Set<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  // Rows are reloaded after each reminder; the messages only need loading when the tenants change.
  const tenantKey = rows.map((r) => r.tenant_id).join(",");
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      rows.map(async (row) => {
        try {
          return [row.tenant_id, await getRentReminder(row.tenant_id, month)] as const;
        } catch (err) {
          return [row.tenant_id, errorMessage(err)] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setReminders(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantKey, month]);

  const send = async (row: MonthRow) => {
    setBusyId(row.tenant_id);
    setRowErrors((current) => ({ ...current, [row.tenant_id]: "" }));
    try {
      await openRentReminder(row.tenant_id, month);
      setOpenedToday((current) => new Set(current).add(row.tenant_id));
      onChanged();
    } catch (err) {
      setRowErrors((current) => ({ ...current, [row.tenant_id]: errorMessage(err) }));
    } finally {
      setBusyId(null);
    }
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
      size="lg"
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          WhatsApp opens with the message ready. Press Send in WhatsApp for each tenant.
        </p>

        <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {rows.map((row) => {
            const reminder = reminders[row.tenant_id];
            const ready = typeof reminder === "object";
            const opened = openedToday.has(row.tenant_id);
            return (
              <div key={row.tenant_id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {row.tenant_name} <span className="font-normal text-slate-500">· {row.place_name}</span>
                    </div>
                    <div className="text-xs text-slate-500 tabular">{formatPhone(row.whatsapp_number)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {opened ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        Opened {shortDate(todayISO())}
                      </span>
                    ) : (
                      row.reminded_on && <span className="text-xs text-slate-500">Last opened {shortDate(row.reminded_on)}</span>
                    )}
                    <Button
                      size="sm"
                      icon={<Copy className="w-4 h-4" />}
                      disabled={!ready}
                      onClick={() => ready && copy(reminder)}
                    >
                      Copy message
                    </Button>
                    <Button
                      size="sm"
                      variant={opened ? "secondary" : "primary"}
                      icon={<MessageCircle className="w-4 h-4" />}
                      loading={busyId === row.tenant_id}
                      disabled={!ready || busyId !== null}
                      onClick={() => send(row)}
                    >
                      {opened ? "Open again" : "Send on WhatsApp"}
                    </Button>
                  </div>
                </div>

                {reminder === undefined ? (
                  <Skeleton className="h-4 w-full max-w-lg" />
                ) : ready ? (
                  <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{reminder.message}</p>
                ) : (
                  <Alert>{reminder}</Alert>
                )}

                {rowErrors[row.tenant_id] && <Alert>{rowErrors[row.tenant_id]}</Alert>}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
