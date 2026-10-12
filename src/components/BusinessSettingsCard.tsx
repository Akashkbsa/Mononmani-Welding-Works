import { useEffect, useState } from "react";
import { BusinessSettings } from "../types/settings";
import { getSettings, saveSettings } from "../services/api";
import { errorMessage } from "../lib/format";
import { Alert, Button, Card, Field, inputClass, Loading, textareaClass, useToast } from "./ui";

/** Number inputs are edited as text so a half-typed value like "1." isn't lost. */
type Form = Omit<BusinessSettings, "cgst_rate" | "sgst_rate" | "igst_rate"> & {
  cgst_rate: string;
  sgst_rate: string;
  igst_rate: string;
};

const toForm = (s: BusinessSettings): Form => ({
  ...s,
  cgst_rate: String(s.cgst_rate),
  sgst_rate: String(s.sgst_rate),
  igst_rate: String(s.igst_rate),
});

const validRate = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;

export default function BusinessSettingsCard() {
  const toast = useToast();
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSaved(toForm(s));
        setForm(toForm(s));
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, []);

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!form || !saved) return <Loading />;

  const changed = JSON.stringify(form) !== JSON.stringify(saved);
  const set = (key: keyof Form) => (value: string) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const text = (key: keyof Form, className = "") => (
    <input className={`${inputClass} ${className}`} value={form[key]} onChange={(e) => set(key)(e.target.value)} />
  );

  const rate = (key: "cgst_rate" | "sgst_rate" | "igst_rate", label: string) => (
    <Field label={label} error={errors[key]}>
      <input
        type="number"
        min={0}
        max={100}
        step="0.01"
        className={`${inputClass} tabular`}
        value={form[key]}
        onChange={(e) => set(key)(e.target.value)}
      />
    </Field>
  );

  const save = async () => {
    const found: Record<string, string> = {};
    if (!form.business_name.trim()) found.business_name = "Enter your business name.";
    for (const key of ["cgst_rate", "sgst_rate", "igst_rate"] as const) {
      if (!validRate(form[key])) found[key] = "Enter a rate between 0 and 100.";
    }
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveSettings({
        ...form,
        cgst_rate: Number(form.cgst_rate),
        sgst_rate: Number(form.sgst_rate),
        igst_rate: Number(form.igst_rate),
      });
      setSaved(toForm(result));
      setForm(toForm(result));
      toast("Settings saved.");
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 max-w-3xl space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">My business and invoice defaults</h2>
        <p className="text-sm text-slate-600 mt-1">
          These details are printed on every invoice and used when you create a new invoice. Changing them does not
          alter invoices you already made.
        </p>
      </div>

      {saveError && <Alert>{saveError}</Alert>}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Business</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Business name" required error={errors.business_name}>
            {text("business_name")}
          </Field>
          <Field label="Line under the name">{text("business_subtitle")}</Field>
          <Field label="GSTIN">
            <input
              className={`${inputClass} font-mono uppercase`}
              maxLength={15}
              value={form.gstin}
              onChange={(e) => set("gstin")(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Phone">{text("phone")}</Field>
          <Field label="Email">{text("email")}</Field>
          <Field label="Address">{text("address")}</Field>
        </div>
        <Field label="Services line" hint="Printed at the top of the invoice.">
          <textarea
            className={textareaClass}
            rows={2}
            value={form.services_banner}
            onChange={(e) => set("services_banner")(e.target.value)}
          />
        </Field>
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Bank details</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Bank">{text("bank_name")}</Field>
          <Field label="Branch">{text("bank_branch")}</Field>
          <Field label="Account number">{text("bank_account_no", "font-mono")}</Field>
          <Field label="IFSC">
            <input
              className={`${inputClass} font-mono uppercase`}
              maxLength={11}
              value={form.bank_ifsc}
              onChange={(e) => set("bank_ifsc")(e.target.value.toUpperCase())}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Tax rates</h3>
        <div className="grid grid-cols-3 gap-4">
          {rate("cgst_rate", "CGST %")}
          {rate("sgst_rate", "SGST %")}
          {rate("igst_rate", "IGST %")}
        </div>
        <p className="text-xs text-slate-500">Used on every new invoice. The usual rates are 9, 9 and 18.</p>
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Invoice terms</h3>
        <Field label="Terms & conditions" hint="One term per line.">
          <textarea
            className={textareaClass}
            rows={4}
            value={form.terms_and_conditions}
            onChange={(e) => set("terms_and_conditions")(e.target.value)}
          />
        </Field>
      </section>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button
          disabled={!changed || saving}
          onClick={() => {
            setForm(saved);
            setErrors({});
            setSaveError(null);
          }}
        >
          Reset to saved
        </Button>
        <Button variant="primary" loading={saving} disabled={!changed} onClick={save}>
          Save changes
        </Button>
      </div>
    </Card>
  );
}
