/** The kinds of record a reminder can be linked to. */
export type ReminderLinkKind =
  | "INVOICE"
  | "QUOTATION"
  | "PURCHASE_ORDER"
  | "PAYMENT"
  | "SUPPLIER_BILL"
  | "SUPPLIER_PAYMENT"
  | "COMPANY"
  | "TENANT"
  | "PLACE";

export type ReminderRepeat = "NONE" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** WAITING: not in its "remind me" window yet. DONE: a finished one-time reminder. */
export type ReminderState = "WAITING" | "COMING_UP" | "DUE_TODAY" | "OVERDUE" | "DONE";

export type ReminderTab = "DUE" | "UPCOMING" | "DONE";

export interface ReminderInput {
  title: string;
  note: string | null;
  /** YYYY-MM-DD or DD-MM-YYYY */
  due_date: string;
  /** 0 to 365 days before the date. */
  remind_days: number;
  repeat: ReminderRepeat;
  /** Monthly only: on the last day of every month. */
  month_end: boolean;
  link_kind: ReminderLinkKind | null;
  link_id: number | null;
}

export interface Reminder {
  id: number;
  title: string;
  note: string | null;
  /** YYYY-MM-DD: the next (or only) date. */
  due_date: string;
  remind_days: number;
  repeat: ReminderRepeat;
  month_end: boolean;
  link_kind: ReminderLinkKind | null;
  link_id: number | null;
  /** The linked record's number or name. */
  link_label: string | null;
  /** The linked record was deleted. */
  link_missing: boolean;
  /** Taken off the banner; still not done. */
  dismissed: boolean;
  done_on: string | null;
  last_done_on: string | null;
  state: ReminderState;
  /** Days from today to the date; negative when late. */
  days_away: number;
  created_at: string;
  updated_at: string;
}

/** The quick "Remind me" choices, in days before the date. */
export const REMIND_BEFORE_CHOICES = [0, 1, 2, 3, 7];

export const LINK_KIND_LABEL: Record<ReminderLinkKind, string> = {
  INVOICE: "Invoice",
  QUOTATION: "Quotation",
  PURCHASE_ORDER: "Purchase order",
  PAYMENT: "Payment",
  SUPPLIER_BILL: "Supplier bill",
  SUPPLIER_PAYMENT: "Supplier payment",
  COMPANY: "Company",
  TENANT: "Tenant",
  PLACE: "Place",
};
