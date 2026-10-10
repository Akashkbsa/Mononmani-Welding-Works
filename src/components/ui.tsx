import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";

/* ---------- Buttons ---------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerText";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  dangerText: "text-red-600 hover:bg-red-50 hover:text-red-700",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: React.ReactNode;
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  loading,
  children,
  className = "",
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const sizing = size === "sm" ? "h-8 px-3 text-[13px] gap-1.5" : "h-9 px-4 text-sm gap-2";
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed ${sizing} ${buttonStyles[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ---------- Form fields ---------- */

export const inputClass =
  "w-full h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100 disabled:text-slate-500";

export const textareaClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className = "", children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-2.5 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

/* ---------- Layout pieces ---------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`bg-white border border-slate-200 rounded-lg ${className}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  note,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "red";
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular mt-0.5 ${tone === "red" ? "text-red-700" : "text-slate-900"}`}>
        {value}
      </div>
      {note && <div className="text-xs text-slate-500 mt-0.5">{note}</div>}
    </>
  );
  return onClick ? (
    <button
      onClick={onClick}
      className="text-left bg-white border border-slate-200 rounded-lg px-4 py-3 hover:border-slate-300 hover:bg-slate-50"
    >
      {body}
    </button>
  ) : (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">{body}</div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-slate-900">{children}</h3>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="py-14 flex items-center justify-center gap-2 text-sm text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label}
    </div>
  );
}

export function Alert({ children, tone = "error" }: { children: React.ReactNode; tone?: "error" | "info" }) {
  const styles =
    tone === "error" ? "bg-red-50 border-red-200 text-red-800" : "bg-slate-50 border-slate-200 text-slate-700";
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${styles}`}>
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/* ---------- Badges ---------- */

type Tone = "neutral" | "green" | "amber" | "red" | "blue";

const toneStyles: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-700",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${toneStyles[tone]}`}>
      {children}
    </span>
  );
}

const paymentStatusTone: Record<string, Tone> = {
  PAID: "green",
  "PARTIALLY PAID": "blue",
  UNPAID: "amber",
  OVERDUE: "red",
  DRAFT: "neutral",
  CANCELLED: "neutral",
};

const paymentStatusLabel: Record<string, string> = {
  PAID: "Paid",
  "PARTIALLY PAID": "Part paid",
  UNPAID: "Unpaid",
  OVERDUE: "Overdue",
  DRAFT: "Draft",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={paymentStatusTone[status] ?? "neutral"}>{paymentStatusLabel[status] ?? status}</Badge>;
}

/* ---------- Modal ---------- */

interface ModalProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl";
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

const modalWidths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };

// Open modals, newest last, so Escape only closes the one on top.
const openModals: number[] = [];
let modalCounter = 0;

export function Modal({ title, subtitle, onClose, size = "md", footer, headerActions, children }: ModalProps) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [id] = useState(() => ++modalCounter);

  useEffect(() => {
    openModals.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openModals[openModals.length - 1] === id) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(id), 1);
    };
  }, [id]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-6">
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${modalWidths[size]} max-h-full flex flex-col bg-white rounded-lg shadow-xl`}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 truncate">{title}</h2>
            {subtitle && <div className="text-sm text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 -mr-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

interface ConfirmProps {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/** Asks before a destructive action and shows the backend's reason if it is refused. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={run} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-700">
        <div>{message}</div>
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}

/* ---------- Toast ---------- */

interface ToastState {
  id: number;
  message: string;
  tone: "success" | "error";
}

const ToastContext = createContext<(message: string, tone?: "success" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const show = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.tone === "error" ? 6000 : 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm">
          <div
            className={`flex items-start gap-2 rounded-md px-4 py-3 text-sm shadow-lg ${
              toast.tone === "success" ? "bg-slate-900 text-white" : "bg-red-600 text-white"
            }`}
          >
            {toast.tone === "success" ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
