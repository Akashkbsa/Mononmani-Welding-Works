import { describe, expect, it } from "vitest";
import {
  financialYearOf,
  fyLabel,
  inMonth,
  isMonth,
  periodKind,
  periodTitle,
  rangeDates,
  rangePeriod,
  shiftPeriod,
  startOf,
} from "./period";

describe("periodKind", () => {
  it("tells the four kinds apart", () => {
    expect(periodKind("")).toBe("all");
    expect(periodKind("2026-10")).toBe("month");
    expect(periodKind("FY2026")).toBe("fy");
    expect(periodKind("R:2026-10-01:2026-10-20")).toBe("range");
  });
});

describe("financialYearOf", () => {
  it("starts the year in April", () => {
    expect(financialYearOf("2026-04-01")).toBe(2026);
    expect(financialYearOf("2026-12-31")).toBe(2026);
    expect(financialYearOf("2027-01-01")).toBe(2026);
    expect(financialYearOf("2027-03-31")).toBe(2026);
    expect(financialYearOf("2026-03-31")).toBe(2025);
  });
});

describe("isMonth", () => {
  it("accepts only YYYY-MM", () => {
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("")).toBe(false);
    expect(isMonth("FY2026")).toBe(false);
    expect(isMonth("2026-10-01")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
  });
});

describe("shiftPeriod", () => {
  it("steps months", () => {
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
  });

  it("steps financial years", () => {
    expect(shiftPeriod("FY2026", 1)).toBe("FY2027");
    expect(shiftPeriod("FY2026", -1)).toBe("FY2025");
  });

  it("leaves all dates and ranges alone", () => {
    expect(shiftPeriod("", 1)).toBe("");
    expect(shiftPeriod("R:2026-10-01:2026-10-20", 1)).toBe("R:2026-10-01:2026-10-20");
  });
});

describe("startOf", () => {
  const today = "2026-10-15";

  it("starts each kind at today", () => {
    expect(startOf("all", today)).toBe("");
    expect(startOf("month", today)).toBe("2026-10");
    expect(startOf("fy", today)).toBe("FY2026");
    expect(startOf("range", today)).toBe("R:2026-10-01:2026-10-15");
  });

  it("puts January to March in the previous financial year", () => {
    expect(startOf("fy", "2027-02-10")).toBe("FY2026");
  });

  it("gives a one-day range on the first of the month", () => {
    expect(startOf("range", "2026-10-01")).toBe("R:2026-10-01:2026-10-01");
  });
});

describe("rangePeriod and rangeDates", () => {
  it("keeps the earlier day first", () => {
    expect(rangePeriod("2026-10-01", "2026-10-20")).toBe("R:2026-10-01:2026-10-20");
    expect(rangePeriod("2026-10-20", "2026-10-01")).toBe("R:2026-10-01:2026-10-20");
    expect(rangePeriod("2026-10-05", "2026-10-05")).toBe("R:2026-10-05:2026-10-05");
  });

  it("reads the two days back", () => {
    expect(rangeDates("R:2026-10-01:2026-10-20")).toEqual({ from: "2026-10-01", to: "2026-10-20" });
  });

  it("gives empty days for a broken range", () => {
    expect(rangeDates("R:")).toEqual({ from: "", to: "" });
    expect(rangeDates("R:2026-10-01")).toEqual({ from: "2026-10-01", to: "" });
  });
});

describe("inMonth", () => {
  it("matches everything for all dates, even no date", () => {
    expect(inMonth("2020-01-01", "")).toBe(true);
    expect(inMonth(null, "")).toBe(true);
    expect(inMonth(undefined, "")).toBe(true);
  });

  it("never matches a missing date once a period is chosen", () => {
    expect(inMonth(null, "2026-10")).toBe(false);
    expect(inMonth("", "FY2026")).toBe(false);
    expect(inMonth(undefined, "R:2026-10-01:2026-10-20")).toBe(false);
  });

  it("matches one month", () => {
    expect(inMonth("2026-10-01", "2026-10")).toBe(true);
    expect(inMonth("2026-10-31", "2026-10")).toBe(true);
    expect(inMonth("2026-11-01", "2026-10")).toBe(false);
    expect(inMonth("2025-10-15", "2026-10")).toBe(false);
  });

  it("matches a financial year from 1 April to 31 March, both included", () => {
    expect(inMonth("2026-04-01", "FY2026")).toBe(true);
    expect(inMonth("2027-03-31", "FY2026")).toBe(true);
    expect(inMonth("2026-03-31", "FY2026")).toBe(false);
    expect(inMonth("2027-04-01", "FY2026")).toBe(false);
  });

  it("matches a custom range with both days included", () => {
    const p = "R:2026-10-05:2026-10-20";
    expect(inMonth("2026-10-05", p)).toBe(true);
    expect(inMonth("2026-10-20", p)).toBe(true);
    expect(inMonth("2026-10-04", p)).toBe(false);
    expect(inMonth("2026-10-21", p)).toBe(false);
  });
});

describe("fyLabel and periodTitle", () => {
  it("labels a financial year", () => {
    expect(fyLabel(2026)).toBe("2026-27");
    expect(fyLabel(1999)).toBe("1999-00");
  });

  it("titles every kind", () => {
    expect(periodTitle("")).toBe("all dates");
    expect(periodTitle("2026-10")).toBe("October 2026");
    expect(periodTitle("FY2026")).toBe("financial year 2026-27");
    expect(periodTitle("R:2026-10-01:2026-10-20")).toBe("01-10-2026 to 20-10-2026");
  });
});
