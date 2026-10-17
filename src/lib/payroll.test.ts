import { describe, expect, it } from "vitest";
import { MonthFigures } from "../types/payroll";
import {
  carriedInLabel,
  settleNotes,
  statusTone,
  entryChanged,
  finishStartsTicked,
  parseQuantity,
  payLine,
  STATUS_LABEL,
  STATUS_TONE,
  statusText,
  WAGE_KIND_LABEL,
} from "./payroll";

const figures = (over: Partial<MonthFigures> = {}): MonthFigures => ({
  wages: 0,
  ot_amount: 0,
  bonus: 0,
  incentives: 0,
  earned: 0,
  given: 0,
  cleared: 0,
  written_off: 0,
  carried: 0,
  rounded_off: 0,
  balance: 0,
  ...over,
});

describe("payLine", () => {
  it("multiplies and rounds to the paisa", () => {
    expect(payLine(26, 650)).toBe(16900);
    expect(payLine(25.5, 650)).toBe(16575);
    expect(payLine(3.33, 87.5)).toBe(291.38);
    expect(payLine(0, 650)).toBe(0);
  });

  it("avoids floating point drift", () => {
    expect(payLine(0.1, 3)).toBe(0.3);
  });
});

describe("parseQuantity", () => {
  it("treats an empty box as no value", () => {
    expect(parseQuantity("", "days")).toEqual({ value: null, error: null });
    expect(parseQuantity("   ", "hours")).toEqual({ value: null, error: null });
  });

  it("reads whole and half days", () => {
    expect(parseQuantity("26", "days")).toEqual({ value: 26, error: null });
    expect(parseQuantity("25.5", "days")).toEqual({ value: 25.5, error: null });
    expect(parseQuantity(" 0.5 ", "days")).toEqual({ value: 0.5, error: null });
    expect(parseQuantity("0", "days")).toEqual({ value: 0, error: null });
    expect(parseQuantity(".5", "days")).toEqual({ value: 0.5, error: null });
    expect(parseQuantity("3.", "days")).toEqual({ value: 3, error: null });
  });

  it("refuses days that are not whole or half", () => {
    expect(parseQuantity("25.25", "days").error).toBe("Half days only, e.g. 25.5");
    expect(parseQuantity("1.1", "days").value).toBeNull();
  });

  it("reads hours with up to two decimals", () => {
    expect(parseQuantity("4.25", "hours")).toEqual({ value: 4.25, error: null });
    expect(parseQuantity("1.1", "hours")).toEqual({ value: 1.1, error: null });
    expect(parseQuantity("1.005", "hours").error).toBe("Up to two decimals");
  });

  it("refuses anything that is not a plain non-negative number", () => {
    for (const bad of ["-1", "abc", "1e3", "1,5", ".", "1.2.3", "Infinity", "+5", "0x10"]) {
      expect(parseQuantity(bad, "days"), bad).toEqual({ value: null, error: "Enter a number" });
      expect(parseQuantity(bad, "hours"), bad).toEqual({ value: null, error: "Enter a number" });
    }
  });
});

describe("status labels and tones", () => {
  it("cover every status", () => {
    for (const s of ["NOT_ENTERED", "TO_PAY", "PAID", "OVERPAID"] as const) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
    }
    expect(STATUS_TONE.OVERPAID).toBe("red");
    expect(STATUS_TONE.PAID).toBe("green");
  });

  it("names every wage kind", () => {
    expect(Object.keys(WAGE_KIND_LABEL).sort()).toEqual(["ADVANCE", "CARRIED", "RETURNED", "SALARY", "WRITE_OFF"]);
  });
});

