import { useCallback, useEffect, useState } from "react";
import { EmployeePayment, PayMonthDetail, PayMonthInput, WageKind } from "../../types/payroll";
import { deletePayMonth, getPayMonth, savePayMonth } from "../../services/api";
import { errorMessage, formatDate, formatMoney, monthTitle } from "../../lib/format";
import { carriedInLabel, parseQuantity, payLine, STATUS_TONE, statusText, WAGE_KIND_LABEL } from "../../lib/payroll";
import { Alert, Badge, Button, ConfirmDialog, Field, inputClass, Loading, Modal, SectionTitle, rowClass, rowProps, useToast } from "../ui";
import WageEntryFormModal from "./WageEntryFormModal";

interface Props {
  employeeId: number;
  month: string;
  onClose: () => void;
  /** Called after anything in the month changed, so the screens behind can reload. */
  onChanged: () => void;
}

/** One employee's month: the working of the pay, the days and rates, and every payment. */
export default function PayMonthModal({ employeeId, month, onClose, onChanged }: Props) {
  const toast = useToast();
  const [detail, setDetail] = useState<PayMonthDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState("");
  const [hours, setHours] = useState("");
  const [wage, setWage] = useState("");
  const [rate, setRate] = useState("");
  const [bonus, setBonus] = useState("");
  const [bonusNote, setBonusNote] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmPaidEdit, setConfirmPaidEdit] = useState<PayMonthInput | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [entryForm, setEntryForm] = useState<{ kind: WageKind; existing?: EmployeePayment } | null>(null);

  /** Show a month's detail and fill the month form from it. */
  const show = useCallback((d: PayMonthDetail) => {
    setDetail(d);
    setDays(d.row ? String(d.row.days_worked) : "");
    setHours(d.row ? String(d.row.ot_hours) : "");
    setWage(String(d.row ? d.row.daily_wage : d.employee.daily_wage));
    setRate(String(d.row ? d.row.ot_rate : d.employee.ot_rate));
    setBonus(d.row && d.row.bonus_amount > 0 ? String(d.row.bonus_amount) : "");
    setBonusNote(d.row?.bonus_note ?? "");
    setNote(d.row?.note ?? "");
  }, []);

  const load = useCallback(async () => {
    try {
      show(await getPayMonth(employeeId, month));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [employeeId, month, show]);

  useEffect(() => {
    load();
  }, [load]);

  if (!detail) {
    return (
      <Modal title={monthTitle(month)} onClose={onClose}>
        {error ? <Alert>{error}</Alert> : <Loading />}
      </Modal>
    );
  }

  const e = detail.employee;
  const f = detail.figures;
  const row = detail.row;
  const daysIn = parseQuantity(days, "days");
  const hoursIn = parseQuantity(hours, "hours");
  const wageValue = Number(wage);
  const rateValue = rate.trim() === "" ? 0 : Number(rate);
  const bonusValue = bonus.trim() === "" ? 0 : Number(bonus);
  const preview =
    daysIn.value !== null && wageValue > 0
      ? payLine(daysIn.value, wageValue) + payLine(hoursIn.value ?? 0, rateValue >= 0 ? rateValue : 0) + (bonusValue >= 0 ? bonusValue : 0)
      : null;

  const write = async (input: PayMonthInput) => {
    setSaving(true);
    setError(null);
    try {
      show(await savePayMonth(employeeId, month, input));
      toast("Month saved");
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveMonth = () => {
    setError(null);
    if (daysIn.error || daysIn.value === null) return setError(daysIn.error ? `Days: ${daysIn.error}.` : "Enter the days (0 if absent).");
    if (hoursIn.error) return setError(`OT hours: ${hoursIn.error}.`);
    if (!(wageValue > 0)) return setError("Daily wage must be more than 0.");
    if (!(rateValue >= 0)) return setError("OT rate can't be negative.");
    if (!(bonusValue >= 0)) return setError("Bonus can't be negative.");
    const input: PayMonthInput = {
      days_worked: daysIn.value,
      ot_hours: hoursIn.value ?? 0,
      daily_wage: wageValue,
      ot_rate: rateValue,
      bonus_amount: bonusValue,
      bonus_note: bonusNote.trim() || null,
      note: note.trim() || null,
    };
    if (detail.status === "PAID" && preview !== null && Math.abs(preview - f.earned) > 0.004) return setConfirmPaidEdit(input);
    write(input);
  };

  const otWarning = (hoursIn.value ?? 0) > 0 && rateValue === 0;
  const kindLabel = (p: EmployeePayment) => (p.carried_to === month && p.kind === "CARRIED" ? carriedInLabel(p.month) : WAGE_KIND_LABEL[p.kind]);
  const allEntries = [...detail.carried_in, ...detail.entries];

  return (
    <>
      <Modal
        title={`${e.name} · ${monthTitle(month)}`}
        subtitle={<Badge tone={STATUS_TONE[detail.status]}>{statusText(detail.status, f)}</Badge>}
        onClose={onClose}
        size="lg"
        footer={
          detail.editable ? (
            <>
              {row && (
                <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                  Delete month
                </Button>
              )}
              <Button onClick={() => setEntryForm({ kind: "ADVANCE" })}>Give advance</Button>
              <Button variant="primary" onClick={() => setEntryForm({ kind: "SALARY" })}>
                Pay salary
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )
        }
      >
        <div className="space-y-6 text-sm">
          {error && <Alert>{error}</Alert>}
          {!detail.editable && <Alert tone="info">You can enter this month once it starts.</Alert>}

          <div>
            <SectionTitle>Working</SectionTitle>
            <dl className="space-y-1 tabular">
              {row ? (
                <>
                  <Line label={`${row.days_worked} days × ${formatMoney(row.daily_wage)}`} value={f.wages} />
                  {(row.ot_hours > 0 || f.ot_amount > 0) && <Line label={`${row.ot_hours} h OT × ${formatMoney(row.ot_rate)}`} value={f.ot_amount} />}
                  {f.bonus > 0 && <Line label={`Bonus${row.bonus_note ? ` (${row.bonus_note})` : ""}`} value={f.bonus} />}
                  <Line label="Earned" value={f.earned} strong />
                </>
              ) : (
                <p className="text-slate-500">Days not entered yet.</p>
              )}
              {f.given > 0 && <Line label="Paid (advances and salary)" value={-f.given} />}
              {f.cleared > 0 && <Line label="Returned, written off or taken from next month" value={f.cleared} />}
              {f.rounded_off !== 0 && <Line label={f.rounded_off > 0 ? "Rounded off (paid less)" : "Extra counted as paid"} value={-f.rounded_off} />}
              <Line label={f.balance < 0 ? "Overpaid" : "Still to pay"} value={Math.abs(f.balance)} strong />
            </dl>
          </div>

          {detail.editable && (
            <div className="rounded-md border border-slate-200 p-4 space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <Field label="Days" required error={daysIn.error ?? undefined}>
                  <input aria-label="Days" inputMode="decimal" className={`${inputClass} tabular`} value={days} onChange={(ev) => setDays(ev.target.value)} />
                </Field>
                <Field label="OT hours" error={hoursIn.error ?? undefined}>
                  <input aria-label="OT hours" inputMode="decimal" className={`${inputClass} tabular`} value={hours} onChange={(ev) => setHours(ev.target.value)} />
                </Field>
                <Field label="Daily wage (₹)">
                  <input aria-label="Daily wage" type="number" min={0} step="0.01" className={`${inputClass} tabular`} value={wage} onChange={(ev) => setWage(ev.target.value)} />
                </Field>
                <Field label="OT rate/hr (₹)">
                  <input aria-label="OT rate per hour" type="number" min={0} step="0.01" className={`${inputClass} tabular`} value={rate} onChange={(ev) => setRate(ev.target.value)} />
                </Field>
                <Field label="Bonus (₹)">
                  <input aria-label="Bonus" type="number" min={0} step="0.01" className={`${inputClass} tabular`} value={bonus} onChange={(ev) => setBonus(ev.target.value)} />
                </Field>
                <Field label="Bonus reason" className="col-span-3">
                  <input aria-label="Bonus reason" className={inputClass} placeholder="e.g. Diwali" value={bonusNote} onChange={(ev) => setBonusNote(ev.target.value)} />
                </Field>
              </div>
              <Field label="Note">
                <input aria-label="Note" className={inputClass} value={note} onChange={(ev) => setNote(ev.target.value)} />
              </Field>
              {otWarning && <p className="text-xs text-amber-700">OT hours are typed but the OT rate is 0, so overtime adds nothing.</p>}
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600 tabular">{preview !== null ? `Earned ${formatMoney(preview)}` : ""}</span>
                <Button loading={saving} onClick={saveMonth}>
                  {row ? "Save month" : "Enter the days"}
                </Button>
              </div>
            </div>
          )}

          <div>
            <SectionTitle>Payments</SectionTitle>
            {allEntries.length === 0 ? (
              <p className="text-slate-500">Nothing paid yet.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Kind</th>
                    <th className="py-2 font-medium">Method</th>
                    <th className="py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allEntries.map((p) => {
                    const own = p.month === month;
                    return (
                      <tr
                        key={`${p.id}-${own ? "own" : "in"}`}
                        {...(own && detail.editable ? rowProps(() => setEntryForm({ kind: p.kind, existing: p })) : {})}
                        className={own && detail.editable ? rowClass : undefined}
                      >
                        <td className="py-2">{formatDate(p.entry_date)}</td>
                        <td className="py-2">
                          {kindLabel(p)}
                          {p.note && <div className="text-xs text-slate-500">{p.note}</div>}
                          {p.round_off !== 0 && (
                            <div className="text-xs text-slate-500">
                              {p.round_off > 0 ? `Rounded off ${formatMoney(p.round_off)}` : `${formatMoney(-p.round_off)} extra, counted as paid`}
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-slate-600">{p.payment_method ?? "—"}</td>
                        <td className="py-2 text-right tabular">{formatMoney(p.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {detail.editable && detail.status === "OVERPAID" && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-slate-700">
                {e.name} was paid {formatMoney(-f.balance)} more than earned this month. How is it settled?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setEntryForm({ kind: "CARRIED" })}>Take from next month</Button>
                <Button onClick={() => setEntryForm({ kind: "RETURNED" })}>Cash returned</Button>
                <Button onClick={() => setEntryForm({ kind: "WRITE_OFF" })}>Write off</Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {entryForm && (
        <WageEntryFormModal
          detail={detail}
          kind={entryForm.kind}
          existing={entryForm.existing}
          month={month}
          onClose={() => setEntryForm(null)}
          onSaved={(d) => {
            setEntryForm(null);
            if (d) show(d);
            else load();
            onChanged();
          }}
        />
      )}

      {confirmPaidEdit && (
        <ConfirmDialog
          title={`Change ${monthTitle(month)}?`}
          message={`${monthTitle(month)} is already paid. Changing it will show the difference to pay or overpaid.`}
          confirmLabel="Change month"
          onConfirm={async () => {
            await write(confirmPaidEdit);
          }}
          onClose={() => setConfirmPaidEdit(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${monthTitle(month)} for ${e.name}?`}
          message="The days, OT hours and bonus for this month will be removed. A month with payments can't be deleted; delete or move the payments first."
          confirmLabel="Delete month"
          onConfirm={async () => {
            await deletePayMonth(employeeId, month);
            toast("Month deleted");
            onChanged();
            await load();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "font-semibold text-slate-900 border-t border-slate-200 pt-1" : "text-slate-700"}`}>
      <dt>{label}</dt>
      <dd>{formatMoney(value)}</dd>
    </div>
  );
}
