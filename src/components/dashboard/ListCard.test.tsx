import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListCard, ListRow } from "./ListCard";

describe("ListCard", () => {
  it("shows the empty text instead of a table", () => {
    render(
      <ListCard title="Unpaid invoices" actionLabel="See all" onAction={() => {}} empty="Nothing unpaid" isEmpty>
        <tr />
      </ListCard>
    );
    expect(screen.getByText("Nothing unpaid")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows rows, a note and a working action", async () => {
    const onAction = vi.fn();
    render(
      <ListCard title="Unpaid invoices" actionLabel="See all" onAction={onAction} empty="-" isEmpty={false} note="Showing the oldest 5 of 12">
        <ListRow title="Anand Steels" right="₹100" onOpen={() => {}} />
      </ListCard>
    );
    expect(screen.getByRole("heading", { name: "Unpaid invoices" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("Anand Steels");
    expect(screen.getByText("Showing the oldest 5 of 12")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "See all" }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});

describe("ListRow", () => {
  const renderRow = (props: Partial<Parameters<typeof ListRow>[0]> = {}) => {
    const onOpen = vi.fn();
    render(
      <table>
        <tbody>
          <ListRow title="Anand Steels" detail="MWW/001" right="₹1,000" rightNote="45 days old" onOpen={onOpen} {...props} />
        </tbody>
      </table>
    );
    return onOpen;
  };

  it("shows its parts", () => {
    renderRow();
    expect(screen.getByTitle("Anand Steels")).toBeInTheDocument();
    expect(screen.getByText("MWW/001")).toBeInTheDocument();
    expect(screen.getByText("₹1,000")).toBeInTheDocument();
  });

  it.each([
    ["warn", "text-amber-700"],
    ["good", "text-emerald-700"],
    ["default", "text-slate-500"],
  ] as const)("colours the note for %s", (rightTone, cls) => {
    renderRow({ rightTone });
    expect(screen.getByText("45 days old").className).toContain(cls);
  });

  it("opens on click and Enter", () => {
    const onOpen = renderRow();
    const row = screen.getByRole("row");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
