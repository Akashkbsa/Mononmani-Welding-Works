import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ageLabel,
  currentMonth,
  daysSince,
  errorMessage,
  formatDate,
  formatFileSize,
  formatMoney,
  formatPhone,
  formatVehicleNumber,
  joinRefDate,
  monthTitle,
  parseDisplayDate,
  round2,
  shiftMonth,
  shortDate,
  splitRefDate,
  todayISO,
  typedDate,
} from "./format";

describe("formatMoney", () => {
  it("writes rupees with Indian grouping and two decimals", () => {
    expect(formatMoney(1250000)).toBe("₹12,50,000.00");
    expect(formatMoney(999.5)).toBe("₹999.50");
    expect(formatMoney(0.07)).toBe("₹0.07");
  });

  it("treats null and undefined as zero", () => {
    expect(formatMoney(null)).toBe("₹0.00");
    expect(formatMoney(undefined)).toBe("₹0.00");
  });

  it("keeps the sign of negative amounts", () => {
    expect(formatMoney(-1500)).toContain("1,500.00");
    expect(formatMoney(-1500).startsWith("-")).toBe(true);
  });

  it("rounds to the paisa", () => {
    expect(formatMoney(10.005)).toMatch(/^₹10\.0[01]$/);
    expect(formatMoney(10.126)).toBe("₹10.13");
  });
});

describe("round2", () => {
  it("rounds half a paisa up, as a calculator does", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(0.125)).toBe(0.13);
    expect(round2(10.004)).toBe(10);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it("is not thrown off by float noise in large amounts", () => {
    expect(round2(1000.005)).toBe(1000.01);
    expect(round2(123456.785)).toBe(123456.79);
    expect(round2(99999999.995)).toBe(100000000);
    expect(round2(1e12)).toBe(1e12);
  });

  it("gives what the backend saves for a line amount", () => {
    // Same cases as round2 in src-tauri/src/util.rs.
    expect(round2(7 * 0.145)).toBe(1.02);
    expect(round2(1.5 * 1.67)).toBe(2.51);
  });

  it("leaves whole and already-rounded numbers alone", () => {
    expect(round2(42)).toBe(42);
    expect(round2(42.5)).toBe(42.5);
    expect(round2(0)).toBe(0);
  });

  it("rounds negatives away from zero, like the backend", () => {
    expect(round2(-3.14159)).toBe(-3.14);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(-0.005)).toBe(-0.01);
  });

  it("never gives -0, so nothing shows as -₹0.00", () => {
    expect(Object.is(round2(-0.001), 0)).toBe(true);
    expect(formatMoney(round2(-0.001))).toBe("₹0.00");
  });

  it("passes NaN and infinity through", () => {
    expect(round2(NaN)).toBeNaN();
    expect(round2(Infinity)).toBe(Infinity);
  });
});

describe("dates that depend on today", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 15 October 2026, mid-morning local time.
    vi.setSystemTime(new Date(2026, 9, 15, 10, 30));
  });
  afterEach(() => vi.useRealTimers());

  it("todayISO is the local date as YYYY-MM-DD", () => {
    expect(todayISO()).toBe("2026-10-15");
  });

  it("todayISO pads single-digit months and days", () => {
    vi.setSystemTime(new Date(2026, 0, 5, 23, 59));
    expect(todayISO()).toBe("2026-01-05");
  });

  it("currentMonth is YYYY-MM", () => {
    expect(currentMonth()).toBe("2026-10");
  });

  it("daysSince counts whole days back to the date", () => {
    expect(daysSince("2026-10-15")).toBe(0);
    expect(daysSince("2026-10-14")).toBe(1);
    expect(daysSince("2026-09-15")).toBe(30);
    expect(daysSince("2025-10-15")).toBe(365);
  });

  it("daysSince is 0 for a future date", () => {
    expect(daysSince("2026-12-31")).toBe(0);
  });

  it("daysSince is 0 for text that is not a date", () => {
    expect(daysSince("")).toBe(0);
    expect(daysSince("not a date")).toBe(0);
  });

  it("daysSince is not thrown off by a daylight-saving style hour shift", () => {
    // Late in the evening still counts by calendar day.
    vi.setSystemTime(new Date(2026, 9, 15, 23, 59));
    expect(daysSince("2026-10-14")).toBe(1);
  });

  it("ageLabel reads naturally", () => {
    expect(ageLabel("2026-10-15")).toBe("Today");
    expect(ageLabel("2026-10-14")).toBe("1 day old");
    expect(ageLabel("2026-10-01")).toBe("14 days old");
    expect(ageLabel("2027-01-01")).toBe("Today");
  });
});

