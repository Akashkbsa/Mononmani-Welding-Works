import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PartyTypeBadge from "./customers/PartyTypeBadge";
import PurchaseOrderStatusBadge from "./purchaseOrders/PurchaseOrderStatusBadge";
import SupplierBillStatusBadge from "./supplierBills/SupplierBillStatusBadge";

describe("PartyTypeBadge", () => {
  it.each([
    ["CUSTOMER", "Customer", "bg-slate-100"],
    ["SUPPLIER", "Supplier", "bg-brand-100"],
    ["BOTH", "Both", "bg-emerald-100"],
  ] as const)("shows %s", (type, label, tone) => {
    render(<PartyTypeBadge type={type} />);
    expect(screen.getByText(label).className).toContain(tone);
  });
});

describe("PurchaseOrderStatusBadge", () => {
  it.each([
    ["COMPLETED", "Completed", "bg-emerald-100"],
    ["PARTIAL", "Partially completed", "bg-amber-100"],
    ["NOT_STARTED", "Not started", "bg-slate-100"],
  ] as const)("shows %s", (status, label, tone) => {
    render(<PurchaseOrderStatusBadge status={status} />);
    expect(screen.getByText(label).className).toContain(tone);
  });
});

describe("SupplierBillStatusBadge", () => {
  it("shows a paid bill as quiet text with a tick", () => {
    const { container } = render(<SupplierBillStatusBadge status="PAID" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.firstElementChild!.className).toContain("text-emerald-700");
  });

  it("gives part-paid and unpaid bills a colour block", () => {
    const { container, rerender } = render(<SupplierBillStatusBadge status="PARTIAL" />);
    expect(container.firstElementChild!.className).toContain("bg-brand-100");
    rerender(<SupplierBillStatusBadge status="NOT_PAID" />);
    expect(container.firstElementChild!.className).toContain("bg-amber-100");
  });
});
