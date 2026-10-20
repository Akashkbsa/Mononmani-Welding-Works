import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import GlobalSearch from "./GlobalSearch";
import { ReminderLinkKind } from "../types/reminder";

const mockSearchAll = vi.hoisted(() => vi.fn());
vi.mock("../services/api", () => ({
  searchAll: mockSearchAll,
}));

describe("GlobalSearch", () => {
  const mockOnOpen = vi.fn();
  const mockOnNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchAll.mockResolvedValue([]);
  });

  function setup() {
    render(<GlobalSearch onOpen={mockOnOpen} onNavigate={mockOnNavigate} />);
  }

  it("opens on Ctrl+K", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not open on Ctrl+K when typing", () => {
    setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    document.body.removeChild(input);
  });

  it("closes on Escape", () => {
    setup();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows placeholder text", () => {
    setup();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText(/Search invoices, customers/i)).toBeInTheDocument();
  });

  it("shows results when query returns data", async () => {
    mockSearchAll.mockResolvedValue([
      { kind: "INVOICE", id: 1, title: "MWW/26-27/001", subtitle: "ABC Company" },
      { kind: "COMPANY", id: 5, title: "ABC Company", subtitle: "29AABCT1234A1Z5" },
    ]);
    setup();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText(/Search invoices, customers/i);
    fireEvent.change(input, { target: { value: "ABC" } });
    await waitFor(() => expect(mockSearchAll).toHaveBeenCalledWith("ABC"));
    await waitFor(() => expect(screen.getByText("MWW/26-27/001")).toBeInTheDocument());
    expect(screen.getAllByText("ABC Company").length).toBeGreaterThan(0);
  });

  it("shows empty state when no results", async () => {
    mockSearchAll.mockResolvedValue([]);
    setup();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText(/Search invoices, customers/i);
    fireEvent.change(input, { target: { value: "xyz123noresult" } });
    await waitFor(() => expect(mockSearchAll).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/No results/i)).toBeInTheDocument());
  });

  it("calls onOpen with kind and id when a result is clicked", async () => {
    mockSearchAll.mockResolvedValue([
      { kind: "INVOICE", id: 42, title: "MWW/26-27/042", subtitle: "Test Co" },
    ]);
    setup();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText(/Search invoices, customers/i);
    fireEvent.change(input, { target: { value: "MWW" } });
    await waitFor(() => expect(screen.getByText("MWW/26-27/042")).toBeInTheDocument());
    fireEvent.click(screen.getByText("MWW/26-27/042"));
    expect(mockOnOpen).toHaveBeenCalledWith("INVOICE" as ReminderLinkKind, 42);
  });

  it("calls onNavigate for EMPLOYEE results", async () => {
    mockSearchAll.mockResolvedValue([
      { kind: "EMPLOYEE", id: 3, title: "Ravi Kumar", subtitle: "" },
    ]);
    setup();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText(/Search invoices, customers/i);
    fireEvent.change(input, { target: { value: "Ravi" } });
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Ravi Kumar"));
    expect(mockOnNavigate).toHaveBeenCalledWith("employees");
  });

  it("does not search when query is less than 2 characters", async () => {
    setup();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText(/Search invoices, customers/i);
    fireEvent.change(input, { target: { value: "A" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(mockSearchAll).not.toHaveBeenCalled();
  });
});