describe("formatDate", () => {
  it("turns YYYY-MM-DD into DD-MM-YYYY", () => {
    expect(formatDate("2026-01-12")).toBe("12-01-2026");
  });

  it("ignores a time part after the date", () => {
    expect(formatDate("2026-01-12 10:20:30")).toBe("12-01-2026");
    expect(formatDate("2026-01-12T10:20:30Z")).toBe("12-01-2026");
  });

  it("shows a dash for nothing", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("returns other text unchanged", () => {
    expect(formatDate("12/01/2026")).toBe("12/01/2026");
  });
});

describe("formatPhone", () => {
  it("spaces an Indian mobile number", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
  });

  it("leaves other numbers as stored", () => {
    expect(formatPhone("+14155550123")).toBe("+14155550123");
    expect(formatPhone("9876543210")).toBe("9876543210");
    expect(formatPhone("+9198765432")).toBe("+9198765432");
    expect(formatPhone("")).toBe("");
  });
});

describe("shiftMonth", () => {
  it("moves within a year", () => {
    expect(shiftMonth("2026-05", 1)).toBe("2026-06");
    expect(shiftMonth("2026-05", -1)).toBe("2026-04");
  });

  it("crosses year ends both ways", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("moves many months at once", () => {
    expect(shiftMonth("2026-10", 15)).toBe("2028-01");
    expect(shiftMonth("2026-10", -22)).toBe("2024-12");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });
});

describe("monthTitle", () => {
  it("names the month", () => {
    expect(monthTitle("2026-11")).toBe("November 2026");
    expect(monthTitle("2026-01")).toBe("January 2026");
    expect(monthTitle("2026-12")).toBe("December 2026");
  });

  it("falls back to the text for a month that does not exist", () => {
    expect(monthTitle("2026-13")).toBe("2026-13 2026");
  });
});

describe("shortDate", () => {
  it("gives day and short month without leading zero", () => {
    expect(shortDate("2026-11-03")).toBe("3 Nov");
    expect(shortDate("2026-05-31")).toBe("31 May");
  });

  it("shows a dash for missing or bad values", () => {
    expect(shortDate(null)).toBe("—");
    expect(shortDate(undefined)).toBe("—");
    expect(shortDate("garbage")).toBe("—");
    expect(shortDate("2026-13-01")).toBe("—");
  });
});

describe("formatVehicleNumber", () => {
  it("formats the usual state numbers", () => {
    expect(formatVehicleNumber("tn09ab1234")).toBe("TN 09 AB 1234");
    expect(formatVehicleNumber("PY 01 BX 4455")).toBe("PY 01 BX 4455");
    expect(formatVehicleNumber("ka-05-mn-0001")).toBe("KA 05 MN 0001");
  });

  it("formats Delhi-style numbers with a letter in the RTO part", () => {
    expect(formatVehicleNumber("dl1cab1234")).toBe("DL 1C AB 1234");
  });

  it("accepts numbers with one, two or no series letters", () => {
    expect(formatVehicleNumber("TN09A1234")).toBe("TN 09 A 1234");
    expect(formatVehicleNumber("TN091234")).toBe("TN 09 1234");
    expect(formatVehicleNumber("TN9ABC1234")).toBe("TN 9A BC 1234");
  });

  it("formats Bharat series numbers", () => {
    expect(formatVehicleNumber("22bh1234aa")).toBe("22 BH 1234 AA");
  });

  it("allows spaces, dots and dashes between parts", () => {
    expect(formatVehicleNumber("tn.09.ab.1234")).toBe("TN 09 AB 1234");
  });

  it("rejects anything else", () => {
    expect(formatVehicleNumber("")).toBeNull();
    expect(formatVehicleNumber("TN09AB123")).toBeNull();
    expect(formatVehicleNumber("TN09AB12345")).toBeNull();
    expect(formatVehicleNumber("T09AB1234")).toBeNull();
    expect(formatVehicleNumber("TN09ABCD1234")).toBeNull();
    expect(formatVehicleNumber("TN/09/AB/1234")).toBeNull();
    expect(formatVehicleNumber("22BH1234")).toBeNull();
    expect(formatVehicleNumber("22BH1234A")).toBeNull();
    expect(formatVehicleNumber("22BH1234ABC")).toBeNull();
  });
});

describe("splitRefDate and joinRefDate", () => {
  it("splits a number and a date", () => {
    expect(splitRefDate("PO-123 & 12-01-2026")).toEqual({ number: "PO-123", dateISO: "2026-01-12" });
  });

  it("uses the last ' & ' so a number may contain one", () => {
    expect(splitRefDate("A & B & 01-02-2026")).toEqual({ number: "A & B", dateISO: "2026-02-01" });
  });

  it("keeps the whole text as the number when there is no valid date", () => {
    expect(splitRefDate("PO-123")).toEqual({ number: "PO-123", dateISO: "" });
    expect(splitRefDate("PO-123 & soon")).toEqual({ number: "PO-123 & soon", dateISO: "" });
    expect(splitRefDate("PO & 2026-01-12")).toEqual({ number: "PO & 2026-01-12", dateISO: "" });
  });

  it("handles nothing", () => {
    expect(splitRefDate(null)).toEqual({ number: "", dateISO: "" });
    expect(splitRefDate(undefined)).toEqual({ number: "", dateISO: "" });
  });

  it("joins a number and a date", () => {
    expect(joinRefDate("PO-123", "2026-01-12")).toBe("PO-123 & 12-01-2026");
    expect(joinRefDate("PO-123", "")).toBe("PO-123");
  });

  it("gives empty text without a number", () => {
    expect(joinRefDate("", "2026-01-12")).toBe("");
    expect(joinRefDate("   ", "2026-01-12")).toBe("");
  });

  it("round-trips", () => {
    const joined = joinRefDate("WO/77", "2025-12-31");
    expect(splitRefDate(joined)).toEqual({ number: "WO/77", dateISO: "2025-12-31" });
  });
});

describe("errorMessage", () => {
  it("reads an Error's message", () => {
    expect(errorMessage(new Error("Customer not found"))).toBe("Customer not found");
  });

  it("strips a leading 'Error:'", () => {
    expect(errorMessage("Error: Invoice is paid")).toBe("Invoice is paid");
    expect(errorMessage(new Error("Error:   spaced"))).toBe("spaced");
  });

  it("only strips it at the start", () => {
    expect(errorMessage("Bad Error: here")).toBe("Bad Error: here");
  });

  it("turns other values into text", () => {
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
  });
});

describe("formatFileSize", () => {
  it("uses KB below a megabyte", () => {
    expect(formatFileSize(0)).toBe("0.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("uses MB from a megabyte", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});

describe("typing a DD-MM-YYYY date", () => {
  it("puts the dashes in as digits are typed", () => {
    expect(typedDate("1")).toBe("1");
    expect(typedDate("161")).toBe("16-1");
    expect(typedDate("16102")).toBe("16-10-2");
    expect(typedDate("16102026")).toBe("16-10-2026");
    expect(typedDate("16/10/2026")).toBe("16-10-2026");
    expect(typedDate("16-10-20269")).toBe("16-10-2026");
    expect(typedDate("")).toBe("");
  });

  it("keeps other text as typed (older invoices)", () => {
    expect(typedDate("As per DC")).toBe("As per DC");
  });

  it("reads only real days", () => {
    expect(parseDisplayDate("16-10-2026")).toBe("2026-10-16");
    expect(parseDisplayDate(" 29-02-2028 ")).toBe("2028-02-29");
    expect(parseDisplayDate("29-02-2026")).toBeNull();
    expect(parseDisplayDate("31-04-2026")).toBeNull();
    expect(parseDisplayDate("16-10-26")).toBeNull();
    expect(parseDisplayDate("2026-10-16")).toBeNull();
    expect(parseDisplayDate(null)).toBeNull();
  });
});
