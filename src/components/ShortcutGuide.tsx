import { useEffect, useState } from "react";
import { Modal } from "./ui";

interface ShortcutRow {
  keys: string[];
  description: string;
}

interface Group {
  title: string;
  rows: ShortcutRow[];
}

const GROUPS: Group[] = [
  {
    title: "Anywhere",
    rows: [
      { keys: ["Ctrl+B"], description: "Open or close the sidebar" },
      { keys: ["Escape"], description: "Close the open dialog or menu" },
      { keys: ["?"], description: "Show this keyboard shortcut guide" },
    ],
  },
  {
    title: "List pages",
    rows: [
      { keys: ["/"], description: "Jump to the search box" },
      { keys: ["Ctrl+N"], description: "Create a new record on the current page" },
    ],
  },
  {
    title: "Image viewer",
    rows: [
      { keys: ["+", "="], description: "Zoom in" },
      { keys: ["-", "_"], description: "Zoom out" },
      { keys: ["0"], description: "Fit image to screen" },
      { keys: ["F"], description: "Toggle fullscreen" },
      { keys: ["←", "→"], description: "Previous / next image" },
      { keys: ["Escape"], description: "Close the image viewer" },
    ],
  },
  {
    title: "Text editor",
    rows: [
      { keys: ["Ctrl+B"], description: "Bold" },
      { keys: ["Ctrl+I"], description: "Italic" },
    ],
  },
];

/** True while the user is typing in a form field. */
function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
}

export default function ShortcutGuide() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?" && !isTyping(e.target)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <Modal title="Keyboard shortcuts" onClose={() => setOpen(false)} size="sm">
      <div className="space-y-5 text-sm">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</h3>
            <table className="w-full">
              <tbody className="divide-y divide-slate-100">
                {group.rows.map((row) => (
                  <tr key={row.description}>
                    <td className="py-1.5 pr-4 w-32">
                      <span className="flex gap-1">
                        {row.keys.map((k) => (
                          <kbd
                            key={k}
                            className="inline-flex items-center rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </td>
                    <td className="py-1.5 text-slate-600">{row.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Modal>
  );
}
