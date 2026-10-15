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
import {
  MarkPaidInput,
  MonthOverview,
  PlaceDetail,
  PlaceInput,
  PlaceListItem,
  ReminderEntry,
  RentalFileInfo,
  RentHistoryRow,
  RentalOwnerKind,
  RentReminder,
  TenantDetail,
  TenantInput,
  TenantListItem,
} from "../types/rental";
import {
  DuplicateBillCheck,
  SupplierBillDetail,
  SupplierBillFileInfo,
  SupplierBillFilter,
  SupplierBillInput,
  SupplierBillListItem,
  SupplierBillsSummary,
} from "../types/supplierBill";
import {
  SupplierPaymentFilter,
  SupplierPaymentInput,
  SupplierPaymentListItem,
  SupplierPaymentMessage,
  SupplierPaymentsSummary,
  SupplierPaymentWithAllocations,
  UnpaidBill,
} from "../types/supplierPayment";
import { Reminder, ReminderInput, ReminderLinkKind, ReminderTab } from "../types/reminder";
import { StorageInfo } from "../types/storage";
import { BusinessSettings } from "../types/settings";
import { BackupResult, BackupStatus, DriveBackupList } from "../types/backup";
import {
  EmployeeDetail,
  EmployeeFileInfo,
  EmployeeInput,
  EmployeeListItem,
  EmployeePayment,
  EmployeePaymentInput,
  PayMonthDetail,
  PayMonthInput,
  PayMonthSummary,
  PaySheet,
  PaySheetEntry,
} from "../types/payroll";

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
/** Which companies a list is for: customers (Customer and Both) or suppliers (Supplier and Both). No value means everyone. */
export type PartyFilter = "CUSTOMER" | "SUPPLIER";
export const listCustomers = (party?: PartyFilter) => call<Customer[]>("list_customers", { party: party ?? null });
export const searchCustomers = (query: string, party?: PartyFilter) =>
  call<Customer[]>("search_customers", { query, party: party ?? null });
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

// Supplier bills
export const listSupplierBills = (filter: SupplierBillFilter = {}) =>
  call<SupplierBillListItem[]>("list_supplier_bills", { filter });
export const getSupplierBill = (id: number) => call<SupplierBillDetail | null>("get_supplier_bill", { id });
export const createSupplierBill = (input: SupplierBillInput) =>
  call<SupplierBillDetail>("create_supplier_bill", { input });
export const updateSupplierBill = (id: number, input: SupplierBillInput) =>
  call<SupplierBillDetail>("update_supplier_bill", { id, input });
export const deleteSupplierBill = (id: number) => call<void>("delete_supplier_bill", { id });
/** A warning only: this supplier already has a bill with this number. */
export const checkDuplicateSupplierBillNumber = (supplierId: number, billNumber: string, excludeId?: number) =>
  call<DuplicateBillCheck>("check_duplicate_supplier_bill_number", { supplierId, billNumber, excludeId: excludeId ?? null });
/** `dataBase64` is the file's bytes as base64 text, without a "data:" prefix. */
export const addSupplierBillFile = (billId: number, fileName: string, dataBase64: string) =>
  call<SupplierBillFileInfo>("add_supplier_bill_file", { billId, fileName, dataBase64 });
export const removeSupplierBillFile = (fileId: number) => call<void>("remove_supplier_bill_file", { fileId });
/** A photo as a data: URL to show in the app (photos only). */
export const getSupplierBillFilePreview = (fileId: number) => call<string>("get_supplier_bill_file_preview", { fileId });
/** Opens a PDF or Word file (or a photo) in the program Windows uses for it. */
export const openSupplierBillFile = (fileId: number) => call<void>("open_supplier_bill_file", { fileId });
export const getSupplierBillsSummary = () => call<SupplierBillsSummary>("get_supplier_bills_summary");

// Supplier payments
export const listSupplierPayments = (filter: SupplierPaymentFilter = {}) =>
  call<SupplierPaymentListItem[]>("list_supplier_payments", { filter });
export const getSupplierPayment = (id: number) =>
  call<SupplierPaymentWithAllocations | null>("get_supplier_payment", { id });
