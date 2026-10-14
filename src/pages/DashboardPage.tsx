import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CreditCard, House, Plus, ReceiptText, Wallet } from "lucide-react";
import type { Page } from "../App";
import { InvoiceListItem } from "../types/invoice";
import { PaymentListItem, PaymentsSummary } from "../types/payment";
import { SupplierBillListItem, SupplierBillsSummary } from "../types/supplierBill";
import { SupplierPaymentListItem } from "../types/supplierPayment";
import { QuotationListItem } from "../types/quotation";
import { MonthOverview } from "../types/rental";
import { Reminder } from "../types/reminder";
import {
  getPaymentsSummary,
  getRentMonthOverview,
  getSupplierBillsSummary,
  listInvoices,
  listPayments,
  listQuotations,
  listReminders,
  listSupplierBills,
  listSupplierPayments,
  printInvoice,
} from "../services/api";
import { ageLabel, currentMonth, daysSince, errorMessage, formatDate, formatMoney, monthTitle, todayISO } from "../lib/format";
import { ageBuckets, ageInDays, lastMonths, monthlySums, topByName } from "../lib/dashboardStats";
import { whenText } from "../lib/reminders";
import { Alert, Button, Card, PageHeader, SectionTitle, Skeleton, Stat, StatStrip, useToast } from "../components/ui";
import { HBars, MonthlyBars } from "../components/dashboard/charts";
import Donut from "../components/dashboard/Donut";
import { ListCard, ListRow } from "../components/dashboard/ListCard";
import InvoiceFormModal from "../components/invoices/InvoiceFormModal";
import InvoiceDetailsModal from "../components/invoices/InvoiceDetailsModal";
import PaymentFormModal from "../components/payments/PaymentFormModal";
import { useReminders } from "../components/reminders/RemindersContext";

// The first dashboard load of a session gets one gentle reveal. Coming back to the dashboard, or
// reloading its data after a save, never replays it: people see this screen all day.
let dashboardRevealed = false;

const SHOWN = 5;
const AGE_STYLE = [
  { stroke: "stroke-brand-600", dot: "bg-brand-600" },
  { stroke: "stroke-amber-400", dot: "bg-amber-400" },
  { stroke: "stroke-orange-500", dot: "bg-orange-500" },
  { stroke: "stroke-red-600", dot: "bg-red-600" },
];
const MONTHS = 6;

