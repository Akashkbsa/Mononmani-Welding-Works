import { RefObject, useEffect, useRef } from "react";

/** True while the user is typing in a box, so single keys belong to that box. */
function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
}

/**
 * The same keys on every list screen: "/" jumps to the search box and Ctrl+N starts a new record.
 * Both are ignored while the user is typing or while a window (dialog) is open.
 */
export function usePageShortcuts({ searchRef, onNew }: { searchRef?: RefObject<HTMLInputElement | null>; onNew?: () => void }) {
  // Kept in a ref so the listener is added once, yet always calls the latest handler.
  const newRef = useRef(onNew);
  newRef.current = onNew;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || document.querySelector('[role="dialog"]')) return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && searchRef?.current) {
        e.preventDefault();
        searchRef.current.focus();
        searchRef.current.select();
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "n" && newRef.current) {
        e.preventDefault();
        newRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchRef]);
}
