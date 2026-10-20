import { useCallback, useEffect, useRef, useState } from "react";
import { searchAll } from "../services/api";
import { SearchResult } from "../types/search";
import { ReminderLinkKind } from "../types/reminder";
import { Page } from "../App";

const KIND_LABELS: Record<string, string> = {
  COMPANY: "Customer / Supplier",
  INVOICE: "Invoice",
  PAYMENT: "Payment",
  PURCHASE_ORDER: "Purchase Order",
  QUOTATION: "Quotation",
  SUPPLIER_BILL: "Supplier Bill",
  SUPPLIER_PAYMENT: "Supplier Payment",
  EMPLOYEE: "Employee",
};

const OPEN_RECORD_KINDS = new Set<string>([
  "INVOICE", "PAYMENT", "PURCHASE_ORDER", "QUOTATION",
  "SUPPLIER_BILL", "SUPPLIER_PAYMENT", "COMPANY",
]);

/** True while the user is typing in a form field (not the search input itself). */
function isTypingElsewhere(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
}

function groupResults(results: SearchResult[]): { kind: string; items: SearchResult[] }[] {
  const map = new Map<string, SearchResult[]>();
  for (const r of results) {
    if (!map.has(r.kind)) map.set(r.kind, []);
    map.get(r.kind)!.push(r);
  }
  return Array.from(map.entries()).map(([kind, items]) => ({ kind, items }));
}

interface Props {
  onOpen: (kind: ReminderLinkKind, id: number) => void;
  onNavigate: (page: Page) => void;
}

export default function GlobalSearch({ onOpen, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setSearched(false);
    setActive(-1);
  }, []);

  // Ctrl+K opens
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        if (isTypingElsewhere(e.target)) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchAll(query.trim());
        setResults(res);
        setSearched(true);
        setActive(-1);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  const allItems = results;

  const openResult = useCallback((result: SearchResult) => {
    if (OPEN_RECORD_KINDS.has(result.kind)) {
      onOpen(result.kind as ReminderLinkKind, result.id);
    } else if (result.kind === "EMPLOYEE") {
      onNavigate("employees");
    }
    close();
  }, [onOpen, onNavigate, close]);

  // Arrow key navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((v) => Math.min(v + 1, allItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((v) => Math.max(v - 1, -1));
    } else if (e.key === "Enter" && active >= 0 && allItems[active]) {
      e.preventDefault();
      openResult(allItems[active]);
    }
  };

  if (!open) return null;

  const groups = groupResults(results);
  let itemIndex = 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

      {/* Panel */}
      <div className="relative w-full max-w-lg mx-4 rounded-xl bg-white shadow-2xl overflow-hidden">
        {/* Input row */}
        <div className="flex items-center border-b border-slate-200 px-4">
          <svg className="w-4 h-4 shrink-0 text-slate-400 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 py-4 text-sm bg-transparent outline-none placeholder-slate-400 text-slate-900"
            placeholder="Search invoices, customers, payments…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-slate-300 border-t-brand-500 rounded-full animate-spin shrink-0 ml-2" aria-hidden="true" />
          )}
          <kbd className="ml-3 text-xs text-slate-400 border border-slate-300 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* Results */}
        {query.trim().length >= 2 && (
          <div className="max-h-96 overflow-y-auto py-2">
            {searched && results.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No results for &ldquo;{query}&rdquo;</p>
            )}
            {groups.map((group) => (
              <div key={group.kind}>
                <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {KIND_LABELS[group.kind] ?? group.kind}
                </div>
                {group.items.map((item) => {
                  const idx = itemIndex++;
                  return (
                    <button
                      key={`${item.kind}-${item.id}`}
                      type="button"
                      className={`w-full text-left px-4 py-2 flex flex-col gap-0.5 transition-colors ${
                        active === idx ? "bg-brand-50 text-brand-800" : "hover:bg-slate-50 text-slate-800"
                      }`}
                      onClick={() => openResult(item)}
                      onMouseEnter={() => setActive(idx)}
                    >
                      <span className="text-sm font-medium leading-tight">{item.title}</span>
                      {item.subtitle && (
                        <span className="text-xs text-slate-500 leading-tight">{item.subtitle}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Footer hint */}
        {query.trim().length < 2 && (
          <div className="px-4 py-4 text-xs text-slate-400">
            Type at least 2 characters to search across all records.
          </div>
        )}
      </div>
    </div>
  );
}
