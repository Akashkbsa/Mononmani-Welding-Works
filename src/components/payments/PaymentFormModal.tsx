import { useEffect, useMemo, useState } from "react";
import { Customer } from "../../types/customer";
import {
  ExcessAction,
  PAYMENT_METHODS,
  PaymentInput,
  PaymentWithAllocations,
  UnpaidInvoice,
} from "../../types/payment";
import {
  createPayment,
  getCustomerCredits,
  getNextPaymentNumber,
  getUnpaidInvoices,
  listCustomers,
  updatePayment,
} from "../../services/api";
import { errorMessage, formatDate, formatMoney, round2, todayISO } from "../../lib/format";
import { Alert, Button, Checkbox, Field, inputClass, Loading, Modal, textareaClass } from "../ui";
import CustomerPicker from "../CustomerPicker";

interface Props {
  payment?: PaymentWithAllocations | null;
  initialCustomerId?: number;
  initialInvoiceId?: number;
  onClose: () => void;
  onSaved: () => void;
}

// A small balance left on an invoice gets a one-click "Settle in full" suggestion up to this size.
// It is only a suggestion: any shortfall can still be written off with the tick box.
const SETTLE_SUGGEST_LIMIT = 500;
// Writing off more than this shows a "check it" warning.
const ADJUSTMENT_WARN = 100;
// An extra amount up to this size is suggested as a round-off.
const ADJUSTMENT_SUGGEST = 50;

// Usual TDS rates for contract and professional work (as a percentage of the invoice).
const TDS_PRESETS = ["0.1", "1", "2", "5", "10"];

