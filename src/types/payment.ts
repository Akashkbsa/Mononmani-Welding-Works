/** CREDIT: held as advance. REFUND: returned. ROUNDOFF: kept, nothing owed back. */
export type ExcessAction = "CREDIT" | "REFUND" | "ROUNDOFF" | "NONE";

export interface Payment {
  id: number;
  payment_number: string;
  customer_id: number | null;
  customer_name: string;
  /** YYYY-MM-DD */
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  bank_name: string | null;
  amount_received: number;
  tds_amount: number;
  /** Whether the TDS counts towards the invoices. */
  tds_recognized: boolean;
  /** Money received plus recognized TDS. */
  total_settled: number;
  /** Earlier advance used by this payment. */
  credit_applied: number;
  /** Part of this payment not allocated to invoices. */
  excess_amount: number;
  excess_action: ExcessAction;
  /** Short amount accepted as full payment; counts towards settling the invoices. */
  writeoff_amount: number;
  /** How much of this payment's advance later payments have used. */
  advance_used: number;
  is_verified: boolean;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentAllocationDetail {
  invoice_id: number;
  invoice_number: string;
  invoice_date: string;
  invoice_total_amount: number;
  allocated_amount: number;
}

export interface PaymentWithAllocations {
  payment: Payment;
  allocations: PaymentAllocationDetail[];
}

export interface PaymentListItem {
  id: number;
  payment_number: string;
  customer_id: number | null;
  customer_name: string;
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  amount_received: number;
  tds_amount: number;
  tds_recognized: boolean;
  total_settled: number;
  credit_applied: number;
  excess_amount: number;
  excess_action: ExcessAction;
  writeoff_amount: number;
  is_verified: boolean;
  invoices_covered: string[];
}

export interface PaymentInput {
  payment_number?: string | null;
  customer_id: number;
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  bank_name: string | null;
  amount_received: number;
  tds_amount: number;
  tds_recognized: boolean;
  credit_to_apply: number;
  is_verified: boolean;
  remarks: string | null;
  allocations: { invoice_id: number; allocated_amount: number }[];
  excess_action: ExcessAction;
  /** Must equal what is still short after money received, recognised TDS and any advance. */
  writeoff_amount: number;
}

export interface PaymentFilter {
  query?: string;
  customer_id?: number;
  payment_method?: string;
  is_verified?: boolean;
}

export interface CustomerCredit {
  id: number;
  customer_id: number;
  source_payment_id: number | null;
  source_payment_number: string | null;
  original_amount: number;
  remaining_amount: number;
  created_at: string;
}

export interface UnpaidInvoice {
  invoice_id: number;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  /** Already settled by other payments. */
  total_settled: number;
  outstanding_amount: number;
}

export interface InvoicePaymentItem {
  payment_id: number;
  payment_number: string;
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  amount: number;
  is_verified: boolean;
}

export interface InvoicePaymentSummary {
  invoice_id: number;
  total_amount: number;
  total_settled: number;
  outstanding_amount: number;
  payment_status: string;
  payments: InvoicePaymentItem[];
}

export interface PaymentsSummary {
  total_received: number;
  total_tds: number;
  total_outstanding: number;
  unpaid_invoices_count: number;
  unverified_count: number;
  advances_held: number;
  received_this_month: number;
  invoiced_this_month: number;
}

export const PAYMENT_METHODS = ["Bank Transfer", "UPI", "Cheque", "Cash", "Demand Draft"] as const;