interface Data {
  summary: PaymentsSummary;
  invoices: InvoiceListItem[];
  payments: PaymentListItem[];
  bills: SupplierBillListItem[];
  billsSummary: SupplierBillsSummary | null;
  supplierPayments: SupplierPaymentListItem[];
  quotations: QuotationListItem[];
  rent: MonthOverview | null;
  reminders: Reminder[];
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading the dashboard">
      <Card className="mb-6 grid grid-cols-4 divide-x divide-slate-200 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 px-5 py-4">
            <Skeleton className="mt-0.5 h-8 w-8" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-32" />
            </div>
          </div>
        ))}
      </Card>
      <div className="grid grid-cols-3 gap-5">
        {[2, 1].map((span) => (
          <Card key={span} className={`${span === 2 ? "col-span-2" : "col-span-1"} space-y-4 p-5`}>
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-40 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/** The biggest unpaid balances, so it is clear who to follow up first. */
function TopOwedCard({
  title,
  total,
  items,
  unit,
  onSeeAll,
}: {
  title: string;
  total: number;
  items: { name: string; amount: number }[];
  unit: string;
  onSeeAll: () => void;
}) {
  const top = topByName(items, SHOWN);
  return (
    <Card className="flex h-full flex-col p-5">
      <SectionTitle
        action={
          <Button size="sm" variant="ghost" onClick={onSeeAll}>
            See all
          </Button>
        }
      >
        {title}
      </SectionTitle>
      <div className="mb-5 text-2xl font-semibold tabular text-slate-900">{formatMoney(total)}</div>
      <HBars empty="Nothing unpaid." rows={top.map((t) => ({ label: t.name, note: `${t.count} unpaid ${unit}${t.count === 1 ? "" : "s"}`, amount: t.amount }))} />
    </Card>
  );
}

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
  const today = todayISO();

  const load = useCallback(async () => {
    // Each part loads on its own, so one slow or failing part does not blank the whole dashboard.
    const [summary, invoices, payments, bills, billsSummary, supplierPayments, quotations, rent, reminders] = await Promise.allSettled([
      getPaymentsSummary(),
      listInvoices(),
      listPayments(),
      listSupplierBills(),
      getSupplierBillsSummary(),
      listSupplierPayments(),
      listQuotations(),
      getRentMonthOverview(currentMonth()),
      listReminders("UPCOMING"),
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
      reminders: ok(reminders, []),
    });
    setError(null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data) dashboardRevealed = true;
  }, [data]);

  // Ctrl+N starts a new invoice, unless the user is typing or a dialog is already open.
  const modalOpen = creating !== null || viewingInvoiceId !== null;
  useEffect(() => {
    if (modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "n") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      setCreating("invoice");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const view = useMemo(() => {
    if (!data) return null;
    const issued = data.invoices.filter((i) => i.status === "ISSUED");
    const waiting = issued
      .filter((i) => i.outstanding_amount > 0)
      .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
    const toPay = data.bills.filter((b) => b.outstanding_amount > 0).sort((a, b) => a.bill_date.localeCompare(b.bill_date));
    const months = lastMonths(today, MONTHS);
    const unsentQuotes = data.quotations.filter((q) => q.order_count === 0).sort((a, b) => a.quotation_date.localeCompare(b.quotation_date));
    const unpaidTenants = (data.rent?.rows ?? []).filter((r) => !r.paid);
    return {
      waiting,
      toPay,
      months,
      invoiced: monthlySums(issued.map((i) => ({ date: i.invoice_date, amount: i.total_amount })), months),
      billed: monthlySums(data.bills.map((b) => ({ date: b.bill_date, amount: b.total_amount })), months),
      paidOut: monthlySums(data.supplierPayments.map((p) => ({ date: p.payment_date, amount: p.amount_paid })), months),
      ages: ageBuckets(waiting.map((i) => ({ date: i.invoice_date, amount: i.outstanding_amount })), today),
      received: monthlySums(data.payments.map((p) => ({ date: p.payment_date, amount: p.amount_received })), months),
      unsentQuotes,
      unpaidTenants,
      oldWaiting: waiting.filter((i) => ageInDays(i.invoice_date, today) > 30).length,
      drafts: data.invoices.filter((i) => i.status === "DRAFT").length,
      owedByCustomers: waiting.map((i) => ({ name: i.customer_name, amount: i.outstanding_amount })),
    };
  }, [data, today]);

  const attention = view
    ? [
        { n: view.oldWaiting, text: (n: number) => `${n} invoice${n === 1 ? "" : "s"} unpaid for over 30 days`, page: "invoices" as Page },
        { n: view.unpaidTenants.length, text: (n: number) => `${n} tenant${n === 1 ? " has" : "s have"} not paid rent this month`, page: "rentals" as Page },
        { n: view.unsentQuotes.length, text: (n: number) => `${n} quotation${n === 1 ? "" : "s"} with no purchase order yet`, page: "quotations" as Page },
        { n: view.drafts, text: (n: number) => `${n} draft invoice${n === 1 ? "" : "s"} not issued`, page: "invoices" as Page },
      ].filter((a) => a.n > 0)
    : [];

  const reveals = (i: number) => ({ className: reveal ? "mww-reveal" : "", style: { "--i": i } as React.CSSProperties });

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
        <>
          <div className={`mb-6 ${reveals(0).className}`} style={reveals(0).style}>
            <StatStrip cols={4}>
              <Stat
                icon={Wallet}
                tone={data.summary.total_outstanding > 0 ? "attention" : "default"}
                label="Customers owe you"
                value={formatMoney(data.summary.total_outstanding)}
                note={`${data.summary.unpaid_invoices_count} unpaid invoice${data.summary.unpaid_invoices_count === 1 ? "" : "s"}`}
                onClick={() => onNavigate("invoices")}
              />
              <Stat
                icon={CreditCard}
                label="Received this month"
                value={formatMoney(data.summary.received_this_month)}
                note={`${formatMoney(data.summary.invoiced_this_month)} invoiced`}
                onClick={() => onNavigate("payments")}
              />
              <Stat
                icon={ReceiptText}
                tone={(data.billsSummary?.total_outstanding ?? 0) > 0 ? "attention" : "default"}
                label="You owe suppliers"
                value={formatMoney(data.billsSummary?.total_outstanding ?? 0)}
                note={`${data.billsSummary?.open_bills_count ?? 0} bill${data.billsSummary?.open_bills_count === 1 ? "" : "s"} to pay`}
                onClick={() => onNavigate("supplierBills")}
              />
              <Stat
                icon={House}
                label={`Rent, ${monthTitle(currentMonth())}`}
                value={data.rent ? formatMoney(data.rent.summary.collected) : "—"}
                note={data.rent ? `${data.rent.summary.paid_count} of ${data.rent.summary.total_count} paid · ${formatMoney(data.rent.summary.pending)} pending` : "No rentals yet"}
                onClick={() => onNavigate("rentals")}
              />
            </StatStrip>
          </div>

          <div className={`mb-6 ${reveals(1).className}`} style={reveals(1).style}>
            <Card className="overflow-hidden">
              {attention.length === 0 ? (
                <div className="flex items-center gap-2 px-5 py-3 text-sm text-slate-600">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  All clear. Nothing needs your attention right now.
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-l-4 border-amber-400 bg-amber-50/60 px-5 py-3 text-sm">
                  <span className="font-semibold text-slate-900">Needs attention</span>
                  {attention.map((a) => (
                    <button
                      key={a.text(a.n)}
                      type="button"
                      onClick={() => onNavigate(a.page)}
                      className="rounded-md bg-white px-2.5 py-1 text-slate-800 shadow-sm ring-1 ring-amber-200 hover:bg-amber-50"
                    >
                      {a.text(a.n)}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className={`mb-6 grid grid-cols-3 items-stretch gap-6 ${reveals(2).className}`} style={reveals(2).style}>
            <Card className="col-span-2 h-full p-5">
              <SectionTitle>Invoiced and received, last {MONTHS} months</SectionTitle>
              <MonthlyBars
                label="Invoiced and received by month"
                months={view.months}
                series={[
                  { name: "Invoiced", fill: "fill-brand-600", dot: "bg-brand-600", values: view.invoiced },
                  { name: "Received", fill: "fill-emerald-500", dot: "bg-emerald-500", values: view.received },
                ]}
              />
            </Card>
            <Card className="h-full p-5">
              <SectionTitle>Unpaid invoices by age</SectionTitle>
              <Donut
                centerLabel="Unpaid"
                empty="No unpaid invoices."
                parts={view.ages.map((b, i) => ({
                  label: b.label,
                  amount: b.amount,
                  note: b.count > 0 ? `${b.count} invoice${b.count === 1 ? "" : "s"}` : undefined,
                  ...AGE_STYLE[i],
                }))}
              />
            </Card>
          </div>

          <div className={`mb-6 grid grid-cols-3 items-stretch gap-6 ${reveals(3).className}`} style={reveals(3).style}>
            <Card className="col-span-2 h-full p-5">
              <SectionTitle>Supplier bills and payments, last {MONTHS} months</SectionTitle>
              <MonthlyBars
                label="Supplier bills received and paid by month"
                months={view.months}
                series={[
                  { name: "Bills received", fill: "fill-amber-500", dot: "bg-amber-500", values: view.billed },
                  { name: "Paid to suppliers", fill: "fill-slate-500", dot: "bg-slate-500", values: view.paidOut },
                ]}
              />
            </Card>
            <TopOwedCard title="Who owes you most" total={data.summary.total_outstanding} items={view.owedByCustomers} unit="invoice" onSeeAll={() => onNavigate("invoices")} />
          </div>

          <div className={`grid grid-cols-2 items-stretch gap-6 ${reveals(4).className}`} style={reveals(4).style}>
            <ListCard
              title="Invoices waiting for payment"
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
              title="Supplier bills to pay"
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

            <ListCard
              title={`Rent, ${monthTitle(currentMonth())}`}
              actionLabel="Rentals"
              onAction={() => onNavigate("rentals")}
              empty="No tenants yet."
              isEmpty={!data.rent || data.rent.rows.length === 0}
            >
              {(data.rent?.rows ?? []).slice(0, SHOWN).map((r) => (
                <ListRow
                  key={r.tenant_id}
                  title={r.tenant_name}
                  detail={r.place_name}
                  right={formatMoney(r.rent_amount)}
                  rightNote={r.paid ? `Paid ${formatDate(r.paid_on)}` : r.reminders_sent > 0 ? `Not paid · ${r.reminders_sent} reminder${r.reminders_sent === 1 ? "" : "s"} sent` : "Not paid"}
                  rightTone={r.paid ? "good" : "warn"}
                  onOpen={() => openRecord("TENANT", r.tenant_id)}
                />
              ))}
            </ListCard>

            <ListCard
              title="Reminders ahead"
              actionLabel="All reminders"
              onAction={() => onNavigate("reminders")}
              empty="No later reminders. Due ones show at the top of the screen."
              isEmpty={data.reminders.length === 0}
              note={data.reminders.length > SHOWN ? `Next ${SHOWN} of ${data.reminders.length} shown.` : undefined}
            >
              {data.reminders.slice(0, SHOWN).map((r) => (
                <ListRow
                  key={r.id}
                  title={r.title}
                  detail={r.link_label ?? undefined}
                  right={formatDate(r.due_date)}
                  rightNote={whenText(r.days_away)}
                  onOpen={() => onNavigate("reminders")}
                />
              ))}
            </ListCard>
          </div>
        </>
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

