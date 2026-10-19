import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { getBackupStatus } from "./services/api";
import { BellRing, ClipboardList, CreditCard, FileCheck2, FileText, HandCoins, HardHat, House, LayoutDashboard, PanelLeftClose, PanelLeftOpen, ReceiptText, Settings, Users, FolderLock } from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ui";
import BrandMark from "./components/BrandMark";
import DashboardPage from "./pages/DashboardPage";
import { ReminderLinkKind } from "./types/reminder";
import ReminderBanner from "./components/reminders/ReminderBanner";
import BackupBanner from "./components/BackupBanner";
import { todayISO } from "./lib/format";
import { useSidebar } from "./lib/useSidebar";
import { RemindersContext } from "./components/reminders/RemindersContext";

// The dashboard opens first and is part of the main file. Every other screen is its own file,
// loaded in the background once the dashboard is up, so the app starts faster and switching
// screens never waits.
const pageLoaders = {
  invoices: () => import("./pages/InvoicesPage"),
  purchaseOrders: () => import("./pages/PurchaseOrdersPage"),
  quotations: () => import("./pages/QuotationsPage"),
  payments: () => import("./pages/PaymentsPage"),
  supplierBills: () => import("./pages/SupplierBillsPage"),
  supplierPayments: () => import("./pages/SupplierPaymentsPage"),
  rentals: () => import("./pages/RentalsPage"),
  employees: () => import("./pages/EmployeesPage"),
  reminders: () => import("./pages/RemindersPage"),
  customers: () => import("./pages/CustomersPage"),
  documents: () => import("./pages/DocumentVaultPage"),
  settings: () => import("./pages/SettingsPage"),
};
const InvoicesPage = lazy(pageLoaders.invoices);
const PurchaseOrdersPage = lazy(pageLoaders.purchaseOrders);
const QuotationsPage = lazy(pageLoaders.quotations);
const PaymentsPage = lazy(pageLoaders.payments);
const SupplierBillsPage = lazy(pageLoaders.supplierBills);
const SupplierPaymentsPage = lazy(pageLoaders.supplierPayments);
const RentalsPage = lazy(pageLoaders.rentals);
const EmployeesPage = lazy(pageLoaders.employees);
const RemindersPage = lazy(pageLoaders.reminders);
const CustomersPage = lazy(pageLoaders.customers);
const DocumentVaultPage = lazy(pageLoaders.documents);
const SettingsPage = lazy(pageLoaders.settings);

export type Page = "dashboard" | "invoices" | "quotations" | "purchaseOrders" | "payments" | "supplierBills" | "supplierPayments" | "rentals" | "employees" | "reminders" | "customers" | "documents" | "settings";

/** The menu in groups, in the order the work flows; a thin line separates the groups. */
const NAV_GROUPS: { id: Page; label: string; icon: typeof FileText }[][] = [
  [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "reminders", label: "Reminders", icon: BellRing },
  ],
  [
    { id: "quotations", label: "Quotations", icon: FileCheck2 },
    { id: "purchaseOrders", label: "Purchase orders", icon: ClipboardList },
    { id: "invoices", label: "Invoices", icon: FileText },
    { id: "payments", label: "Payments", icon: CreditCard },
  ],
  [
    { id: "supplierBills", label: "Supplier bills", icon: ReceiptText },
    { id: "supplierPayments", label: "Supplier payments", icon: HandCoins },
  ],
  [{ id: "customers", label: "Customers & suppliers", icon: Users }],
  [{ id: "employees", label: "Employees", icon: HardHat }],
  [{ id: "rentals", label: "Rentals", icon: House }],
  [{ id: "documents", label: "Document Vault", icon: FolderLock }],
];

function NavButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  label: string;
  badge?: boolean;
  /** Only the icon, for the closed sidebar; the name shows on hover and is read out. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={`relative w-full flex items-center gap-3 h-9 rounded-md text-sm transition-[background-color,color,box-shadow] duration-200 ${
        compact ? "justify-center px-0" : "px-3"
      } ${
        active
          ? "bg-white/10 text-white font-medium shadow-[inset_3px_0_0_var(--color-arc-500)]"
          : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${active ? "text-sky" : "text-slate-400"}`} aria-hidden="true" />
      {!compact && <span className="truncate">{label}</span>}
      {badge && (
        <span
          className={`h-2 w-2 rounded-full bg-amber-500 ${compact ? "absolute right-2 top-1.5" : "ml-auto"}`}
          title="Backups need attention"
        />
      )}
    </button>
  );
}


/** Indian financial year (April to March), the same one used in invoice numbers, e.g. "26-27". */
function financialYear(now = new Date()): string {
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [backupDue, setBackupDue] = useState(false);
  // Bumped after a backup (automatic or from the banner), so the Settings dot checks again.
  const [backupVersion, setBackupVersion] = useState(0);
  const backupChanged = useCallback(() => setBackupVersion((v) => v + 1), []);
  // An invoice another screen wants opened (for example from a purchase order); the Invoices page opens it once.
  const [openInvoiceId, setOpenInvoiceId] = useState<number | null>(null);
  // Same handoff for a quotation or a purchase order opened from the other one.
  const [openQuotationId, setOpenQuotationId] = useState<number | null>(null);
  const [openPurchaseOrderId, setOpenPurchaseOrderId] = useState<number | null>(null);
  const [openSupplierPaymentId, setOpenSupplierPaymentId] = useState<number | null>(null);

  const openQuotation = (quotationId: number) => {
    setOpenQuotationId(quotationId);
    setPage("quotations");
  };

  // Bumped after any reminder change so the banner at the top loads again.
  const [remindersVersion, setRemindersVersion] = useState(0);
  const remindersChanged = () => setRemindersVersion((v) => v + 1);

  // A record on a screen without its own handoff (payment, supplier bill, company, tenant, place) to open once.
  const [openOther, setOpenOther] = useState<{ kind: ReminderLinkKind; id: number } | null>(null);
  const otherId = (kind: ReminderLinkKind) => (openOther?.kind === kind ? openOther.id : null);
  const clearOther = () => setOpenOther(null);

  /** Go to the screen of a record a reminder is linked to, and open it there. */
  const openRecord = (kind: ReminderLinkKind, id: number) => {
    switch (kind) {
      case "INVOICE":
        setOpenInvoiceId(id);
        setPage("invoices");
        break;
      case "QUOTATION":
        openQuotation(id);
        break;
      case "PURCHASE_ORDER":
        setOpenPurchaseOrderId(id);
        setPage("purchaseOrders");
        break;
      case "SUPPLIER_PAYMENT":
        setOpenSupplierPaymentId(id);
        setPage("supplierPayments");
        break;
      case "PAYMENT":
        setOpenOther({ kind, id });
        setPage("payments");
        break;
      case "SUPPLIER_BILL":
        setOpenOther({ kind, id });
        setPage("supplierBills");
        break;
      case "COMPANY":
        setOpenOther({ kind, id });
        setPage("customers");
        break;
      case "TENANT":
      case "PLACE":
        setOpenOther({ kind, id });
        setPage("rentals");
        break;
    }
  };

  // A dot on Settings when backups need attention: Google Drive not connected, Drive almost full or
  // full, or changes not backed up since before today (the automatic backup has not managed it yet).
  useEffect(() => {
    getBackupStatus()
      .then((s) => {
        const backedUpToday = !!s.last_success && s.last_success.finished_at.slice(0, 10) >= todayISO();
        setBackupDue(!s.connected || s.drive_space !== "OK" || (s.pending.any && !backedUpToday));
      })
      .catch(() => setBackupDue(false));
  }, [page, backupVersion]);

  const sidebar = useSidebar();
  // Ctrl+B opens or closes the sidebar from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        sidebar.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebar.toggle]);

  // Fetch the other screens' files while the owner looks at the dashboard.
  useEffect(() => {
    const timer = window.setTimeout(() => Object.values(pageLoaders).forEach((load) => void load().catch(() => {})), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <ToastProvider>
      <RemindersContext.Provider value={{ changed: remindersChanged, openRecord }}>
      <div className="h-full flex">
        <aside
          aria-label="Main menu"
          className={`${
            sidebar.closed ? "w-14" : "w-60"
          } shrink-0 bg-ink-900 flex flex-col overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none`}
        >
          <div
            className={`mb-3 border-b border-white/10 flex items-center ${
              sidebar.closed ? "flex-col gap-2 px-2 py-3" : "gap-3 py-5 pl-4 pr-2"
            }`}
          >
            <BrandMark className={`${sidebar.closed ? "h-8 w-8" : "h-9 w-9"} shrink-0`} />
            {!sidebar.closed && (
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white leading-tight">Mononmani</div>
                <div className="text-xs text-slate-400">Welding Works</div>
              </div>
            )}
            <button
              type="button"
              onClick={sidebar.toggle}
              aria-expanded={!sidebar.closed}
              aria-label={sidebar.closed ? "Open the menu" : "Close the menu"}
              title={`${sidebar.closed ? "Open" : "Close"} the menu (Ctrl+B)`}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-brand-200"
            >
              {sidebar.closed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          <nav className={`flex-1 overflow-y-auto overflow-x-hidden scrollbar-none ${sidebar.closed ? "px-2" : "px-3"}`}>
            {NAV_GROUPS.map((group, i) => (
              <div key={i} className={`space-y-0.5 ${i > 0 ? "mt-2 border-t border-white/10 pt-2" : ""}`}>
                {group.map((item) => (
                  <NavButton
                    key={item.id}
                    active={page === item.id}
                    onClick={() => setPage(item.id)}
                    icon={item.icon}
                    label={item.label}
                    compact={sidebar.closed}
                  />
                ))}
              </div>
            ))}
          </nav>
          <div className={`pb-3 ${sidebar.closed ? "px-2" : "px-3"}`}>
            <NavButton
              active={page === "settings"}
              onClick={() => setPage("settings")}
              icon={Settings}
              label="Settings"
              badge={backupDue}
              compact={sidebar.closed}
            />
          </div>
          {sidebar.closed ? (
            <div className="py-3 border-t border-white/10 text-center text-[11px] tabular text-slate-400" title="Financial year">
              {financialYear()}
            </div>
          ) : (
            <div className="px-5 py-3 border-t border-white/10 text-xs text-slate-400 flex justify-between">
              <span>Financial year</span>
              <span className="tabular text-slate-200">{financialYear()}</span>
            </div>
          )}
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="@container mx-auto max-w-[120rem] px-4 py-5 sm:px-6 lg:px-10 lg:py-7">
            {page !== "reminders" && (
              // Floats at the top while the page scrolls, until Done, Snooze or Dismiss. The silver strip
              // behind it (cancelled out by the negative margin at rest) hides content scrolling past.
              <div className="sticky top-0 z-30 -mt-5 bg-canvas pt-5 lg:-mt-7 lg:pt-7">
                <ReminderBanner refreshKey={`${page}-${remindersVersion}`} onOpenAll={() => setPage("reminders")} />
              </div>
            )}
            <BackupBanner refreshKey={`${page}-${backupVersion}`} onChanged={backupChanged} onOpenSettings={() => setPage("settings")} />
            <div key={page} className="mww-page">
              <ErrorBoundary>
                <Suspense fallback={null}>
                {page === "dashboard" && <DashboardPage onNavigate={setPage} onOpenQuotation={openQuotation} />}
                {page === "invoices" && (
                  <InvoicesPage
                    openInvoiceId={openInvoiceId}
                    onOpenInvoiceHandled={() => setOpenInvoiceId(null)}
                    onOpenQuotation={openQuotation}
                  />
                )}
                {page === "quotations" && (
                  <QuotationsPage
                    openQuotationId={openQuotationId}
                    onOpenHandled={() => setOpenQuotationId(null)}
                    onOpenPurchaseOrder={(purchaseOrderId) => {
                      setOpenPurchaseOrderId(purchaseOrderId);
                      setPage("purchaseOrders");
                    }}
                  />
                )}
                {page === "purchaseOrders" && (
                  <PurchaseOrdersPage
                    openPurchaseOrderId={openPurchaseOrderId}
                    onOpenHandled={() => setOpenPurchaseOrderId(null)}
                    onOpenQuotation={openQuotation}
                    onOpenInvoice={(invoiceId) => {
                      setOpenInvoiceId(invoiceId);
                      setPage("invoices");
                    }}
                  />
                )}
                {page === "payments" && <PaymentsPage openId={otherId("PAYMENT")} onOpenHandled={clearOther} />}
                {page === "supplierBills" && (
                  <SupplierBillsPage
                    openId={otherId("SUPPLIER_BILL")}
                    onOpenHandled={clearOther}
                    onOpenPayment={(paymentId) => {
                      setOpenSupplierPaymentId(paymentId);
                      setPage("supplierPayments");
                    }}
                  />
                )}
                {page === "supplierPayments" && (
                  <SupplierPaymentsPage
                    openPaymentId={openSupplierPaymentId}
                    onOpenHandled={() => setOpenSupplierPaymentId(null)}
                  />
                )}
                {page === "employees" && <EmployeesPage />}
                {page === "rentals" && <RentalsPage openTenantId={otherId("TENANT")} openPlaceId={otherId("PLACE")} onOpenHandled={clearOther} />}
                {page === "reminders" && <RemindersPage onOpenRecord={openRecord} onChanged={remindersChanged} refreshKey={remindersVersion} />}
                {page === "customers" && <CustomersPage openId={otherId("COMPANY")} onOpenHandled={clearOther} />}
                {page === "documents" && <DocumentVaultPage />}
                {page === "settings" && <SettingsPage />}
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        </main>
      </div>
      </RemindersContext.Provider>
    </ToastProvider>
  );
}

export default App;
