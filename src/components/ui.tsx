import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, Check, CheckCircle2, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";

/* ---------- Motion helpers ---------- */

/**
 * Keeps something mounted for a moment after it is closed, so it can animate away.
 * Render it while `mounted` is true and mark it `data-state="closed"` while `closing` is true.
 */
export function usePresence(open: boolean, exitMs = 160) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);
  return { mounted: open || mounted, closing: !open && mounted };
}

/**
 * When a dialog is removed, leaves a see-through copy of it behind that fades away, so closing is
 * as soft as opening no matter how the parent closed it. The copy cannot be clicked or focused.
 */
function useDialogGhost(ref: React.RefObject<HTMLElement | null>) {
  const alive = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    const node = ref.current;
    return () => {
      alive.current = false;
      // In development React unmounts and remounts straight away; only a real removal stays dead.
      queueMicrotask(() => {
        if (alive.current || !node) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const ghost = node.cloneNode(true) as HTMLElement;
        ghost.classList.add("mww-ghost");
        ghost.setAttribute("aria-hidden", "true");
        ghost.setAttribute("inert", "");
        ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
        document.body.appendChild(ghost);
        const remove = () => ghost.remove();
        ghost.addEventListener("animationend", (e) => {
          if (e.target === ghost) remove();
        });
        window.setTimeout(remove, 800);
      });
    };
  }, [ref]);
}

/* ---------- Buttons ---------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerText";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-slate-300 disabled:shadow-none",
  secondary: "bg-white text-slate-700 border border-slate-300 shadow-sm hover:bg-slate-50 hover:border-slate-400 disabled:text-slate-400 disabled:shadow-none",
  ghost: "text-brand-700 hover:bg-brand-50 disabled:text-slate-300",
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
      className={`inline-flex items-center justify-center mww-btn rounded-md font-medium whitespace-nowrap disabled:cursor-not-allowed ${sizing} ${buttonStyles[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ---------- Form fields ---------- */

export const inputClass =
  "w-full h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100 disabled:text-slate-500";

export const textareaClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

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
        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600"
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

/* ---------- Searchable select ---------- */

export interface SearchOption {
  id: number;
  label: string;
  /** Second line under the label, e.g. phone and GSTIN. */
  detail?: string;
  /** Everything a person might type to find it. */
  search: string;
}

