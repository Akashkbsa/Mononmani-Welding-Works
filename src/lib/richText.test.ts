import { describe, expect, it } from "vitest";
import { domToRich, richToPlain, sanitizeRich } from "./richText";

const box = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("sanitizeRich", () => {
  it("keeps plain text as it is", () => {
    expect(sanitizeRich("MS angle 50x50x6")).toBe("MS angle 50x50x6");
  });

  it("keeps the four allowed formats", () => {
    expect(sanitizeRich('<b>bold</b> <i>it</i><br><font size="5">big</font>')).toBe(
      '<b>bold</b> <i>it</i><br><font size="5">big</font>'
    );
  });

  it("writes the other spellings of bold, italic and line break the short way", () => {
    expect(sanitizeRich("<strong>a</strong><em>b</em>c<br/>d<br />e<BR>f")).toBe("<b>a</b><i>b</i>c<br>d<br>e<br>f");
    // Case does not matter, but a space after the slash makes it something else.
    expect(sanitizeRich("<B> x </ B>")).toBe("<b> x &lt;/ B>");
  });

  it("accepts font sizes 1 to 7 in any quoting", () => {
    expect(sanitizeRich("<font size=7>x</font>")).toBe('<font size="7">x</font>');
    expect(sanitizeRich("<font size='1'>x</font>")).toBe('<font size="1">x</font>');
    expect(sanitizeRich('<FONT SIZE = "3">x</FONT>')).toBe('<font size="3">x</font>');
  });

  it("shows other tags as text", () => {
    expect(sanitizeRich("<script>alert(1)</script>")).toBe("&lt;script>alert(1)&lt;/script>");
    expect(sanitizeRich('<font size="8">x</font>')).toBe('&lt;font size="8">x</font>');
    expect(sanitizeRich('<font color="red">x</font>')).toBe('&lt;font color="red">x</font>');
    expect(sanitizeRich('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror="alert(1)">');
  });

  it("shows a lone < as text", () => {
    expect(sanitizeRich("a < b")).toBe("a &lt; b");
    expect(sanitizeRich("x <")).toBe("x &lt;");
  });

  it("turns typed new lines into line breaks", () => {
    expect(sanitizeRich("one\ntwo\r\nthree\rfour")).toBe("one<br>two<br>three<br>four");
  });

  it("drops trailing line breaks and outer spaces", () => {
    expect(sanitizeRich("  text\n\n")).toBe("text");
    expect(sanitizeRich("text<br><br>")).toBe("text");
  });

  it("is stable when run twice", () => {
    const once = sanitizeRich('<strong>a</strong>\n<font size=2>b</font> <x>');
    expect(sanitizeRich(once)).toBe(once);
  });

  it("gives empty text for nothing", () => {
    expect(sanitizeRich("")).toBe("");
    expect(sanitizeRich("\n\n")).toBe("");
  });
});

describe("richToPlain", () => {
  it("removes the formatting", () => {
    expect(richToPlain('<b>Gate</b> <font size="5">welding</font><br>work')).toBe("Gate weldingwork");
  });

  it("turns escapes back into characters", () => {
    expect(richToPlain("a < b &amp; c &gt; d&nbsp;e")).toBe("a < b & c > d e");
  });

  it("is empty for formatting with no text", () => {
    expect(richToPlain("<b></b><br>  ")).toBe("");
    expect(richToPlain("")).toBe("");
  });
});

describe("domToRich", () => {
  it("writes text with special characters escaped", () => {
    expect(domToRich(box("a &lt; b &amp; c"))).toBe("a &lt; b &amp; c");
  });

  it("writes bold, italic and their other spellings", () => {
    expect(domToRich(box("<b>a</b><strong>b</strong><i>c</i><em>d</em>"))).toBe("<b>a</b><b>b</b><i>c</i><i>d</i>");
  });

  it("keeps a valid font size and drops an invalid one", () => {
    expect(domToRich(box('<font size="6">x</font>'))).toBe('<font size="6">x</font>');
    expect(domToRich(box('<font size="9">x</font>'))).toBe("x");
    expect(domToRich(box('<font face="Arial">x</font>'))).toBe("x");
  });

  it("writes line breaks", () => {
    expect(domToRich(box("a<br>b"))).toBe("a<br>b");
  });

  it("turns paragraphs and divs into lines", () => {
    expect(domToRich(box("<div>one</div><div>two</div>"))).toBe("one<br>two");
    expect(domToRich(box("<p>one</p><p>two</p>"))).toBe("one<br>two");
  });

  it("does not add a second break after a div that already ends with one", () => {
    expect(domToRich(box("<div>one<br></div><div>two</div>"))).toBe("one<br>two");
  });

  it("keeps the text of unknown elements but not the element", () => {
    expect(domToRich(box('<span style="color:red">red</span> <u>under</u>'))).toBe("red under");
  });

  it("keeps nested formatting", () => {
    expect(domToRich(box('<b><i>both</i></b> <font size="2"><b>x</b></font>'))).toBe(
      '<b><i>both</i></b> <font size="2"><b>x</b></font>'
    );
  });

  it("ignores comments", () => {
    expect(domToRich(box("a<!-- hidden -->b"))).toBe("ab");
  });

  it("round-trips with sanitizeRich", () => {
    const stored = '<b>Gate</b> <i>grill</i><br><font size="5">big</font> &lt; 5';
    expect(sanitizeRich(domToRich(box(stored)))).toBe(stored);
  });
});
