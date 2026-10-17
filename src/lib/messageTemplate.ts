/**
 * WhatsApp message templates: `{keyword}` is replaced by the person's own value. Words in braces
 * that are not keywords stay as typed. The app fills the real message (src-tauri messages/templates.rs);
 * this copy only draws the Settings preview with sample values.
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}

/** Keywords written in a template that are not in `known`, without braces. */
export function unknownKeywords(template: string, known: string[]): string[] {
  const found = Array.from(template.matchAll(/\{([A-Za-z0-9_]+)\}/g), (m) => m[1]);
  return Array.from(new Set(found.filter((k) => !known.includes(k))));
}

/** Text with `insert` put in place of the selection [start, end); returns the new text and caret. */
export function insertAt(text: string, insert: string, start: number, end: number): { text: string; caret: number } {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return { text: text.slice(0, s) + insert + text.slice(e), caret: s + insert.length };
}
