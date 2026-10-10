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
import { Alert, Badge, Button, Checkbox, Field, inputClass, Loading, Modal, textareaClass } from "../ui";

interface Props {
  payment?: PaymentWithAllocations | null;
  initialCustomerId?: number;
  initialInvoiceId?: number;
  onClose: () => void;
  onSaved: () => void;
}

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
  const [hasTds, setHasTds] = useState((existing?.tds_amount ?? 0) > 0);
  const [tds, setTds] = useState(existing && existing.tds_amount > 0 ? String(existing.tds_amount) : "");
  const [verified, setVerified] = useState(existing?.is_verified ?? true);
  const [remarks, setRemarks] = useState(existing?.remarks ?? "");
  const [excessAction, setExcessAction] = useState<ExcessAction>(
    existing?.excess_action === "REFUND" ? "REFUND" : "CREDIT"
  );

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

  const settled = round2(num(amount) + (hasTds ? num(tds) : 0));
  const allocated = round2(Object.values(allocations).reduce((s, v) => s + num(v), 0));
  const advanceUsed = useAdvance ? round2(Math.min(advanceAvailable, Math.max(0, allocated - settled))) : 0;
  const leftover = round2(Math.max(0, settled - allocated));
  const shortBy = round2(allocated - settled - advanceUsed);

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
        const funds = settled + (useAdvance ? advanceAvailable : 0) - used;
        const share = funds > 0 ? Math.min(funds, inv.outstanding_amount) : inv.outstanding_amount;
        next[inv.invoice_id] = String(round2(share));
      }
      return next;
    });
  };

  /** Spread the money over the oldest invoices first. */
  const allocateOldestFirst = () => {
    let funds = settled + (useAdvance ? advanceAvailable : 0);
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
    if (settled <= 0 && advanceUsed <= 0) return setError("Enter the amount received.");
    if (overAllocated.length) {
      return setError(`The amount for invoice ${overAllocated[0].invoice_number} is more than its balance.`);
    }
    if (shortBy > 0.005) {
      return setError(`You've allocated ${formatMoney(shortBy)} more than was received.`);
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
      credit_to_apply: useAdvance ? advanceAvailable : 0,
      is_verified: verified,
      remarks: remarks.trim() || null,
      allocations: Object.entries(allocations)
        .map(([id, v]) => ({ invoice_id: Number(id), allocated_amount: num(v) }))
        .filter((a) => a.allocated_amount > 0),
      excess_action: leftover > 0 ? excessAction : "NONE",
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
            <Field label="TDS amount (₹)" hint="Counts towards the invoices as paid.">
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
                  <th className="py-2 font-medium">Due</th>
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
                        {formatDate(inv.due_date)} {inv.is_overdue && <Badge tone="red">Overdue</Badge>}
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
          {hasTds && <SummaryRow label="TDS" value={num(tds)} />}
          {advanceUsed > 0 && <SummaryRow label="Advance used" value={advanceUsed} />}
          <SummaryRow label="Applied to invoices" value={allocated} />
          {shortBy > 0.005 ? (
            <p className="text-red-600 pt-1">Applied is {formatMoney(shortBy)} more than the money available.</p>
          ) : leftover > 0 ? (
            <div className="border-t border-slate-200 pt-3 mt-2 space-y-2">
              <div className="flex justify-between font-medium">
                <span>Left over</span>
                <span>{formatMoney(leftover)}</span>
              </div>
              <div className="flex gap-6">
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

function Radio({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-slate-700">
      <input type="radio" className="accent-slate-900" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