/**
 * A select you can type into. Click it (or Tab to it) and start typing; every word typed must
 * appear somewhere in an option. Arrow keys move, Enter picks, Escape closes the list only.
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  emptyText = "Nothing matches. Try a different word.",
  fallbackLabel,
  disabled,
  ariaLabel,
}: {
  options: SearchOption[];
  value: number | null;
  onChange: (id: number) => void;
  placeholder?: string;
  emptyText?: string;
  /** Shown when nothing is selected but the record still has a name (e.g. a deleted customer). */
  fallbackLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.id === value);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = useMemo(
    () => (terms.length === 0 ? options : options.filter((o) => terms.every((t) => o.search.toLowerCase().includes(t)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, query]
  );

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (open) (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const { mounted, closing } = usePresence(open, 160);

  // Clear what was typed only after the list has finished leaving, so it does not flicker.
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setQuery(""), 180);
    return () => window.clearTimeout(timer);
  }, [open]);

  const choose = (o: SearchOption) => {
    onChange(o.id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => Math.max(0, Math.min(filtered.length - 1, a + step)));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    } else if (e.key === "Escape" && open) {
      // Close the list only; the dialog behind stays open.
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <input
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        className={`${inputClass} pr-8`}
        value={open ? query : selected?.label ?? fallbackLabel ?? ""}
        placeholder={open && selected ? selected.label : placeholder}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      {mounted && (
        <ul
          ref={listRef}
          role="listbox"
          data-state={closing ? "closed" : "open"}
          className="mww-popover absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">{emptyText}</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={o.id === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  i === active ? "bg-brand-50" : ""
                } ${o.id === value ? "font-medium text-brand-700" : "text-slate-800"}`}
              >
                <div>{o.label}</div>
                {o.detail && <div className="text-xs font-normal text-slate-500">{o.detail}</div>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
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
    <div className="flex items-end justify-between gap-4 mb-5 pb-4 border-b border-slate-200">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  className = "",
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div style={style} className={`bg-white border border-slate-200 rounded-lg shadow-card ${className}`}>
      {children}
    </div>
  );
}

/** A row of key figures in one card, divided by hairlines. */
export function StatStrip({ children, cols }: { children: React.ReactNode; cols: 3 | 4 }) {
  return (
    <Card className={`grid ${cols === 4 ? "grid-cols-4" : "grid-cols-3"} divide-x divide-slate-200 overflow-hidden`}>
      {children}
    </Card>
  );
}

export function Stat({
  label,
  value,
  note,
  icon: Icon,
  tone = "default",
  onClick,
}: {
  label: string;
  value: string;
  note?: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** "attention" is for money still owed: the one place the arc colour marks a figure. */
  tone?: "default" | "attention";
  onClick?: () => void;
}) {
  const body = (
    <div className="flex items-start gap-3">
      {Icon && (
        <span
          className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md ${
            tone === "attention" ? "bg-arc-50 text-arc-600" : "bg-brand-50 text-brand-600"
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-600">{label}</div>
        <div className="mt-0.5 text-xl font-semibold tabular text-slate-900">{value}</div>
        {note && <div className="mt-0.5 text-xs text-slate-500">{note}</div>}
      </div>
    </div>
  );
  return onClick ? (
    <button onClick={onClick} className="px-5 py-4 text-left transition-colors hover:bg-brand-50/60">
      {body}
    </button>
  ) : (
    <div className="px-5 py-4">{body}</div>
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
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="py-14 text-center">
      {Icon && (
        <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="py-14 flex items-center justify-center gap-2 text-sm text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label}
    </div>
  );
}

/** A grey bar that shimmers while data loads. Give it the size of what will replace it. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`mww-skeleton ${className}`} />;
}

/** Placeholder rows shaped like a table body, so the page does not jump when data arrives. */
export function ListSkeleton({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="divide-y divide-slate-100">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 px-4 py-3.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 flex-1 max-w-xs" />
          <Skeleton className="ml-auto h-4 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

export function Alert({ children, tone = "error" }: { children: React.ReactNode; tone?: "error" | "info" }) {
  const styles =
    tone === "error" ? "bg-red-50 border-red-200 text-red-800" : "bg-slate-50 border-slate-200 text-slate-700";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${styles}`}
    >
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/* ---------- Tables ---------- */

/** Header row: tinted and sticky so column names stay visible while scrolling. */
export const theadClass = "sticky top-0 bg-slate-50 text-left text-xs font-semibold text-slate-600 border-b border-slate-200";

/** Clickable body row; the chevron cell darkens on hover to show it opens. */
export const rowClass =
  "group cursor-pointer transition-colors hover:bg-brand-50/60 focus-visible:bg-brand-50/60 focus-visible:outline-offset-[-2px]";

/**
 * Props that make a table row open with a click or with Enter/Space when it has keyboard focus.
 * Controls inside the row (a star, a button) keep their own keys.
 */
export function rowProps(onOpen: () => void) {
  return {
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
        e.preventDefault();
        onOpen();
      }
    },
  };
}

export function RowChevron() {
  return (
    <td className="w-8 pr-3 text-right">
      <ChevronRight className="inline h-4 w-4 text-slate-300 transition-colors group-hover:text-brand-600" />
    </td>
  );
}

/* ---------- Badges ---------- */

type Tone = "neutral" | "green" | "amber" | "red" | "blue";

const toneStyles: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  green: "bg-emerald-100 text-emerald-900",
  amber: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-800",
  blue: "bg-brand-100 text-brand-800",
};

/** Flat label for things that need a second look. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${toneStyles[tone]}`}>
      {children}
    </span>
  );
}

const paymentStatusLabel: Record<string, string> = {
  PAID: "Paid",
  "PARTIALLY PAID": "Part paid",
  UNPAID: "Unpaid",
  DRAFT: "Draft",
  CANCELLED: "Cancelled",
};

/**
 * Paid is finished work, so it reads as quiet text with a tick. Unpaid and part paid
 * are the ones to act on, so they get a flat colour block. Draft and cancelled stay muted.
 */
