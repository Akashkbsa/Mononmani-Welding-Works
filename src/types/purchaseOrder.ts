export type PurchaseOrderStatus = "NOT_STARTED" | "PARTIAL" | "COMPLETED";

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  NOT_STARTED: "Not started",
  PARTIAL: "Partially completed",
  COMPLETED: "Completed",
};

/** Largest file that can be attached, in bytes (10 MB). The backend checks it again. */
export const MAX_PO_FILE_BYTES = 10 * 1024 * 1024;

export interface PurchaseOrder {
  id: number;
  customer_id: number;
  customer_name: string;
  po_number: string;
  /** YYYY-MM-DD */
  po_date: string | null;
  status: PurchaseOrderStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderListItem {
  id: number;
  customer_id: number;
  customer_name: string;
  po_number: string;
  po_date: string | null;
  status: PurchaseOrderStatus;
  file_count: number;
  invoice_count: number;
}

export interface PurchaseOrderFileInfo {
  id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

/** An invoice shown under a purchase order, or in the list of invoices that can still be attached. */
export interface LinkedInvoice {
  id: number;
  invoice_number: string;
  /** YYYY-MM-DD */
  invoice_date: string;
  total_amount: number;
  status: string;
  payment_status: string;
  /** The "PO number & date" text the invoice carries now; linking replaces it. */
  po_number_and_date: string | null;
}

export interface PurchaseOrderDetail {
  order: PurchaseOrder;
  files: PurchaseOrderFileInfo[];
  invoices: LinkedInvoice[];
}

export interface PurchaseOrderInput {
  customer_id: number;
  po_number: string;
  /** YYYY-MM-DD or DD-MM-YYYY; empty for none */
  po_date: string | null;
  status: PurchaseOrderStatus;
  notes: string | null;
  /** Invoices to attach when saving. Unlinking is a separate action. */
  invoice_ids: number[];
}

export interface PurchaseOrderFilter {
  query?: string;
  status?: PurchaseOrderStatus | "ALL";
  customer_id?: number;
}

export interface DuplicatePoCheck {
  has_duplicate: boolean;
  existing_id: number | null;
}
