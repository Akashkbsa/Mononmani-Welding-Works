import { useCallback, useEffect, useState } from "react";
import { Copy, FileText, MessageCircle, Plus, Printer } from "lucide-react";
import { EmployeePayMessage, EmployeePayment, Incentive, PayMonthDetail, PayMonthInput, PayStatus, WageKind } from "../../types/payroll";
import {
  deletePayMonth,
  getEmployeePayMessage,
  getPayMonth,
  openEmployeePayWhatsApp,
  printPaySlip,
  savePayMonth,
  sendPaySlipWhatsApp,
} from "../../services/api";
import { errorMessage, formatDate, formatMoney, formatPhone, monthTitle, round2 } from "../../lib/format";
import { carriedInLabel, parseQuantity, shortMoney, payLine, statusText, statusTone, WAGE_KIND_LABEL } from "../../lib/payroll";
import { Alert, Badge, Button, ConfirmDialog, Field, inputClass, Loading, Modal, SectionTitle, rowClass, rowProps, useToast } from "../ui";
import IncentiveFormModal from "./IncentiveFormModal";
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
  const [incentiveForm, setIncentiveForm] = useState<{ existing?: Incentive } | null>(null);
  const [message, setMessage] = useState<EmployeePayMessage | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [slipBusy, setSlipBusy] = useState<"print" | "send" | null>(null);
  const [slipError, setSlipError] = useState<string | null>(null);
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

  // The pay message follows the saved month: it is filled again whenever the month changes.
  useEffect(() => {
    if (!detail?.row) {
      setMessage(null);
      setMessageError(null);
      return;
    }
    let cancelled = false;
    getEmployeePayMessage(employeeId, month)
      .then((m) => {
        if (cancelled) return;
        setMessage(m);
        setMessageError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setMessage(null);
        setMessageError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [detail, employeeId, month]);

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
  // Incentives are saved on their own (Add incentive), so the preview takes them as saved.
  const incentiveTotal = f.incentives;
  const preview =
    daysIn.value !== null && wageValue > 0
      ? round2(
          payLine(daysIn.value, wageValue) + payLine(hoursIn.value ?? 0, rateValue >= 0 ? rateValue : 0) + (bonusValue >= 0 ? bonusValue : 0) + incentiveTotal,
        )
      : null;
  // The working follows the boxes as they are typed: what the month will be once saved.
  const valid =
    detail.editable && daysIn.value !== null && !daysIn.error && !hoursIn.error && wageValue > 0 && rateValue >= 0 && bonusValue >= 0;
  const typed = valid
    ? {
        days: daysIn.value as number,
        hours: hoursIn.value ?? 0,
        wage: round2(wageValue),
        rate: round2(rateValue),
        wages: payLine(daysIn.value as number, wageValue),
        ot: payLine(hoursIn.value ?? 0, rateValue),
        bonus: round2(bonusValue),
        bonusNote: bonusNote.trim(),
        incentives: row?.incentives ?? [],
      }
    : null;
  const saved = row
    ? {
        days: row.days_worked,
        hours: row.ot_hours,
        wage: row.daily_wage,
        rate: row.ot_rate,
        wages: f.wages,
        ot: f.ot_amount,
        bonus: f.bonus,
        bonusNote: row.bonus_note ?? "",
        incentives: row.incentives,
      }
    : null;
  const w = typed ?? saved;
  const earned = typed && preview !== null ? preview : f.earned;
  const balance = round2(earned - f.given + f.cleared - f.rounded_off);
  const status: PayStatus = !w ? detail.status : balance > 0 ? "TO_PAY" : balance < 0 ? "OVERPAID" : "PAID";
  const shownFigures = { ...f, earned, balance };
  const unsaved =
    typed !== null &&
    (saved === null ||
      typed.days !== saved.days ||
      typed.hours !== saved.hours ||
      typed.wage !== saved.wage ||
      typed.rate !== saved.rate ||
      typed.bonus !== saved.bonus);

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
  const ownTotal = (kind: WageKind) => round2(detail.entries.filter((p) => p.kind === kind).reduce((t, p) => t + p.amount, 0));
  const returned = ownTotal("RETURNED");
  const carriedOut = ownTotal("CARRIED");

  // WhatsApp opens with the message typed in; the owner presses Send there.
  const sendOnWhatsApp = async () => {
    setOpening(true);
    try {
      setMessage(await openEmployeePayWhatsApp(employeeId, month));
      toast("WhatsApp opened. Press Send there.");
    } catch (err) {
      setMessageError(errorMessage(err));
    } finally {
      setOpening(false);
    }
  };

  // Pay slip PDF: printing opens it in the PDF viewer; sending also opens its folder and the chat.
  const paySlip = async (how: "print" | "send") => {
    setSlipBusy(how);
    setSlipError(null);
    try {
      if (how === "print") {
        await printPaySlip(employeeId, month);
        toast("Pay slip opened. Print it from the PDF viewer.");
      } else {
        await sendPaySlipWhatsApp(employeeId, month);
        toast("Drag the pay slip from the folder into the WhatsApp chat, then press Send.");
      }
    } catch (err) {
      setSlipError(errorMessage(err));
    } finally {
      setSlipBusy(null);
    }
  };

  const copyMessage = async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message.message);
      toast("Message copied");
    } catch {
      setMessageError("Could not copy the message.");
    }
  };

  return (
    <>
      <Modal
        title={`${e.name} · ${monthTitle(month)}`}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge tone={statusTone(status, shownFigures)}>{statusText(status, shownFigures)}</Badge>
            {unsaved && <span className="text-xs text-amber-700">Not saved yet</span>}
          </span>
        }
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
              {row && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setIncentiveForm({})}>
                  Add incentive
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
              {w ? (
                <>
                  <Line label={`${w.days} days × ${formatMoney(w.wage)}`} value={w.wages} />
                  {(w.hours > 0 || w.ot > 0) && <Line label={`${w.hours} h OT × ${formatMoney(w.rate)}`} value={w.ot} />}
                  {w.bonus > 0 && <Line label={`Bonus${w.bonusNote ? ` (${w.bonusNote})` : ""}`} value={w.bonus} />}
                  {w.incentives.map((i) => (
                    <Line
                      key={i.id}
                      label={`Incentive (${i.reason})`}
                      value={i.amount}
                      onOpen={detail.editable ? () => setIncentiveForm({ existing: i }) : undefined}
                    />
                  ))}
                  <Line label="Earned" value={earned} strong />
                </>
              ) : (
                <p className="text-slate-500">Days not entered yet.</p>
              )}
              {f.given > 0 && <Line label="Paid (advances and salary)" value={-f.given} />}
              {returned > 0 && <Line label="Cash returned" value={returned} />}
              {carriedOut > 0 && <Line label="Extra, to next month" value={carriedOut} />}
              {f.written_off > 0 && <Line label="Extra, written off" value={f.written_off} />}
              {f.rounded_off !== 0 && <Line label={f.rounded_off > 0 ? "Rounded off (paid less)" : "Extra, rounded off"} value={-f.rounded_off} />}
              <Line label={balance < 0 ? "Overpaid" : "Still to pay"} value={Math.abs(balance)} strong />
            </dl>
            {unsaved && <p className="mt-2 text-xs text-amber-700">Showing the figures as typed below. Press {row ? "Save month" : "Enter the days"} to keep them.</p>}
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
                              {p.round_off > 0 ? `−${shortMoney(p.round_off)} rounded off` : `+${shortMoney(-p.round_off)} rounded off`}
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

          {row && (
            <div>
              <SectionTitle>Pay slip</SectionTitle>
              {slipError && <Alert>{slipError}</Alert>}
              {unsaved && <p className="mb-2 text-xs text-amber-700">Save the month first so the pay slip shows the new figures.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button icon={<Printer className="h-4 w-4" />} loading={slipBusy === "print"} disabled={slipBusy !== null} onClick={() => paySlip("print")}>
                  Print pay slip
                </Button>
                <Button icon={<FileText className="h-4 w-4" />} loading={slipBusy === "send"} disabled={slipBusy !== null} onClick={() => paySlip("send")}>
                  Send pay slip on WhatsApp
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Sending opens the pay slip in its folder and the employee's chat. Drag the file into the chat, then press Send.
              </p>
            </div>
          )}

          {row && (
            <div>
              <SectionTitle>WhatsApp message</SectionTitle>
              {messageError && <Alert tone="info">{messageError}</Alert>}
              {message && (
                <div className="space-y-3">
                  {unsaved && <p className="text-xs text-amber-700">Save the month first to send the new figures.</p>}
                  <pre className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2.5 font-sans text-slate-700 tabular">{message.message}</pre>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" loading={opening} onClick={sendOnWhatsApp}>
                      <MessageCircle className="h-4 w-4" aria-hidden />
                      Send on WhatsApp
                    </Button>
                    <Button onClick={copyMessage}>
                      <Copy className="h-4 w-4" aria-hidden />
                      Copy message
                    </Button>
                    <span className="text-xs text-slate-500 tabular">To {formatPhone(message.number)}</span>
                  </div>
                  <p className="text-xs text-slate-500">Change the wording in Settings, WhatsApp messages.</p>
                </div>
              )}
            </div>
          )}

          {detail.editable && detail.status === "OVERPAID" && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-slate-700">
                Paid {shortMoney(-f.balance)} extra. How is it settled?
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

      {incentiveForm && (
        <IncentiveFormModal
          detail={detail}
          existing={incentiveForm.existing}
          onClose={() => setIncentiveForm(null)}
          onSaved={(d) => {
            setIncentiveForm(null);
            // Only the figures change: anything typed in the month form stays as typed.
            setDetail(d);
            onChanged();
          }}
        />
      )}

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
          message="The days, OT hours, bonus and incentives for this month will be removed. A month with payments can't be deleted; delete or move the payments first."
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

/** Money in the working; an amount taken off reads "−₹5,000.00" with a true minus sign. */
function signedMoney(value: number): string {
  return value < 0 ? `−${formatMoney(-value)}` : formatMoney(value);
}

function Line({ label, value, strong, onOpen }: { label: string; value: number; strong?: boolean; onOpen?: () => void }) {
  const look = strong ? "font-semibold text-slate-900 border-t border-slate-200 pt-1" : "text-slate-700";
  return (
    <div className={`flex justify-between gap-4 ${look}`}>
      <dt>{label}</dt>
      <dd className="flex items-center gap-3">
        {onOpen && (
          <button type="button" aria-label={`Edit ${label}`} onClick={onOpen} className="text-xs font-medium text-brand-700 hover:underline">
            Edit
          </button>
        )}
        {signedMoney(value)}
      </dd>
    </div>
  );
}
