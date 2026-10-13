import { AttachmentInfo } from "./attachment";
import { PurchaseOrderStatus } from "./purchaseOrder";

export type QuotationFileInfo = AttachmentInfo;

export interface Quotation {
  id: number;
  customer_id: number;
  customer_name: string;
  quotation_number: string;
  /** YYYY-MM-DD */
  quotation_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotationListItem {
  id: number;
  customer_id: number;
  customer_name: string;
  quotation_number: string;
  /** YYYY-MM-DD */
  quotation_date: string;
  file_count: number;
  order_count: number;
}

/** A purchase order shown under a quotation, or in the list of orders that can still be attached. */
export interface LinkedOrder {
  id: number;
  po_number: string;
  /** YYYY-MM-DD */
  po_date: string | null;
  status: PurchaseOrderStatus;
  invoice_count: number;
}

export interface QuotationDetail {
  quotation: Quotation;
  files: QuotationFileInfo[];
  orders: LinkedOrder[];
}

export interface QuotationInput {
  customer_id: number;
  quotation_number: string;
  /** YYYY-MM-DD or DD-MM-YYYY */
  quotation_date: string;
  notes: string | null;
  /** Purchase orders to attach when saving. Unlinking is a separate action. */
  purchase_order_ids: number[];
}

export interface QuotationFilter {
  query?: string;
  customer_id?: number;
}

export interface DuplicateQuotationCheck {
  has_duplicate: boolean;
  existing_id: number | null;
  existing_customer_name: string | null;
}
