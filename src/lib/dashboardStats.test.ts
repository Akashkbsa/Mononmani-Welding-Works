import { describe, expect, it } from "vitest";
import { ageInDays, compactMoney, lastMonths, monthShort, monthlySums, topByName } from "./dashboardStats";

describe("lastMonths", () => {
  it("lists the months ending with today's, oldest first", () => {
    expect(lastMonths("2026-10-15", 6)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("crosses the year end", () => {
    expect(lastMonths("2026-02-01", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("gives one month or none", () => {
    expect(lastMonths("2026-10-15", 1)).toEqual(["2026-10"]);
    expect(lastMonths("2026-10-15", 0)).toEqual([]);
  });
});

describe("monthlySums", () => {
  const months = ["2026-08", "2026-09", "2026-10"];

  it("adds each month's amounts", () => {
    const items = [
      { date: "2026-08-01", amount: 100 },
      { date: "2026-08-31", amount: 50.5 },
      { date: "2026-10-10", amount: 20 },
    ];
    expect(monthlySums(items, months)).toEqual([150.5, 0, 20]);
  });

  it("ignores entries outside the months", () => {
    const items = [
      { date: "2026-07-31", amount: 999 },
      { date: "2026-11-01", amount: 999 },
      { date: "2026-09-15", amount: 1 },
    ];
    expect(monthlySums(items, months)).toEqual([0, 1, 0]);
  });

  it("rounds each total to the paisa", () => {
    const items = [
      { date: "2026-09-01", amount: 0.1 },
      { date: "2026-09-02", amount: 0.2 },
    ];
    expect(monthlySums(items, months)[1]).toBe(0.3);
  });

  it("gives zeros with no entries", () => {
    expect(monthlySums([], months)).toEqual([0, 0, 0]);
  });
});

describe("ageInDays", () => {
  it("counts whole days", () => {
    expect(ageInDays("2026-10-15", "2026-10-15")).toBe(0);
    expect(ageInDays("2026-10-14", "2026-10-15")).toBe(1);
    expect(ageInDays("2026-02-28", "2026-03-01")).toBe(1);
    expect(ageInDays("2024-02-28", "2024-03-01")).toBe(2);
    expect(ageInDays("2025-10-15", "2026-10-15")).toBe(365);
  });

  it("is 0 for a future date", () => {
    expect(ageInDays("2026-10-20", "2026-10-15")).toBe(0);
  });
});

describe("topByName", () => {
  it("adds by name, ignoring case and spaces, largest first", () => {
    const rows = topByName(
      [
        { name: "Ravi Steels", amount: 100 },
        { name: "ravi steels ", amount: 50 },
        { name: "Anand Works", amount: 200 },
        { name: "Bala Traders", amount: 10 },
      ],
      10
    );
    expect(rows).toEqual([
      { name: "Anand Works", amount: 200, count: 1 },
      { name: "Ravi Steels", amount: 150, count: 2 },
      { name: "Bala Traders", amount: 10, count: 1 },
    ]);
  });

  it("keeps only the first `limit`", () => {
    const rows = topByName(
      [
        { name: "A", amount: 1 },
        { name: "B", amount: 2 },
        { name: "C", amount: 3 },
      ],
      2
    );
    expect(rows.map((r) => r.name)).toEqual(["C", "B"]);
  });

  it("breaks ties by name", () => {
    const rows = topByName(
      [
        { name: "Zed", amount: 5 },
        { name: "Alpha", amount: 5 },
      ],
      5
    );
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Zed"]);
  });

  it("rounds totals to the paisa", () => {
    const rows = topByName(
      [
        { name: "A", amount: 0.1 },
        { name: "A", amount: 0.2 },
      ],
      1
    );
    expect(rows[0].amount).toBe(0.3);
  });

  it("gives nothing for nothing", () => {
    expect(topByName([], 5)).toEqual([]);
  });
});

describe("monthShort", () => {
  it("gives the short name, with the year only for January", () => {
    expect(monthShort("2026-10")).toBe("Oct");
    expect(monthShort("2026-12")).toBe("Dec");
    expect(monthShort("2027-01")).toBe("Jan 27");
  });
});

describe("compactMoney", () => {
  it("shows small amounts in whole rupees", () => {
    expect(compactMoney(0)).toBe("₹0");
    expect(compactMoney(999)).toBe("₹999");
    expect(compactMoney(999.6)).toBe("₹1000");
  });

  it("uses K for thousands", () => {
    expect(compactMoney(1000)).toBe("₹1 K");
    expect(compactMoney(1500)).toBe("₹1.5 K");
    expect(compactMoney(45_000)).toBe("₹45 K");
  });

  it("uses L for lakhs", () => {
    expect(compactMoney(100_000)).toBe("₹1 L");
    expect(compactMoney(120_000)).toBe("₹1.2 L");
    expect(compactMoney(1_250_000)).toBe("₹13 L");
  });

  it("uses Cr for crores", () => {
    expect(compactMoney(10_000_000)).toBe("₹1 Cr");
    expect(compactMoney(25_000_000)).toBe("₹2.5 Cr");
    expect(compactMoney(150_000_000)).toBe("₹15 Cr");
    expect(compactMoney(1_500_000_000)).toBe("₹150 Cr");
  });

  it("keeps the minus sign", () => {
    expect(compactMoney(-1500)).toBe("-₹1.5 K");
    expect(compactMoney(-50)).toBe("-₹50");
  });
});
