import { useEffect, useMemo, useState } from "react";
import { CalendarDays, HandCoins, HardHat, Plus, Printer } from "lucide-react";
import { getPaySheet, printMonthPaySlips, savePaySheet } from "../../services/api";
import { currentMonth, errorMessage, formatMoney, monthTitle, round2, shiftMonth } from "../../lib/format";
import { entryChanged, parseQuantity, payLine, settleNotes, shortStatusText, statusText, statusTone } from "../../lib/payroll";
import { PaySheet, PaySheetEntry, PaySheetRow } from "../../types/payroll";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, inputClass, ListSkeleton, rowClass, rowProps, theadClass, useToast } from "../ui";
import MonthFilter from "../MonthFilter";
import { usePageShortcuts } from "../../lib/usePageShortcuts";
import EmployeeFormModal from "./EmployeeFormModal";
import PayMonthModal from "./PayMonthModal";
import WageEntryFormModal from "./WageEntryFormModal";

type Draft = { days: string; hours: string };

/** What a typed row means: skipped, an error to show, or a row to save. */
function readDraft(r: PaySheetRow, d: Draft): { days: string | null; hours: string | null; entry: PaySheetEntry | null } {
  const days = parseQuantity(d.days, "days");
  const hours = parseQuantity(d.hours, "hours");
  if (days.error || hours.error) return { days: days.error, hours: hours.error, entry: null };
  if (days.value === null) {
    if (r.row) return { days: "Enter days (0 if absent)", hours: null, entry: null };
    if (hours.value !== null && hours.value > 0) return { days: "Enter days first", hours: null, entry: null };
    return { days: null, hours: null, entry: null };
  }
  return { days: null, hours: null, entry: { employee_id: r.employee_id, days_worked: days.value, ot_hours: hours.value ?? 0 } };
}

