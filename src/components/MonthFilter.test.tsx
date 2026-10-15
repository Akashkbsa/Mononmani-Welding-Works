import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MonthFilter from "./MonthFilter";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0)); // 15 October 2026
});
afterEach(() => vi.useRealTimers());

const setup = (value: string, props: { allowAll?: boolean; dates?: (string | null)[] } = {}) => {
  const onChange = vi.fn();
  render(<MonthFilter dates={props.dates ?? []} value={value} onChange={onChange} allowAll={props.allowAll} />);
  return onChange;
};

describe("MonthFilter with all choices", () => {
  it("shows only the kind picker for all dates", () => {
    setup("");
    expect(screen.getByLabelText("Show dates")).toHaveValue("all");
    expect(screen.queryByLabelText("Previous month")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("From date")).not.toBeInTheDocument();
  });

  it("picking a kind starts it at today", () => {
    const onChange = setup("");
    const select = screen.getByLabelText("Show dates");
    fireEvent.change(select, { target: { value: "month" } });
    fireEvent.change(select, { target: { value: "fy" } });
    fireEvent.change(select, { target: { value: "range" } });
    fireEvent.change(select, { target: { value: "all" } });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["2026-10", "FY2026", "R:2026-10-01:2026-10-15", ""]);
  });

  it("steps months back and forward", () => {
    const onChange = setup("2026-08");
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Previous month"));
    fireEvent.click(screen.getByLabelText("Next month"));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["2026-07", "2026-09"]);
  });

  it("does not go past this month", () => {
    setup("2026-10");
    expect(screen.getByLabelText("Next month")).toBeDisabled();
    expect(screen.getByLabelText("Previous month")).toBeEnabled();
  });

  it("steps financial years and stops at this one", () => {
    const onChange = setup("FY2025");
    expect(screen.getByText("FY 2025-26")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Previous financial year"));
    fireEvent.click(screen.getByLabelText("Next financial year"));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["FY2024", "FY2026"]);
  });

  it("disables next on the current financial year", () => {
    setup("FY2026");
    expect(screen.getByLabelText("Next financial year")).toBeDisabled();
  });

  it("edits a custom range and keeps the earlier day first", () => {
    const onChange = setup("R:2026-10-01:2026-10-15");
    const from = screen.getByLabelText("From date");
    const to = screen.getByLabelText("To date");
    expect(from).toHaveValue("2026-10-01");
    expect(to).toHaveValue("2026-10-15");
    expect(from).toHaveAttribute("max", "2026-10-15");
    fireEvent.change(from, { target: { value: "2026-09-20" } });
    fireEvent.change(to, { target: { value: "2026-09-01" } });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["R:2026-09-20:2026-10-15", "R:2026-09-01:2026-10-01"]);
  });

  it("ignores a cleared date box", () => {
    const onChange = setup("R:2026-10-01:2026-10-15");
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MonthFilter as a month picker only", () => {
  const dates = ["2026-03-10", null, "2026-06-30", "2026-05-01"];

  it("has no kind picker", () => {
    setup("2026-05", { allowAll: false, dates });
    expect(screen.queryByLabelText("Show dates")).not.toBeInTheDocument();
  });

  it("stays between the first and last month of the records", () => {
    setup("2026-03", { allowAll: false, dates });
    expect(screen.getByLabelText("Previous month")).toBeDisabled();
    expect(screen.getByLabelText("Next month")).toBeEnabled();
  });

  it("stops at the last record's month", () => {
    setup("2026-06", { allowAll: false, dates });
    expect(screen.getByLabelText("Next month")).toBeDisabled();
  });

  it("falls back to this month with no records", () => {
    setup("2026-10", { allowAll: false, dates: [] });
    expect(screen.getByLabelText("Next month")).toBeDisabled();
    expect(screen.getByLabelText("Previous month")).toBeEnabled();
  });
});