export const createSupplierPayment = (input: SupplierPaymentInput) =>
  call<SupplierPaymentWithAllocations>("create_supplier_payment", { input });
export const updateSupplierPayment = (id: number, input: SupplierPaymentInput) =>
  call<SupplierPaymentWithAllocations>("update_supplier_payment", { id, input });
export const deleteSupplierPayment = (id: number) => call<void>("delete_supplier_payment", { id });
export const getNextSupplierPaymentNumber = () => call<string>("get_next_supplier_payment_number");
/** The supplier's bills a payment can be applied to. When editing, pass the payment's id. */
export const getUnpaidBillsForSupplier = (supplierId: number, excludePaymentId?: number) =>
  call<UnpaidBill[]>("get_unpaid_bills_for_supplier", { supplierId, excludePaymentId: excludePaymentId ?? null });
export const getSupplierPaymentsSummary = () => call<SupplierPaymentsSummary>("get_supplier_payments_summary");
export const getSupplierPaymentMessage = (id: number) =>
  call<SupplierPaymentMessage>("get_supplier_payment_message", { id });
/** Opens the supplier's WhatsApp chat with the message typed in and marks it sent; the owner presses Send there. */
export const openSupplierPaymentWhatsApp = (id: number) =>
  call<SupplierPaymentMessage>("open_supplier_payment_whatsapp", { id });

// Rentals
export const listRentalPlaces = () => call<PlaceListItem[]>("list_rental_places");
export const getRentalPlace = (id: number) => call<PlaceDetail | null>("get_rental_place", { id });
export const createRentalPlace = (input: PlaceInput) => call<PlaceDetail>("create_rental_place", { input });
export const updateRentalPlace = (id: number, input: PlaceInput) =>
  call<PlaceDetail>("update_rental_place", { id, input });
export const deleteRentalPlace = (id: number) => call<void>("delete_rental_place", { id });

export const listRentalTenants = (includeMovedOut = false) =>
  call<TenantListItem[]>("list_rental_tenants", { includeMovedOut });
export const getRentalTenant = (id: number) => call<TenantDetail | null>("get_rental_tenant", { id });
export const createRentalTenant = (input: TenantInput) => call<TenantDetail>("create_rental_tenant", { input });
export const updateRentalTenant = (id: number, input: TenantInput) =>
  call<TenantDetail>("update_rental_tenant", { id, input });
/** A date marks the tenant as moved out; null moves them back in. */
export const setRentalTenantMovedOut = (id: number, movedOutDate: string | null) =>
  call<TenantDetail>("set_rental_tenant_moved_out", { id, movedOutDate });
export const deleteRentalTenant = (id: number) => call<void>("delete_rental_tenant", { id });

/** `month` is YYYY-MM. */
export const getRentMonthOverview = (month: string) => call<MonthOverview>("get_rent_month_overview", { month });
export const markRentPaid = (input: MarkPaidInput) => call<void>("mark_rent_paid", { input });
export const undoRentPaid = (tenantId: number, month: string) => call<void>("undo_rent_paid", { tenantId, month });
export const getRentReminder = (tenantId: number, month: string) =>
  call<RentReminder>("get_rent_reminder", { tenantId, month });
/** Opens the tenant's WhatsApp chat with the reminder typed in; the owner presses Send there. */
export const openRentReminder = (tenantId: number, month: string) =>
  call<RentReminder>("open_rent_reminder", { tenantId, month });

/** The tenant's last 12 months up to this month, newest first, paid or not. */
export const getTenantRentHistory = (tenantId: number) => call<RentHistoryRow[]>("get_tenant_rent_history", { tenantId });

export const getRentReminderHistory = (tenantId: number, month: string) =>
  call<ReminderEntry[]>("get_rent_reminder_history", { tenantId, month });

export const addRentalFile =(ownerKind: RentalOwnerKind, ownerId: number, fileName: string, dataBase64: string) =>
  call<RentalFileInfo>("add_rental_file", { ownerKind, ownerId, fileName, dataBase64 });
