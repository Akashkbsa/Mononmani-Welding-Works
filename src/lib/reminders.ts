import { Reminder, ReminderState } from "../types/reminder";

/** "in 2 days", "tomorrow", "today", "yesterday", "3 days late". */
export function whenText(daysAway: number): string {
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "tomorrow";
  if (daysAway === -1) return "1 day late";
  return daysAway > 0 ? `in ${daysAway} days` : `${-daysAway} days late`;
}

/** Colours for a reminder's state: coming up amber, due today orange, overdue red. */
export const STATE_STYLE: Record<ReminderState, { label: string; chip: string; stripe: string }> = {
  WAITING: { label: "Upcoming", chip: "bg-slate-100 text-slate-700", stripe: "bg-slate-300" },
  COMING_UP: { label: "Coming up", chip: "bg-amber-100 text-amber-900", stripe: "bg-amber-400" },
  DUE_TODAY: { label: "Due today", chip: "bg-orange-100 text-orange-900", stripe: "bg-orange-500" },
  OVERDUE: { label: "Overdue", chip: "bg-red-100 text-red-800", stripe: "bg-red-600" },
  DONE: { label: "Done", chip: "bg-emerald-100 text-emerald-900", stripe: "bg-emerald-500" },
};

/** "Every month", "Last day of every month", "Every week", "Every year", or "" for one-time. */
export function repeatText(r: Pick<Reminder, "repeat" | "month_end">): string {
  switch (r.repeat) {
    case "WEEKLY":
      return "Every week";
    case "MONTHLY":
      return r.month_end ? "Last day of every month" : "Every month";
    case "YEARLY":
      return "Every year";
    default:
      return "";
  }
}

/** "On the day", "1 day before", "2 days before", "1 week before". */
export function remindText(days: number): string {
  if (days === 0) return "On the day";
  if (days === 7) return "1 week before";
  return `${days} day${days === 1 ? "" : "s"} before`;
}
