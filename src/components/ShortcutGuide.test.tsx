import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShortcutGuide from "./ShortcutGuide";

describe("ShortcutGuide", () => {
  it("is hidden on mount", () => {
    render(<ShortcutGuide />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens when '?' is pressed", async () => {
    render(<ShortcutGuide />);
    await userEvent.keyboard("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not open while typing in an input", async () => {
    render(
      <>
        <input data-testid="box" />
        <ShortcutGuide />
      </>,
    );
    await userEvent.click(screen.getByTestId("box"));
    await userEvent.keyboard("?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows all four shortcut groups", async () => {
    render(<ShortcutGuide />);
    await userEvent.keyboard("?");
    expect(screen.getAllByText(/anywhere/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/list pages/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/image viewer/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/text editor/i).length).toBeGreaterThan(0);
  });

  it("shows key shortcuts for the global group", async () => {
    render(<ShortcutGuide />);
    await userEvent.keyboard("?");
    expect(screen.getAllByText(/Ctrl\+B/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Escape/i).length).toBeGreaterThan(0);
  });

  it("closes when Escape is pressed", async () => {
    render(<ShortcutGuide />);
    await userEvent.keyboard("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when the close button is clicked", async () => {
    render(<ShortcutGuide />);
    await userEvent.keyboard("?");
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles closed when '?' is pressed again", async () => {
    render(<ShortcutGuide />);
    await userEvent.keyboard("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