/** One month for everyone: days, overtime, what they earned, what was paid and what is left. */
export default function PaySheetTab() {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [sheet, setSheet] = useState<PaySheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, Draft> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [creating, setCreating] = useState(false);
  const [giving, setGiving] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPaySheet(month)
      .then((s) => {
        if (cancelled) return;
        setSheet(s);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [month, version]);

  const reload = () => setVersion((v) => v + 1);

  // Everyone with days entered, one page each, in one PDF opened in the PDF viewer.
  const printAll = async () => {
    setPrinting(true);
    setError(null);
    try {
      const done = await printMonthPaySlips(month);
      toast(`Pay slips for ${done.count} ${done.count === 1 ? "employee" : "employees"} opened. Print them from the PDF viewer.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPrinting(false);
    }
  };
  usePageShortcuts({ onNew: () => setCreating(true) });

  // Every month from the first record to the last, as dates for the picker.
  const monthDates = useMemo(() => {
    if (!sheet) return [];
    const out: string[] = [];
    for (let m = sheet.first_month; m <= sheet.last_month && out.length < 1200; m = shiftMonth(m, 1)) out.push(`${m}-01`);
    return out;
  }, [sheet]);

  const editing = drafts !== null;
  const future = month > currentMonth();

  const startEditing = () => {
    if (!sheet) return;
    const d: Record<number, Draft> = {};
    for (const r of sheet.rows) d[r.employee_id] = { days: r.row ? String(r.row.days_worked) : "", hours: r.row && r.row.ot_hours > 0 ? String(r.row.ot_hours) : "" };
    setDrafts(d);
    setDirty(false);
  };

  const stopEditing = () => {
    setDrafts(null);
    setDirty(false);
  };

  const setDraft = (id: number, part: Partial<Draft>) => {
    setDrafts((d) => (d ? { ...d, [id]: { ...d[id], ...part } } : d));
    setDirty(true);
  };

  const read = useMemo(() => {
    const out: Record<number, ReturnType<typeof readDraft>> = {};
    if (sheet && drafts) for (const r of sheet.rows) out[r.employee_id] = readDraft(r, drafts[r.employee_id] ?? { days: "", hours: "" });
    return out;
  }, [sheet, drafts]);
  const hasErrors = Object.values(read).some((x) => x.days || x.hours);

  const saveDays = async () => {
    // Only rows that changed: an untouched month is never re-checked or re-saved.
    const entries = (sheet?.rows ?? [])
      .map((r) => ({ r, entry: read[r.employee_id]?.entry ?? null }))
      .filter((x): x is { r: PaySheetRow; entry: PaySheetEntry } => x.entry !== null && entryChanged(x.r, x.entry))
      .map((x) => x.entry);
    setSaving(true);
    setError(null);
    try {
      setSheet(await savePaySheet(month, entries));
      toast(`Saved days for ${entries.length} ${entries.length === 1 ? "employee" : "employees"}`);
      stopEditing();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  /** While typing, the pay columns preview the typed days with the month's rates. */
  const shown = (r: PaySheetRow) => {
    const x = read[r.employee_id];
    if (!editing || !x?.entry) return { wages: r.figures.wages, ot: r.figures.ot_amount, earned: r.figures.earned, entered: r.row !== null };
    const wage = r.row ? r.row.daily_wage : r.current_wage;
    const rate = r.row ? r.row.ot_rate : r.current_ot_rate;
    const wages = payLine(x.entry.days_worked, wage);
    const ot = payLine(x.entry.ot_hours, rate);
    return { wages, ot, earned: round2(wages + ot + r.figures.bonus + r.figures.incentives), entered: true };
  };

  // Bonus and incentives share one Extras column, shown only in a month that has some.
  const hasExtras = !!sheet?.rows.some((r) => r.figures.bonus > 0 || r.figures.incentives > 0);
  // Days and OT hold inputs while typing; every cell shares the padding so the row lines up.
  const cell = editing ? "py-2 pr-3" : "py-3 pr-3";
  // The month's notes added up over everyone, for the footer.
  const sum = (pick: (r: PaySheetRow) => number) => round2((sheet?.rows ?? []).reduce((t, r) => t + pick(r), 0));
  const totalNotes = settleNotes({
    ...(sheet?.rows[0]?.figures ?? ({} as PaySheetRow["figures"])),
    written_off: sum((r) => r.figures.written_off),
    carried: sum((r) => r.figures.carried),
    rounded_off: sum((r) => (r.figures.rounded_off < 0 ? r.figures.rounded_off : 0)),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <MonthFilter
          dates={monthDates}
          value={month}
          allowAll={false}
          onChange={(m) => {
            stopEditing();
            setMonth(m || currentMonth());
          }}
        />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {editing ? (
            <>
              <Button onClick={() => (dirty ? setConfirmDiscard(true) : stopEditing())}>Cancel</Button>
              <Button variant="primary" loading={saving} disabled={hasErrors} onClick={saveDays}>
                Save days
              </Button>
            </>
          ) : (
            <>
              <Button
                icon={<Printer className="w-4 h-4" />}
                loading={printing}
                disabled={!sheet || sheet.rows.length === sheet.not_entered}
                title="Everyone's pay slip for this month in one PDF"
                onClick={printAll}
              >
                Pay slips
              </Button>
              <Button icon={<HandCoins className="w-4 h-4" />} disabled={!sheet || sheet.rows.length === 0 || future} onClick={() => setGiving(true)}>
                Give advance
              </Button>
              <Button
                variant="primary"
                icon={<CalendarDays className="w-4 h-4" />}
                disabled={!sheet || sheet.rows.length === 0 || future}
                onClick={startEditing}
              >
                Enter days
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        {sheet === null ? (
          <ListSkeleton rows={4} label="Loading the pay sheet" />
        ) : sheet.rows.length === 0 ? (
          <EmptyState
            icon={HardHat}
            title={`No one on the pay sheet for ${monthTitle(month)}`}
            description="Add your employees first, with their daily wage and OT rate."
            action={
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                New employee
              </Button>
            }
          />
        ) : (
          <table data-hide-narrow="4 5" className="mww-fade w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="py-2.5 px-4 font-semibold">Name</th>
                <th className="py-2.5 pr-3 font-semibold text-right w-12">Days</th>
                <th className="py-2.5 pr-3 font-semibold text-right w-16 whitespace-nowrap">OT hrs</th>
                <th className="py-2.5 pr-3 font-semibold text-right">Wages</th>
                <th className="py-2.5 pr-3 font-semibold text-right">OT</th>
                {hasExtras && <th className="py-2.5 pr-3 font-semibold text-right @max-[44rem]:hidden">Extras</th>}
                <th className="py-2.5 pr-3 font-semibold text-right">Earned</th>
                <th className="py-2.5 pr-3 font-semibold text-right @max-[44rem]:hidden">Paid</th>
                <th className="py-2.5 pl-1 pr-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sheet.rows.map((r) => {
                const s = shown(r);
                const x = read[r.employee_id];
                const d = drafts?.[r.employee_id];
                const notes = settleNotes(r.figures);
                const extras = [
                  ...(r.figures.bonus > 0 ? [`Bonus${r.row?.bonus_note ? ` (${r.row.bonus_note})` : ""}: ${formatMoney(r.figures.bonus)}`] : []),
                  ...(r.row?.incentives ?? []).map((i) => `${i.reason}: ${formatMoney(i.amount)}`),
                ];
                const extrasTotal = r.figures.bonus + r.figures.incentives;
                return (
                  <tr key={r.employee_id} {...(editing ? {} : rowProps(() => setViewing(r.employee_id)))} className={editing ? undefined : rowClass}>
                    <td className={`max-w-[16rem] ${cell} pl-4`}>
                      <div className="truncate font-medium text-slate-900" title={r.name}>
                        {r.name}
                      </div>
                      {r.role && <div className="text-xs text-slate-500">{r.role}</div>}
                    </td>
                    <td className={`${cell} text-right tabular`}>
                      {editing && d ? (
                        <QtyInput label={`Days for ${r.name}`} value={d.days} error={x?.days ?? null} onChange={(v) => setDraft(r.employee_id, { days: v })} />
                      ) : r.row ? (
                        r.row.days_worked
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${cell} text-right tabular`}>
                      {editing && d ? (
                        <QtyInput label={`OT hours for ${r.name}`} value={d.hours} error={x?.hours ?? null} onChange={(v) => setDraft(r.employee_id, { hours: v })} />
                      ) : r.row ? (
                        r.row.ot_hours
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${cell} text-right tabular`}>{s.entered ? formatMoney(s.wages) : "—"}</td>
                    <td className={`${cell} text-right tabular`}>{s.entered && s.ot > 0 ? formatMoney(s.ot) : "—"}</td>
                    {hasExtras && (
                      <td className={`${cell} text-right tabular @max-[44rem]:hidden`} title={extras.join("\n") || undefined}>
                        {extrasTotal > 0 ? formatMoney(extrasTotal) : "—"}
                        {extras.length > 1 && <div className="text-xs text-slate-500">{extras.length} items</div>}
                      </td>
                    )}
                    <td className={`${cell} text-right tabular font-medium`}>{s.entered ? formatMoney(s.earned) : "—"}</td>
                    <td className={`${cell} text-right tabular @max-[44rem]:hidden`}>
                      {r.figures.given > 0 ? formatMoney(r.figures.given) : "—"}
                      {notes.map((n) => (
                        <div key={n} className="text-xs text-slate-500">
                          {n}
                        </div>
                      ))}
                    </td>
                    <td className={`${cell} pl-1`}>
                      <span title={statusText(r.status, r.figures)}>
                        <Badge tone={statusTone(r.status, r.figures)}>{shortStatusText(r.status, r.figures)}</Badge>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 text-sm">
              <tr>
                <td className="py-2.5 px-4 font-semibold" colSpan={hasExtras ? 6 : 5}>
                  {sheet.not_entered > 0 ? `${sheet.not_entered} not entered` : "Everyone entered"}
                </td>
                <td className="py-2.5 pr-4 text-right tabular font-semibold">{formatMoney(sheet.total_earned)}</td>
                <td className="py-2.5 pr-4 text-right tabular font-semibold">{formatMoney(sheet.total_given)}</td>
                <td className="py-2.5 pl-1 pr-3 tabular font-semibold">
                  To pay {formatMoney(sheet.total_to_pay)}
                  {totalNotes.map((n) => (
                    <div key={n} className="text-xs font-normal text-slate-500">
                      {n}
                    </div>
                  ))}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {creating && (
        <EmployeeFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {giving && sheet && (
        <WageEntryFormModal
          detail={null}
          kind="ADVANCE"
          month={month}
          employeeChoices={sheet.rows.map((r) => ({ id: r.employee_id, name: r.name, role: r.role }))}
          onClose={() => setGiving(false)}
          onSaved={() => {
            setGiving(false);
            reload();
          }}
        />
      )}

      {viewing !== null && <PayMonthModal employeeId={viewing} month={month} onClose={() => setViewing(null)} onChanged={reload} />}

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard the days you typed?"
          message="Nothing has been saved yet."
          confirmLabel="Discard"
          onConfirm={async () => stopEditing()}
          onClose={() => setConfirmDiscard(false)}
        />
      )}
    </>
  );
}

function QtyInput({ label, value, error, onChange }: { label: string; value: string; error: string | null; onChange: (v: string) => void }) {
  return (
    <div>
      <input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        inputMode="decimal"
        className={`${inputClass} h-8 text-right tabular ${error ? "border-red-400" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <div className="mt-1 text-left text-xs text-red-600">{error}</div>}
    </div>
  );
}
