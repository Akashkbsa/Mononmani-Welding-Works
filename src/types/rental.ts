import { AttachmentInfo } from "./attachment";

export type RentalFileInfo = AttachmentInfo;

/** Which kind of record a rental file belongs to. */
export type RentalOwnerKind = "PLACE" | "TENANT";

export interface Place {
  id: number;
  name: string;
  address: string | null;
  monthly_rent: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaceInput {
  name: string;
  address: string | null;
  monthly_rent: number;
  notes: string | null;
}

export interface PlaceListItem {
  id: number;
  name: string;
  address: string | null;
  monthly_rent: number;
  /** The tenant living there now; null means the place is vacant. */
  current_tenant: string | null;
  file_count: number;
}

export interface PlaceDetail {
  place: Place;
  files: RentalFileInfo[];
}

export interface Tenant {
  id: number;
  place_id: number;
  place_name: string;
  name: string;
  /** + and digits, e.g. +919876543210 */
  whatsapp_number: string;
  monthly_rent: number;
  /** YYYY-MM-DD */
  move_in_date: string | null;
  /** YYYY-MM-DD; null means the tenant lives there now. */
  moved_out_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantInput {
  place_id: number;
  name: string;
  /** Typed as the owner has it; the backend turns it into + and digits. */
  whatsapp_number: string;
  monthly_rent: number;
  /** YYYY-MM-DD or DD-MM-YYYY */
  move_in_date: string | null;
  notes: string | null;
}

export interface TenantListItem {
  id: number;
  place_id: number;
  place_name: string;
  name: string;
  whatsapp_number: string;
  monthly_rent: number;
  move_in_date: string | null;
  moved_out_date: string | null;
  file_count: number;
}

export interface TenantDetail {
  tenant: Tenant;
  files: RentalFileInfo[];
}

/** One tenant on one month's list. */
export interface MonthRow {
  tenant_id: number;
  tenant_name: string;
  place_name: string;
  whatsapp_number: string;
  /** What was recorded for a paid month, else the tenant's current rent. */
  rent_amount: number;
  paid: boolean;
  /** YYYY-MM-DD */
  paid_on: string | null;
  paid_amount: number | null;
  note: string | null;
  /** Reminders sent for this month. */
  reminders_sent: number;
  /** YYYY-MM-DD: the day the latest confirmed reminder was sent. */
  last_sent_on: string | null;
}

/** One reminder for a tenant and month. */
export interface ReminderEntry {
  id: number;
  /** 1 = first reminder, 2 = second, and so on. */
  number: number;
  /** YYYY-MM-DD */
  opened_on: string;
  /** The day it was sent (the day WhatsApp was opened with it). */
  sent_on: string | null;
}

export interface MonthSummary {
  paid_count: number;
  total_count: number;
  collected: number;
  pending: number;
}

export interface MonthOverview {
  /** YYYY-MM */
  month: string;
  rows: MonthRow[];
  summary: MonthSummary;
}

export interface MarkPaidInput {
  tenant_id: number;
  /** YYYY-MM */
  month: string;
  /** YYYY-MM-DD or DD-MM-YYYY */
  paid_on: string;
  /** null means the tenant's rent. */
  amount: number | null;
  note: string | null;
}

/** The message for one unpaid tenant and the WhatsApp link that opens it. */
export interface RentReminder {
  tenant_id: number;
  tenant_name: string;
  number: string;
  /** Which reminder this would be: 1 when none was sent yet, 2 after one, and so on. */
  reminder_number: number;
  message: string;
  link: string;
}
