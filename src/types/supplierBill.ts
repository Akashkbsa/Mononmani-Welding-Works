import { AttachmentInfo } from "./attachment";

export type BillStatus = "NOT_PAID" | "PARTIAL" | "PAID";

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  NOT_PAID: "Not paid",
  PARTIAL: "Partially paid",
  PAID: "Fully paid",
};

export type SupplierBillFileInfo = AttachmentInfo;

export interface SupplierBill {
  id: number;
  supplier_id: number;
  supplier_name: string;
  bill_number: string;
  /** YYYY-MM-DD */
  bill_date: string;
  total_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierBillListItem {
  id: number;
  supplier_id: number;
  supplier_name: string;
  bill_number: string;
  /** YYYY-MM-DD */
  bill_date: string;
  total_amount: number;
  settled_amount: number;
  outstanding_amount: number;
  status: BillStatus;
  file_count: number;
}

/** A supplier payment shown under the bill it settles. */
export interface BillPayment {
  payment_id: number;
  payment_number: string;
  /** YYYY-MM-DD */
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  /** What this payment settled on this bill, including any written-off part. */
  amount_settled: number;
}

export interface SupplierBillDetail {
  bill: SupplierBill;
  settled_amount: number;
  outstanding_amount: number;
  status: BillStatus;
  files: SupplierBillFileInfo[];
  payments: BillPayment[];
}

export interface SupplierBillInput {
  supplier_id: number;
  bill_number: string;
  /** YYYY-MM-DD or DD-MM-YYYY */
  bill_date: string;
  total_amount: number;
  notes: string | null;
}

export interface SupplierBillFilter {
  query?: string;
  supplier_id?: number;
  status?: BillStatus | "ALL";
}

export interface DuplicateBillCheck {
  has_duplicate: boolean;
  existing_id: number | null;
}

export interface SupplierBillsSummary {
  /** What is still owed on all bills. */
  total_outstanding: number;
  open_bills_count: number;
  /** Advances paid to suppliers and not yet used. */
  advances_held: number;
}
