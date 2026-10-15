import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerFormModal from "./CustomerFormModal";
import { Customer, CustomerCreateInput, PartyType } from "../../types/customer";
import { field, makeCustomer } from "../../test/helpers";

const api = vi.hoisted(() => ({ checkDuplicateCustomer: vi.fn(), createCustomer: vi.fn(), updateCustomer: vi.fn() }));
vi.mock("../../services/api", () => api);

let onClose: Mock<() => void>;
let onSaved: Mock<(c: Customer) => void>;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.checkDuplicateCustomer.mockResolvedValue({ has_duplicate: false, existing_customer: null });
  api.createCustomer.mockImplementation(async (input: CustomerCreateInput) => makeCustomer({ id: 50, ...input }));
  api.updateCustomer.mockImplementation(async (id: number, input: CustomerCreateInput) => makeCustomer({ id, ...input }));
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<(c: Customer) => void>();
});

const open = (props: Partial<Parameters<typeof CustomerFormModal>[0]> = {}) =>
  render(<CustomerFormModal onClose={onClose} onSaved={onSaved} {...props} />);

const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const save = (name = "Add company") => userEvent.click(screen.getByRole("button", { name }));
const sent = (): CustomerCreateInput => api.createCustomer.mock.calls[0][0];

describe("adding a company", () => {
  it("starts in Puducherry with the name box focused", () => {
    open();
    expect(screen.getByRole("dialog", { name: "New company" })).toBeInTheDocument();
    expect(field("Business name")).toHaveFocus();
    expect(field("State")).toHaveValue("Puducherry");
    expect(field("Type")).toHaveValue("CUSTOMER");
  });

  it("saves cleaned-up details", async () => {
    open();
    type("Business name", "  Anand Steels ");
    type("GSTIN", "34aaaaa1234a1z5");
    type("Phone", "+91 98765 43210");
    type("Email", "Office@Anand.IN");
    fireEvent.change(screen.getByPlaceholderText("Building, street"), { target: { value: " 12 Main Road " } });
    type("City", "Lawspet");
    type("PIN code", "605008");
    fireEvent.click(screen.getByLabelText(/Frequent company/));
    await save();
    await waitFor(() => expect(api.createCustomer).toHaveBeenCalledOnce());
    expect(sent()).toEqual({
      name: "Anand Steels",
      gstin: "34AAAAA1234A1Z5",
      phone: "+91 98765 43210",
      email: "office@anand.in",
      address_line1: "12 Main Road",
      address_line2: null,
      city: "Lawspet",
      state: "Puducherry",
      postal_code: "605008",
      is_favorite: true,
      party_type: "CUSTOMER",
      whatsapp_number: null,
    });
    expect(api.checkDuplicateCustomer).toHaveBeenCalledWith("Anand Steels", undefined);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 50, name: "Anand Steels" }));
  });

  it("Enter in a box saves", async () => {
    open();
    type("Business name", "Anand Steels");
    fireEvent.submit(field("Business name").closest("form")!);
    await waitFor(() => expect(api.createCustomer).toHaveBeenCalled());
  });

  it("fills the state from the GSTIN", () => {
    open();
    type("GSTIN", "33");
    expect(field("GSTIN")).toHaveValue("33");
    expect(field("State")).toHaveValue("Tamil Nadu");
  });

  it("warns when the state and the GSTIN disagree", () => {
    open();
    type("GSTIN", "33AAAAA1234A1Z5");
    fireEvent.change(field("State"), { target: { value: "Kerala" } });
    expect(screen.getByText(/The GSTIN starts with 33 \(Tamil Nadu\), but the state is Kerala/)).toBeInTheDocument();
  });

  it("can send WhatsApp to a different number", async () => {
    open();
    type("Business name", "Anand Steels");
    type("Phone", "0413 2200300");
    fireEvent.click(screen.getByLabelText(/This phone number is also on WhatsApp/));
    type("WhatsApp number", "98765 43210");
    await save();
    await waitFor(() => expect(api.createCustomer).toHaveBeenCalled());
    expect(sent().whatsapp_number).toBe("98765 43210");
  });

  describe("checks what was typed", () => {
    it.each([
      ["Business name", "", "Enter the business name."],
      ["GSTIN", "34AAAAA1234", "GSTIN should be 15 characters, like 34AAAAA1234A1Z5."],
      ["GSTIN", "34AAAAA1234A1X5", "GSTIN should be 15 characters, like 34AAAAA1234A1Z5."],
      ["Phone", "12345", "Enter a phone number with 7 to 15 digits."],
      ["Phone", "98765abc43", "Enter a phone number with 7 to 15 digits."],
      ["Phone", "1234567890123456", "Enter a phone number with 7 to 15 digits."],
      ["Email", "office@anand", "Enter a valid email address."],
    ])("%s %j", async (label, value, message) => {
      open();
      if (label !== "Business name") type("Business name", "Anand Steels");
      type(label, value);
      await save();
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(api.createCustomer).not.toHaveBeenCalled();
    });

    it("a WhatsApp number with too few digits", async () => {
      open();
      type("Business name", "Anand Steels");
      fireEvent.click(screen.getByLabelText(/This phone number is also on WhatsApp/));
      type("WhatsApp number", "98765");
      await save();
      expect(screen.getByText("Enter a 10-digit mobile number, or include the country code.")).toBeInTheDocument();
    });

    it("accepts a phone with spaces, dashes and brackets", async () => {
      open();
      type("Business name", "Anand Steels");
      type("Phone", "(0413) 220-0300");
      await save();
      await waitFor(() => expect(api.createCustomer).toHaveBeenCalled());
    });
  });

  describe("a company with the same name", () => {
    const existing = makeCustomer({ id: 9, name: "Anand Steels", city: "Lawspet", party_type: "SUPPLIER" });

    it("says it exists as a supplier and suggests Both", async () => {
      api.checkDuplicateCustomer.mockResolvedValue({ has_duplicate: true, existing_customer: existing });
      open();
      type("Business name", "Anand Steels");
      await save();
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Anand Steels (Lawspet) already exists as a supplier. Open it and set its type to Both instead of adding it again"
      );
      expect(api.createCustomer).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Save anyway" }));
      await waitFor(() => expect(api.createCustomer).toHaveBeenCalledOnce());
      expect(api.checkDuplicateCustomer).toHaveBeenCalledOnce();
    });

    it("asks to check it is not the same business when the type matches", async () => {
      api.checkDuplicateCustomer.mockResolvedValue({ has_duplicate: true, existing_customer: { ...existing, party_type: "CUSTOMER" } });
      open();
      type("Business name", "Anand Steels");
      await save();
      expect(await screen.findByRole("status")).toHaveTextContent("Check it isn't the same business");
    });

    it("forgets the warning once the name changes", async () => {
      api.checkDuplicateCustomer.mockResolvedValue({ has_duplicate: true, existing_customer: existing });
      open();
      type("Business name", "Anand Steels");
      await save();
      await screen.findByRole("button", { name: "Save anyway" });
      type("Business name", "Anand Steels 2");
      expect(screen.getByRole("button", { name: "Add company" })).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("still saves when the duplicate check itself fails", async () => {
      api.checkDuplicateCustomer.mockRejectedValue(new Error("db busy"));
      open();
      type("Business name", "Anand Steels");
      await save();
      await waitFor(() => expect(api.createCustomer).toHaveBeenCalled());
    });
  });

  it("shows the backend's refusal", async () => {
    api.createCustomer.mockRejectedValue(new Error("Error: name is too long"));
    open();
    type("Business name", "Anand Steels");
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("name is too long");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("the type choice", () => {
  it("is hidden when only one type is allowed", () => {
    open({ allowedPartyTypes: ["SUPPLIER"], defaultPartyType: "SUPPLIER", noun: "supplier" });
    expect(screen.queryByText("Type", { selector: "label" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New supplier" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add supplier" })).toBeInTheDocument();
  });

  it("offers only the allowed types", () => {
    open({ allowedPartyTypes: ["SUPPLIER", "BOTH"], defaultPartyType: "SUPPLIER" });
    const options = Array.from(field("Type").querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["SUPPLIER", "BOTH"]);
  });

  it("keeps showing a saved type that is not normally offered here", () => {
    open({ customer: makeCustomer({ party_type: "CUSTOMER" }), allowedPartyTypes: ["SUPPLIER", "BOTH"] as PartyType[] });
    expect(field("Type")).toHaveValue("CUSTOMER");
  });
});

describe("editing a company", () => {
  const saved = makeCustomer({
    id: 7,
    name: "Bala Traders",
    gstin: "33BBBBB1111B1Z5",
    phone: "+919876500002",
    state: "Pondicherry",
    whatsapp_number: "+919876543210",
  });

  it("shows the saved details and saves in place", async () => {
    open({ customer: saved, noun: "customer" });
    expect(screen.getByRole("dialog", { name: "Edit customer" })).toBeInTheDocument();
    expect(field("Business name")).toHaveValue("Bala Traders");
    // A state written before the list existed stays chosen.
    expect(field("State")).toHaveValue("Pondicherry");
    expect(screen.getByLabelText(/This phone number is also on WhatsApp/)).not.toBeChecked();
    expect(field("WhatsApp number")).toHaveValue("+91 98765 43210");
    type("City", "Chennai");
    await save("Save changes");
    await waitFor(() => expect(api.updateCustomer).toHaveBeenCalledOnce());
    expect(api.checkDuplicateCustomer).toHaveBeenCalledWith("Bala Traders", 7);
    const [id, input] = api.updateCustomer.mock.calls[0];
    expect(id).toBe(7);
    expect(input).toMatchObject({ city: "Chennai", state: "Pondicherry", whatsapp_number: "+91 98765 43210" });
  });

  it("asks before throwing away changes", async () => {
    open({ customer: saved });
    type("City", "Chennai");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard your changes?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
