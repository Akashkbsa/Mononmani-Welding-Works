/** CREDIT: kept as an advance with the supplier. ROUNDOFF: counted as paid, nothing owed back. */
export type SupplierExcessAction = "CREDIT" | "ROUNDOFF" | "NONE";

export interface SupplierPayment {
  id: number;
  payment_number: string;
  supplier_id: number;
  supplier_name: string;
  /** YYYY-MM-DD */
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  bank_name: string | null;
  amount_paid: number;
  /** Short amount the supplier accepted as full payment; counts towards settling the bills. */
  writeoff_amount: number;
  /** Money paid plus the written-off part. */
  total_settled: number;
  /** Earlier advance used by this payment. */
  credit_applied: number;
  /** Part of this payment not applied to bills. */
  excess_amount: number;
  excess_action: SupplierExcessAction;
  /** How much of this payment's advance later payments have used. */
  advance_used: number;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierAllocationDetail {
  bill_id: number;
  bill_number: string;
  bill_date: string;
  bill_total_amount: number;
  allocated_amount: number;
}

export interface SupplierPaymentWithAllocations {
  payment: SupplierPayment;
  allocations: SupplierAllocationDetail[];
}

export interface SupplierPaymentListItem {
  id: number;
  payment_number: string;
  supplier_id: number;
  supplier_name: string;
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  amount_paid: number;
  writeoff_amount: number;
  total_settled: number;
  credit_applied: number;
  excess_amount: number;
  excess_action: SupplierExcessAction;
  bills_covered: string[];
}

export interface SupplierPaymentInput {
  payment_number?: string | null;
  supplier_id: number;
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  bank_name: string | null;
  amount_paid: number;
  credit_to_apply: number;
  remarks: string | null;
  allocations: { bill_id: number; allocated_amount: number }[];
  excess_action: SupplierExcessAction;
  /** The short amount accepted as full payment. It cannot be more than what is actually short. */
  writeoff_amount: number;
}

export interface SupplierPaymentFilter {
  query?: string;
  supplier_id?: number;
  date_from?: string;
  date_to?: string;
  payment_method?: string;
}

/** A bill a payment to this supplier can be applied to. */
export interface UnpaidBill {
  bill_id: number;
  bill_number: string;
  bill_date: string;
  total_amount: number;
  /** Already settled by other payments. */
  total_settled: number;
  outstanding_amount: number;
}

export interface SupplierCredit {
  id: number;
  supplier_id: number;
  source_payment_id: number | null;
  source_payment_number: string | null;
  original_amount: number;
  remaining_amount: number;
  created_at: string;
}

export interface SupplierPaymentsSummary {
  total_paid: number;
  paid_this_month: number;
  advances_held: number;
}
