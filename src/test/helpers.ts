import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Customer } from "../types/customer";

/**
 * The input, select or textarea inside the `Field` with this label. `Field` draws its label
 * without `htmlFor`, so getByLabelText cannot find these controls.
 */
export function field(label: string): HTMLInputElement {
  const el = screen.getByText(label, { selector: "label" }).parentElement!.querySelector("input, select, textarea");
  if (!el) throw new Error(`No control in the field "${label}"`);
  return el as HTMLInputElement;
}

/** A company with only a name; pass whatever else the test needs. */
export function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    name: "Sample Co",
    gstin: null,
    phone: null,
    email: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    is_favorite: false,
    last_used_at: null,
    created_at: "",
    updated_at: "",
    party_type: "CUSTOMER",
    whatsapp_number: null,
    ...over,
  };
}

/** Open a searchable select (`role="combobox"`) by its name and click the option with this text. */
export async function pick(comboboxName: string, optionText: string | RegExp) {
  await userEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  await userEvent.click(await screen.findByText(optionText));
}

/** A small file as if chosen in a file picker. */
export function makeFile(name: string, content = "data") {
  return new File([content], name, { lastModified: 1000 });
}

/** The hidden file input of a "Files" section. */
export function fileInput(): HTMLInputElement {
  const el = document.querySelector('input[type="file"]');
  if (!el) throw new Error("No file input on the page");
  return el as HTMLInputElement;
}
