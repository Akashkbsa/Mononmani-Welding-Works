import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, CreditCard, House, Plus, ReceiptText, Wallet } from "lucide-react";
import type { Page } from "../App";
import { InvoiceListItem } from "../types/invoice";
import { PaymentListItem, PaymentsSummary } from "../types/payment";
import { SupplierBillListItem, SupplierBillsSummary } from "../types/supplierBill";
import { SupplierPaymentListItem } from "../types/supplierPayment";
import { QuotationListItem } from "../types/quotation";
import { MonthOverview } from "../types/rental";
import {
  getPaymentsSummary,
  getRentMonthOverview,
  getSupplierBillsSummary,
  listInvoices,
  listPayments,
  listQuotations,
  listSupplierBills,
  listSupplierPayments,
  printInvoice,
} from "../services/api";
import { ageLabel, currentMonth, daysSince, errorMessage, formatDate, formatMoney, todayISO } from "../lib/format";
import { ageInDays, compactMoney, lastMonths, monthlySums, topByName } from "../lib/dashboardStats";
import { Alert, Button, Card, PageHeader, SectionTitle, Skeleton, useToast } from "../components/ui";
import { BarChart, ProgressBar, Segment, SegmentBar, SharePart, ShareRing, Sparkline } from "../components/dashboard/charts";
import { ListCard, ListRow } from "../components/dashboard/ListCard";
import InvoiceFormModal from "../components/invoices/InvoiceFormModal";
import InvoiceDetailsModal from "../components/invoices/InvoiceDetailsModal";
import PaymentFormModal from "../components/payments/PaymentFormModal";
import { useReminders } from "../components/reminders/RemindersContext";
import { usePageShortcuts } from "../lib/usePageShortcuts";

// The first dashboard load of a session gets one gentle reveal. Coming back to the dashboard, or
// reloading its data after a save, never replays it: people see this screen all day.
let dashboardRevealed = false;

const SHOWN = 5;
const MONTHS = 6;

/** Steel shades for the parts of a ring, darkest first; "Others" is grey. */
const RING_COLOURS = [
  { stroke: "stroke-brand-800", dot: "bg-brand-800" },
  { stroke: "stroke-brand-600", dot: "bg-brand-600" },
  { stroke: "stroke-brand-500", dot: "bg-brand-500" },
  { stroke: "stroke-brand-200", dot: "bg-brand-200" },
  { stroke: "stroke-brand-100", dot: "bg-brand-100" },
];
const OTHERS = { stroke: "stroke-slate-300", dot: "bg-slate-300" };

interface Data {
  summary: PaymentsSummary;
  invoices: InvoiceListItem[];
  payments: PaymentListItem[];
  bills: SupplierBillListItem[];
  billsSummary: SupplierBillsSummary | null;
  supplierPayments: SupplierPaymentListItem[];
  quotations: QuotationListItem[];
  rent: MonthOverview | null;
}

/** Unpaid money split by age: up to 30 days, 31 to 90, over 90. Steel, amber, red. */
function ageSegments(items: { date: string; amount: number }[], today: string): Segment[] {
  const parts = [
    { label: "Up to 30 days", amount: 0, color: "bg-brand-500" },
    { label: "31 to 90 days", amount: 0, color: "bg-amber-400" },
    { label: "Over 90 days", amount: 0, color: "bg-red-500" },
  ];
  for (const item of items) {
    const days = ageInDays(item.date, today);
    parts[days <= 30 ? 0 : days <= 90 ? 1 : 2].amount += item.amount;
  }
  return parts;
}

/** The first five by amount and the rest as "Others", coloured for a ring. */
function ringParts(items: { name: string; amount: number }[]): SharePart[] {
  const top = topByName(items, SHOWN);
  const total = items.reduce((s, i) => s + i.amount, 0);
  const rest = Math.round((total - top.reduce((s, t) => s + t.amount, 0)) * 100) / 100;
  const parts: SharePart[] = top.map((t, i) => ({ label: t.name, amount: t.amount, ...RING_COLOURS[i] }));
  if (rest > 0.5) parts.push({ label: "Others", amount: rest, ...OTHERS });
  return parts;
}

