import { Employee, EmployeePayment, MonthFigures, PayMonthDetail, PayRow } from "../../types/payroll";

/** Sample payroll records for the employee form tests. */

export const employee = (over: Partial<Employee> = {}): Employee => ({
  id: 3,
  name: "Murugan",
  role: "Welder",
  phone: "9876500003",
  address: null,
  joined_on: "2025-04-01",
  left_on: null,
  daily_wage: 800,
  ot_rate: 100,
  notes: null,
  created_at: "",
  updated_at: "",
  ...over,
});

export const figures = (over: Partial<MonthFigures> = {}): MonthFigures => ({
  wages: 0,
  ot_amount: 0,
  bonus: 0,
  earned: 0,
  given: 0,
  cleared: 0,
  rounded_off: 0,
  balance: 0,
  ...over,
});

export const payRow = (over: Partial<PayRow> = {}): PayRow => ({
  id: 1,
  employee_id: 3,
  month: "2026-09",
  days_worked: 26,
  daily_wage: 800,
  ot_hours: 4,
  ot_rate: 100,
  bonus_amount: 0,
  bonus_note: null,
  note: null,
  ...over,
});

export const wagePayment = (over: Partial<EmployeePayment> = {}): EmployeePayment => ({
  id: 20,
  employee_id: 3,
  month: "2026-09",
  kind: "ADVANCE",
  entry_date: "2026-09-10",
  amount: 2000,
  round_off: 0,
  carried_to: null,
  payment_method: "Cash",
  note: null,
  created_at: "",
  updated_at: "",
  ...over,
});

/** September 2026: 26 days × ₹800 + 4 h × ₹100 = ₹21,200 earned, nothing paid yet. */
export const monthDetail = (over: Partial<PayMonthDetail> = {}): PayMonthDetail => ({
  employee: employee(),
  month: "2026-09",
  row: payRow(),
  figures: figures({ wages: 20800, ot_amount: 400, earned: 21200, balance: 21200 }),
  status: "TO_PAY",
  editable: true,
  entries: [],
  carried_in: [],
  ...over,
});
