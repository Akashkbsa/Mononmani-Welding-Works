import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { getLedger, printLedger, setOpeningBalance } from "../../services/api";
import { errorMessage, formatDate, formatMoney, todayISO } from "../../lib/format";
import { financialYearOf, periodTitle } from "../../lib/period";
import { balanceText, periodBounds } from "../../lib/ledger";
import { Ledger } from "../../types/ledger";
import { Alert, Button, Card, inputClass, ListSkeleton, Modal, Stat, StatStrip, theadClass, useToast } from "../ui";
import MonthFilter from "../MonthFilter";

interface Props {
  companyId: number;
  companyName: string;
  onClose: () => void;
}

/**
 * Everything with one company in a single account, as Tally keeps it: our invoices and our
 * payments to them are Debit, their payments and their bills are Credit. Dr means they owe us.
 */
export default function LedgerModal({ companyId, companyName, onClose }: Props) {
  const toast = useToast();
  const today = todayISO();
  const [period, setPeriod] = useState(`FY${financialYearOf(today)}`);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [editingOpening, setEditingOpening] = useState(false);
  const { from, to } = periodBounds(period, today);

  useEffect(() => {
    let cancelled = false;
    getLedger(companyId, from, to)
      .then((l) => {
        if (cancelled) return;
        setLedger(l);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [companyId, from, to, version]);

  const print = async () => {
    setPrinting(true);
    setError(null);
    try {
      await printLedger(companyId, from, to);
      toast("Ledger opened. Print it from the PDF viewer.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPrinting(false);
    }
  };

  const l = ledger;
  const opening = l?.opening_balance;

  return (
    <Modal
      title={`Ledger · ${companyName}`}
      subtitle={from || to ? periodTitle(period) : "All records"}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} loading={printing} disabled={!l} onClick={print}>
            Print ledger
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthFilter dates={l?.dates ?? []} value={period} onChange={setPeriod} />
          {opening && !editingOpening && (
            <div className="flex items-center gap-2 text-slate-600">
              {opening.amount !== 0 ? (
                <span className="tabular">
                  Opening balance {balanceText(opening.amount)}
                  {opening.as_on && ` as on ${formatDate(opening.as_on)}`}
                </span>
              ) : (
                <span>No opening balance</span>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditingOpening(true)}>
                {opening.amount !== 0 ? "Change" : "Add opening balance"}
              </Button>
            </div>
          )}
        </div>

        {editingOpening && opening && (
          <OpeningBalanceForm
            initialAmount={opening.amount}
            initialDate={opening.as_on}
            onCancel={() => setEditingOpening(false)}
            onSave={async (amount, asOn) => {
              await setOpeningBalance(companyId, { amount, as_on: asOn });
              toast(amount === 0 ? "Opening balance removed" : "Opening balance saved");
              setEditingOpening(false);
              setVersion((v) => v + 1);
            }}
          />
        )}

        {error && <Alert>{error}</Alert>}

        {!l ? (
          !error && <ListSkeleton rows={6} label="Loading the ledger" />
        ) : (
          <>
            <StatStrip cols={4}>
              <Stat label={from ? "Brought forward" : "Opening"} value={balanceText(from ? l.brought_forward : l.opening_balance.amount)} />
              <Stat label="Total debit" value={formatMoney(l.total_debit)} note="Invoices, our payments" />
              <Stat label="Total credit" value={formatMoney(l.total_credit)} note="Their payments, bills" />
              <Stat
                label="Closing balance"
                value={balanceText(l.closing)}
                note={l.closing > 0 ? "They owe you" : l.closing < 0 ? "You owe them" : "Settled"}
                tone={l.closing !== 0 ? "attention" : "default"}
              />
            </StatStrip>

            <Card className="overflow-x-auto">
              <table className="w-full min-w-[44rem]">
                <thead className={theadClass}>
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Date</th>
                    <th className="py-2.5 pr-4 font-semibold">Particulars</th>
                    <th className="py-2.5 pr-4 font-semibold">Ref. no.</th>
                    <th className="py-2.5 pr-4 font-semibold text-right">Debit</th>
                    <th className="py-2.5 pr-4 font-semibold text-right">Credit</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {from && (
                    <tr className="text-slate-500 italic">
                      <td className="py-2.5 px-4 tabular">{formatDate(from)}</td>
                      <td className="py-2.5 pr-4" colSpan={4}>
                        Balance brought forward
                      </td>
                      <td className="py-2.5 px-4 text-right tabular">{balanceText(l.brought_forward)}</td>
                    </tr>
                  )}
                  {l.lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No entries in this period.
                      </td>
                    </tr>
                  ) : (
                    l.lines.map((x, i) => (
                      <tr key={i}>
                        <td className="py-2.5 px-4 tabular whitespace-nowrap">{x.date ? formatDate(x.date) : "—"}</td>
                        <td className="py-2.5 pr-4">
                          {x.particulars}
                          {x.detail && <div className="text-xs text-slate-500">{x.detail}</div>}
                        </td>
                        <td className="py-2.5 pr-4 whitespace-nowrap text-slate-600">{x.number}</td>
                        <td className="py-2.5 pr-4 text-right tabular">{x.debit > 0 ? formatMoney(x.debit) : ""}</td>
                        <td className="py-2.5 pr-4 text-right tabular">{x.credit > 0 ? formatMoney(x.credit) : ""}</td>
                        <td className="py-2.5 px-4 text-right tabular whitespace-nowrap">{balanceText(x.balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <tr>
                    <td className="py-2.5 px-4" colSpan={3}>
                      Closing balance
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular">{formatMoney(l.total_debit)}</td>
                    <td className="py-2.5 pr-4 text-right tabular">{formatMoney(l.total_credit)}</td>
                    <td className="py-2.5 px-4 text-right tabular whitespace-nowrap">{balanceText(l.closing)}</td>
                  </tr>
                </tfoot>
              </table>
            </Card>
            <p className="text-xs text-slate-500">Dr: they owe you. Cr: you owe them. Draft and cancelled invoices are left out.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

function OpeningBalanceForm({
  initialAmount,
  initialDate,
  onCancel,
  onSave,
}: {
  initialAmount: number;
  initialDate: string | null;
  onCancel: () => void;
  onSave: (amount: number, asOn: string | null) => Promise<void>;
}) {
  const [amount, setAmount] = useState(initialAmount !== 0 ? String(Math.abs(initialAmount)) : "");
  const [side, setSide] = useState<"DR" | "CR">(initialAmount < 0 ? "CR" : "DR");
  const [asOn, setAsOn] = useState(initialDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    const value = amount.trim() === "" ? 0 : Number(amount);
    if (!(value >= 0)) return setError("Enter the amount, or leave it empty to remove the opening balance.");
    if (value > 0 && !asOn) return setError("Enter the date the balance stood on.");
    setSaving(true);
    try {
      await onSave(side === "DR" ? value : -value, value > 0 ? asOn : null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-slate-200 p-4 space-y-3">
      <p className="text-slate-600">What this company owed before you started using the app, for example from Tally.</p>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-slate-700">Amount (₹)</span>
          <input
            aria-label="Opening balance amount"
            type="number"
            min={0}
            step="0.01"
            className={`${inputClass} w-40 tabular`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-slate-700">Who owes</span>
          <select aria-label="Who owes" className={`${inputClass} w-52`} value={side} onChange={(e) => setSide(e.target.value as "DR" | "CR")}>
            <option value="DR">They owe us (Dr)</option>
            <option value="CR">We owe them (Cr)</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-slate-700">As on</span>
          <input aria-label="As on" type="date" className={`${inputClass} w-44`} value={asOn} onChange={(e) => setAsOn(e.target.value)} />
        </label>
        <div className="ml-auto flex gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