/** 1 April of the current financial year, as YYYY-MM-DD. */
function financialYearStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** "₹24,94,720.93" with the paise set smaller, so the rupees read first. Same figure, same format. */
function Amount({ value }: { value: number }) {
  const text = formatMoney(value);
  const dot = text.lastIndexOf(".");
  return (
    <span className="tabular">
      {dot > 0 ? text.slice(0, dot) : text}
      {dot > 0 && <span className="text-[0.6em] font-medium text-slate-400">{text.slice(dot)}</span>}
    </span>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  owed,
  visual,
  caption,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  /** Money still owed to the business: the one figure the arc colour marks. */
  owed?: boolean;
  visual: ReactNode;
  caption: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={caption}
      className="flex h-full min-w-0 flex-col rounded-lg border border-slate-200 bg-white px-4 py-4 text-left shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50/40 2xl:px-5"
    >
      <span className="flex min-w-0 items-center gap-2 text-[0.8rem] font-medium text-slate-600">
        <Icon className={`h-4 w-4 shrink-0 ${owed ? "text-arc-600" : "text-brand-600"}`} />
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-2 truncate text-[1.3rem] font-semibold leading-tight tracking-tight text-slate-900 2xl:text-[1.6rem]">{value}</span>
      <span className="mt-3 block">{visual}</span>
      <span className="mt-2 line-clamp-2 text-xs leading-snug text-slate-500">{caption}</span>
    </button>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading the dashboard" className="space-y-6">
      <div className="grid grid-cols-4 gap-6">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="space-y-3 p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-2 w-full" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2 space-y-4 p-5">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-60 w-full" />
        </Card>
        <Card className="space-y-4 p-5">
          <Skeleton className="h-4 w-32" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
      </div>
    </div>
  );
}

type ChartView = "cash" | "sales";

