import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Customer, formatCustomerAddress } from "../../types/customer";
import { InvoiceInput, InvoiceItemInput, InvoiceStatus, InvoiceWithItems, TaxType } from "../../types/invoice";
import {
  checkDuplicateInvoiceNumber,
  createInvoice,
  getNextInvoiceNumber,
  getSettings,
  listCustomers,
  updateInvoice,
} from "../../services/api";
import { GST_STATES, HOME_STATE, stateCodeFor, stateName, taxTypeFor } from "../../lib/gst";
import {
  errorMessage,
  formatDate,
  formatMoney,
  formatVehicleNumber,
  joinRefDate,
  round2,
  splitRefDate,
  todayISO,
} from "../../lib/format";
import { Alert, Button, Field, inputClass, Modal, textareaClass } from "../ui";
import CustomerFormModal from "../customers/CustomerFormModal";

interface Props {
  invoice?: InvoiceWithItems | null;
  onClose: () => void;
  onSaved: (saved: InvoiceWithItems, print: boolean) => void;
}

const UNITS = ["NOS", "KGS", "MTR", "SQFT", "JOB", "SET", "LTRS"];

const DEFAULT_TERMS =
  "1. Goods once sold will not be taken back or Exchanged\n2. Dispute if any will be subject to Puducherry.\n3. Payment within due date else 21% p.a. interest will be charged";

const emptyItem = (): InvoiceItemInput => ({ description: "", hsn_sac: "9954", qum: "NOS", quantity: 1, rate: 0 });

/** The form starts from the invoice being edited, or from sensible defaults for a new one. */
function initialForm(invoice?: InvoiceWithItems | null): InvoiceInput {
  if (invoice) {
    const inv = invoice.invoice;
    return {
      ...inv,
      // Let the backend recompute the due date (used only by the PDF) from the invoice date.
      due_date: undefined,
      items: invoice.items.map((i) => ({
        description: i.description,
        hsn_sac: i.hsn_sac,
        qum: i.qum,
        quantity: i.quantity,
        rate: i.rate,
      })),
    };
  }
  const today = todayISO();
  return {
    invoice_number: "",
    invoice_date: today,
    invoice_state: HOME_STATE.name,
    customer_id: null,
    customer_name: "",
    customer_address: null,
    customer_phone: null,
    customer_gstin: null,
    customer_state: HOME_STATE.name,
    customer_state_code: HOME_STATE.code,
    po_number_and_date: null,
    vehicle_number: null,
    date_of_supply: formatDate(today),
    place_of_supply: HOME_STATE.name,
    our_dc_number_and_date: null,
    your_dc_number_and_date: null,
    delivery_note: null,
    supplier_ref: null,
    buyer_ref: null,
    dispatch_doc_no: null,
    delivery_note_date: null,
    dispatch_through: null,
    destination: null,
    terms_of_delivery: null,
    tax_type: "CGST_SGST",
    discount: 0,
    cgst_rate: 9,
    sgst_rate: 9,
    igst_rate: 18,
    bank_name: "Indian Bank",
    bank_branch: "Mettupalayam (PONDY)",
    bank_account_no: "498877880",
    bank_ifsc: "IDIB000M070",
    terms_and_conditions: DEFAULT_TERMS,
    status: "ISSUED",
    notes: null,
    items: [emptyItem()],
  };
}

/** Same arithmetic as the backend, so the totals shown are the totals saved. */
function computeTotals(form: InvoiceInput) {
  const amounts = form.items.map((i) => round2((Number(i.quantity) || 0) * (Number(i.rate) || 0)));
  const subtotal = round2(amounts.reduce((a, b) => a + b, 0));
  const discount = round2(Math.max(0, Number(form.discount) || 0));
  const taxable = Math.max(0, subtotal - discount);
  const igst = form.tax_type === "IGST";
  const cgst = igst ? 0 : round2((taxable * (Number(form.cgst_rate) || 0)) / 100);
  const sgst = igst ? 0 : round2((taxable * (Number(form.sgst_rate) || 0)) / 100);
  const igstAmount = igst ? round2((taxable * (Number(form.igst_rate) || 0)) / 100) : 0;
  // Exact to the paisa: invoice totals are not rounded to the rupee.
  const total = round2(taxable + cgst + sgst + igstAmount);
  return { amounts, subtotal, discount, cgst, sgst, igst: igstAmount, roundOff: 0, total };
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-200 pt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {title}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}

