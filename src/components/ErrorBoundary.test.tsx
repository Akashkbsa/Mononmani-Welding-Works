import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "./ErrorBoundary";

let shouldThrow = true;
function Broken() {
  if (shouldThrow) throw new Error("Cannot read invoice total");
  return <p>Screen works</p>;
}

describe("ErrorBoundary", () => {
  it("shows its children when nothing fails", () => {
    render(
      <ErrorBoundary>
        <p>Fine</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("Fine")).toBeInTheDocument();
  });

  it("shows a calm message and the error instead of a broken screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    );
    expect(screen.getByRole("heading", { name: "This screen could not be shown" })).toBeInTheDocument();
    expect(screen.getByText("Your records are safe. Try again, or restart the app if it keeps happening.")).toBeInTheDocument();
    expect(screen.getByText("Cannot read invoice total")).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith("Screen failed to render:", expect.any(Error), expect.anything());
  });

  it("Try again renders the screen again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    );
    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Screen works")).toBeInTheDocument();
  });

  it("keeps the rest of the window working", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    shouldThrow = true;
    function Shell() {
      const [n, setN] = useState(0);
      return (
        <>
          <button onClick={() => setN(n + 1)}>Sidebar {n}</button>
          <ErrorBoundary>
            <Broken />
          </ErrorBoundary>
        </>
      );
    }
    render(<Shell />);
    await userEvent.click(screen.getByRole("button", { name: "Sidebar 0" }));
    expect(screen.getByRole("button", { name: "Sidebar 1" })).toBeInTheDocument();
  });
});
