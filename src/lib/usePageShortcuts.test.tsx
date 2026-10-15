import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { usePageShortcuts } from "./usePageShortcuts";

function Page({ onNew, withDialog = false, withSearch = true }: { onNew?: () => void; withDialog?: boolean; withSearch?: boolean }) {
  const searchRef = useRef<HTMLInputElement>(null);
  usePageShortcuts({ searchRef: withSearch ? searchRef : undefined, onNew });
  return (
    <div>
      <input aria-label="Search" ref={searchRef} defaultValue="old text" />
      <input aria-label="Other box" />
      <div aria-label="Note" contentEditable suppressContentEditableWarning />
      <button>Plain button</button>
      {withDialog && <div role="dialog">Open dialog</div>}
    </div>
  );
}

describe("usePageShortcuts", () => {
  it("'/' moves to the search box and selects its text", () => {
    render(<Page />);
    const search = screen.getByLabelText("Search") as HTMLInputElement;
    fireEvent.keyDown(screen.getByText("Plain button"), { key: "/" });
    expect(search).toHaveFocus();
    expect(search.selectionStart).toBe(0);
    expect(search.selectionEnd).toBe("old text".length);
  });

  it("'/' is left alone while typing in a box", () => {
    render(<Page />);
    const other = screen.getByLabelText("Other box");
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(other).toHaveFocus();
  });

  it("'/' is left alone while typing in an editable area", () => {
    render(<Page />);
    const note = screen.getByLabelText("Note");
    // jsdom does not compute isContentEditable, so set it the way a browser would report it.
    Object.defineProperty(note, "isContentEditable", { value: true });
    fireEvent.keyDown(note, { key: "/" });
    expect(screen.getByLabelText("Search")).not.toHaveFocus();
  });

  it("'/' with Ctrl, Alt or Meta does nothing", () => {
    render(<Page />);
    for (const mod of ["ctrlKey", "altKey", "metaKey"]) {
      fireEvent.keyDown(document.body, { key: "/", [mod]: true });
      expect(screen.getByLabelText("Search")).not.toHaveFocus();
    }
  });

  it("'/' does nothing without a search box", () => {
    render(<Page withSearch={false} />);
    const event = fireEvent.keyDown(document.body, { key: "/" });
    expect(event).toBe(true); // not prevented
  });

  it("Ctrl+N and Cmd+N start a new record", () => {
    const onNew = vi.fn();
    render(<Page onNew={onNew} />);
    expect(fireEvent.keyDown(document.body, { key: "n", ctrlKey: true })).toBe(false);
    fireEvent.keyDown(document.body, { key: "N", metaKey: true });
    expect(onNew).toHaveBeenCalledTimes(2);
  });

  it("Ctrl+Shift+N and Ctrl+Alt+N are ignored", () => {
    const onNew = vi.fn();
    render(<Page onNew={onNew} />);
    fireEvent.keyDown(document.body, { key: "N", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: "n", ctrlKey: true, altKey: true });
    fireEvent.keyDown(document.body, { key: "n" });
    expect(onNew).not.toHaveBeenCalled();
  });

  it("does nothing while a dialog is open", () => {
    const onNew = vi.fn();
    render(<Page onNew={onNew} withDialog />);
    fireEvent.keyDown(document.body, { key: "n", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "/" });
    expect(onNew).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Search")).not.toHaveFocus();
  });

  it("does nothing when another handler already took the key", () => {
    const onNew = vi.fn();
    render(<Page onNew={onNew} />);
    const event = new KeyboardEvent("keydown", { key: "n", ctrlKey: true, cancelable: true, bubbles: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(onNew).not.toHaveBeenCalled();
  });

  it("always calls the latest handler", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Page onNew={first} />);
    rerender(<Page onNew={second} />);
    fireEvent.keyDown(document.body, { key: "n", ctrlKey: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("stops listening when the page goes away", () => {
    const onNew = vi.fn();
    const { unmount } = render(<Page onNew={onNew} />);
    unmount();
    fireEvent.keyDown(document.body, { key: "n", ctrlKey: true });
    expect(onNew).not.toHaveBeenCalled();
  });
});
