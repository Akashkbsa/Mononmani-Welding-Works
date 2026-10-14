/**
 * An invoice line description may carry a little formatting: bold, italic, a size from 1 (smallest)
 * to 7 and line breaks. It is stored as text with only these tags: <b>, <i>, <font size="N"> and <br>.
 * This mirrors `sanitize_rich_text` in the backend, which has the final say when saving.
 */

function allowedTag(s: string): { tag: string; length: number } | null {
  const end = s.indexOf(">");
  if (end < 0) return null;
  const inner = s.slice(1, end).trim().toLowerCase();
  const length = end + 1;
  const simple: Record<string, string> = {
    b: "<b>",
    strong: "<b>",
    "/b": "</b>",
    "/strong": "</b>",
    i: "<i>",
    em: "<i>",
    "/i": "</i>",
    "/em": "</i>",
    br: "<br>",
    "br/": "<br>",
    "br /": "<br>",
    "/font": "</font>",
  };
  if (simple[inner]) return { tag: simple[inner], length };
  const m = /^font\s+size\s*=\s*["']?([1-7])["']?$/.exec(inner);
  return m ? { tag: `<font size="${m[1]}">`, length } : null;
}

/** Keep only the allowed tags; show every other "<" as text and turn typed new lines into <br>. */
export function sanitizeRich(input: string): string {
  const text = input.replace(/\r\n?/g, "\n");
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      out += "<br>";
      i += 1;
    } else if (c === "<") {
      const found = allowedTag(text.slice(i));
      if (found) {
        out += found.tag;
        i += found.length;
      } else {
        out += "&lt;";
        i += 1;
      }
    } else {
      out += c;
      i += 1;
    }
  }
  while (out.endsWith("<br>")) out = out.slice(0, -4);
  return out.trim();
}

/** The text without its formatting, for checks like "is it empty". */
export function richToPlain(input: string): string {
  return sanitizeRich(input)
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

const escapeText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, " ");

/** What the editing box currently holds, written as the allowed tags only. */
export function domToRich(root: Node): string {
  let out = "";
  root.childNodes.forEach((node, index) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += escapeText(node.textContent ?? "");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const inner = domToRich(node);
    switch (node.tagName) {
      case "B":
      case "STRONG":
        out += `<b>${inner}</b>`;
        break;
      case "I":
      case "EM":
        out += `<i>${inner}</i>`;
        break;
      case "FONT": {
        const size = /^[1-7]$/.test(node.getAttribute("size") ?? "") ? node.getAttribute("size") : null;
        out += size ? `<font size="${size}">${inner}</font>` : inner;
        break;
      }
      case "BR":
        out += "<br>";
        break;
      case "DIV":
      case "P":
        out += inner;
        if (index < root.childNodes.length - 1 && !inner.endsWith("<br>")) out += "<br>";
        break;
      default:
        out += inner;
    }
  });
  return out;
}
