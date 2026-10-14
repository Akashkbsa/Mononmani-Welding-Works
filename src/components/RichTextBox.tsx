import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bold, Italic, Minus, Plus } from "lucide-react";
import { domToRich, richToPlain, sanitizeRich } from "../lib/richText";

interface Props {
  /** The text with its formatting (see lib/richText). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

const MIN_SIZE = 1;
const MAX_SIZE = 7;
const NORMAL_SIZE = 3;

/**
 * A few lines of text where selecting words shows a small bar, like Word's: smaller, larger, bold
 * and italic. Enter starts a new line. Pasted text keeps no outside formatting.
 */
export default function RichTextBox({ value, onChange, placeholder, ariaLabel }: Props) {
  const editor = useRef<HTMLDivElement>(null);
  // What this box last reported, so a re-render with the same value never resets the cursor.
  const lastEmitted = useRef<string | null>(null);
  const [bar, setBar] = useState<{ x: number; y: number; below: boolean } | null>(null);

  useEffect(() => {
    const el = editor.current;
    if (el && value !== lastEmitted.current) {
      el.innerHTML = sanitizeRich(value);
      lastEmitted.current = value;
    }
  }, [value]);

  // Show the bar while some of this box's text is selected.
  useEffect(() => {
    const update = () => {
      const el = editor.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.isCollapsed || sel.rangeCount === 0 || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) {
        setBar(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return setBar(null);
      const below = rect.top < 56;
      setBar({ x: rect.left + rect.width / 2, y: below ? rect.bottom : rect.top, below });
    };
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);

  const emit = () => {
    const el = editor.current;
    if (!el) return;
    // An emptied box keeps a stray <br>; clear it so the placeholder shows again.
    if (el.textContent === "" && !el.querySelector("br")) el.innerHTML = "";
    const next = sanitizeRich(domToRich(el));
    lastEmitted.current = next;
    onChange(next);
  };

  const run = (command: string, argument?: string) => {
    editor.current?.focus();
    document.execCommand(command, false, argument);
    emit();
  };

  const changeSize = (step: number) => {
    const current = parseInt(document.queryCommandValue("fontSize"), 10) || NORMAL_SIZE;
    const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, current + step));
    if (next !== current) run("fontSize", String(next));
  };

  const insertText = (text: string) => {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    lines.forEach((line, i) => {
      if (i > 0) document.execCommand("insertLineBreak");
      if (line) document.execCommand("insertText", false, line);
    });
  };

  const tool = "grid h-8 w-8 place-items-center rounded text-slate-700 hover:bg-slate-100 active:bg-slate-200";

  return (
    <>
      <div
        ref={editor}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        spellCheck
        className="rich rich-box min-h-[4.25rem] w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        onInput={emit}
        onBlur={emit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            document.execCommand("insertLineBreak");
            emit();
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          insertText(e.clipboardData.getData("text/plain"));
          emit();
        }}
        onDrop={(e) => e.preventDefault()}
      />
      {bar &&
        createPortal(
          <div
            role="toolbar"
            aria-label="Text style"
            // Keep the selection while a button is pressed.
            onMouseDown={(e) => e.preventDefault()}
            className="fixed z-[90] flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
            style={{ left: bar.x, top: bar.y, transform: bar.below ? "translate(-50%, 8px)" : "translate(-50%, calc(-100% - 8px))" }}
          >
            <button type="button" className={tool} title="Smaller text" aria-label="Smaller text" onClick={() => changeSize(-1)}>
              <Minus className="h-4 w-4" />
            </button>
            <button type="button" className={tool} title="Larger text" aria-label="Larger text" onClick={() => changeSize(1)}>
              <Plus className="h-4 w-4" />
            </button>
            <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden="true" />
            <button type="button" className={tool} title="Bold (Ctrl+B)" aria-label="Bold" onClick={() => run("bold")}>
              <Bold className="h-4 w-4" />
            </button>
            <button type="button" className={tool} title="Italic (Ctrl+I)" aria-label="Italic" onClick={() => run("italic")}>
              <Italic className="h-4 w-4" />
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

/** True when the formatted text has no real characters. */
export const isRichEmpty = (value: string) => richToPlain(value) === "";
