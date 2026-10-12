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

interface Props {
  payment?: PaymentWithAllocations | null;
  initialCustomerId?: number;
  initialInvoiceId?: number;
  onClose: () => void;
  onSaved: () => void;
}

// Differences up to this size can be written off (short) or kept as a round-off (extra) in one payment.
const ADJUSTMENT_LIMIT = 500;
// Writing off more than this shows a "check it" warning.
const ADJUSTMENT_WARN = 100;
// An extra amount up to this size is suggested as a round-off.
const ADJUSTMENT_SUGGEST = 50;

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
  const [bankName, setBankName] = useState(existing?.bank_name ?? "");
  const [tdsRecognized, setTdsRecognized] = useState(existing?.tds_recognized ?? true);
  const [hasTds, setHasTds] = useState((existing?.tds_amount ?? 0) > 0);
  const [tds, setTds] = useState(existing && existing.tds_amount > 0 ? String(existing.tds_amount) : "");
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

  // Money counted so far: received plus recognised TDS.
  const base = round2(num(amount) + (hasTds && tdsRecognized ? num(tds) : 0));
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
    .filter((x) => x.left > 0.005 && x.left <= ADJUSTMENT_LIMIT);

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
        const used = Object.values(next).reduce((s, v) => s + num(v), 0);
        const funds = base + (useAdvance ? advanceAvailable : 0) - used;
        const share = funds > 0 ? Math.min(funds, inv.outstanding_amount) : inv.outstanding_amount;
        next[inv.invoice_id] = String(round2(share));
      }
      return next;
    });
  };

  /** Spread the money over the oldest invoices first. */
  const allocateOldestFirst = () => {
    let funds = base + (useAdvance ? advanceAvailable : 0);
    const next: Record<number, string> = {};
    for (const inv of invoices ?? []) {
      if (funds <= 0.005) break;
      const share = round2(Math.min(funds, inv.outstanding_amount));
      next[inv.invoice_id] = String(share);
      funds = round2(funds - share);
    }
    setAllocations(next);
  };

  const save = async () => {
    setError(null);
    if (customerId === null) return setError("Choose the customer who paid.");
    if (!date) return setError("Enter the payment date.");
    if (num(amount) < 0 || num(tds) < 0) return setError("Amounts cannot be negative.");
    if (base <= 0 && advanceUsed <= 0) return setError("Enter the amount received.");
    if (overAllocated.length) {
      return setError(`The amount for invoice ${overAllocated[0].invoice_number} is more than its balance.`);
    }
    if (shortBy > 0.005 && writeoff === 0) {
      return setError(
        `You've allocated ${formatMoney(shortBy)} more than was received. Tick "Settle in full" to write it off, or lower the amounts.`
      );
    }
    if (writeoff > ADJUSTMENT_LIMIT) {
      return setError(`A write-off can be at most ${formatMoney(ADJUSTMENT_LIMIT)}.`);
    }
    if (excessAction === "ROUNDOFF" && leftover > ADJUSTMENT_LIMIT) {
      return setError(`${formatMoney(leftover)} is too much to keep as a round-off. Hold it as an advance or refund it.`);
    }

    const input: PaymentInput = {
      payment_number: isEdit ? null : paymentNumber.trim() || null,
      customer_id: customerId,
      payment_date: date,
      payment_method: method,
      reference_number: reference.trim() || null,
      bank_name: bankName.trim() || null,
      amount_received: num(amount),
      tds_amount: hasTds ? num(tds) : 0,
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
            <select
              className={inputClass}
              value={customerId ?? ""}
              disabled={isEdit}
              onChange={(e) => {
                setCustomerId(e.target.value ? Number(e.target.value) : null);
                setAllocations({});
                setUseAdvance(false);
              }}
            >
              <option value="">Choose a customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.city ? ` — ${c.city}` : ""}
                </option>
              ))}
            </select>
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
          <Field label="Customer's bank">
            <input className={inputClass} value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </Field>
          <div className="pt-6">
            <Checkbox checked={hasTds} onChange={setHasTds} label="TDS was deducted" />
          </div>
          {hasTds && (
            <Field
              label="TDS amount (₹)"
              hint={tdsRecognized ? "Counts towards the invoices as paid." : "Recorded only; the invoices stay unpaid by this amount."}
            >
              <input
                type="number"
                min={0}
                step="0.01"
                className={`${inputClass} tabular`}
                value={tds}
                onChange={(e) => setTds(e.target.value)}
              />
            </Field>
          )}
          {hasTds && (
            <div className="col-span-2">
              <Checkbox
                checked={tdsRecognized}
                onChange={setTdsRecognized}
                label="Recognise TDS"
                description="Turn off until the TDS certificate arrives; the amount then stays outstanding."
              />
            </div>
          )}
        </div>

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
                          className="h-4 w-4 accent-slate-900"
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
          {hasTds && <SummaryRow label={tdsRecognized ? "TDS" : "TDS (not recognised)"} value={num(tds)} />}
          {advanceUsed > 0 && <SummaryRow label="Advance used" value={advanceUsed} />}
          {writeoff > 0 && <SummaryRow label="Written off" value={writeoff} />}
          <SummaryRow label="Applied to invoices" value={allocated} />
          {shortBy > 0.005 ? (
            <div className="border-t border-slate-200 pt-3 mt-2 space-y-2">
              <div className="flex justify-between font-medium text-amber-800">
                <span>Short</span>
                <span>{formatMoney(shortBy)}</span>
              </div>
              {shortBy <= ADJUSTMENT_LIMIT ? (
                <>
                  <Checkbox
                    checked={settleInFull}
                    onChange={setSettleInFull}
                    label={`Settle in full: write off ${formatMoney(shortBy)}`}
                    description="The customer paid less than the invoices total and you accept it as full payment. The invoices show as paid."
                  />
                  {settleInFull && shortBy > ADJUSTMENT_WARN && (
                    <p className="text-xs text-amber-700">That is a large amount to write off. Check it is right.</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Write-offs are limited to {formatMoney(ADJUSTMENT_LIMIT)}. Lower the amounts applied instead.
                </p>
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
                  disabled={leftover > ADJUSTMENT_LIMIT}
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
      <input type="radio" className="accent-slate-900" checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}