export default function InvoiceFormModal({ invoice, onClose, onSaved }: Props) {
  const isEdit = !!invoice;
  const [form, setForm] = useState<InvoiceInput>(() => initialForm(invoice));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [numberTaken, setNumberTaken] = useState(false);
  const [saving, setSaving] = useState<false | "save" | "print">(false);
  const [vehicleTouched, setVehicleTouched] = useState(false);
  // Set when the customer record's state and its GSTIN disagree, so the user can see why.
  const [stateNote, setStateNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCustomers()
      .then(setCustomers)
      .catch((err) => setError(errorMessage(err)));
    if (!invoice) {
      getNextInvoiceNumber()
        .then((n) => setForm((f) => ({ ...f, invoice_number: f.invoice_number || n })))
        .catch((err) => setError(errorMessage(err)));
      // Bank details, terms and tax rates always come from Settings.
      getSettings()
        .then((s) =>
          setForm((f) => ({
            ...f,
            bank_name: s.bank_name,
            bank_branch: s.bank_branch,
            bank_account_no: s.bank_account_no,
            bank_ifsc: s.bank_ifsc,
            terms_and_conditions: s.terms_and_conditions,
            cgst_rate: s.cgst_rate,
            sgst_rate: s.sgst_rate,
            igst_rate: s.igst_rate,
          })),
        )
        .catch((err) => setError(errorMessage(err)));
    }
  }, [invoice]);

  const totals = useMemo(() => computeTotals(form), [form]);

  const update = <K extends keyof InvoiceInput>(key: K, value: InvoiceInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /** Copies the customer's current details onto the invoice and picks the right tax. */
  const selectCustomer = (c: Customer) => {
    const code = stateCodeFor(c.state, c.gstin);
    const state = stateName(code) ?? c.state;
    const recordCode = stateCodeFor(c.state, null);
    const gstinCode = stateCodeFor(null, c.gstin);
    setStateNote(
      recordCode && gstinCode && recordCode !== gstinCode
        ? `The customer record says ${c.state}, but its GSTIN starts with ${gstinCode} (${stateName(gstinCode)}). The GSTIN's state is used for tax. If the GSTIN is wrong, correct it in the customer record.`
        : null
    );
    setForm((f) => ({
      ...f,
      customer_id: c.id,
      customer_name: c.name,
      customer_address: formatCustomerAddress(c) || null,
      customer_phone: c.phone,
      customer_gstin: c.gstin,
      customer_state: state,
      customer_state_code: code,
      place_of_supply: state ?? f.place_of_supply,
      tax_type: taxTypeFor(code),
    }));
  };

  const setCustomerState = (name: string) => {
    setStateNote(null);
    const code = stateCodeFor(name, null);
    setForm((f) => ({
      ...f,
      customer_state: name || null,
      customer_state_code: code,
      place_of_supply: name || f.place_of_supply,
      tax_type: taxTypeFor(code),
    }));
  };

  const updateItem = (index: number, patch: Partial<InvoiceItemInput>) =>
    setForm((f) => ({ ...f, items: f.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));

  const checkNumber = async () => {
    const n = form.invoice_number.trim();
    if (!n) return;
    const res = await checkDuplicateInvoiceNumber(n, invoice?.invoice.id).catch(() => null);
    setNumberTaken(!!res?.has_duplicate);
  };

  const save = async (print: boolean) => {
    setError(null);
    if (!form.customer_id && !isEdit) return setError("Choose a customer, or add a new one.");
    if (!form.customer_name.trim()) return setError("Enter the customer's name.");
    if (!form.invoice_number.trim()) return setError("Enter an invoice number.");
    if (!form.invoice_date) return setError("Enter the invoice date.");
    if (vehicleError) return setError(vehicleError);
    const blank = form.items.findIndex((i) => !i.description.trim());
    if (blank >= 0) return setError(`Line ${blank + 1} needs a description.`);
    if (form.items.some((i) => !(Number(i.quantity) > 0))) return setError("Every line needs a quantity above zero.");
    if (totals.discount > totals.subtotal) return setError("Discount cannot be more than the subtotal.");

    const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
    const cleanRef = (v: string | null) => {
      const { number, dateISO } = splitRefDate(v);
      return clean(joinRefDate(number.trim(), dateISO));
    };
    const input: InvoiceInput = {
      ...form,
      customer_address: clean(form.customer_address),
      customer_phone: clean(form.customer_phone),
      customer_gstin: clean(form.customer_gstin),
      po_number_and_date: cleanRef(form.po_number_and_date),
      vehicle_number: clean(form.vehicle_number),
      date_of_supply: clean(form.date_of_supply),
      place_of_supply: clean(form.place_of_supply),
      our_dc_number_and_date: cleanRef(form.our_dc_number_and_date),
      your_dc_number_and_date: cleanRef(form.your_dc_number_and_date),
      terms_and_conditions: clean(form.terms_and_conditions),
      notes: clean(form.notes),
      discount: Number(form.discount) || 0,
      cgst_rate: Number(form.cgst_rate) || 0,
      sgst_rate: Number(form.sgst_rate) || 0,
      igst_rate: Number(form.igst_rate) || 0,
      items: form.items.map((i) => ({ ...i, quantity: Number(i.quantity), rate: Number(i.rate) || 0 })),
    };

    setSaving(print ? "print" : "save");
    try {
      const saved = isEdit ? await updateInvoice(invoice!.invoice.id, input) : await createInvoice(input);
      onSaved(saved, print);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const knownCustomerState = GST_STATES.some((s) => s.name === form.customer_state);

  // The GSTIN's own state versus the state chosen above; tax follows the state above.
  const gstinCode = stateCodeFor(null, form.customer_gstin);
  const gstinMismatch =
    gstinCode && form.customer_state_code && gstinCode !== form.customer_state_code
      ? `The GSTIN starts with ${gstinCode} (${stateName(gstinCode)}), but the state above is ${form.customer_state}. Tax follows the state above, so check which is right.`
      : null;

  // A vehicle number saved before this check existed can stay as it is until it is changed.
  const vehicleValue = form.vehicle_number ?? "";
  const vehicleError =
    vehicleValue.trim() &&
    !formatVehicleNumber(vehicleValue) &&
    vehicleValue.trim() !== (invoice?.invoice.vehicle_number ?? "")
      ? "Not a valid Indian vehicle number. Example: TN 09 AB 1234."
      : null;

  return (
    <>
      <Modal
        title={isEdit ? `Edit invoice ${invoice!.invoice.invoice_number}` : "New invoice"}
        onClose={onClose}
        size="xl"
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button loading={saving === "save"} disabled={!!saving} onClick={() => save(false)}>
              Save
            </Button>
            <Button variant="primary" loading={saving === "print"} disabled={!!saving} onClick={() => save(true)}>
              Save and print
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {error && <Alert>{error}</Alert>}

          {/* Customer and invoice details */}
          <div className="grid grid-cols-5 gap-6">
            <div className="col-span-3 space-y-3">
              <Field label="Bill to" required>
                <div className="flex gap-2">
                  <select
                    className={inputClass}
                    value={form.customer_id ?? ""}
                    onChange={(e) => {
                      const c = customers.find((x) => x.id === Number(e.target.value));
                      if (c) selectCustomer(c);
                    }}
                  >
                    <option value="" disabled>
                      {form.customer_id === null && isEdit ? form.customer_name : "Choose a customer"}
                    </option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.city ? ` — ${c.city}` : ""}
                      </option>
                    ))}
                  </select>
                  <Button icon={<Plus className="w-4 h-4" />} onClick={() => setAddingCustomer(true)}>
                    New
                  </Button>
                </div>
              </Field>

              {(form.customer_id !== null || isEdit) && (
                <div className="rounded-md border border-slate-200 p-3 space-y-2">
                  <p className="text-xs text-slate-500">
                    As printed on this invoice. Changes here don't change the customer record.
                  </p>
                  <input
                    className={inputClass}
                    value={form.customer_name}
                    onChange={(e) => update("customer_name", e.target.value)}
                    placeholder="Name"
                  />
                  <textarea
                    className={textareaClass}
                    rows={2}
                    value={form.customer_address ?? ""}
                    onChange={(e) => update("customer_address", e.target.value)}
                    placeholder="Address"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      className={inputClass}
                      value={form.customer_phone ?? ""}
                      onChange={(e) => update("customer_phone", e.target.value)}
                      placeholder="Phone"
                    />
                    <input
                      className={`${inputClass} font-mono uppercase`}
                      value={form.customer_gstin ?? ""}
                      maxLength={15}
                      onChange={(e) => update("customer_gstin", e.target.value.toUpperCase())}
                      placeholder="GSTIN"
                    />
                    <select
                      className={inputClass}
                      value={form.customer_state ?? ""}
                      onChange={(e) => setCustomerState(e.target.value)}
                    >
                      <option value="">State</option>
                      {!knownCustomerState && form.customer_state && (
                        <option value={form.customer_state}>{form.customer_state}</option>
                      )}
                      {GST_STATES.map((s) => (
                        <option key={s.code} value={s.name}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  {(stateNote || gstinMismatch) && (
                    <p className="text-xs text-amber-700">{gstinMismatch ?? stateNote}</p>
                  )}
                </div>
              )}
            </div>

            <div className="col-span-2 space-y-3">
              <Field label="Invoice number" required error={numberTaken ? "This number is already used." : null}>
                <input
                  className={`${inputClass} font-mono`}
                  value={form.invoice_number}
                  onChange={(e) => {
                    update("invoice_number", e.target.value);
                    setNumberTaken(false);
                  }}
                  onBlur={checkNumber}
                />
              </Field>
              <Field label="Invoice date" required>
                <input
                  type="date"
                  className={inputClass}
                  value={form.invoice_date}
                  onChange={(e) => update("invoice_date", e.target.value)}
                />
              </Field>
              <Field label="Status" hint={form.status === "DRAFT" ? "Drafts don't count as money owed." : undefined}>
                <select
                  className={inputClass}
                  value={form.status}
                  onChange={(e) => update("status", e.target.value as InvoiceStatus)}
                >
                  <option value="ISSUED">Issued</option>
                  <option value="DRAFT">Draft</option>
                  {isEdit && <option value="CANCELLED">Cancelled</option>}
                </select>
              </Field>
            </div>
          </div>

          {/* Line items */}
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-2 w-8 font-medium">#</th>
                  <th className="py-2 pr-2 font-medium">Description</th>
                  <th className="py-2 pr-2 w-28 font-medium">HSN/SAC</th>
                  <th className="py-2 pr-2 w-24 font-medium">Unit</th>
                  <th className="py-2 pr-2 w-24 font-medium text-right">Qty</th>
                  <th className="py-2 pr-2 w-32 font-medium text-right">Rate</th>
                  <th className="py-2 w-32 font-medium text-right">Amount</th>
                  <th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {form.items.map((item, idx) => (
                  <tr key={idx} className="align-top">
                    <td className="py-2 text-slate-400 pt-4">{idx + 1}</td>
                    <td className="py-2 pr-2">
                      <input
                        className={inputClass}
                        value={item.description}
                        onChange={(e) => updateItem(idx, { description: e.target.value })}
                        placeholder="Work or material"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className={inputClass}
                        value={item.hsn_sac}
                        onChange={(e) => updateItem(idx, { hsn_sac: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className={inputClass}
                        list="invoice-units"
                        value={item.qum}
                        onChange={(e) => updateItem(idx, { qum: e.target.value.toUpperCase() })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        className={`${inputClass} text-right tabular`}
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, { quantity: e.target.value as unknown as number })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className={`${inputClass} text-right tabular`}
                        value={item.rate}
                        onChange={(e) => updateItem(idx, { rate: e.target.value as unknown as number })}
                      />
                    </td>
                    <td className="py-2 pt-4 text-right tabular">{formatMoney(totals.amounts[idx])}</td>
                    <td className="py-2 pl-1">
                      <button
                        type="button"
                        aria-label="Remove line"
                        disabled={form.items.length === 1}
                        onClick={() => update("items", form.items.filter((_, i) => i !== idx))}
                        className="p-2 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:invisible"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="invoice-units">
              {UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="w-4 h-4" />}
              className="mt-2"
              onClick={() => update("items", [...form.items, emptyItem()])}
            >
              Add line
            </Button>
          </div>

          {/* Tax and totals */}
          <div className="grid grid-cols-2 gap-8 border-t border-slate-200 pt-5">
            <div className="space-y-3">
              <Field
                label="Tax"
                hint={
                  form.customer_state_code
                    ? `Customer state code ${form.customer_state_code}: ${
                        taxTypeFor(form.customer_state_code) === "IGST" ? "outside" : "within"
                      } Puducherry.`
                    : undefined
                }
              >
                <div className="flex gap-2">
                  <select
                    className={inputClass}
                    value={form.tax_type}
                    onChange={(e) => update("tax_type", e.target.value as TaxType)}
                  >
                    <option value="CGST_SGST">CGST + SGST (within state)</option>
                    <option value="IGST">IGST (other state)</option>
                  </select>
                  <div
                    className="shrink-0 h-9 px-3 inline-flex items-center rounded-md bg-slate-100 text-sm text-slate-700 tabular"
                    title="Tax rates are set in Settings"
                  >
                    {form.tax_type === "IGST"
                      ? `IGST ${form.igst_rate}%`
                      : `CGST ${form.cgst_rate}% + SGST ${form.sgst_rate}%`}
                  </div>
                </div>
              </Field>
              <Field label="Discount (₹)">
                <div className="w-40">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${inputClass} text-right tabular`}
                    value={form.discount}
                    onChange={(e) => update("discount", e.target.value as unknown as number)}
                  />
                </div>
              </Field>
            </div>

            <dl className="text-sm space-y-1.5 tabular">
              <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
              {totals.discount > 0 && <Row label="Discount" value={`− ${formatMoney(totals.discount)}`} />}
              {form.tax_type === "IGST" ? (
                <Row label={`IGST ${form.igst_rate}%`} value={formatMoney(totals.igst)} />
              ) : (
                <>
                  <Row label={`CGST ${form.cgst_rate}%`} value={formatMoney(totals.cgst)} />
                  <Row label={`SGST ${form.sgst_rate}%`} value={formatMoney(totals.sgst)} />
                </>
              )}
              {totals.roundOff !== 0 && <Row label="Round off" value={formatMoney(totals.roundOff)} />}
              <div className="flex justify-between border-t border-slate-200 pt-2 mt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd>{formatMoney(totals.total)}</dd>
              </div>
            </dl>
          </div>

          <Collapsible title="Delivery details">
            <p className="mb-3 text-xs text-slate-500">
              Add the number first, then its date. Anything left empty prints as a dash.
            </p>
            <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
              <RefDateField
                label="PO number & date"
                value={form.po_number_and_date}
                onChange={(v) => update("po_number_and_date", v)}
              />
              <Field label="Vehicle number" error={vehicleTouched ? vehicleError : null}>
                <input
                  className={`${inputClass} uppercase`}
                  value={form.vehicle_number ?? ""}
                  placeholder="TN 09 AB 1234"
                  onChange={(e) => update("vehicle_number", e.target.value.toUpperCase())}
                  onBlur={() => {
                    setVehicleTouched(true);
                    const formatted = formatVehicleNumber(vehicleValue);
                    if (formatted) update("vehicle_number", formatted);
                  }}
                />
              </Field>
              <RefDateField
                label="Our DC number & date"
                value={form.our_dc_number_and_date}
                onChange={(v) => update("our_dc_number_and_date", v)}
              />
              <RefDateField
                label="Your DC number & date"
                value={form.your_dc_number_and_date}
                onChange={(v) => update("your_dc_number_and_date", v)}
              />
              <TextField label="Date of supply" value={form.date_of_supply} onChange={(v) => update("date_of_supply", v)} />
              <TextField label="Place of supply" value={form.place_of_supply} onChange={(v) => update("place_of_supply", v)} />
            </div>
          </Collapsible>

          <p className="text-xs text-slate-500">
            Printed bank details ({form.bank_name}, A/c {form.bank_account_no}), terms and tax rates come from
            Settings.
          </p>

          <Field label="Internal note" hint="Only you see this. It isn't printed.">
            <textarea
              className={textareaClass}
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
            />
          </Field>
        </div>
      </Modal>

      {addingCustomer && (
        <CustomerFormModal
          onClose={() => setAddingCustomer(false)}
          onSaved={(c) => {
            setAddingCustomer(false);
            setCustomers((list) => [c, ...list]);
            selectCustomer(c);
          }}
        />
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-600">
      <dt>{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

/**
 * A reference number and its date as one value: "number & dd-mm-yyyy". Drawn as a single
 * connected box so it reads and focuses like one field: the number takes the spare width, the
 * "&" divider is fixed, and the date sits on the right. The date is available once a number is
 * typed. Left empty, nothing is printed for it.
 */
function RefDateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const { number, dateISO } = splitRefDate(value);
  const hasNumber = !!number.trim();
  return (
    <Field label={label}>
      <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        <input
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
          value={number}
          placeholder="Number"
          aria-label={`${label}: number`}
          onChange={(e) => onChange(joinRefDate(e.target.value, dateISO))}
        />
        <span
          aria-hidden="true"
          className="grid w-8 shrink-0 place-items-center border-x border-slate-200 bg-slate-50 text-sm font-medium text-slate-500"
        >
          &amp;
        </span>
        <input
          type="date"
          className="h-full w-36 shrink-0 bg-transparent px-2 text-sm text-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-400"
          aria-label={`${label}: date`}
          title={hasNumber ? undefined : "Enter the number first"}
          disabled={!hasNumber}
          value={dateISO}
          onChange={(e) => onChange(joinRefDate(number, e.target.value))}
        />
      </div>
    </Field>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <Field label={label}>
      <input className={inputClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
