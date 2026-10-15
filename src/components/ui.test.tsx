import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  ListSkeleton,
  Loading,
  Modal,
  PageHeader,
  rowProps,
  SearchSelect,
  Stat,
  StatusBadge,
  ToastProvider,
  useDiscardGuard,
  usePresence,
  useToast,
} from "./ui";

afterEach(() => vi.useRealTimers());

describe("Button", () => {
  it("is a plain button by default so it never submits a form", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("can be a submit button", () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("calls onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled and cannot be clicked while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} icon={<span data-testid="icon" />}>
        Save
      </Button>
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(screen.queryByTestId("icon")).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows its icon when not loading", () => {
    render(<Button icon={<span data-testid="icon" />}>Add</Button>);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("applies the variant, size and extra classes", () => {
    render(
      <Button variant="danger" size="sm" className="extra">
        Delete
      </Button>
    );
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("bg-red-600");
    expect(cls).toContain("h-8");
    expect(cls).toContain("extra");
  });
});

describe("Field", () => {
  it("labels its control", () => {
    render(
      <Field label="Name" htmlFor="name">
        <input id="name" />
      </Field>
    );
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("marks a required field", () => {
    render(
      <Field label="Name" required>
        <input />
      </Field>
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("shows the error instead of the hint", () => {
    const { rerender } = render(
      <Field label="GSTIN" hint="15 characters">
        <input />
      </Field>
    );
    expect(screen.getByText("15 characters")).toBeInTheDocument();
    rerender(
      <Field label="GSTIN" hint="15 characters" error="GSTIN is not valid">
        <input />
      </Field>
    );
    expect(screen.getByText("GSTIN is not valid")).toBeInTheDocument();
    expect(screen.queryByText("15 characters")).not.toBeInTheDocument();
  });
});

describe("Checkbox", () => {
  it("reports the new value", async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Favourite" description="Shown first" />);
    expect(screen.getByText("Shown first")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Favourite/));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does nothing when disabled", async () => {
    const onChange = vi.fn();
    render(<Checkbox checked onChange={onChange} label="Favourite" disabled />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SearchSelect", () => {
  const options = [
    { id: 1, label: "Anand Steels", detail: "Puducherry", search: "Anand Steels Puducherry 9876500001" },
    { id: 2, label: "Bala Traders", detail: "Chennai", search: "Bala Traders Chennai 9876500002" },
    { id: 3, label: "Chennai Fabricators", search: "Chennai Fabricators Chennai" },
  ];

  function Harness({ initial = null as number | null, fallbackLabel }: { initial?: number | null; fallbackLabel?: string }) {
    const [value, setValue] = useState<number | null>(initial);
    return (
      <>
        <SearchSelect ariaLabel="Customer" options={options} value={value} onChange={setValue} fallbackLabel={fallbackLabel} />
        <output data-testid="value">{value ?? "none"}</output>
        <button>Outside</button>
      </>
    );
  }

  it("shows the selected option's label", () => {
    render(<Harness initial={2} />);
    expect(screen.getByRole("combobox")).toHaveValue("Bala Traders");
  });

  it("shows the fallback label when nothing matches the value", () => {
    render(<Harness fallbackLabel="Deleted customer" />);
    expect(screen.getByRole("combobox")).toHaveValue("Deleted customer");
  });

  it("opens on focus with every option listed", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText("Puducherry")).toBeInTheDocument();
  });

  it("needs every typed word to appear, in any order and case", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole("combobox"), "chennai BALA");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Bala TradersChennai"]);
  });

  it("shows the empty text when nothing matches", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole("combobox"), "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Nothing matches. Try a different word.")).toBeInTheDocument();
  });

  it("picks with the mouse", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByText("Chennai Fabricators"));
    expect(screen.getByTestId("value")).toHaveTextContent("3");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  it("moves with the arrow keys and picks with Enter", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox");
    await userEvent.click(box);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");
    expect(screen.getByTestId("value")).toHaveTextContent("2");
  });

  it("does not move past the first or last option", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{Enter}");
    expect(screen.getByTestId("value")).toHaveTextContent("1");
    await userEvent.click(screen.getByText("Outside"));
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(screen.getByTestId("value")).toHaveTextContent("3");
  });

  it("Enter with no matches picks nothing", async () => {
    render(<Harness initial={1} />);
    await userEvent.type(screen.getByRole("combobox"), "zzz{Enter}");
    expect(screen.getByTestId("value")).toHaveTextContent("1");
  });

  it("an arrow key opens a closed list", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox");
    await userEvent.click(box);
    await userEvent.keyboard("{Escape}");
    expect(box).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-expanded", "true");
  });

  it("Escape closes only the list, not a dialog around it", async () => {
    const onClose = vi.fn();
    render(
      <Modal title="New invoice" onClose={onClose}>
        <Harness />
      </Modal>
    );
    const box = screen.getByRole("combobox");
    await userEvent.click(box);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens again on a click right after picking", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox");
    await userEvent.click(box);
    await userEvent.click(screen.getByText("Bala Traders"));
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(box);
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("closes when clicking elsewhere", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByText("Outside"));
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  it("marks the selected option", async () => {
    render(<Harness initial={2} />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent("Bala Traders");
  });

  it("cannot be used when disabled", () => {
    render(<SearchSelect options={options} value={null} onChange={() => {}} disabled ariaLabel="Customer" />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

describe("small display pieces", () => {
  it("PageHeader shows title, description and actions", () => {
    render(<PageHeader title="Invoices" description="All bills" actions={<button>New</button>} />);
    expect(screen.getByRole("heading", { name: "Invoices" })).toBeInTheDocument();
    expect(screen.getByText("All bills")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("Stat is a button only when it can be clicked", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Stat label="Unpaid" value="₹100" note="3 invoices" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("3 invoices")).toBeInTheDocument();
    rerender(<Stat label="Unpaid" value="₹100" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("EmptyState shows its text and action", () => {
    render(<EmptyState title="No invoices yet" description="Create one" action={<button>Create</button>} />);
    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("Loading is announced", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("ListSkeleton draws the asked number of rows", () => {
    render(<ListSkeleton rows={3} label="Loading invoices" />);
    const status = screen.getByRole("status", { name: "Loading invoices" });
    expect(status.children).toHaveLength(3);
  });

  it("Alert is an alert for errors and a status otherwise", () => {
    const { rerender } = render(<Alert>Failed</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    rerender(<Alert tone="info">FYI</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("FYI");
  });

  it("Badge uses its tone", () => {
    render(<Badge tone="red">Late</Badge>);
    expect(screen.getByText("Late").className).toContain("bg-red-100");
  });
});

describe("StatusBadge", () => {
  it.each([
    ["PAID", "Paid"],
    ["PARTIALLY PAID", "Part paid"],
    ["UNPAID", "Unpaid"],
    ["DRAFT", "Draft"],
    ["CANCELLED", "Cancelled"],
    ["SOMETHING NEW", "SOMETHING NEW"],
  ])("shows %s as %s", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("gives unpaid invoices a colour block", () => {
    render(<StatusBadge status="UNPAID" />);
    expect(screen.getByText("Unpaid").className).toContain("bg-amber-100");
  });
});

describe("rowProps", () => {
  it("opens on click, Enter and Space on the row itself", () => {
    const onOpen = vi.fn();
    render(
      <table>
        <tbody>
          <tr {...rowProps(onOpen)} data-testid="row">
            <td>
              <button>Star</button>
            </td>
          </tr>
        </tbody>
      </table>
    );
    const row = screen.getByTestId("row");
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("leaves keys on controls inside the row alone", () => {
    const onOpen = vi.fn();
    render(
      <table>
        <tbody>
          <tr {...rowProps(onOpen)}>
            <td>
              <button>Star</button>
            </td>
          </tr>
        </tbody>
      </table>
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    const onOpen = vi.fn();
    render(
      <table>
        <tbody>
          <tr {...rowProps(onOpen)} data-testid="row" />
        </tbody>
      </table>
    );
    fireEvent.keyDown(screen.getByTestId("row"), { key: "a" });
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("usePresence", () => {
  it("stays mounted while closing, then unmounts", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 100), { initialProps: { open: true } });
    expect(result.current).toEqual({ mounted: true, closing: false });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, closing: true });
    act(() => vi.advanceTimersByTime(99));
    expect(result.current.mounted).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ mounted: false, closing: false });
  });

  it("starts unmounted when closed", () => {
    const { result } = renderHook(() => usePresence(false));
    expect(result.current).toEqual({ mounted: false, closing: false });
  });

  it("re-opening during the exit keeps it mounted", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 100), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(50));
    rerender({ open: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toEqual({ mounted: true, closing: false });
  });
});

describe("Modal", () => {
  it("is a labelled modal dialog", () => {
    render(
      <Modal title="Edit customer" subtitle="Anand Steels" onClose={() => {}} footer={<button>Save</button>}>
        body
      </Modal>
    );
    const dialog = screen.getByRole("dialog", { name: "Edit customer" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Anand Steels")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("closes with the X button and with Escape", async () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        body
      </Modal>
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("moves focus to the first control inside", () => {
    render(
      <Modal title="T" onClose={() => {}}>
        <input aria-label="first field" />
      </Modal>
    );
    // The header's close button comes first in the dialog.
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("leaves focus on a field that took it with autoFocus", () => {
    render(
      <Modal title="T" onClose={() => {}}>
        <input aria-label="name" autoFocus />
      </Modal>
    );
    expect(screen.getByLabelText("name")).toHaveFocus();
  });

  it("keeps Tab inside the dialog", () => {
    render(
      <Modal title="T" onClose={() => {}} footer={<button>Save</button>}>
        <input aria-label="name" />
      </Modal>
    );
    const close = screen.getByRole("button", { name: "Close" });
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
  });

  it("Escape closes only the dialog on top", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function Host() {
      const [asking, setAsking] = useState(false);
      return (
        <Modal title="Outer" onClose={outer}>
          <button onClick={() => setAsking(true)}>Ask</button>
          {asking && (
            <Modal title="Inner" onClose={inner}>
              inner body
            </Modal>
          )}
        </Modal>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it("gives focus back to what had it before", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <Modal title="T" onClose={() => setOpen(false)}>
              body
            </Modal>
          )}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    expect(opener).not.toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("leaves a fading, unclickable copy behind when removed", async () => {
    const { unmount } = render(
      <Modal title="Gone" onClose={() => {}}>
        <input id="field" aria-label="field" />
      </Modal>
    );
    unmount();
    await Promise.resolve();
    const ghost = document.body.querySelector(".mww-ghost");
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost).toHaveAttribute("inert");
    expect(ghost!.querySelector("[id]")).toBeNull();
    ghost!.remove();
  });
});

describe("ConfirmDialog", () => {
  it("runs the action and closes", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ConfirmDialog title="Delete invoice?" message="It cannot be undone." confirmLabel="Delete" onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Delete invoice?" })).toHaveTextContent("It cannot be undone.");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows the reason when refused and stays open", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Invoice has payments"));
    const onClose = vi.fn();
    render(<ConfirmDialog title="Delete?" message="Sure?" confirmLabel="Delete" onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invoice has payments");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("shows a refusal that is plain text", async () => {
    render(<ConfirmDialog title="Delete?" message="Sure?" confirmLabel="Delete" onConfirm={() => Promise.reject("No")} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No");
  });

  it("disables the button while working", async () => {
    let finish!: () => void;
    const onConfirm = () => new Promise<void>((resolve) => (finish = resolve));
    render(<ConfirmDialog title="Delete?" message="Sure?" confirmLabel="Delete" onConfirm={onConfirm} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    await act(async () => finish());
  });

  it("cancel closes without running", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog title="Delete?" message="Sure?" confirmLabel="Delete" cancelLabel="Keep" onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("useDiscardGuard", () => {
  function Form({ onClose }: { onClose: () => void }) {
    const { markDirty, requestClose, confirm } = useDiscardGuard(onClose);
    return (
      <>
        <div onChangeCapture={markDirty}>
          <input aria-label="Name" />
        </div>
        <button onClick={requestClose}>Cancel form</button>
        {confirm}
      </>
    );
  }

  it("closes straight away when nothing was typed", async () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel form" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks first once something was typed", async () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Cancel form" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Discard your changes?" })).toBeInTheDocument();
  });

  it("Keep editing goes back to the form", async () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Cancel form" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Discard changes closes the form", async () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Cancel form" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("Toast", () => {
  function Shower({ message, tone }: { message: string; tone?: "success" | "error" }) {
    const toast = useToast();
    return <button onClick={() => toast(message, tone)}>Show</button>;
  }

  it("shows a success message, then hides it after 3 seconds", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Shower message="Invoice saved" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("status")).toHaveTextContent("Invoice saved");
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "open");
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "closed");
    act(() => vi.advanceTimersByTime(180));
    expect(screen.queryByText("Invoice saved")).not.toBeInTheDocument();
  });

  it("keeps an error up for 6 seconds as an alert", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Shower message="Could not save" tone="error" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
    act(() => vi.advanceTimersByTime(5999));
    expect(screen.getByRole("alert")).toHaveAttribute("data-state", "open");
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does nothing outside a provider", () => {
    render(<Shower message="x" />);
    expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
  });
});