export default function DashboardPage({
  onNavigate,
  onOpenQuotation,
}: {
  onNavigate: (page: Page) => void;
  onOpenQuotation: (quotationId: number) => void;
}) {
  const toast = useToast();
  const { openRecord } = useReminders();
  const reveal = useRef(!dashboardRevealed).current;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | "invoice" | "payment">(null);
  const [viewingInvoiceId, setViewingInvoiceId] = useState<number | null>(null);
  const [chart, setChart] = useState<ChartView>("cash");
  const today = todayISO();

  const load = useCallback(async () => {
    // Each part loads on its own, so one slow or failing part does not blank the whole dashboard.
    const [summary, invoices, payments, bills, billsSummary, supplierPayments, quotations, rent] = await Promise.allSettled([
      getPaymentsSummary(),
      listInvoices(),
      listPayments(),
      listSupplierBills(),
      getSupplierBillsSummary(),
      listSupplierPayments(),
      listQuotations(),
      getRentMonthOverview(currentMonth()),
    ]);
    if (summary.status === "rejected" || invoices.status === "rejected" || payments.status === "rejected") {
      const failed = [summary, invoices, payments].find((r) => r.status === "rejected") as PromiseRejectedResult;
      setError(errorMessage(failed.reason));
      return;
    }
    const ok = <T,>(r: PromiseSettledResult<T>, fallback: T): T => (r.status === "fulfilled" ? r.value : fallback);
    setData({
      summary: summary.value,
      invoices: invoices.value,
      payments: payments.value,
      bills: ok(bills, []),
      billsSummary: ok(billsSummary, null),
      supplierPayments: ok(supplierPayments, []),
      quotations: ok(quotations, []),
      rent: ok(rent, null),
    });
    setError(null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data) dashboardRevealed = true;
  }, [data]);

  // Ctrl+N starts a new invoice, unless the user is typing or a window is already open.
  usePageShortcuts({ onNew: () => setCreating("invoice") });

  const view = useMemo(() => {
    if (!data) return null;
    const issued = data.invoices.filter((i) => i.status === "ISSUED");
    const waiting = issued.filter((i) => i.outstanding_amount > 0).sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
    const toPay = data.bills.filter((b) => b.outstanding_amount > 0).sort((a, b) => a.bill_date.localeCompare(b.bill_date));
    const months = lastMonths(today, MONTHS);
    const fyStart = financialYearStart(today);
    const lateInvoices = waiting.filter((i) => ageInDays(i.invoice_date, today) > 30);
    const lateBills = toPay.filter((b) => ageInDays(b.bill_date, today) > 30);
    const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
    return {
      waiting,
      toPay,
      months,
      invoiced: monthlySums(issued.map((i) => ({ date: i.invoice_date, amount: i.total_amount })), months),
      received: monthlySums(data.payments.map((p) => ({ date: p.payment_date, amount: p.amount_received })), months),
      paidOut: monthlySums(data.supplierPayments.map((p) => ({ date: p.payment_date, amount: p.amount_paid })), months),
      owedAges: ageSegments(waiting.map((i) => ({ date: i.invoice_date, amount: i.outstanding_amount })), today),
      oweAges: ageSegments(toPay.map((b) => ({ date: b.bill_date, amount: b.outstanding_amount })), today),
      customers: ringParts(issued.filter((i) => i.invoice_date >= fyStart).map((i) => ({ name: i.customer_name, amount: i.total_amount }))),
      suppliers: ringParts(data.bills.filter((b) => b.bill_date >= fyStart).map((b) => ({ name: b.supplier_name, amount: b.total_amount }))),
      attention: [
        {
          count: lateInvoices.length,
          text: "Invoices unpaid over 30 days",
          amount: sum(lateInvoices.map((i) => ({ amount: i.outstanding_amount }))),
          page: "invoices" as Page,
        },
        {
          count: lateBills.length,
          text: "Supplier bills over 30 days",
          amount: sum(lateBills.map((b) => ({ amount: b.outstanding_amount }))),
          page: "supplierBills" as Page,
        },
        {
          count: (data.rent?.rows ?? []).filter((r) => !r.paid).length,
          text: "Tenants yet to pay rent",
          amount: data.rent?.summary.pending ?? 0,
          page: "rentals" as Page,
        },
        {
          count: data.quotations.filter((q) => q.order_count === 0).length,
          text: "Quotations with no order yet",
          amount: null,
          page: "quotations" as Page,
        },
        {
          count: data.invoices.filter((i) => i.status === "DRAFT").length,
          text: "Draft invoices not issued",
          amount: null,
          page: "invoices" as Page,
        },
      ].filter((a) => a.count > 0),
    };
  }, [data, today]);

  const reveals = (i: number) => ({ className: reveal ? "mww-reveal" : "", style: { "--i": i } as React.CSSProperties });
  const fyLabel = (() => {
    const start = Number(financialYearStart(today).slice(0, 4));
    return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
  })();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          <>
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} title="New invoice (Ctrl+N)" onClick={() => setCreating("invoice")}>
              New invoice
            </Button>
            <Button onClick={() => setCreating("payment")}>Record payment</Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {!data || !view ? (
        error ? null : <DashboardSkeleton />
      ) : (
        <div className="space-y-6">
          {/* 1. The money position, each figure with a small picture of what is behind it. */}
          <div className={`grid grid-cols-4 gap-6 ${reveals(0).className}`} style={reveals(0).style}>
            <Kpi
              icon={Wallet}
              owed
              label="Customers owe you"
              value={<Amount value={data.summary.total_outstanding} />}
              visual={<SegmentBar parts={view.owedAges} />}
              caption={`${data.summary.unpaid_invoices_count} unpaid · ${compactMoney(view.owedAges[2].amount)} over 90 days`}
              onClick={() => onNavigate("invoices")}
            />
            <Kpi
              icon={CreditCard}
              label="Received this month"
              value={<Amount value={data.summary.received_this_month} />}
              visual={<Sparkline values={view.received} label={`Received in the last ${MONTHS} months`} />}
              caption={`${compactMoney(data.summary.invoiced_this_month)} invoiced this month`}
              onClick={() => onNavigate("payments")}
            />
            <Kpi
              icon={ReceiptText}
              label="You owe suppliers"
              value={<Amount value={data.billsSummary?.total_outstanding ?? 0} />}
              visual={<SegmentBar parts={view.oweAges} />}
              caption={`${data.billsSummary?.open_bills_count ?? 0} unpaid · ${compactMoney(view.oweAges[2].amount)} over 90 days`}
              onClick={() => onNavigate("supplierBills")}
            />
            <Kpi
              icon={House}
              label="Rent this month"
              value={data.rent && data.rent.rows.length > 0 ? <Amount value={data.rent.summary.collected} /> : "—"}
              visual={
                <ProgressBar
                  done={data.rent?.summary.collected ?? 0}
                  total={(data.rent?.summary.collected ?? 0) + (data.rent?.summary.pending ?? 0)}
                  label="Rent collected this month"
                />
              }
              caption={
                data.rent && data.rent.rows.length > 0
                  ? `${data.rent.summary.paid_count} of ${data.rent.summary.total_count} paid · ${compactMoney(data.rent.summary.pending)} to collect`
                  : "No tenants yet"
              }
              onClick={() => onNavigate("rentals")}
            />
          </div>

          {/* 2. The trend, and what to act on. */}
          <div className={`grid grid-cols-5 items-stretch gap-6 2xl:grid-cols-3 ${reveals(1).className}`} style={reveals(1).style}>
            <Card className="col-span-3 flex flex-col p-5 2xl:col-span-2">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">Last {MONTHS} months</h3>
                <div role="tablist" aria-label="Chart" className="flex rounded-md bg-slate-100 p-0.5 text-xs">
                  {(
                    [
                      ["cash", "Money in and out"],
                      ["sales", "Invoiced and received"],
                    ] as const
                  ).map(([id, text]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={chart === id}
                      onClick={() => setChart(id)}
                      className={`rounded px-2.5 py-1 font-medium transition-colors ${chart === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-3 flex gap-4 text-xs text-slate-600">
                {(chart === "cash"
                  ? [
                      ["bg-brand-600", "Received from customers"],
                      ["bg-slate-300", "Paid to suppliers"],
                    ]
                  : [
                      ["bg-brand-200", "Invoiced"],
                      ["bg-brand-600", "Received"],
                    ]
                ).map(([dot, text]) => (
                  <span key={text} className="inline-flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-sm ${dot}`} />
                    {text}
                  </span>
                ))}
              </div>
              <div className="min-h-0 flex-1">
                <BarChart
                  months={view.months}
                  label={chart === "cash" ? "Money received and paid by month" : "Invoiced and received by month"}
                  series={
                    chart === "cash"
                      ? [
                          { name: "Received", fill: "fill-brand-600", dot: "bg-brand-600", values: view.received },
                          { name: "Paid out", fill: "fill-slate-300", dot: "bg-slate-300", values: view.paidOut },
                        ]
                      : [
                          { name: "Invoiced", fill: "fill-brand-200", dot: "bg-brand-200", values: view.invoiced },
                          { name: "Received", fill: "fill-brand-600", dot: "bg-brand-600", values: view.received },
                        ]
                  }
                />
              </div>
            </Card>

            <Card className="col-span-2 flex flex-col p-5 2xl:col-span-1">
              <SectionTitle>Needs attention</SectionTitle>
              {view.attention.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center text-sm text-slate-600">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  All clear. Nothing needs your attention.
                </div>
              ) : (
                <ul className="-mx-2 space-y-1">
                  {view.attention.map((a) => (
                    <li key={a.text}>
                      <button
                        type="button"
                        onClick={() => onNavigate(a.page)}
                        className="group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-slate-50"
                      >
                        <span className="grid h-8 min-w-8 place-items-center rounded-md bg-amber-50 px-1.5 text-sm font-semibold tabular text-amber-800">
                          {a.count}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm leading-snug text-slate-800" title={a.text}>
                            {a.text}
                          </span>
                          {a.amount !== null && a.amount > 0 && <span className="block text-xs text-slate-500 tabular">{formatMoney(a.amount)}</span>}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-600" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* 3. Who the money comes from and goes to this financial year. */}
          <div className={`grid grid-cols-2 items-stretch gap-6 ${reveals(2).className}`} style={reveals(2).style}>
            <Card className="p-5">
              <SectionTitle
                action={
                  <Button size="sm" variant="ghost" onClick={() => onNavigate("customers")}>
                    Customers
                  </Button>
                }
              >
                Biggest customers, {fyLabel}
              </SectionTitle>
              <ShareRing parts={view.customers} centerLabel="Invoiced" empty="No invoices this financial year yet." />
            </Card>
            <Card className="p-5">
              <SectionTitle
                action={
                  <Button size="sm" variant="ghost" onClick={() => onNavigate("supplierBills")}>
                    Supplier bills
                  </Button>
                }
              >
                Biggest suppliers, {fyLabel}
              </SectionTitle>
              <ShareRing parts={view.suppliers} centerLabel="Billed" empty="No supplier bills this financial year yet." />
            </Card>
          </div>

          {/* 4. The oldest things to settle. */}
          <div className={`grid grid-cols-2 items-stretch gap-6 ${reveals(3).className}`} style={reveals(3).style}>
            <ListCard
              title="Invoices to chase, oldest first"
              actionLabel="All invoices"
              onAction={() => onNavigate("invoices")}
              empty="Nothing is waiting. Every issued invoice is paid."
              isEmpty={view.waiting.length === 0}
              note={view.waiting.length > SHOWN ? `Oldest ${SHOWN} of ${view.waiting.length} shown.` : undefined}
            >
              {view.waiting.slice(0, SHOWN).map((inv) => (
                <ListRow
                  key={inv.id}
                  title={inv.customer_name}
                  detail={`${inv.invoice_number} · ${formatDate(inv.invoice_date)}`}
                  right={formatMoney(inv.outstanding_amount)}
                  rightNote={ageLabel(inv.invoice_date)}
                  rightTone={daysSince(inv.invoice_date) > 30 ? "warn" : "default"}
                  onOpen={() => setViewingInvoiceId(inv.id)}
                />
              ))}
            </ListCard>
            <ListCard
              title="Supplier bills to pay, oldest first"
              actionLabel="All supplier bills"
              onAction={() => onNavigate("supplierBills")}
              empty="No supplier bills to pay."
              isEmpty={view.toPay.length === 0}
              note={view.toPay.length > SHOWN ? `Oldest ${SHOWN} of ${view.toPay.length} shown.` : undefined}
            >
              {view.toPay.slice(0, SHOWN).map((b) => (
                <ListRow
                  key={b.id}
                  title={b.supplier_name}
                  detail={`${b.bill_number} · ${formatDate(b.bill_date)}`}
                  right={formatMoney(b.outstanding_amount)}
                  rightNote={ageLabel(b.bill_date)}
                  rightTone={daysSince(b.bill_date) > 30 ? "warn" : "default"}
                  onOpen={() => openRecord("SUPPLIER_BILL", b.id)}
                />
              ))}
            </ListCard>
          </div>
        </div>
      )}

      {creating === "invoice" && (
        <InvoiceFormModal
          onClose={() => setCreating(null)}
          onSaved={async (saved, print) => {
            setCreating(null);
            toast(`Invoice ${saved.invoice.invoice_number} saved`);
            load();
            if (print) {
              try {
                await printInvoice(saved.invoice.id, "Original");
              } catch (err) {
                toast(errorMessage(err), "error");
              }
            }
          }}
        />
      )}
      {creating === "payment" && (
        <PaymentFormModal
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            toast("Payment recorded");
            load();
          }}
        />
      )}
      {viewingInvoiceId !== null && (
        <InvoiceDetailsModal invoiceId={viewingInvoiceId} onClose={() => setViewingInvoiceId(null)} onChanged={load} onOpenQuotation={onOpenQuotation} />
      )}
    </>
  );
}
