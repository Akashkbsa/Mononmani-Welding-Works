import { useEffect, useMemo, useState } from "react";
import { Customer } from "../../types/customer";
import { PAYMENT_METHODS } from "../../types/payment";
import { SupplierExcessAction, SupplierPaymentInput, SupplierPaymentWithAllocations, UnpaidBill } from "../../types/supplierPayment";
import {
  createSupplierPayment,
  getNextSupplierPaymentNumber,
  getSupplierCredits,
  getUnpaidBillsForSupplier,
  listCustomers,
  updateSupplierPayment,
} from "../../services/api";
import { errorMessage, formatDate, formatMoney, round2, todayISO } from "../../lib/format";
import { Alert, Button, Checkbox, Field, inputClass, Loading, Modal, textareaClass, useDiscardGuard } from "../ui";
import CustomerPicker from "../CustomerPicker";

interface Props {
  payment?: SupplierPaymentWithAllocations | null;
  initialSupplierId?: number;
  initialBillId?: number;
  onClose: () => void;
  onSaved: () => void;
}

const num = (v: string | number | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

export default function SupplierPaymentFormModal({ payment, initialSupplierId, initialBillId, onClose, onSaved }: Props) {
  const existing = payment?.payment;
  const isEdit = !!existing;
  const guard = useDiscardGuard(onClose);

  const [suppliers, setSuppliers] = useState<Customer[]>([]);
  const [supplierId, setSupplierId] = useState<number | null>(existing?.supplier_id ?? initialSupplierId ?? null);
  const [paymentNumber, setPaymentNumber] = useState(existing?.payment_number ?? "");
  const [date, setDate] = useState(existing?.payment_date ?? todayISO());
  const [amount, setAmount] = useState(existing ? String(existing.amount_paid) : "");
  const [method, setMethod] = useState(existing?.payment_method ?? "Bank Transfer");
  const [reference, setReference] = useState(existing?.reference_number ?? "");
  const [bankName, setBankName] = useState(existing?.bank_name ?? "");
  const [remarks, setRemarks] = useState(existing?.remarks ?? "");
  const [excessAction, setExcessAction] = useState<SupplierExcessAction>(existing?.excess_action === "ROUNDOFF" ? "ROUNDOFF" : "CREDIT");
  const [settleInFull, setSettleInFull] = useState((existing?.writeoff_amount ?? 0) > 0);

  const [bills, setBills] = useState<UnpaidBill[] | null>(null);
  const [allocations, setAllocations] = useState<Record<number, string>>(() =>
    Object.fromEntries((payment?.allocations ?? []).map((a) => [a.bill_id, String(a.allocated_amount)]))
  );
  const [advanceAvailable, setAdvanceAvailable] = useState(0);
  const [useAdvance, setUseAdvance] = useState((existing?.credit_applied ?? 0) > 0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCustomers("SUPPLIER")
      .then(setSuppliers)
      .catch((err) => setError(errorMessage(err)));
    if (!isEdit) {
      getNextSupplierPaymentNumber()
        .then(setPaymentNumber)
        .catch((err) => setError(errorMessage(err)));
    }
  }, [isEdit]);

  // Load what we owe this supplier and any advance paid to them.
  useEffect(() => {
    if (supplierId === null) {
      setBills([]);
      setAdvanceAvailable(0);
      return;
    }
    let cancelled = false;
    setBills(null);
    Promise.all([getUnpaidBillsForSupplier(supplierId, existing?.id), getSupplierCredits(supplierId, existing?.id)])
      .then(([list, credits]) => {
        if (cancelled) return;
        setBills(list);
        setAdvanceAvailable(round2(credits.reduce((s, c) => s + c.remaining_amount, 0)));
        if (!isEdit && initialBillId && supplierId === initialSupplierId) {
          const target = list.find((b) => b.bill_id === initialBillId);
          if (target) {
            setAllocations({ [target.bill_id]: String(target.outstanding_amount) });
            setAmount((a) => a || String(target.outstanding_amount));
          }
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [supplierId, existing?.id, isEdit, initialBillId, initialSupplierId]);

  const base = round2(num(amount));
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

  // Ticked bills that would still show a balance after this payment.
  const partials = (bills ?? [])
    .filter((b) => b.bill_id in allocations)
    .map((b) => ({ bill: b, left: round2(b.outstanding_amount - num(allocations[b.bill_id])) }))
    .filter((x) => x.left > 0.005);

  const overAllocated = useMemo(
    () => (bills ?? []).filter((b) => num(allocations[b.bill_id]) > b.outstanding_amount + 0.005),
    [bills, allocations]
  );

  const toggleBill = (bill: UnpaidBill) => {
    setAllocations((prev) => {
      const next = { ...prev };
      if (bill.bill_id in next) {
        delete next[bill.bill_id];
      } else {
        const used = Object.values(next).reduce((s, v) => s + num(v), 0);
        const funds = base + (useAdvance ? advanceAvailable : 0) - used;
        const share = funds > 0 ? Math.min(funds, bill.outstanding_amount) : bill.outstanding_amount;
        next[bill.bill_id] = String(round2(share));
      }
      return next;
    });
  };

  /** Spread the money over the oldest bills first. */
  const allocateOldestFirst = () => {
    guard.markDirty();
    const next: Record<number, string> = {};
    let funds = base + (useAdvance ? advanceAvailable : 0);
    for (const bill of bills ?? []) {
      if (funds <= 0.005) break;
      const share = round2(Math.min(funds, bill.outstanding_amount));
      next[bill.bill_id] = String(share);
      funds = round2(funds - share);
    }
    setAllocations(next);
  };

  const save = async () => {
    setError(null);
    if (supplierId === null) return setError("Choose the supplier you paid.");
    if (!date) return setError("Enter the payment date.");
    if (num(amount) < 0) return setError("Amounts cannot be negative.");
    if (base <= 0 && advanceUsed <= 0) return setError("Enter the amount paid.");
    if (overAllocated.length) {
      return setError(`The amount for bill ${overAllocated[0].bill_number} is more than its balance.`);
    }
    if (shortBy > 0.005 && writeoff === 0) {
      return setError(
        `You've applied ${formatMoney(shortBy)} more than was paid. Tick "Accept as full payment" to write it off, or lower the amounts.`
      );
    }

    const input: SupplierPaymentInput = {
      payment_number: isEdit ? null : paymentNumber.trim() || null,
      supplier_id: supplierId,
      payment_date: date,
      payment_method: method,
      reference_number: reference.trim() || null,
      bank_name: bankName.trim() || null,
      amount_paid: num(amount),
      credit_to_apply: useAdvance ? advanceAvailable : 0,
      remarks: remarks.trim() || null,
      allocations: Object.entries(allocations)
        .map(([id, v]) => ({ bill_id: Number(id), allocated_amount: num(v) }))
        .filter((a) => a.allocated_amount > 0),
      excess_action: leftover > 0 ? excessAction : "NONE",
      writeoff_amount: writeoff,
    };

    setSaving(true);
    try {
      if (isEdit) await updateSupplierPayment(existing!.id, input);
      else await createSupplierPayment(input);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const supplierName = suppliers.find((c) => c.id === supplierId)?.name ?? existing?.supplier_name;

  return (
    <>
      <Modal
        title={isEdit ? `Edit payment ${existing!.payment_number}` : "Record supplier payment"}
        subtitle={isEdit ? supplierName : undefined}
        onClose={guard.requestClose}
        size="lg"
        footer={
          <>
            <Button onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {isEdit ? "Save changes" : "Record payment"}
            </Button>
          </>
        }
      >
        <div className="space-y-6" onChangeCapture={guard.markDirty}>
          {error && <Alert>{error}</Alert>}

          <div className="grid grid-cols-3 gap-4">
            <Field label="Supplier" required className="col-span-2">
              <CustomerPicker
                customers={suppliers}
                value={supplierId}
                ariaLabel="Supplier"
                noun="supplier"
                disabled={isEdit}
                fallbackLabel={existing?.supplier_name}
                onChange={(c) => {
                  guard.markDirty();
                  setSupplierId(c.id);
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
            <Field label="Amount paid (₹)" required>
              <input
                type="number"
                min={0}
                step="0.01"
                className={`${inputClass} tabular`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Date paid" required>
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
            <Field label="Bank (optional)">
              <input className={inputClass} value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </Field>
          </div>

          {/* Bills this payment covers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-900">Apply to bills</h3>
              {bills && bills.length > 0 && (
                <Button size="sm" variant="ghost" onClick={allocateOldestFirst}>
                  Fill oldest first
                </Button>
              )}
            </div>

            {supplierId === null ? (
              <p className="text-sm text-slate-500">Choose a supplier to see their unpaid bills.</p>
            ) : bills === null ? (
              <Loading />
            ) : bills.length === 0 ? (
              <p className="text-sm text-slate-500">This supplier has no unpaid bills. The amount will be kept as an advance.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="w-8" />
                    <th className="py-2 font-medium">Bill</th>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium text-right">Balance</th>
                    <th className="py-2 font-medium text-right w-40">Apply (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bills.map((bill) => {
                    const selected = bill.bill_id in allocations;
                    const over = overAllocated.includes(bill);
                    return (
                      <tr key={bill.bill_id}>
                        <td className="py-2">
                          <input
                            type="checkbox"
                            aria-label={`Apply to ${bill.bill_number}`}
                            className="h-4 w-4 accent-brand-600"
                            checked={selected}
                            onChange={() => toggleBill(bill)}
                          />
                        </td>
                        <td className="py-2 font-medium">{bill.bill_number}</td>
                        <td className="py-2 text-slate-600">{formatDate(bill.bill_date)}</td>
                        <td className="py-2 text-right tabular">{formatMoney(bill.outstanding_amount)}</td>
                        <td className="py-1.5 text-right">
                          {selected && (
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className={`${inputClass} h-8 text-right tabular ${over ? "border-red-400" : ""}`}
                              value={allocations[bill.bill_id]}
                              onChange={(e) => setAllocations((a) => ({ ...a, [bill.bill_id]: e.target.value }))}
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
                  label={`Use advance paid earlier (${formatMoney(advanceAvailable)} available)`}
                  description="Covers any amount applied beyond what you are paying now."
                />
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="rounded-md border border-slate-200 p-4 text-sm tabular space-y-1.5">
            <SummaryRow label="Paid" value={num(amount)} />
            {advanceUsed > 0 && <SummaryRow label="Advance used" value={advanceUsed} />}
            {writeoff > 0 && <SummaryRow label="Written off" value={writeoff} />}
            <SummaryRow label="Applied to bills" value={allocated} />
            {shortBy > 0.005 ? (
              <div className="border-t border-slate-200 pt-3 mt-2 space-y-2">
                <div className="flex justify-between font-medium text-amber-800">
                  <span>Short</span>
                  <span>{formatMoney(shortBy)}</span>
                </div>
                <Checkbox
                  checked={settleInFull}
                  onChange={setSettleInFull}
                  label={`Accept as full payment: write off ${formatMoney(shortBy)}`}
                  description="You paid less than the bills total and the supplier accepts it as full payment. The bills show as fully paid."
                />
                {!settleInFull && <p className="text-red-600">Applied is {formatMoney(shortBy)} more than the money available.</p>}
              </div>
            ) : partials.length > 0 && leftover <= 0.005 ? (
              <div className="border-t border-slate-200 pt-3 mt-2 space-y-1.5">
                {partials.map(({ bill, left }) => (
                  <div key={bill.bill_id} className="flex items-center justify-between gap-3 text-slate-600">
                    <span>
                      Bill {bill.bill_number} will still show {formatMoney(left)} due.
                    </span>
                    <Button
                      size="sm"
                      onClick={() => {
                        guard.markDirty();
                        setAllocations((a) => ({ ...a, [bill.bill_id]: String(bill.outstanding_amount) }));
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
                  <Radio checked={excessAction === "ROUNDOFF"} onChange={() => setExcessAction("ROUNDOFF")} label="Keep as round-off" />
                  <Radio checked={excessAction === "CREDIT"} onChange={() => setExcessAction("CREDIT")} label="Keep as advance with this supplier" />
                </div>
                <p className="text-xs text-slate-500">
                  {excessAction === "ROUNDOFF"
                    ? "Counted as paid, not held as an advance and not owed back."
                    : "Held as an advance and used on this supplier's later bills."}
                </p>
                {isEdit && existing!.advance_used > 0 && (
                  <p className="text-xs text-slate-500">
                    {formatMoney(existing!.advance_used)} of this advance has already been used by a later payment.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <Field label="Remarks">
            <textarea className={textareaClass} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </div>
      </Modal>
      {guard.confirm}
    </>
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
    <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
      <input type="radio" className="accent-brand-600" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
