import { describe, expect, it } from "vitest";
import { Customer, formatCustomerAddress } from "./customer";

const c = (over: Partial<Customer>): Customer => ({
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
});

describe("formatCustomerAddress", () => {
  it("joins every part with the PIN code at the end", () => {
    expect(
      formatCustomerAddress(
        c({ address_line1: "12 Main Road", address_line2: "Lawspet", city: "Puducherry", state: "Puducherry", postal_code: "605008" })
      )
    ).toBe("12 Main Road, Lawspet, Puducherry, Puducherry - 605008");
  });

  it("skips missing and empty parts", () => {
    expect(formatCustomerAddress(c({ address_line1: "12 Main Road", address_line2: "", city: "Chennai" }))).toBe("12 Main Road, Chennai");
  });

  it("shows a PIN code alone without a dash", () => {
    expect(formatCustomerAddress(c({ postal_code: "605008" }))).toBe("605008");
  });

  it("is empty with no address", () => {
    expect(formatCustomerAddress(c({}))).toBe("");
  });
});
