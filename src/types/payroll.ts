export type PayStatus = "NOT_ENTERED" | "TO_PAY" | "PAID" | "OVERPAID";
export type WageKind = "ADVANCE" | "SALARY" | "RETURNED" | "WRITE_OFF" | "CARRIED";

export interface Employee {
  id: number;
  name: string;
  role: string | null;
  phone: string | null;
  address: string | null;
  joined_on: string;
  left_on: string | null;
  daily_wage: number;
  /** Per hour; 0 means no overtime pay. */
  ot_rate: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeInput {
  name: string;
  role: string | null;
  phone: string | null;
  address: string | null;
  joined_on: string;
  daily_wage: number;
  ot_rate: number;
  notes: string | null;
}

export interface EmployeeListItem {
  id: number;
  name: string;
  role: string | null;
  phone: string | null;
  daily_wage: number;
  ot_rate: number;
  joined_on: string;
  left_on: string | null;
  file_count: number;
}

export interface EmployeeFileInfo {
  id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

export interface EmployeeDetail {
  employee: Employee;
  files: EmployeeFileInfo[];
}

/** An entered month with the rates copied when it was first saved. */
export interface PayRow {
  id: number;
  employee_id: number;
  month: string;
  days_worked: number;
  daily_wage: number;
  ot_hours: number;
  ot_rate: number;
  bonus_amount: number;
  bonus_note: string | null;
  note: string | null;
}

export interface PayMonthInput {
  days_worked: number;
  ot_hours: number;
  /** null copies the employee's on first save, otherwise keeps the month's. */
  daily_wage: number | null;
  ot_rate: number | null;
  bonus_amount: number;
  bonus_note: string | null;
  note: string | null;
}

export interface MonthFigures {
  wages: number;
  ot_amount: number;
  bonus: number;
  earned: number;
  /** Advances and salary, plus an advance carried in. */
  given: number;
  /** Cash returned, written off, or taken from next month. */
  cleared: number;
  /** + paid less and accepted, - paid more. */
  rounded_off: number;
  /** + still to pay, - overpaid. */
  balance: number;
}

export interface EmployeePayment {
  id: number;
  employee_id: number;
  month: string;
  kind: WageKind;
  entry_date: string;
  amount: number;
  round_off: number;
  carried_to: string | null;
  payment_method: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeePaymentInput {
  employee_id: number;
  month: string;
  kind: WageKind;
  entry_date: string;
  amount: number;
  /** Salary only: round off the difference and finish the month. */
  finish: boolean;
  payment_method: string | null;
  note: string | null;
}

export interface PayMonthDetail {
  employee: Employee;
  month: string;
  row: PayRow | null;
  figures: MonthFigures;
  status: PayStatus;
  /** False for a later month that only holds an advance carried into it. */
  editable: boolean;
  entries: EmployeePayment[];
  carried_in: EmployeePayment[];
}

export interface PaySheetRow {
  employee_id: number;
  name: string;
  role: string | null;
  row: PayRow | null;
  figures: MonthFigures;
  status: PayStatus;
  current_wage: number;
  current_ot_rate: number;
}

export interface PaySheet {
  month: string;
  first_month: string;
  last_month: string;
  rows: PaySheetRow[];
  total_earned: number;
  total_given: number;
  total_to_pay: number;
  not_entered: number;
}

export interface PaySheetEntry {
  employee_id: number;
  days_worked: number;
  ot_hours: number;
}

export interface PayMonthSummary {
  month: string;
  row: PayRow | null;
  figures: MonthFigures;
  status: PayStatus;
}
