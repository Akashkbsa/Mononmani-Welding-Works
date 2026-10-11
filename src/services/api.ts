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

/** Creates the PDF for one copy of the invoice and opens it. */
export async function printInvoice(id: number, copy: CopyType = "Original"): Promise<void> {
  const path = await call<string>("generate_invoice_pdf_by_id", { id, copyType: copy });
  await openInvoicePdf(path);
}

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
