import { invoke } from "@tauri-apps/api/core";
import { Customer, CustomerCreateInput, DuplicateCheckResult } from "../types/customer";
import { DbStatusInfo } from "../types/db";
import {
  CopyType,
  InvoiceFilter,
  InvoiceInput,
  InvoiceListItem,
  InvoiceWithItems,
} from "../types/invoice";
import {
  CustomerCredit,
  InvoicePaymentSummary,
  PaymentFilter,
  PaymentInput,
  PaymentListItem,
  PaymentWithAllocations,
  PaymentsSummary,
  UnpaidInvoice,
} from "../types/payment";
import {
  DuplicatePoCheck,
  LinkedInvoice,
  PurchaseOrderDetail,
  PurchaseOrderFileInfo,
  PurchaseOrderFilter,
  PurchaseOrderInput,
  PurchaseOrderListItem,
} from "../types/purchaseOrder";
import {
  DuplicateQuotationCheck,
  LinkedOrder,
  QuotationDetail,
  QuotationFileInfo,
  QuotationFilter,
  QuotationInput,
  QuotationListItem,
} from "../types/quotation";
import { StorageInfo } from "../types/storage";
import { BusinessSettings } from "../types/settings";
import { BackupResult, BackupStatus, DriveBackupList } from "../types/backup";

/** Calls a Rust command and turns its error string into an Error with a readable message. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw new Error(String(err).replace(/^Error:\s*/, ""));
  }
}

// App
export const getStorageInfo = () => call<StorageInfo>("get_storage_info");
export const getDbStatus = () => call<DbStatusInfo>("get_db_status");
export const openDataFolder = () => call<void>("open_data_folder");
export const openInvoicePdf = (path: string) => call<void>("open_invoice_pdf", { path });

// Customers
export const listCustomers = () => call<Customer[]>("list_customers");
export const searchCustomers = (query: string) => call<Customer[]>("search_customers", { query });
export const checkDuplicateCustomer = (name: string, excludeId?: number) =>
  call<DuplicateCheckResult>("check_duplicate_customer", { name, excludeId: excludeId ?? null });
export const createCustomer = (input: CustomerCreateInput) => call<Customer>("create_customer", { input });
export const updateCustomer = (id: number, input: CustomerCreateInput) =>
  call<Customer>("update_customer", { id, input });
export const deleteCustomer = (id: number) => call<void>("delete_customer", { id });
export const setCustomerFavorite = (id: number, isFavorite: boolean) =>
  call<Customer>("toggle_customer_favorite", { id, isFavorite });

// Invoices
export const listInvoices = (filter: InvoiceFilter = {}) => call<InvoiceListItem[]>("list_invoices", { filter });
export const getInvoice = (id: number) => call<InvoiceWithItems | null>("get_invoice", { id });
export const getNextInvoiceNumber = () => call<string>("get_next_invoice_number");
export const checkDuplicateInvoiceNumber = (invoiceNumber: string, excludeId?: number) =>
  call<{ has_duplicate: boolean }>("check_duplicate_invoice_number", {
    invoiceNumber,
    excludeId: excludeId ?? null,
  });
export const createInvoice = (input: InvoiceInput) => call<InvoiceWithItems>("create_invoice", { input });
export const updateInvoice = (id: number, input: InvoiceInput) =>
  call<InvoiceWithItems>("update_invoice", { id, input });
export const deleteInvoice = (id: number) => call<void>("delete_invoice", { id });
/** Cancel an invoice (it stays on record), or restore a cancelled one to Issued. */
export const setInvoiceCancelled = (id: number, cancelled: boolean) =>
  call<InvoiceWithItems>("set_invoice_cancelled", { id, cancelled });

/** Creates the PDF for one copy of the invoice and opens it. */
export async function printInvoice(id: number, copy: CopyType = "Original"): Promise<void> {
  const path = await call<string>("generate_invoice_pdf_by_id", { id, copyType: copy });
  await openInvoicePdf(path);
}

/** One PDF holding the chosen copies of an invoice (in the order given), opened for the user. */
export async function printCopies(id: number, copies: CopyType[]): Promise<void> {
  const path = await call<string>("generate_invoice_copies_pdf", { id, copyTypes: copies });
  await openInvoicePdf(path);
}

/** One PDF with every issued invoice of a month (for the accountant). `month` is 1 to 12. */
export async function downloadMonthInvoices(
  year: number,
  month: number
): Promise<{ path: string; invoice_count: number }> {
  const result = await call<{ path: string; invoice_count: number }>("generate_month_invoices_pdf", { year, month });
  await openInvoicePdf(result.path);
  return result;
}

// Purchase orders
export const listPurchaseOrders = (filter: PurchaseOrderFilter = {}) =>
  call<PurchaseOrderListItem[]>("list_purchase_orders", { filter });
export const getPurchaseOrder = (id: number) => call<PurchaseOrderDetail | null>("get_purchase_order", { id });
export const createPurchaseOrder = (input: PurchaseOrderInput) =>
  call<PurchaseOrderDetail>("create_purchase_order", { input });
export const updatePurchaseOrder = (id: number, input: PurchaseOrderInput) =>
  call<PurchaseOrderDetail>("update_purchase_order", { id, input });
