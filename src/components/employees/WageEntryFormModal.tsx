import { useState } from "react";
import { EmployeePayment, EmployeePaymentInput, PayMonthDetail, WageKind } from "../../types/payroll";
import { PAYMENT_METHODS } from "../../types/payment";
import { createEmployeePayment, deleteEmployeePayment, getPayMonth, updateEmployeePayment } from "../../services/api";
import { errorMessage, formatMoney, monthTitle, round2, shiftMonth, todayISO } from "../../lib/format";
import { WAGE_KIND_LABEL } from "../../lib/payroll";
import { Alert, Button, Checkbox, ConfirmDialog, Field, inputClass, Loading, Modal, SearchSelect, useToast } from "../ui";

interface Props {
  /** The month the entry is for; null asks for the employee first (Give advance on the pay sheet). */
  detail: PayMonthDetail | null;
  kind: WageKind;
  existing?: EmployeePayment;
  /** Who can be picked when `detail` is null. */
  employeeChoices?: { id: number; name: string; role: string | null }[];
  month: string;
  onClose: () => void;
  /** The month's new detail, or null after a delete. */
  onSaved: (detail: PayMonthDetail | null) => void;
}

const TITLES: Record<WageKind, string> = {
  ADVANCE: "Give advance",
  SALARY: "Pay salary",
  RETURNED: "Cash returned",
  WRITE_OFF: "Write off",
  CARRIED: "Take from next month",
};

/** Record money for one employee's month: an advance, salary (with round-off), or settling an overpaid month. */
export default function WageEntryFormModal({ detail: given, kind, existing, employeeChoices = [], month, onClose, onSaved }: Props) {
  const toast = useToast();
  const [detail, setDetail] = useState<PayMonthDetail | null>(given);
  const [picking, setPicking] = useState(false);
  const balance = detail?.figures.balance ?? 0;
  // When editing, the month's figures already include this entry; work out the balance without it.
  const balanceWithout = existing
    ? round2(
        balance +
          (existing.kind === "ADVANCE" || existing.kind === "SALARY" ? existing.amount + existing.round_off : -existing.amount)
      )
    : balance;
  const overpaid = balanceWithout < 0 ? -balanceWithout : 0;
  const initialAmount = existing
    ? String(existing.amount)
    : kind === "SALARY"
      ? balanceWithout > 0
        ? String(balanceWithout)
        : ""
      : kind === "ADVANCE"
        ? ""
        : overpaid > 0
          ? String(overpaid)
          : "";

  const [amount, setAmount] = useState(initialAmount);
  const [date, setDate] = useState(existing?.entry_date ?? todayISO());
  const [method, setMethod] = useState(existing?.payment_method ?? "Cash");
  const [note, setNote] = useState(existing?.note ?? "");
  const [finish, setFinish] = useState(existing ? existing.round_off !== 0 : false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const needsMethod = kind === "ADVANCE" || kind === "SALARY" || kind === "RETURNED";
  const amountValue = Number(amount);
  const amountOk = amount.trim() !== "" && amountValue > 0;
  const difference = round2(balanceWithout - (amountOk ? amountValue : 0));
  const canRound = kind === "SALARY" && detail?.row != null && amountOk && difference !== 0;

  const pick = async (id: number) => {
    setPicking(true);
    setError(null);
    try {
      setDetail(await getPayMonth(id, month));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPicking(false);
    }
  };

  const save = async () => {
    if (!detail) return setError("Choose the employee.");
    setError(null);
    if (!amountOk) return setError("Enter an amount more than 0.");
    if (!date) return setError("Enter the date.");
    const input: EmployeePaymentInput = {
      employee_id: detail.employee.id,
      month,
      kind,
      entry_date: date,
      amount: amountValue,
      finish: canRound && finish,
      payment_method: needsMethod ? method : null,
      note: note.trim() || null,
    };
    setSaving(true);
    try {
      const d = existing ? await updateEmployeePayment(existing.id, input) : await createEmployeePayment(input);
      toast(`${WAGE_KIND_LABEL[kind]} saved`);
      onSaved(d);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const title = existing ? `Edit ${WAGE_KIND_LABEL[kind].toLowerCase()}` : TITLES[kind];

  return (
    <>
      <Modal
        title={title}
        subtitle={detail ? `${detail.employee.name} · ${monthTitle(month)}` : monthTitle(month)}
        onClose={onClose}
        size="md"
        footer={
          <>
            {existing && (
              <Button variant="dangerText" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} disabled={!detail} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          {error && <Alert>{error}</Alert>}

          {given === null && (
            <Field label="Employee" required>
              <SearchSelect
                ariaLabel="Employee"
                options={employeeChoices.map((c) => ({ id: c.id, label: c.name, detail: c.role ?? undefined, search: `${c.name} ${c.role ?? ""}` }))}
                value={detail?.employee.id ?? null}
                onChange={pick}
                placeholder="Type a name…"
              />
            </Field>
          )}
          {picking && <Loading />}

          {detail && (
            <>
              <p className="text-slate-600 tabular">
                {balanceWithout > 0
                  ? `Still to pay: ${formatMoney(balanceWithout)}`
                  : balanceWithout < 0
                    ? `Overpaid: ${formatMoney(-balanceWithout)}`
                    : detail.row
                      ? "Nothing left to pay."
                      : "Days not entered yet."}
              </p>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Amount (₹)" required>
                  <input
                    aria-label="Amount"
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${inputClass} tabular`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
                <Field label="Date" required>
                  <input aria-label="Date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                {needsMethod && (
                  <Field label="Paid by">
                    <select aria-label="Paid by" className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
                      {!PAYMENT_METHODS.includes(method as never) && <option>{method}</option>}
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Note" className={needsMethod ? "" : "col-span-2"}>
                  <input aria-label="Note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>

              {kind === "SALARY" && canRound && (
                <div className="space-y-1">
                  <Checkbox checked={finish} onChange={setFinish} label="Round off and finish" />
                  {finish ? (
                    <p className="text-slate-600 tabular">
                      {difference > 0 ? `Rounded off ${formatMoney(difference)} (paid less)` : `${formatMoney(-difference)} extra, counted as paid`}
                    </p>
                  ) : (
                    difference < 0 && (
                      <p className="text-amber-700 tabular">This pays {formatMoney(-difference)} more than is due. The month will show Overpaid.</p>
                    )
                  )}
                  {finish && Math.abs(difference) > 100 && (
                    <p className="text-amber-700">That's a round-off of more than ₹100. Check the amount.</p>
                  )}
                </div>
              )}
              {kind === "ADVANCE" && amountOk && amountValue > balanceWithout && detail.row && (
                <p className="text-amber-700 tabular">This is more than is still due. The month will show Overpaid.</p>
              )}
              {kind === "CARRIED" && <p className="text-slate-600">It will show as an advance on {monthTitle(shiftMonth(month, 1))} pay.</p>}
            </>
          )}
        </div>
      </Modal>

      {confirmDelete && existing && (
        <ConfirmDialog
          title={`Delete this ${WAGE_KIND_LABEL[kind].toLowerCase()}?`}
          message={
            kind === "CARRIED"
              ? `The advance on ${monthTitle(shiftMonth(month, 1))} goes too, and ${monthTitle(month)} shows the difference again.`
              : `${monthTitle(month)} will show the difference again.`
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            await deleteEmployeePayment(existing.id);
            toast("Deleted");
            onSaved(null);
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
