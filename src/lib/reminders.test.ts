import { describe, expect, it } from "vitest";
import { remindText, repeatText, SNOOZE_OPTIONS, snoozeLabel, STATE_STYLE, whenText } from "./reminders";

describe("whenText", () => {
  it("reads naturally around today", () => {
    expect(whenText(0)).toBe("today");
    expect(whenText(1)).toBe("tomorrow");
    expect(whenText(2)).toBe("in 2 days");
    expect(whenText(30)).toBe("in 30 days");
    expect(whenText(-1)).toBe("1 day late");
    expect(whenText(-3)).toBe("3 days late");
  });
});

describe("STATE_STYLE", () => {
  it("styles every state", () => {
    for (const s of ["WAITING", "COMING_UP", "DUE_TODAY", "OVERDUE", "DONE"] as const) {
      expect(STATE_STYLE[s].label).toBeTruthy();
      expect(STATE_STYLE[s].chip).toMatch(/^bg-/);
      expect(STATE_STYLE[s].stripe).toMatch(/^bg-/);
    }
    expect(STATE_STYLE.OVERDUE.label).toBe("Overdue");
  });
});

describe("repeatText", () => {
  it("names each repeat", () => {
    expect(repeatText({ repeat: "NONE", month_end: false })).toBe("");
    expect(repeatText({ repeat: "WEEKLY", month_end: false })).toBe("Every week");
    expect(repeatText({ repeat: "MONTHLY", month_end: false })).toBe("Every month");
    expect(repeatText({ repeat: "MONTHLY", month_end: true })).toBe("Last day of every month");
    expect(repeatText({ repeat: "YEARLY", month_end: false })).toBe("Every year");
  });

  it("ignores month end for repeats other than monthly", () => {
    expect(repeatText({ repeat: "YEARLY", month_end: true })).toBe("Every year");
    expect(repeatText({ repeat: "NONE", month_end: true })).toBe("");
  });
});

describe("remindText", () => {
  it("reads the days before", () => {
    expect(remindText(0)).toBe("On the day");
    expect(remindText(1)).toBe("1 day before");
    expect(remindText(3)).toBe("3 days before");
    expect(remindText(7)).toBe("1 week before");
    expect(remindText(14)).toBe("14 days before");
  });
});

describe("snoozeLabel", () => {
  it("names the usual lengths", () => {
    expect(snoozeLabel(1)).toBe("Tomorrow");
    expect(snoozeLabel(2)).toBe("2 days");
    expect(snoozeLabel(7)).toBe("1 week");
    expect(snoozeLabel(14)).toBe("2 weeks");
    expect(snoozeLabel(30)).toBe("1 month");
    expect(snoozeLabel(10)).toBe("10 days");
  });

  it("has a label for every option offered", () => {
    expect(SNOOZE_OPTIONS[0]).toBe(1);
    for (const d of SNOOZE_OPTIONS) expect(snoozeLabel(d)).not.toBe("");
  });
});
