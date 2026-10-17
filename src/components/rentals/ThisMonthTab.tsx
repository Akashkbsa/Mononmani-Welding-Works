import { useEffect, useState } from "react";
import { Check, House, MessageCircle } from "lucide-react";
import { getRentMonthOverview, undoRentPaid } from "../../services/api";
import { currentMonth, errorMessage, formatMoney, monthTitle, shiftMonth, shortDate } from "../../lib/format";
import { MonthOverview, MonthRow } from "../../types/rental";
import MonthFilter from "../MonthFilter";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ListSkeleton,
  Stat,
  StatStrip,
  theadClass,
  useToast,
} from "../ui";
import MarkPaidModal from "./MarkPaidModal";
import SendRemindersModal, { reminderLabel } from "./SendRemindersModal";

/** Who has paid for a month and who has not, with the buttons to record it. */
export default function ThisMonthTab() {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [overview, setOverview] = useState<MonthOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a change so the list loads again.
  const [version, setVersion] = useState(0);
  const [marking, setMarking] = useState<MonthRow | null>(null);
  const [undoing, setUndoing] = useState<MonthRow | null>(null);
  const [reminding, setReminding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRentMonthOverview(month)
      .then((result) => {
        if (cancelled) return;
        setOverview(result);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [month, version]);

  const reload = () => setVersion((v) => v + 1);
  // While another month is loading, the old rows stay on screen but cannot be acted on.
  const stale = overview?.month !== month;
  const summary = overview?.summary;
  const unpaid = (overview?.rows ?? []).filter((row) => !row.paid);

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          {/* The same month picker as the other screens; rent can be marked up to a year ahead. */}
          <MonthFilter
            dates={[`${shiftMonth(currentMonth(), -240)}-01`, `${shiftMonth(currentMonth(), 12)}-01`]}
            value={month}
            allowAll={false}
            onChange={(m) => setMonth(m || currentMonth())}
          />
          {month !== currentMonth() && (
            <Button size="sm" variant="ghost" onClick={() => setMonth(currentMonth())}>
              Back to this month
            </Button>
          )}
        </div>
        {overview !== null && overview.rows.length > 0 && (
          <Button
            variant="primary"
            icon={<MessageCircle className="w-4 h-4" />}
            disabled={stale || unpaid.length === 0}
            onClick={() => setReminding(true)}
          >
            {unpaid.length === 0 ? "Everyone has paid" : `Send reminders (${unpaid.length})`}
          </Button>
        )}
      </div>

      {summary && (
        <div className="mb-5">
          <StatStrip cols={3}>
            <Stat label="Paid" value={`${summary.paid_count} of ${summary.total_count}`} />
            <Stat label="Collected" value={formatMoney(summary.collected)} />
            <Stat label="Pending" value={formatMoney(summary.pending)} tone={summary.pending > 0 ? "attention" : "default"} />
          </StatStrip>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {overview === null ? (
          <ListSkeleton rows={4} label="Loading rent" />
        ) : overview.rows.length === 0 ? (
          <EmptyState icon={House} title="No tenants yet" description="Add places and tenants in the other tabs." />
        ) : (
          <table data-hide-narrow="2" className={`mww-fade w-full text-sm ${stale ? "opacity-60" : ""}`}>
            <thead className={theadClass}>
              <tr>
                <th className="py-2.5 px-4 font-semibold">Tenant</th>
                <th className="py-2.5 pr-4 font-semibold">Place</th>
                <th className="py-2.5 pr-4 font-semibold text-right">Rent</th>
                <th className="py-2.5 pr-4 font-semibold">Status</th>
                <th className="py-2.5 px-4 font-semibold text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overview.rows.map((row) => (
                <tr key={row.tenant_id}>
                  <td className="max-w-[14rem] truncate py-3 px-4 font-medium text-slate-900" title={row.tenant_name}>
                    {row.tenant_name}
                  </td>
                  <td className="max-w-[14rem] truncate py-3 pr-4 text-slate-600" title={row.place_name}>
                    {row.place_name}
                  </td>
                  <td className="py-3 pr-4 text-right tabular">{formatMoney(row.rent_amount)}</td>
                  <td className="py-3 pr-4">
                    {row.paid ? (
                      <div>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                          Paid
                        </span>
                        <div className="mt-0.5 max-w-[16rem] truncate text-xs text-slate-500" title={row.note ?? undefined}>
                          {shortDate(row.paid_on)}
                          {row.note ? ` · ${row.note}` : ""}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Badge tone="amber">Not paid</Badge>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {row.reminders_sent > 0
                            ? `${reminderLabel(row.reminders_sent)} sent ${shortDate(row.last_sent_on)}`
                            : "No reminder sent"}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {row.paid ? (
                      <Button size="sm" variant="ghost" disabled={stale} onClick={() => setUndoing(row)}>
                        Undo
                      </Button>
                    ) : (
                      <Button size="sm" disabled={stale} onClick={() => setMarking(row)}>
                        Mark paid
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {marking && (
        <MarkPaidModal
          row={marking}
          month={month}
          onClose={() => setMarking(null)}
          onSaved={() => {
            setMarking(null);
            reload();
          }}
        />
      )}

      {reminding && <SendRemindersModal month={month} rows={unpaid} onClose={() => setReminding(false)} onChanged={reload} />}

      {undoing && (
        <ConfirmDialog
          title={`Mark ${undoing.tenant_name} as not paid?`}
          message={`The date, amount and note saved for ${monthTitle(month)} will be cleared.`}
          confirmLabel="Mark as not paid"
          onConfirm={async () => {
            await undoRentPaid(undoing.tenant_id, month);
            toast("Marked as not paid");
            reload();
          }}
          onClose={() => setUndoing(null)}
        />
      )}
    </>
  );
}
