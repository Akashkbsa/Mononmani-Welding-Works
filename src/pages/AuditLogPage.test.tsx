import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuditLogPage from "./AuditLogPage";
import { AuditLogEntry, AuditLogPage as AuditLogPageType } from "../types/audit";

const api = vi.hoisted(() => ({ listAuditLog: vi.fn() }));
vi.mock("../services/api", () => api);

function entry(over: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    seq: 1,
    table_name: "invoices",
    row_id: 42,
    op: "INSERT",
    changed_at: "2026-10-19 14:30:00",
    ...over,
  };
}

function page(entries: AuditLogEntry[], has_more = false): AuditLogPageType {
  return { entries, has_more };
}

describe("AuditLogPage", () => {
  it("shows a loading state then renders entries", async () => {
    api.listAuditLog.mockResolvedValue(page([entry()]));
    render(<AuditLogPage />);
    expect(await screen.findByText(/Invoice/i)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
    expect(screen.getByText(/19-10-2026/)).toBeInTheDocument();
  });

  it("shows a human-readable table name for invoices", async () => {
    api.listAuditLog.mockResolvedValue(page([entry({ table_name: "invoices" })]));
    render(<AuditLogPage />);
    expect(await screen.findByText("Invoice")).toBeInTheDocument();
  });

  it("shows a human-readable table name for payments", async () => {
    api.listAuditLog.mockResolvedValue(page([entry({ table_name: "payments", op: "DELETE" })]));
    render(<AuditLogPage />);
    expect(await screen.findByText("Payment")).toBeInTheDocument();
  });

  it("shows all three operation types with distinct labels", async () => {
    api.listAuditLog.mockResolvedValue(
      page([
        entry({ seq: 1, op: "INSERT" }),
        entry({ seq: 2, op: "UPDATE" }),
        entry({ seq: 3, op: "DELETE" }),
      ]),
    );
    render(<AuditLogPage />);
    await screen.findByText("Added");
    expect(screen.getByText("Edited")).toBeInTheDocument();
    expect(screen.getByText("Deleted")).toBeInTheDocument();
  });

  it("shows 'Load more' when has_more is true", async () => {
    api.listAuditLog.mockResolvedValue(page([entry()], true));
    render(<AuditLogPage />);
    expect(await screen.findByRole("button", { name: /load more/i })).toBeInTheDocument();
  });

  it("hides 'Load more' when has_more is false", async () => {
    api.listAuditLog.mockResolvedValue(page([entry()], false));
    render(<AuditLogPage />);
    await waitFor(() => expect(api.listAuditLog).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("loads next page with the last seq as before_seq when 'Load more' is clicked", async () => {
    const first = page([entry({ seq: 5 })], true);
    const second = page([entry({ seq: 2 })], false);
    api.listAuditLog.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<AuditLogPage />);
    await userEvent.click(await screen.findByRole("button", { name: /load more/i }));
    await waitFor(() => expect(api.listAuditLog).toHaveBeenCalledWith({ before_seq: 5 }));
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("shows 'No changes recorded yet' when the log is empty", async () => {
    api.listAuditLog.mockResolvedValue(page([]));
    render(<AuditLogPage />);
    expect(await screen.findByText(/no changes recorded/i)).toBeInTheDocument();
  });
});
