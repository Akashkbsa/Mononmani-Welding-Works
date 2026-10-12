import { useMemo } from "react";
import { Customer } from "../types/customer";
import { SearchSelect } from "./ui";

/** Pick a customer by typing any part of the name, city, phone number or GSTIN. */
export default function CustomerPicker({
  customers,
  value,
  onChange,
  disabled,
  fallbackLabel,
}: {
  customers: Customer[];
  value: number | null;
  onChange: (customer: Customer) => void;
  disabled?: boolean;
  fallbackLabel?: string;
}) {
  const options = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        label: c.city ? `${c.name} — ${c.city}` : c.name,
        detail: [c.gstin, c.phone].filter(Boolean).join("  ·  ") || undefined,
        search: [c.name, c.city, c.phone, c.gstin, c.state].filter(Boolean).join(" "),
      })),
    [customers]
  );
  return (
    <SearchSelect
      ariaLabel="Customer"
      options={options}
      value={value}
      disabled={disabled}
      fallbackLabel={fallbackLabel}
      placeholder="Search by name, phone or GSTIN"
      emptyText="No customer matches. Try another name, phone or GSTIN, or add a new customer."
      onChange={(id) => {
        const c = customers.find((x) => x.id === id);
        if (c) onChange(c);
      }}
    />
  );
}
