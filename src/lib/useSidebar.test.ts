import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { SIDEBAR_KEY, useSidebar } from "./useSidebar";

/** A pretend window width: narrow or wide, which tests can change while the hook listens. */
let narrow = false;
const listeners = new Set<() => void>();
function setNarrow(value: boolean) {
  narrow = value;
  listeners.forEach((l) => l());
}

beforeEach(() => {
  narrow = false;
  listeners.clear();
  window.localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return narrow;
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }))
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("the sidebar", () => {
  it("starts open on a wide window", () => {
    expect(renderHook(() => useSidebar()).result.current.closed).toBe(false);
  });

  it("starts closed on a narrow window, such as half the screen", () => {
    narrow = true;
    expect(renderHook(() => useSidebar()).result.current.closed).toBe(true);
  });

  it("closes when the window is made narrow and opens again when widened", () => {
    const { result } = renderHook(() => useSidebar());
    act(() => setNarrow(true));
    expect(result.current.closed).toBe(true);
    act(() => setNarrow(false));
    expect(result.current.closed).toBe(false);
  });

  it("remembers closing it on a wide window, also after widening and the next start", () => {
    const { result, unmount } = renderHook(() => useSidebar());
    act(() => result.current.toggle());
    expect(result.current.closed).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe("closed");
    act(() => setNarrow(true));
    act(() => setNarrow(false));
    expect(result.current.closed).toBe(true);
    unmount();
    expect(renderHook(() => useSidebar()).result.current.closed).toBe(true);
  });

  it("can be opened on a narrow window for a moment without changing the remembered choice", () => {
    narrow = true;
    const { result } = renderHook(() => useSidebar());
    act(() => result.current.toggle());
    expect(result.current.closed).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBeNull();
  });

  it("still works when the remembered choice cannot be stored", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useSidebar());
    act(() => result.current.toggle());
    expect(result.current.closed).toBe(true);
    vi.restoreAllMocks();
  });
});