export const deletePurchaseOrder = (id: number) => call<void>("delete_purchase_order", { id });
/** A warning only: the same customer already has an order with this number. */
export const checkDuplicatePoNumber = (customerId: number, poNumber: string, excludeId?: number) =>
  call<DuplicatePoCheck>("check_duplicate_po_number", { customerId, poNumber, excludeId: excludeId ?? null });
/** `dataBase64` is the file's bytes as base64 text, without a "data:" prefix. */
export const addPurchaseOrderFile = (purchaseOrderId: number, fileName: string, dataBase64: string) =>
  call<PurchaseOrderFileInfo>("add_purchase_order_file", { purchaseOrderId, fileName, dataBase64 });
export const removePurchaseOrderFile = (fileId: number) => call<void>("remove_purchase_order_file", { fileId });
/** A photo as a data: URL to show in the app (photos only). */
export const getPurchaseOrderFilePreview = (fileId: number) =>
  call<string>("get_purchase_order_file_preview", { fileId });
/** Opens a PDF or Word file (or a photo) in the program Windows uses for it. */
export const openPurchaseOrderFile = (fileId: number) => call<void>("open_purchase_order_file", { fileId });
export const listUnlinkedInvoicesForCustomer = (customerId: number) =>
  call<LinkedInvoice[]>("list_unlinked_invoices_for_customer", { customerId });
/** Link an invoice to a purchase order, or unlink it with null. */
export const setInvoicePurchaseOrder = (invoiceId: number, purchaseOrderId: number | null) =>
  call<void>("set_invoice_purchase_order", { invoiceId, purchaseOrderId });

// Quotations
export const listQuotations = (filter: QuotationFilter = {}) => call<QuotationListItem[]>("list_quotations", { filter });
export const getQuotation = (id: number) => call<QuotationDetail | null>("get_quotation", { id });
export const createQuotation = (input: QuotationInput) => call<QuotationDetail>("create_quotation", { input });
export const updateQuotation = (id: number, input: QuotationInput) =>
  call<QuotationDetail>("update_quotation", { id, input });
export const deleteQuotation = (id: number) => call<void>("delete_quotation", { id });
/** A warning only: some customer already has a quotation with this number. */
export const checkDuplicateQuotationNumber = (quotationNumber: string, excludeId?: number) =>
  call<DuplicateQuotationCheck>("check_duplicate_quotation_number", { quotationNumber, excludeId: excludeId ?? null });
/** `dataBase64` is the file's bytes as base64 text, without a "data:" prefix. */
export const addQuotationFile = (quotationId: number, fileName: string, dataBase64: string) =>
  call<QuotationFileInfo>("add_quotation_file", { quotationId, fileName, dataBase64 });
export const removeQuotationFile = (fileId: number) => call<void>("remove_quotation_file", { fileId });
/** A photo as a data: URL to show in the app (photos only). */
export const getQuotationFilePreview = (fileId: number) => call<string>("get_quotation_file_preview", { fileId });
/** Opens a PDF or Word file (or a photo) in the program Windows uses for it. */
export const openQuotationFile = (fileId: number) => call<void>("open_quotation_file", { fileId });
export const listUnlinkedPurchaseOrdersForCustomer = (customerId: number) =>
  call<LinkedOrder[]>("list_unlinked_purchase_orders_for_customer", { customerId });
/** Link a purchase order to a quotation, or unlink it with null. */
export const setPurchaseOrderQuotation = (purchaseOrderId: number, quotationId: number | null) =>
  call<void>("set_purchase_order_quotation", { purchaseOrderId, quotationId });

// Payments
export const listPayments = (filter: PaymentFilter = {}) => call<PaymentListItem[]>("list_payments", { filter });
export const getPayment = (id: number) => call<PaymentWithAllocations | null>("get_payment", { id });
export const getNextPaymentNumber = () => call<string>("get_next_payment_number");
export const createPayment = (input: PaymentInput) => call<PaymentWithAllocations>("create_payment", { input });
export const updatePayment = (id: number, input: PaymentInput) =>
  call<PaymentWithAllocations>("update_payment", { id, input });
export const deletePayment = (id: number) => call<void>("delete_payment", { id });
export const getUnpaidInvoices = (customerId: number, excludePaymentId?: number) =>
  call<UnpaidInvoice[]>("get_unpaid_invoices_for_customer", {
    customerId,
    excludePaymentId: excludePaymentId ?? null,
  });
export const getCustomerCredits = (customerId: number, excludePaymentId?: number) =>
  call<CustomerCredit[]>("get_customer_credits", { customerId, excludePaymentId: excludePaymentId ?? null });
export const getInvoicePayments = (invoiceId: number) =>
  call<InvoicePaymentSummary>("get_invoice_payment_summary", { invoiceId });
export const getPaymentsSummary = () => call<PaymentsSummary>("get_payments_kpi_summary");

// Google Drive backup
export const getBackupStatus = () => call<BackupStatus>("backup_status");
export const connectDrive = (clientId: string, clientSecret: string) =>
  call<string | null>("connect_drive", { clientId, clientSecret });
export const disconnectDrive = () => call<void>("disconnect_drive");
export const runBackup = () => call<BackupResult>("run_backup");
export const listDriveBackups = () => call<DriveBackupList>("list_drive_backups");
export const restoreDriveBackup = (fileId: string) => call<string>("restore_drive_backup", { fileId });

// Business settings
export const getSettings = () => call<BusinessSettings>("get_settings");
export const saveSettings = (settings: BusinessSettings) => call<BusinessSettings>("save_settings", { settings });