export function StatusBadge({ status }: { status: string }) {
  const label = paymentStatusLabel[status] ?? status;
  if (status === "PAID") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        {label}
      </span>
    );
  }
  if (status === "UNPAID") return <Badge tone="amber">{label}</Badge>;
  if (status === "PARTIALLY PAID") return <Badge tone="blue">{label}</Badge>;
  return <span className="text-xs text-slate-500">{label}</span>;
}

/* ---------- Modal ---------- */

interface ModalProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "wide" | "xl";
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

const modalWidths = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", wide: "max-w-6xl", xl: "max-w-6xl" };

// Open modals, newest last, so Escape only closes the one on top.
const openModals: number[] = [];
let modalCounter = 0;

export function Modal({ title, subtitle, onClose, size = "md", footer, headerActions, children }: ModalProps) {
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [id] = useState(() => ++modalCounter);
  const dialogRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useDialogGhost(rootRef);

  useEffect(() => {
    openModals.push(id);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    // Move focus into the dialog unless a field already took it (autoFocus).
    if (!dialogRef.current?.contains(document.activeElement)) (focusable()[0] ?? dialogRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== id) return;
      if (e.key === "Escape") {
        closeRef.current();
      } else if (e.key === "Tab") {
        // Keep Tab inside the dialog.
        const items = focusable();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(id), 1);
      previouslyFocused?.focus?.();
    };
  }, [id]);

  return (
    <div ref={rootRef} className="mww-backdrop fixed inset-0 z-40 flex items-center justify-center bg-ink-900/50 p-6">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`mww-dialog w-full ${modalWidths[size]} max-h-full flex flex-col bg-white rounded-lg shadow-xl`}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-900 truncate tracking-tight">{title}</h2>
            {subtitle && <div className="text-sm text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 -mr-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
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
  /** Label of the button that backs out; defaults to "Cancel". */
  cancelLabel?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/** Asks before a destructive action and shows the backend's reason if it is refused. */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = "Cancel", onConfirm, onClose }: ConfirmProps) {
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
          <Button onClick={onClose}>{cancelLabel}</Button>
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

/**
 * Stops a form dialog from throwing away typed work. Close it through `requestClose`: when
 * the user has changed something, a "Discard your changes?" question comes first.
 *
 * Mark the form dirty with `markDirty` (typing in any field does this through `onChangeCapture`
 * on the form's wrapper; buttons that change the form call it themselves), and render
 * `confirm` next to the dialog.
 */
export function useDiscardGuard(onClose: () => void) {
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);
  const requestClose = useCallback(() => {
    if (dirty) setAsking(true);
    else onClose();
  }, [dirty, onClose]);
  const confirm = asking ? (
    <ConfirmDialog
      title="Discard your changes?"
      message="What you have entered on this form will be lost."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      onConfirm={async () => onClose()}
      onClose={() => setAsking(false)}
    />
  ) : null;
  return { markDirty, requestClose, confirm };
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
  const [leaving, setLeaving] = useState(false);

  const show = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    setLeaving(false);
    const hold = toast.tone === "error" ? 6000 : 3000;
    const leave = window.setTimeout(() => setLeaving(true), hold);
    const remove = window.setTimeout(() => setToast(null), hold + 180);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(remove);
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* The live region is always present so screen readers announce what appears in it. */}
      <div className="fixed bottom-5 right-5 z-50 max-w-sm" aria-live="polite">
        {toast && (
          <div
            key={toast.id}
            data-state={leaving ? "closed" : "open"}
            role={toast.tone === "error" ? "alert" : "status"}
            className={`mww-toast flex items-start gap-2 rounded-md px-4 py-3 text-sm shadow-lg ${
              toast.tone === "success" ? "bg-ink-800 text-white" : "bg-red-600 text-white"
            }`}
          >
            {toast.tone === "success" ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-arc-400" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
