/** What a company is to the business: someone it sells to, buys from, or both. */
export type PartyType = "CUSTOMER" | "SUPPLIER" | "BOTH";

export const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  CUSTOMER: "Customer",
  SUPPLIER: "Supplier",
  BOTH: "Both",
};

export interface Customer {
  id: number;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  is_favorite: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  party_type: PartyType;
}

/** Same shape for creating and editing a customer. */
export interface CustomerCreateInput {
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  is_favorite: boolean;
  party_type: PartyType;
}

export interface DuplicateCheckResult {
  has_duplicate: boolean;
  existing_customer: Customer | null;
}

/** One-line address as printed on an invoice. */
export function formatCustomerAddress(c: Customer): string {
  const parts = [c.address_line1, c.address_line2, c.city, c.state].filter(Boolean);
  const address = parts.join(", ");
  return c.postal_code ? `${address}${address ? " - " : ""}${c.postal_code}` : address;
}
