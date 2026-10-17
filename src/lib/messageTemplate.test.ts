import { describe, expect, it } from "vitest";
import { fillTemplate, insertAt, unknownKeywords } from "./messageTemplate";

describe("fillTemplate", () => {
  it("fills keywords and leaves other braces as typed", () => {
    const values = { name: "Ravi", rent: "₹12,000" };
    expect(fillTemplate("Hi {name}, rent {rent}. {name}!", values)).toBe("Hi Ravi, rent ₹12,000. Ravi!");
    expect(fillTemplate("{unknown} { name} {name", values)).toBe("{unknown} { name} {name");
    expect(fillTemplate("வணக்கம் {name}", values)).toBe("வணக்கம் Ravi");
  });
});

describe("unknownKeywords", () => {
  it("lists each keyword that is not allowed, once", () => {
    expect(unknownKeywords("{name} {age} {age} {in rupees}", ["name"])).toEqual(["age"]);
    expect(unknownKeywords("plain text", ["name"])).toEqual([]);
  });
});

describe("insertAt", () => {
  it("replaces the selection and moves the caret after the insert", () => {
    expect(insertAt("Hello !", "{name}", 6, 6)).toEqual({ text: "Hello {name}!", caret: 12 });
    expect(insertAt("Hello XX", "{name}", 6, 8)).toEqual({ text: "Hello {name}", caret: 12 });
    expect(insertAt("ab", "{x}", 99, 99)).toEqual({ text: "ab{x}", caret: 5 });
  });
});
