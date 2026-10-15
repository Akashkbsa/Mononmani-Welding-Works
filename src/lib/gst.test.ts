import { describe, expect, it } from "vitest";
import { GST_STATES, HOME_STATE, stateCodeFor, stateName, taxTypeFor } from "./gst";

describe("GST_STATES", () => {
  it("has unique two-digit codes and names", () => {
    const codes = GST_STATES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(GST_STATES.map((s) => s.name.toLowerCase())).size).toBe(GST_STATES.length);
    for (const code of codes) expect(code).toMatch(/^\d{2}$/);
  });

  it("includes the home state, Puducherry (34)", () => {
    expect(GST_STATES).toContainEqual(HOME_STATE);
    expect(HOME_STATE).toEqual({ code: "34", name: "Puducherry" });
  });
});

describe("stateCodeFor", () => {
  it("takes the code from a GSTIN first", () => {
    expect(stateCodeFor("Tamil Nadu", "34AABCU9603R1ZM")).toBe("34");
    expect(stateCodeFor(null, "33AABCU9603R1ZM")).toBe("33");
    expect(stateCodeFor(undefined, "  29AABCU9603R1ZM ")).toBe("29");
  });

  it("falls back to the state name when the GSTIN has no known code", () => {
    expect(stateCodeFor("Kerala", "99AABCU9603R1ZM")).toBe("32");
    expect(stateCodeFor("Kerala", "XXAAB")).toBe("32");
    expect(stateCodeFor("Kerala", "25AABCU9603R1ZM")).toBe("32");
    expect(stateCodeFor("Kerala", "")).toBe("32");
    expect(stateCodeFor("Kerala", null)).toBe("32");
  });

  it("matches state names whatever the case or spaces", () => {
    expect(stateCodeFor("puducherry")).toBe("34");
    expect(stateCodeFor("  TAMIL NADU  ")).toBe("33");
    expect(stateCodeFor("Dadra and Nagar Haveli and Daman and Diu")).toBe("26");
  });

  it("knows the common old and short names", () => {
    expect(stateCodeFor("Pondicherry")).toBe("34");
    expect(stateCodeFor("pondy")).toBe("34");
    expect(stateCodeFor("TamilNadu")).toBe("33");
    expect(stateCodeFor("Orissa")).toBe("21");
    expect(stateCodeFor("New Delhi")).toBe("07");
  });

  it("gives null for nothing or an unknown state", () => {
    expect(stateCodeFor(null)).toBeNull();
    expect(stateCodeFor("")).toBeNull();
    expect(stateCodeFor("   ")).toBeNull();
    expect(stateCodeFor("Atlantis")).toBeNull();
  });
});

describe("stateName", () => {
  it("names a code", () => {
    expect(stateName("34")).toBe("Puducherry");
    expect(stateName("07")).toBe("Delhi");
  });

  it("gives null for unknown or missing codes", () => {
    expect(stateName("25")).toBeNull();
    expect(stateName("7")).toBeNull();
    expect(stateName(null)).toBeNull();
    expect(stateName(undefined)).toBeNull();
  });
});

describe("taxTypeFor", () => {
  it("charges CGST + SGST inside Puducherry", () => {
    expect(taxTypeFor("34")).toBe("CGST_SGST");
  });

  it("charges IGST for every other state", () => {
    for (const s of GST_STATES.filter((s) => s.code !== "34")) expect(taxTypeFor(s.code)).toBe("IGST");
  });

  it("treats an unknown state as local", () => {
    expect(taxTypeFor(null)).toBe("CGST_SGST");
    expect(taxTypeFor("")).toBe("CGST_SGST");
  });
});
