import { useCallback, useEffect, useState } from "react";

/** Below this window width the sidebar closes by itself (for example the app on half the screen). */
export const NARROW_QUERY = "(max-width: 1099px)";
export const SIDEBAR_KEY = "mww.sidebar";

function readSidebarChoice(): "open" | "closed" {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "closed" ? "closed" : "open";
  } catch {
    return "open";
  }
}

function saveSidebarChoice(choice: "open" | "closed") {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, choice);
  } catch {
    // Not remembered this time; the sidebar still works.
  }
}

const isNarrow = () => typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;

/**
 * Open or closed (a thin strip of icons). A narrow window closes it and widening opens it again,
 * back to the owner's own choice on a wide window, which is remembered between starts.
 */
export function useSidebar() {
  const [closed, setClosed] = useState(() => isNarrow() || readSidebarChoice() === "closed");
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const follow = () => setClosed(query.matches || readSidebarChoice() === "closed");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);
  const toggle = useCallback(() => {
    setClosed((was) => {
      // Only a choice made on a wide window is kept; on a narrow one it lasts until the window changes.
      if (!isNarrow()) saveSidebarChoice(was ? "open" : "closed");
      return !was;
    });
  }, []);
  return { closed, toggle };
}
