import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { getReminderBanner, getSnoozeChoices, markReminderDone, setReminderDismissed, snoozeReminder } from "../../services/api";
import { errorMessage, formatDate } from "../../lib/format";
import { snoozeLabel, STATE_STYLE, whenText } from "../../lib/reminders";
import { LINK_KIND_LABEL, Reminder } from "../../types/reminder";
import { Button, useToast } from "../ui";
import { useReminders } from "./RemindersContext";

const SHOWN = 3;

/** Row tints so the most urgent reminder stands out: overdue red, due today orange, coming up amber. */
const ROW_TINT: Record<string, string> = {
  OVERDUE: "bg-red-50",
  DUE_TODAY: "bg-orange-50",
  COMING_UP: "bg-amber-50",
};

interface Props {
  /** Changes whenever reminders may have changed (page switch, a save), so the banner loads again. */
  refreshKey: string;
  onOpenAll: () => void;
}

/**
 * Reminders that are coming up, due or overdue, at the top of every screen. They stay until the owner
 * presses Done or Dismiss, or snoozes them until a later day.
 */
export default function ReminderBanner({ refreshKey, onOpenAll }: Props) {
  const toast = useToast();
  const { changed, openRecord } = useReminders();
  const [items, setItems] = useState<Reminder[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [snoozeDays, setSnoozeDays] = useState<number[]>([1]);
  /** The reminder whose "how long?" snooze menu is open. */
  const [menuId, setMenuId] = useState<number | null>(null);

  // Close the snooze menu on a click elsewhere or Escape.
  useEffect(() => {
    if (menuId === null) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && (e.target as HTMLElement).closest("[data-snooze-menu]")) return;
      setMenuId(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuId]);

  // Check again every minute, so a reminder appears when the date changes while the app is open.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getReminderBanner()
      .then((list) => !cancelled && setItems(list))
      .then(() => getSnoozeChoices())
      .then((days) => !cancelled && days && days.length > 0 && setSnoozeDays(days))
      .catch(() => {
        // The banner is a helper; a failed check leaves the screen as it is.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, tick]);

  if (items.length === 0) return null;

  const act = async (r: Reminder, action: () => Promise<unknown>, message: string) => {
    setMenuId(null);
    setBusyId(r.id);
    try {
      await action();
      toast(message);
      changed();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section role="region" aria-label="Reminders" className="mww-fade mb-5 rounded-lg border border-slate-200 bg-white shadow-card">
      <ul className="divide-y divide-slate-200">
        {items.slice(0, SHOWN).map((r) => {
          const style = STATE_STYLE[r.state];
          return (
            <li key={r.id} className={`relative flex items-center gap-3 py-2.5 pl-5 pr-3 first:rounded-t-lg last:rounded-b-lg ${ROW_TINT[r.state] ?? ""}`}>
              <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${style.stripe}`} />
              <BellRing className="h-4 w-4 shrink-0 text-slate-600" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate font-medium text-slate-900">{r.title}</span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${style.chip}`}>{style.label}</span>
                  <span className="text-xs text-slate-600 tabular">
                    {formatDate(r.due_date)} · {whenText(r.days_away)}
                  </span>
                </div>
                {r.link_kind && r.link_id !== null && (
                  <div className="text-xs">
                    {r.link_missing ? (
                      <span className="text-slate-500">link removed</span>
                    ) : (
                      <button type="button" className="text-brand-700 hover:underline" onClick={() => openRecord(r.link_kind!, r.link_id!)}>
                        {LINK_KIND_LABEL[r.link_kind]} {r.link_label}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="primary"
                  loading={busyId === r.id}
                  onClick={() => act(r, () => markReminderDone(r.id), r.repeat === "NONE" ? "Marked as done" : "Done. Moved to the next date")}
                >
                  Done
                </Button>
                <div className="relative" data-snooze-menu>
                  <Button
                    size="sm"
                    disabled={busyId === r.id}
                    aria-haspopup={snoozeDays.length > 1 ? "menu" : undefined}
                    aria-expanded={snoozeDays.length > 1 ? menuId === r.id : undefined}
                    title={snoozeDays.length === 1 ? `Hide until ${snoozeLabel(snoozeDays[0]).toLowerCase()}. It comes back by itself.` : "Hide for a while. It comes back by itself."}
                    onClick={() =>
                      snoozeDays.length === 1
                        ? act(r, () => snoozeReminder(r.id, snoozeDays[0]), `Snoozed: back ${snoozeDays[0] === 1 ? "tomorrow" : `in ${snoozeLabel(snoozeDays[0])}`}`)
                        : setMenuId(menuId === r.id ? null : r.id)
                    }
                  >
                    Snooze
                  </Button>
                  {menuId === r.id && (
                    <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-card">
                      {snoozeDays.map((d) => (
                        <button
                          key={d}
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                          onClick={() => act(r, () => snoozeReminder(r.id, d), `Snoozed: back ${d === 1 ? "tomorrow" : `in ${snoozeLabel(d)}`}`)}
                        >
                          {snoozeLabel(d)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  disabled={busyId === r.id}
                  title="Hide from the top. It stays on the Reminders page as not done."
                  onClick={() => act(r, () => setReminderDismissed(r.id, true), "Hidden from the top")}
                >
                  Dismiss
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > SHOWN && (
        <button type="button" onClick={onOpenAll} className="w-full border-t border-slate-200 px-5 py-2 text-left text-sm text-brand-700 hover:bg-slate-50">
          and {items.length - SHOWN} more reminder{items.length - SHOWN === 1 ? "" : "s"}
        </button>
      )}
    </section>
  );
}