describe("statusText", () => {
  it("shows what is left to pay", () => {
    expect(statusText("TO_PAY", figures({ balance: 13260 }))).toBe("To pay ₹13,260.00");
  });

  it("shows an overpaid amount as positive", () => {
    expect(statusText("OVERPAID", figures({ balance: -1000 }))).toBe("Overpaid ₹1,000.00");
  });

  it("shows how a paid month was finished", () => {
    expect(statusText("PAID", figures())).toBe("Paid");
    expect(statusText("PAID", figures({ rounded_off: 10 }))).toBe("Paid");
    expect(statusText("PAID", figures({ cleared: 3950, written_off: 3950 }))).toBe("Paid");
  });

  it("notes briefly how a paid month was settled", () => {
    expect(settleNotes(figures())).toEqual([]);
    expect(settleNotes(figures({ cleared: 3600, written_off: 3600 }))).toEqual(["+₹3,600 written off"]);
    expect(settleNotes(figures({ cleared: 1000.5, carried: 1000.5 }))).toEqual(["+₹1,000.50 to next month"]);
    expect(settleNotes(figures({ rounded_off: -5 }))).toEqual(["+₹5 rounded off"]);
    expect(settleNotes(figures({ rounded_off: 10 }))).toEqual(["−₹10 rounded off"]);
    expect(settleNotes(figures({ cleared: 400 }))).toEqual([]); // cash returned is not extra
  });

  it("marks a month paid with extra", () => {
    expect(statusTone("PAID", figures())).toBe("green");
    expect(statusTone("PAID", figures({ written_off: 1 }))).toBe("blue");
    expect(statusTone("PAID", figures({ carried: 1 }))).toBe("blue");
    expect(statusTone("PAID", figures({ rounded_off: 10 }))).toBe("green");
  });

  it("mentions money already given in a month with no days entered", () => {
    expect(statusText("NOT_ENTERED", figures())).toBe("Not entered");
    expect(statusText("NOT_ENTERED", figures({ given: 2000 }))).toBe("Not entered · ₹2,000 given");
  });
});

describe("carriedInLabel", () => {
  it("names the month the advance came from", () => {
    expect(carriedInLabel("2026-09")).toBe("Advance carried from September 2026");
  });
});

describe("finishStartsTicked", () => {
  it("is ticked when the saved round-off still matches the month", () => {
    // Balance before this salary was 1010; salary of 1000 left 10 rounded off.
    expect(finishStartsTicked({ kind: "SALARY", amount: 1000, round_off: 10 }, 1010)).toBe(true);
  });

  it("is not ticked once wages were added after finishing", () => {
    expect(finishStartsTicked({ kind: "SALARY", amount: 1000, round_off: 10 }, 1510)).toBe(false);
  });

  it("is not ticked without a round-off", () => {
    expect(finishStartsTicked({ kind: "SALARY", amount: 1000, round_off: 0 }, 1000)).toBe(false);
  });

  it("is only for salary payments", () => {
    expect(finishStartsTicked({ kind: "ADVANCE", amount: 1000, round_off: 10 }, 1010)).toBe(false);
  });

  it("handles a negative round-off (paid a little more)", () => {
    expect(finishStartsTicked({ kind: "SALARY", amount: 1005, round_off: -5 }, 1000)).toBe(true);
  });

  it("compares to the paisa", () => {
    expect(finishStartsTicked({ kind: "SALARY", amount: 0.2, round_off: 0.1 }, 0.30000000000000004)).toBe(true);
  });
});

describe("entryChanged", () => {
  const e = { days_worked: 26, ot_hours: 4 };

  it("is true for a new row", () => {
    expect(entryChanged({ row: null }, e)).toBe(true);
  });

  it("is false when nothing changed", () => {
    expect(entryChanged({ row: { days_worked: 26, ot_hours: 4 } }, e)).toBe(false);
  });

  it("is true when days or hours changed", () => {
    expect(entryChanged({ row: { days_worked: 25, ot_hours: 4 } }, e)).toBe(true);
    expect(entryChanged({ row: { days_worked: 26, ot_hours: 0 } }, e)).toBe(true);
  });
});
