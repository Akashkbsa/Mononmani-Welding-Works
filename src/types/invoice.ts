export type TaxType = "CGST_SGST" | "IGST";
export type InvoiceStatus = "ISSUED" | "DRAFT" | "CANCELLED";
export type PaymentStatus = "UNPAID" | "PARTIALLY PAID" | "PAID" | "DRAFT" | "CANCELLED";

export interface Invoice {
  id: number;
  invoice_number: string;
  /** YYYY-MM-DD */
  invoice_date: string;
  /** YYYY-MM-DD */
  due_date: string | null;
  payment_terms_days: number;
  invoice_state: string;

  // Customer details as they were when the invoice was saved.
  customer_id: number | null;
  customer_name: string;
  customer_address: string | null;
  customer_phone: string | null;
  customer_gstin: string | null;
  customer_state: string | null;
  customer_state_code: string | null;

  po_number_and_date: string | null;
  vehicle_number: string | null;
  date_of_supply: string | null;
  place_of_supply: string | null;
  our_dc_number_and_date: string | null;
  your_dc_number_and_date: string | null;
  delivery_note: string | null;
  supplier_ref: string | null;
  buyer_ref: string | null;
  dispatch_doc_no: string | null;
  delivery_note_date: string | null;
  dispatch_through: string | null;
  destination: string | null;
  terms_of_delivery: string | null;

  tax_type: TaxType;
  subtotal: number;
  discount: number;
  cgst_rate: number;
  cgst_amount: number;
  sgst_rate: number;
  sgst_amount: number;
  igst_rate: number;
  igst_amount: number;
  round_off: number;
  total_amount: number;
  amount_in_words: string;

  bank_name: string;
  bank_branch: string;
  bank_account_no: string;
  bank_ifsc: string;
  terms_and_conditions: string | null;

  status: InvoiceStatus;
  notes: string | null;
  pdf_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  sl_no: number;
  description: string;
  hsn_sac: string;
  qum: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface InvoiceWithItems {
  invoice: Invoice;
  items: InvoiceItem[];
}

export interface InvoiceListItem {
  id: number;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  customer_id: number | null;
  customer_name: string;
  customer_gstin: string | null;
  total_amount: number;
  tax_type: TaxType;
  status: InvoiceStatus;
  total_settled: number;
  outstanding_amount: number;
  payment_status: PaymentStatus;
  pdf_path: string | null;
}

export interface InvoiceItemInput {
  description: string;
  hsn_sac: string;
  qum: string;
  quantity: number;
  rate: number;
}

/** Same shape for creating and editing an invoice. */
export interface InvoiceInput {
  invoice_number: string;
  invoice_date: string;
  /** Optional: the backend fills defaults (used only by the PDF). */
  due_date?: string | null;
  payment_terms_days?: number;
  invoice_state: string;

  customer_id: number | null;
  customer_name: string;
  customer_address: string | null;
  customer_phone: string | null;
  customer_gstin: string | null;
  customer_state: string | null;
  customer_state_code: string | null;

  po_number_and_date: string | null;
  vehicle_number: string | null;
  date_of_supply: string | null;
  place_of_supply: string | null;
  our_dc_number_and_date: string | null;
  your_dc_number_and_date: string | null;
  delivery_note: string | null;
  supplier_ref: string | null;
  buyer_ref: string | null;
  dispatch_doc_no: string | null;
  delivery_note_date: string | null;
  dispatch_through: string | null;
  destination: string | null;
  terms_of_delivery: string | null;

  tax_type: TaxType;
  discount: number;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;

  bank_name: string;
  bank_branch: string;
  bank_account_no: string;
  bank_ifsc: string;
  terms_and_conditions: string | null;

  status: InvoiceStatus;
  notes: string | null;
  items: InvoiceItemInput[];
}

export interface InvoiceFilter {
  query?: string;
  status?: string;
  customer_id?: number;
}

export type CopyType = "Original" | "Duplicate" | "Triplicate";
