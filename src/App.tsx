import { useEffect, useState } from "react";
import { getBackupStatus } from "./services/api";
import { CreditCard, FileText, LayoutDashboard, Settings, Users } from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ui";
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
      className={`w-full flex items-center gap-3 px-3 h-9 rounded-md text-sm transition-colors border-l-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 ${
        active
          ? "border-orange-600 bg-orange-50 text-slate-900 font-medium"
          : "border-transparent text-slate-700 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <Icon className={`w-4 h-4 ${active ? "text-orange-700" : "text-slate-500"}`} />
      {label}
      {badge && <span className="ml-auto h-2 w-2 rounded-full bg-amber-500" title="Backup due" />}
    </button>
  );
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
        <aside className="w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="px-4 py-4 mb-3 border-b border-slate-200 flex items-center gap-2.5">
            <div className="h-8 w-8 shrink-0 rounded-md bg-orange-600 text-white grid place-items-center text-xs font-bold">
              MW
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 leading-tight">Mononmani</div>
              <div className="text-xs text-slate-600">Welding Works</div>
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
          <div className="px-3 pb-4">
            <NavButton
              active={page === "settings"}
              onClick={() => setPage("settings")}
              icon={Settings}
              label="Settings"
              badge={backupDue}
            />
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-8 py-8">
            <ErrorBoundary key={page}>
              {page === "dashboard" && <DashboardPage onNavigate={setPage} />}
              {page === "invoices" && <InvoicesPage />}
              {page === "payments" && <PaymentsPage />}
              {page === "customers" && <CustomersPage />}
              {page === "settings" && <SettingsPage />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}

export default App;