const num = (v: string | number | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

export default function PaymentFormModal({ payment, initialCustomerId, initialInvoiceId, onClose, onSaved }: Props) {
  const existing = payment?.payment;
  const isEdit = !!existing;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(existing?.customer_id ?? initialCustomerId ?? null);
  const [paymentNumber, setPaymentNumber] = useState(existing?.payment_number ?? "");
  const [date, setDate] = useState(existing?.payment_date ?? todayISO());
  const [amount, setAmount] = useState(existing ? String(existing.amount_received) : "");
  const [method, setMethod] = useState(existing?.payment_method ?? "Bank Transfer");
  const [reference, setReference] = useState(existing?.reference_number ?? "");
  const [tdsRecognized, setTdsRecognized] = useState(existing?.tds_recognized ?? true);
  const [hasTds, setHasTds] = useState((existing?.tds_amount ?? 0) > 0);
  const [tds, setTds] = useState(existing && existing.tds_amount > 0 ? String(existing.tds_amount) : "");
  // TDS is usually a percentage of the invoice, so that is the default for a new payment.
  const [tdsMode, setTdsMode] = useState<"percent" | "amount">(existing && existing.tds_amount > 0 ? "amount" : "percent");
  const [tdsPreset, setTdsPreset] = useState("2");
  const [tdsOther, setTdsOther] = useState("");
  const [tdsBase, setTdsBase] = useState<"before_tax" | "total">("before_tax");
  const [verified, setVerified] = useState(existing?.is_verified ?? true);
  const [remarks, setRemarks] = useState(existing?.remarks ?? "");
  const [excessAction, setExcessAction] = useState<ExcessAction>(
    existing?.excess_action === "REFUND" ? "REFUND" : existing?.excess_action === "ROUNDOFF" ? "ROUNDOFF" : "CREDIT"
  );
  const [settleInFull, setSettleInFull] = useState((existing?.writeoff_amount ?? 0) > 0);

  const [invoices, setInvoices] = useState<UnpaidInvoice[] | null>(null);
  const [allocations, setAllocations] = useState<Record<number, string>>(() =>
    Object.fromEntries((payment?.allocations ?? []).map((a) => [a.invoice_id, String(a.allocated_amount)]))
  );
  const [advanceAvailable, setAdvanceAvailable] = useState(0);
  const [useAdvance, setUseAdvance] = useState((existing?.credit_applied ?? 0) > 0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCustomers()
      .then(setCustomers)
      .catch((err) => setError(errorMessage(err)));
    if (!isEdit) {
      getNextPaymentNumber()
        .then(setPaymentNumber)
        .catch((err) => setError(errorMessage(err)));
    }
  }, [isEdit]);

  // Load what this customer owes and any advance they have.
  useEffect(() => {
    if (customerId === null) {
      setInvoices([]);
      setAdvanceAvailable(0);
      return;
    }
    let cancelled = false;
    setInvoices(null);
    Promise.all([getUnpaidInvoices(customerId, existing?.id), getCustomerCredits(customerId, existing?.id)])
      .then(([list, credits]) => {
        if (cancelled) return;
        setInvoices(list);
        setAdvanceAvailable(round2(credits.reduce((s, c) => s + c.remaining_amount, 0)));
        if (!isEdit && initialInvoiceId && customerId === initialCustomerId) {
          const target = list.find((i) => i.invoice_id === initialInvoiceId);
          if (target) {
            setAllocations({ [target.invoice_id]: String(target.outstanding_amount) });
            setAmount((a) => a || String(target.outstanding_amount));
          }
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [customerId, existing?.id, isEdit, initialInvoiceId, initialCustomerId]);

  // TDS as a percentage: worked out per invoice from the part of it this payment covers.
  const percentMode = hasTds && tdsMode === "percent";
  const tdsRatePct = tdsPreset === "other" ? num(tdsOther) : Number(tdsPreset);
  const tdsOf = (inv: UnpaidInvoice, alloc: number) =>
    inv.total_amount > 0
      ? round2(((tdsRatePct / 100) * (tdsBase === "before_tax" ? inv.taxable_amount : inv.total_amount) * alloc) / inv.total_amount)
      : 0;
  // What an allocation of `alloc` rupees to this invoice costs in actual money once TDS is taken off.
  const moneyFor = (inv: UnpaidInvoice, alloc: number) =>
    round2(alloc - (percentMode && tdsRecognized ? tdsOf(inv, alloc) : 0));
  /** The largest allocation (up to the balance) that `funds` of real money can pay for. */
  const fitAllocation = (inv: UnpaidInvoice, funds: number) => {
    const ratio = tdsBase === "before_tax" && inv.total_amount > 0 ? inv.taxable_amount / inv.total_amount : 1;
    const factor = percentMode && tdsRecognized ? Math.max(0.05, 1 - (tdsRatePct / 100) * ratio) : 1;
    let a = round2(Math.min(inv.outstanding_amount, funds / factor));
    for (let i = 0; i < 3; i++) {
      const diff = round2(funds - moneyFor(inv, a));
      if (diff > 0.005 && a < inv.outstanding_amount - 0.005) a = round2(a + 0.01);
      else if (diff < -0.005 && a > 0.01) a = round2(a - 0.01);
      else break;
    }
    return a;
  };
  const tdsFromInvoices = round2(
    (invoices ?? []).reduce((sum, inv) => sum + (inv.invoice_id in allocations ? tdsOf(inv, num(allocations[inv.invoice_id])) : 0), 0)
  );
  const tdsValue = !hasTds ? 0 : percentMode ? tdsFromInvoices : num(tds);

  // Money counted so far: received plus recognised TDS.
  const base = round2(num(amount) + (hasTds && tdsRecognized ? tdsValue : 0));
  const allocated = round2(Object.values(allocations).reduce((s, v) => s + num(v), 0));
  const advanceUsed = useAdvance ? round2(Math.min(advanceAvailable, Math.max(0, allocated - base))) : 0;
  const leftover = round2(Math.max(0, base - allocated));
  const shortBy = round2(allocated - base - advanceUsed);
  // A short amount accepted as full payment (only while something is really short).
  const writeoff = settleInFull && shortBy > 0.005 ? shortBy : 0;

  // Forget the tick once nothing is short, so it can't silently apply to a later edit.
  useEffect(() => {
    if (shortBy <= 0.005) setSettleInFull(false);
  }, [shortBy]);

  // Selected invoices that would still show a small balance after this payment.
  const partials = (invoices ?? [])
    .filter((inv) => inv.invoice_id in allocations)
    .map((inv) => ({ inv, left: round2(inv.outstanding_amount - num(allocations[inv.invoice_id])) }))
    .filter((x) => x.left > 0.005 && x.left <= SETTLE_SUGGEST_LIMIT);

  const overAllocated = useMemo(
    () =>
      (invoices ?? []).filter((inv) => num(allocations[inv.invoice_id]) > inv.outstanding_amount + 0.005),
    [invoices, allocations]
  );

  const toggleInvoice = (inv: UnpaidInvoice) => {
    setAllocations((prev) => {
      const next = { ...prev };
      if (inv.invoice_id in next) {
        delete next[inv.invoice_id];
      } else {
        if (percentMode) {
          // Size the new line so received money plus TDS exactly pays for it.
          const used = (invoices ?? []).reduce(
            (sum, i) => sum + (i.invoice_id in next ? moneyFor(i, num(next[i.invoice_id])) : 0),
            0
          );
          const funds = num(amount) + (useAdvance ? advanceAvailable : 0) - used;
          next[inv.invoice_id] = String(funds > 0 ? fitAllocation(inv, funds) : inv.outstanding_amount);
        } else {
          const used = Object.values(next).reduce((s, v) => s + num(v), 0);
          const funds = base + (useAdvance ? advanceAvailable : 0) - used;
          const share = funds > 0 ? Math.min(funds, inv.outstanding_amount) : inv.outstanding_amount;
          next[inv.invoice_id] = String(round2(share));
        }
      }
      return next;
    });
  };

  /** Spread the money over the oldest invoices first. */
  const allocateOldestFirst = () => {
    const next: Record<number, string> = {};
    if (percentMode) {
      let funds = num(amount) + (useAdvance ? advanceAvailable : 0);
      for (const inv of invoices ?? []) {
        if (funds <= 0.005) break;
        const share = fitAllocation(inv, funds);
        next[inv.invoice_id] = String(share);
        funds = round2(funds - moneyFor(inv, share));
      }
    } else {
      let funds = base + (useAdvance ? advanceAvailable : 0);
      for (const inv of invoices ?? []) {
        if (funds <= 0.005) break;
        const share = round2(Math.min(funds, inv.outstanding_amount));
        next[inv.invoice_id] = String(share);
        funds = round2(funds - share);
      }
    }
    setAllocations(next);
  };

  const save = async () => {
    setError(null);
    if (customerId === null) return setError("Choose the customer who paid.");
    if (!date) return setError("Enter the payment date.");
    if (num(amount) < 0 || tdsValue < 0) return setError("Amounts cannot be negative.");
    if (hasTds && tdsMode === "percent" && !(tdsRatePct > 0 && tdsRatePct < 100)) {
      return setError("Enter a TDS rate between 0 and 100 percent.");
    }
    if (base <= 0 && advanceUsed <= 0) return setError("Enter the amount received.");
    if (overAllocated.length) {
      return setError(`The amount for invoice ${overAllocated[0].invoice_number} is more than its balance.`);
    }
    if (shortBy > 0.005 && writeoff === 0) {
      return setError(
        `You've allocated ${formatMoney(shortBy)} more than was received. Tick "Settle in full" to write it off, or lower the amounts.`
      );
    }


    const input: PaymentInput = {
      payment_number: isEdit ? null : paymentNumber.trim() || null,
      customer_id: customerId,
      payment_date: date,
      payment_method: method,
      reference_number: reference.trim() || null,
      bank_name: existing?.bank_name ?? null,
      amount_received: num(amount),
      tds_amount: tdsValue,
      tds_recognized: tdsRecognized,
      credit_to_apply: useAdvance ? advanceAvailable : 0,
      is_verified: verified,
      remarks: remarks.trim() || null,
      allocations: Object.entries(allocations)
        .map(([id, v]) => ({ invoice_id: Number(id), allocated_amount: num(v) }))
        .filter((a) => a.allocated_amount > 0),
      excess_action: leftover > 0 ? excessAction : "NONE",
      writeoff_amount: writeoff,
    };

    setSaving(true);
    try {
      if (isEdit) await updatePayment(existing!.id, input);
      else await createPayment(input);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const customerName = customers.find((c) => c.id === customerId)?.name ?? existing?.customer_name;

  return (
    <Modal
      title={isEdit ? `Edit payment ${existing!.payment_number}` : "Record payment"}
      subtitle={isEdit ? customerName : undefined}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {isEdit ? "Save changes" : "Record payment"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}

        <div className="grid grid-cols-3 gap-4">
          <Field label="Customer" required className="col-span-2">
            <CustomerPicker
              customers={customers}
              value={customerId}
              disabled={isEdit}
              fallbackLabel={existing?.customer_name}
              onChange={(c) => {
                setCustomerId(c.id);
                setAllocations({});
                setUseAdvance(false);
              }}
            />
          </Field>
          <Field label="Payment number">
            <input
              className={`${inputClass} font-mono`}
              value={paymentNumber}
              disabled={isEdit}
              onChange={(e) => setPaymentNumber(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Amount received (₹)" required>
            <input
              type="number"
              min={0}
              step="0.01"
              className={`${inputClass} tabular`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Date received" required>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Method">
            <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
              {!PAYMENT_METHODS.includes(method as never) && <option>{method}</option>}
            </select>
          </Field>
          <Field label={method === "Cheque" ? "Cheque number" : "Reference / UTR"}>
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <div className="pt-6">
            <Checkbox checked={hasTds} onChange={setHasTds} label="TDS was deducted" />
          </div>
        </div>

        {hasTds && (
          <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-800">TDS deducted</span>
              <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
                {(
                  [
                    ["percent", "% of invoice"],
                    ["amount", "₹ amount"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={tdsMode === mode}
                    onClick={() => setTdsMode(mode)}
                    className={`rounded px-3 py-1 transition-colors ${
                      tdsMode === mode ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {percentMode ? (
              <div className="grid grid-cols-3 gap-4">
                <Field label="TDS rate">
                  <div className="flex gap-2">
                    <select className={inputClass} value={tdsPreset} onChange={(e) => setTdsPreset(e.target.value)}>
                      {TDS_PRESETS.map((r) => (
                        <option key={r} value={r}>
                          {r}%
                        </option>
                      ))}
                      <option value="other">Other…</option>
                    </select>
                    {tdsPreset === "other" && (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        autoFocus
                        aria-label="TDS rate in percent"
                        placeholder="%"
                        className={`${inputClass} w-24 tabular`}
                        value={tdsOther}
                        onChange={(e) => setTdsOther(e.target.value)}
                      />
                    )}
                  </div>
                </Field>
                <Field label="TDS is taken on">
                  <select
                    className={inputClass}
                    value={tdsBase}
                    onChange={(e) => setTdsBase(e.target.value as "before_tax" | "total")}
                  >
                    <option value="before_tax">Amount before GST</option>
                    <option value="total">Invoice total with GST</option>
                  </select>
                </Field>
                <Field label="TDS amount">
                  <div className={`${inputClass} flex items-center bg-white tabular`}>{formatMoney(tdsValue)}</div>
                </Field>
                <p className="col-span-3 -mt-2 text-xs text-slate-500">
                  {Object.keys(allocations).length === 0
                    ? "Tick the invoices below and the TDS is worked out from them."
                    : "Worked out from the part of each ticked invoice this payment covers."}
                </p>
              </div>
            ) : (
              <Field
                label="TDS amount (₹)"
                hint={tdsRecognized ? "Counts towards the invoices as paid." : "Recorded only; the invoices stay unpaid by this amount."}
              >
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={`${inputClass} tabular max-w-xs`}
                  value={tds}
                  onChange={(e) => setTds(e.target.value)}
                />
              </Field>
            )}

            <Checkbox
              checked={tdsRecognized}
              onChange={setTdsRecognized}
              label="Recognise TDS"
              description="Turn off until the TDS certificate arrives; the amount then stays outstanding."
            />
            {percentMode && tdsRecognized && allocated > 0 && Math.abs(num(amount) - round2(allocated - tdsValue - advanceUsed)) > 0.005 && (
              <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
                <span>
                  After TDS the customer should pay {formatMoney(round2(allocated - tdsValue - advanceUsed))} for these invoices.
                </span>
                <Button size="sm" onClick={() => setAmount(String(round2(allocated - tdsValue - advanceUsed)))}>
                  Set amount received
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Invoices this payment covers */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-900">Apply to invoices</h3>
            {invoices && invoices.length > 0 && (
              <Button size="sm" variant="ghost" onClick={allocateOldestFirst}>
                Fill oldest first
              </Button>
            )}
          </div>

          {customerId === null ? (
            <p className="text-sm text-slate-500">Choose a customer to see their unpaid invoices.</p>
          ) : invoices === null ? (
            <Loading />
          ) : invoices.length === 0 ? (
            <p className="text-sm text-slate-500">This customer has no unpaid invoices. The amount will be kept as an advance.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="w-8" />
                  <th className="py-2 font-medium">Invoice</th>
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium text-right">Balance</th>
                  <th className="py-2 font-medium text-right w-40">Apply (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => {
                  const selected = inv.invoice_id in allocations;
                  const over = overAllocated.includes(inv);
                  return (
                    <tr key={inv.invoice_id}>
                      <td className="py-2">
                        <input
                          type="checkbox"
                          aria-label={`Apply to ${inv.invoice_number}`}
                          className="h-4 w-4 accent-brand-600"
                          checked={selected}
                          onChange={() => toggleInvoice(inv)}
                        />
                      </td>
                      <td className="py-2 font-medium">{inv.invoice_number}</td>
                      <td className="py-2 text-slate-600">
                        {formatDate(inv.invoice_date)}
                      </td>
                      <td className="py-2 text-right tabular">{formatMoney(inv.outstanding_amount)}</td>
                      <td className="py-1.5 text-right">
                        {selected && (
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={`${inputClass} h-8 text-right tabular ${over ? "border-red-400" : ""}`}
                            value={allocations[inv.invoice_id]}
                            onChange={(e) =>
                              setAllocations((a) => ({ ...a, [inv.invoice_id]: e.target.value }))
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {advanceAvailable > 0 && (
            <div className="mt-3 rounded-md bg-sky-50 px-3 py-2.5">
              <Checkbox
                checked={useAdvance}
                onChange={setUseAdvance}
                label={`Use advance from earlier payments (${formatMoney(advanceAvailable)} available)`}
                description="Covers any amount applied beyond what was received now."
              />
            </div>
          )}
        </div>

        {/* Summary */}
        <div className="rounded-md border border-slate-200 p-4 text-sm tabular space-y-1.5">
          <SummaryRow label="Received" value={num(amount)} />
          {hasTds && <SummaryRow label={tdsRecognized ? "TDS" : "TDS (not recognised)"} value={tdsValue} />}
          {advanceUsed > 0 && <SummaryRow label="Advance used" value={advanceUsed} />}
          {writeoff > 0 && <SummaryRow label="Written off" value={writeoff} />}
          <SummaryRow label="Applied to invoices" value={allocated} />
          {shortBy > 0.005 ? (
            <div className="border-t border-slate-200 pt-3 mt-2 space-y-2">
              <div className="flex justify-between font-medium text-amber-800">
                <span>Short</span>
                <span>{formatMoney(shortBy)}</span>
              </div>
              <Checkbox
                checked={settleInFull}
                onChange={setSettleInFull}
                label={`Settle in full: write off ${formatMoney(shortBy)}`}
                description="The customer paid less than the invoices total and you accept it as full payment. The invoices show as paid."
              />
              {settleInFull && shortBy > ADJUSTMENT_WARN && (
                <p className="text-xs text-amber-700">That is a large amount to write off. Check it is right.</p>
              )}
              {!settleInFull && (
                <p className="text-red-600">Applied is {formatMoney(shortBy)} more than the money available.</p>
              )}
            </div>
          ) : partials.length > 0 && leftover <= 0.005 ? (
            <div className="border-t border-slate-200 pt-3 mt-2 space-y-1.5">
              {partials.map(({ inv, left }) => (
                <div key={inv.invoice_id} className="flex items-center justify-between gap-3 text-slate-600">
                  <span>
                    Invoice {inv.invoice_number} will still show {formatMoney(left)} due.
                  </span>
                  <Button
                    size="sm"
                    onClick={() => {
                      setAllocations((a) => ({ ...a, [inv.invoice_id]: String(inv.outstanding_amount) }));
                      setSettleInFull(true);
                    }}
                  >
                    Settle in full
                  </Button>
                </div>
              ))}
            </div>
          ) : leftover > 0 ? (
            <div className="border-t border-slate-200 pt-3 mt-2 space-y-2">
              <div className="flex justify-between font-medium">
                <span>Left over</span>
                <span>{formatMoney(leftover)}</span>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                <Radio
                  checked={excessAction === "ROUNDOFF"}
                  onChange={() => setExcessAction("ROUNDOFF")}
                  label="Keep as round-off"
                />
                <Radio
                  checked={excessAction === "CREDIT"}
                  onChange={() => setExcessAction("CREDIT")}
                  label="Keep as advance for future invoices"
                />
                <Radio
                  checked={excessAction === "REFUND"}
                  onChange={() => setExcessAction("REFUND")}
                  label="Refunded to customer"
                />
              </div>
              {excessAction === "ROUNDOFF" ? (
                <p className="text-xs text-slate-500">
                  Counted as received but not held as an advance and not owed back to the customer.
                </p>
              ) : leftover <= ADJUSTMENT_SUGGEST ? (
                <p className="text-xs text-slate-500">Looks like a rounded-up payment? Choose "Keep as round-off".</p>
              ) : null}
              {isEdit && existing!.advance_used > 0 && (
                <p className="text-xs text-slate-500">
                  {formatMoney(existing!.advance_used)} of this advance has already been used by a later payment.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Remarks" className="col-span-2">
            <textarea className={textareaClass} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <div className="pt-6">
            <Checkbox
              checked={verified}
              onChange={setVerified}
              label="Money is in the bank"
              description="Untick for cheques that haven't cleared."
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-slate-600">
      <span>{label}</span>
      <span className="text-slate-900">{formatMoney(value)}</span>
    </div>
  );
}

function Radio({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-slate-700 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="radio" className="accent-brand-600" checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}
