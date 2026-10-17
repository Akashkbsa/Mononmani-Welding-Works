import { describe, expect, it } from "vitest";
import { balanceText, periodBounds } from "./ledger";

describe("balanceText", () => {
  it("marks who owes whom", () => {
    expect(balanceText(108560)).toBe("₹1,08,560.00 Dr");
    expect(balanceText(-41475)).toBe("₹41,475.00 Cr");
    expect(balanceText(0)).toBe("Nil");
  });
});

describe("periodBounds", () => {
  const today = "2026-10-17";

  it("turns a period into From and To dates", () => {
    expect(periodBounds("", today)).toEqual({ from: null, to: null });
    expect(periodBounds("2026-02", today)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodBounds("2028-02", "2028-12-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodBounds("FY2025", today)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(periodBounds("R:2026-05-01:2026-06-30", today)).toEqual({ from: "2026-05-01", to: "2026-06-30" });
  });

  it("stops a period that runs past today at today", () => {
    expect(periodBounds("FY2026", today)).toEqual({ from: "2026-04-01", to: "2026-10-17" });
    expect(periodBounds("2026-10", today)).toEqual({ from: "2026-10-01", to: "2026-10-17" });
  });
});
