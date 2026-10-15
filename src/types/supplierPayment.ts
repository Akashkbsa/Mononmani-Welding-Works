/** ROUNDOFF: money paid beyond the bills, counted as paid with nothing owed back. NONE: no extra. */
export type SupplierExcessAction = "ROUNDOFF" | "NONE";

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
  /** Part of this payment beyond the bills it covers. */
  excess_amount: number;
  excess_action: SupplierExcessAction;
  remarks: string | null;
  created_at: string;
  updated_at: string;
  /** YYYY-MM-DD the WhatsApp message was last opened for the supplier; null if never. */
  whatsapp_sent_on: string | null;
}

/** The WhatsApp message for one payment and the link that opens the supplier's chat with it typed in. */
export interface SupplierPaymentMessage {
  message: string;
  /** `+` and digits. */
  number: string;
  link: string;
  whatsapp_sent_on: string | null;
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
  excess_amount: number;
  excess_action: SupplierExcessAction;
  bills_covered: string[];
  whatsapp_sent_on: string | null;
}

export interface SupplierPaymentInput {
  payment_number?: string | null;
  supplier_id: number;
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  bank_name: string | null;
  amount_paid: number;
  remarks: string | null;
  allocations: { bill_id: number; allocated_amount: number }[];
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

export interface SupplierPaymentsSummary {
  total_paid: number;
  paid_this_month: number;
}