export const removeRentalFile = (fileId: number) => call<void>("remove_rental_file", { fileId });
export const getRentalFilePreview = (fileId: number) => call<string>("get_rental_file_preview", { fileId });
export const openRentalFile = (fileId: number) => call<void>("open_rental_file", { fileId });

// Reminders
export const listReminders = (tab: ReminderTab) => call<Reminder[]>("list_reminders", { tab });
/** The reminders the top banner shows now. */
export const getReminderBanner = () => call<Reminder[]>("get_reminder_banner");
export const getRemindersForRecord = (linkKind: ReminderLinkKind, linkId: number) =>
  call<Reminder[]>("get_reminders_for_record", { linkKind, linkId });
export const createReminder = (input: ReminderInput) => call<Reminder>("create_reminder", { input });
export const updateReminder = (id: number, input: ReminderInput) => call<Reminder>("update_reminder", { id, input });
export const deleteReminder = (id: number) => call<void>("delete_reminder", { id });
export const markReminderDone = (id: number) => call<Reminder>("mark_reminder_done", { id });
export const markReminderNotDone = (id: number) => call<Reminder>("mark_reminder_not_done", { id });
/** Take a reminder off the banner (true) or put it back (false). */
export const setReminderDismissed = (id: number, dismissed: boolean) =>
  call<Reminder>("set_reminder_dismissed", { id, dismissed });

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

// Employees and payroll
export const listEmployees = () => call<EmployeeListItem[]>("list_employees");
export const getEmployee = (id: number) => call<EmployeeDetail | null>("get_employee", { id });
export const createEmployee = (input: EmployeeInput) => call<EmployeeDetail>("create_employee", { input });
export const updateEmployee = (id: number, input: EmployeeInput) => call<EmployeeDetail>("update_employee", { id, input });
export const deleteEmployee = (id: number) => call<void>("delete_employee", { id });
export const markEmployeeLeft = (id: number, leftOn: string) => call<EmployeeDetail>("mark_employee_left", { id, leftOn });
export const rejoinEmployee = (id: number, joinedOn: string) => call<EmployeeDetail>("rejoin_employee", { id, joinedOn });
/** Other employees with the same name, for a warning only. */
export const findEmployeesByName = (name: string, excludeId?: number) =>
  call<EmployeeListItem[]>("find_employees_by_name", { name, excludeId: excludeId ?? null });
export const addEmployeeFile = (employeeId: number, fileName: string, dataBase64: string) =>
  call<EmployeeFileInfo>("add_employee_file", { employeeId, fileName, dataBase64 });
export const removeEmployeeFile = (fileId: number) => call<void>("remove_employee_file", { fileId });
export const getEmployeeFilePreview = (fileId: number) => call<string>("get_employee_file_preview", { fileId });
export const openEmployeeFile = (fileId: number) => call<void>("open_employee_file", { fileId });
/** The last 12 months up to this month, newest first. */
export const getEmployeePayHistory = (employeeId: number) => call<PayMonthSummary[]>("get_employee_pay_history", { employeeId });
export const getPaySheet = (month: string) => call<PaySheet>("get_pay_sheet", { month });
export const savePaySheet = (month: string, rows: PaySheetEntry[]) => call<PaySheet>("save_pay_sheet", { month, rows });
export const getPayMonth = (employeeId: number, month: string) => call<PayMonthDetail>("get_pay_month", { employeeId, month });
export const savePayMonth = (employeeId: number, month: string, input: PayMonthInput) =>
  call<PayMonthDetail>("save_pay_month", { employeeId, month, input });
export const deletePayMonth = (employeeId: number, month: string) => call<void>("delete_pay_month", { employeeId, month });
export const createEmployeePayment = (input: EmployeePaymentInput) => call<PayMonthDetail>("create_employee_payment", { input });
export const updateEmployeePayment = (id: number, input: EmployeePaymentInput) =>
  call<PayMonthDetail>("update_employee_payment", { id, input });
export const deleteEmployeePayment = (id: number) => call<void>("delete_employee_payment", { id });
/** Advances and salary handed over between two dates (YYYY-MM-DD). */
export const listWagePayments = (from: string, to: string) => call<EmployeePayment[]>("list_wage_payments", { from, to });
