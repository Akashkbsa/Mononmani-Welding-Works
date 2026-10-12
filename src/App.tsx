import { useEffect, useState } from "react";
import { getBackupStatus } from "./services/api";
import { CreditCard, FileText, LayoutDashboard, Settings, Users } from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ui";
import BrandMark from "./components/BrandMark";
import DashboardPage from "./pages/DashboardPage";
import InvoicesPage from "./pages/InvoicesPage";
import PaymentsPage from "./pages/PaymentsPage";
import CustomersPage from "./pages/CustomersPage";
import SettingsPage from "./pages/SettingsPage";

export type Page = "dashboard" | "invoices" | "payments" | "customers" | "settings";

const NAV: { id: Page; label: string; icon: typeof FileText }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "customers", label: "Customers", icon: Users },
];

function NavButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  label: string;
  badge?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`w-full flex items-center gap-3 px-3 h-9 rounded-md text-sm transition-[background-color,color,box-shadow] duration-200 ${
        active
          ? "bg-white/10 text-white font-medium shadow-[inset_3px_0_0_var(--color-arc-500)]"
          : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon className={`w-4 h-4 ${active ? "text-white" : "text-slate-400"}`} />
      {label}
      {badge && <span className="ml-auto h-2 w-2 rounded-full bg-amber-500" title="Backup due" />}
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

  // Reminds the user (a dot on Settings) when something is not backed up yet.
  useEffect(() => {
    getBackupStatus()
      .then((s) => setBackupDue(s.connected && (s.pending.any || !s.last_success)))
      .catch(() => setBackupDue(false));
  }, [page]);

  return (
    <ToastProvider>
      <div className="h-full flex">
        <aside className="w-60 shrink-0 bg-ink-900 flex flex-col">
          <div className="px-4 py-5 mb-3 border-b border-white/10 flex items-center gap-3">
            <BrandMark className="h-9 w-9 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white leading-tight">Mononmani</div>
              <div className="text-xs text-slate-400">Welding Works</div>
            </div>
          </div>
          <nav className="flex-1 px-3 space-y-0.5">
            {NAV.map((item) => (
              <NavButton
                key={item.id}
                active={page === item.id}
                onClick={() => setPage(item.id)}
                icon={item.icon}
                label={item.label}
              />
            ))}
          </nav>
          <div className="px-3 pb-3">
            <NavButton
              active={page === "settings"}
              onClick={() => setPage("settings")}
              icon={Settings}
              label="Settings"
              badge={backupDue}
            />
          </div>
          <div className="px-5 py-3 border-t border-white/10 text-xs text-slate-400 flex justify-between">
            <span>Financial year</span>
            <span className="tabular text-slate-200">{financialYear()}</span>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-8 py-6">
            <div key={page} className="mww-page">
              <ErrorBoundary>
                {page === "dashboard" && <DashboardPage onNavigate={setPage} />}
                {page === "invoices" && <InvoicesPage />}
                {page === "payments" && <PaymentsPage />}
                {page === "customers" && <CustomersPage />}
                {page === "settings" && <SettingsPage />}
              </ErrorBoundary>
            </div>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}

export default App;
