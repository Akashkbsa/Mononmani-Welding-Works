/** What a company owed before its records in the app: + they owe us (Dr), − we owe them (Cr). */
export interface OpeningBalance {
  amount: number;
  /** YYYY-MM-DD; null when none is set. */
  as_on: string | null;
}

/** Debit: they owe us more (our invoices, our payments to them). Credit: they owe us less. */
export interface LedgerLine {
  date: string;
  particulars: string;
  number: string;
  detail: string;
  debit: number;
  credit: number;
  /** After this line: + Dr (they owe us), − Cr (we owe them). */
  balance: number;
}

export interface Ledger {
  company_id: number;
  company_name: string;
  party_type: string;
  from: string | null;
  to: string | null;
  brought_forward: number;
  lines: LedgerLine[];
  total_debit: number;
  total_credit: number;
  closing: number;
  opening_balance: OpeningBalance;
  /** Every record date, for the period picker. */
  dates: string[];
}
