/** GST state codes. The business is registered in Puducherry (34). */
export const GST_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

export const HOME_STATE = { code: "34", name: "Puducherry" };

const ALIASES: Record<string, string> = {
  pondicherry: "34",
  pondy: "34",
  tamilnadu: "33",
  orissa: "21",
  "new delhi": "07",
};

/** Finds the GST state code from a GSTIN (first two digits) or a state name. */
export function stateCodeFor(state: string | null | undefined, gstin?: string | null): string | null {
  const fromGstin = gstin?.trim().slice(0, 2);
  if (fromGstin && /^\d{2}$/.test(fromGstin) && GST_STATES.some((s) => s.code === fromGstin)) {
    return fromGstin;
  }
  const key = (state ?? "").trim().toLowerCase();
  if (!key) return null;
  const match = GST_STATES.find((s) => s.name.toLowerCase() === key);
  return match?.code ?? ALIASES[key] ?? null;
}

export function stateName(code: string | null | undefined): string | null {
  return GST_STATES.find((s) => s.code === code)?.name ?? null;
}

/** Supplies within Puducherry are charged CGST + SGST; everything else IGST. */
export function taxTypeFor(stateCode: string | null): "CGST_SGST" | "IGST" {
  return !stateCode || stateCode === HOME_STATE.code ? "CGST_SGST" : "IGST";
}
