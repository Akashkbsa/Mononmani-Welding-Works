import { useState } from "react";
import { Customer, CustomerCreateInput } from "../../types/customer";
import { checkDuplicateCustomer, createCustomer, updateCustomer } from "../../services/api";
import { GST_STATES, HOME_STATE, stateCodeFor, stateName } from "../../lib/gst";
import { errorMessage } from "../../lib/format";
import { Alert, Button, Checkbox, Field, inputClass, Modal } from "../ui";

interface Props {
  customer?: Customer | null;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function validate(input: CustomerCreateInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.name) errors.name = "Enter the customer's name.";
  if (input.gstin && !GSTIN_PATTERN.test(input.gstin)) {
    errors.gstin = "GSTIN should be 15 characters, like 34AAAAA1234A1Z5.";
  }
  if (input.phone) {
    const digits = input.phone.replace(/[\s\-()+]/g, "");
    if (!/^[\d\s\-()+]+$/.test(input.phone) || digits.length < 7 || digits.length > 15) {
      errors.phone = "Enter a phone number with 7 to 15 digits.";
    }
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errors.email = "Enter a valid email address.";
  }
  return errors;
}

export default function CustomerFormModal({ customer, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: customer?.name ?? "",
    gstin: customer?.gstin ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address_line1: customer?.address_line1 ?? "",
    address_line2: customer?.address_line2 ?? "",
    city: customer?.city ?? "",
    state: customer ? customer.state ?? "" : HOME_STATE.name,
    postal_code: customer?.postal_code ?? "",
    is_favorite: customer?.is_favorite ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  // A state saved before the list existed (e.g. "Pondicherry") stays selectable.
  const knownState = GST_STATES.some((s) => s.name === form.state);

  const onGstinChange = (value: string) => {
    const gstin = value.toUpperCase();
    setForm((f) => {
      const code = stateCodeFor(null, gstin);
      return { ...f, gstin, state: gstin.length >= 2 && code ? stateName(code) ?? f.state : f.state };
    });
  };

  const save = async (allowDuplicate: boolean) => {
    const clean = (v: string) => v.trim() || null;
    const input: CustomerCreateInput = {
      name: form.name.trim(),
      gstin: clean(form.gstin.toUpperCase()),
      phone: clean(form.phone),
      email: clean(form.email.toLowerCase()),
      address_line1: clean(form.address_line1),
      address_line2: clean(form.address_line2),
      city: clean(form.city),
      state: clean(form.state),
      postal_code: clean(form.postal_code),
      is_favorite: form.is_favorite,
    };

    const found = validate(input);
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    setServerError(null);
    try {
      if (!allowDuplicate) {
        const dup = await checkDuplicateCustomer(input.name, customer?.id).catch(() => null);
        if (dup?.has_duplicate && dup.existing_customer) {
          setDuplicate(dup.existing_customer);
          setSaving(false);
          return;
        }
      }
      const saved = customer ? await updateCustomer(customer.id, input) : await createCustomer(input);
      onSaved(saved);
    } catch (err) {
      setServerError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={customer ? "Edit customer" : "New customer"}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => save(!!duplicate)}>
            {duplicate ? "Save anyway" : customer ? "Save changes" : "Add customer"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save(!!duplicate);
        }}
      >
        {serverError && <Alert>{serverError}</Alert>}
        {duplicate && (
          <Alert tone="info">
            A customer named <strong>{duplicate.name}</strong>
            {duplicate.city ? ` (${duplicate.city})` : ""} already exists. Check it isn't the same business, or
            choose <strong>Save anyway</strong>.
          </Alert>
        )}

        <Field label="Business name" required error={errors.name}>
          <input
            autoFocus
            className={inputClass}
            value={form.name}
            onChange={(e) => {
              set("name")(e.target.value);
              setDuplicate(null);
            }}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="GSTIN" error={errors.gstin} hint="Leave blank for unregistered customers.">
            <input
              className={`${inputClass} font-mono uppercase`}
              maxLength={15}
              value={form.gstin}
              onChange={(e) => onGstinChange(e.target.value)}
            />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input className={inputClass} value={form.phone} onChange={(e) => set("phone")(e.target.value)} />
          </Field>
        </div>

        <Field label="Email" error={errors.email}>
          <input className={inputClass} value={form.email} onChange={(e) => set("email")(e.target.value)} />
        </Field>

        <Field label="Address">
          <div className="space-y-2">
            <input
              className={inputClass}
              placeholder="Building, street"
              value={form.address_line1}
              onChange={(e) => set("address_line1")(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Area, landmark (optional)"
              value={form.address_line2}
              onChange={(e) => set("address_line2")(e.target.value)}
            />
          </div>
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="City">
            <input className={inputClass} value={form.city} onChange={(e) => set("city")(e.target.value)} />
          </Field>
          <Field label="State" hint="Decides CGST + SGST or IGST.">
            <select className={inputClass} value={form.state} onChange={(e) => set("state")(e.target.value)}>
              <option value="">Select state</option>
              {!knownState && form.state && <option value={form.state}>{form.state}</option>}
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="PIN code">
            <input
              className={inputClass}
              value={form.postal_code}
              onChange={(e) => set("postal_code")(e.target.value)}
            />
          </Field>
        </div>

        <Checkbox
          checked={form.is_favorite}
          onChange={set("is_favorite")}
          label="Frequent customer"
          description="Shown at the top of customer lists."
        />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
