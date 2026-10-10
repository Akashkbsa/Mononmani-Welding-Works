import { useState } from "react";
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
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 h-9 rounded-md text-sm transition-colors ${
        active ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <Icon className={`w-4 h-4 ${active ? "text-orange-600" : "text-slate-400"}`} />
      {label}
    </button>
  );
}

function App() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <ToastProvider>
      <div className="h-full flex">
        <aside className="w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="px-5 py-5">
            <div className="text-[15px] font-semibold text-slate-900 leading-tight">Mononmani</div>
            <div className="text-xs text-slate-500">Welding Works</div>
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
