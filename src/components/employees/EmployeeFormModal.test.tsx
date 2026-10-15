import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmployeeFormModal from "./EmployeeFormModal";
import { ToastProvider } from "../ui";
import { EmployeeDetail, EmployeeInput } from "../../types/payroll";
import { fileInput, makeFile } from "../../test/helpers";
import { employee } from "./payrollFixtures";

const api = vi.hoisted(() => ({
  addEmployeeFile: vi.fn(),
  createEmployee: vi.fn(),
  findEmployeesByName: vi.fn(),
  getEmployee: vi.fn(),
  openEmployeeFile: vi.fn(),
  removeEmployeeFile: vi.fn(),
  updateEmployee: vi.fn(),
}));
vi.mock("../../services/api", () => api);

let onClose: Mock<() => void>;
let onSaved: Mock<(d: EmployeeDetail) => void>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
  Object.values(api).forEach((f) => f.mockReset());
  api.findEmployeesByName.mockResolvedValue([]);
  api.createEmployee.mockImplementation(async (input: EmployeeInput) => ({ employee: employee({ id: 9, ...input }), files: [] }));
  api.updateEmployee.mockImplementation(async (id: number, input: EmployeeInput) => ({ employee: employee({ id, ...input }), files: [] }));
  api.getEmployee.mockResolvedValue({ employee: employee(), files: [] });
  api.addEmployeeFile.mockResolvedValue({});
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<(d: EmployeeDetail) => void>();
});
afterEach(() => vi.useRealTimers());

const open = async (employeeId?: number) => {
  render(
    <ToastProvider>
      <EmployeeFormModal employeeId={employeeId} onClose={onClose} onSaved={onSaved} />
    </ToastProvider>
  );
  if (employeeId !== undefined) await screen.findByRole("dialog", { name: "Edit employee" });
};

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = (name = "Save employee") => userEvent.click(screen.getByRole("button", { name }));

describe("a new employee", () => {
  it("starts joined today with no OT pay", async () => {
    await open();
    expect(screen.getByLabelText("Joined on")).toHaveValue("2026-10-15");
    expect(screen.getByLabelText("OT rate per hour")).toHaveValue(0);
  });

  it("saves cleaned-up details", async () => {
    await open();
    type("Name", "  Ravi ");
    type("Role", " Helper ");
    type("Daily wage", "650");
    type("OT rate per hour", "");
    type("Address", "  ");
    await save();
    await waitFor(() => expect(api.createEmployee).toHaveBeenCalledOnce());
    expect(api.createEmployee.mock.calls[0][0]).toEqual({
      name: "Ravi",
      role: "Helper",
      phone: null,
      address: null,
      joined_on: "2026-10-15",
      daily_wage: 650,
      ot_rate: 0,
      notes: null,
    });
    expect(await screen.findByText("Employee saved")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ employee: expect.objectContaining({ id: 9 }) }));
  });

  it.each<[{ name?: string; joined?: string; wage?: string; ot?: string }, string]>([
    [{ name: "" }, "Enter the employee's name."],
    [{ joined: "" }, "Enter the joining date."],
    [{ wage: "0" }, "Daily wage must be more than 0."],
    [{ wage: "" }, "Daily wage must be more than 0."],
    [{ ot: "-1" }, "OT rate can't be negative."],
  ])("refuses %j", async (change, message) => {
    await open();
    type("Name", change.name ?? "Ravi");
    if (change.joined !== undefined) type("Joined on", change.joined);
    type("Daily wage", change.wage ?? "650");
    if (change.ot !== undefined) type("OT rate per hour", change.ot);
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(api.createEmployee).not.toHaveBeenCalled();
  });

  it("warns about someone with the same name but still allows saving", async () => {
    api.findEmployeesByName.mockResolvedValue([
      { id: 3, name: "Ravi", role: "Welder" },
      { id: 4, name: "Ravi", role: null },
    ]);
    await open();
    type("Name", "Ravi");
    fireEvent.blur(screen.getByLabelText("Name"));
    expect(await screen.findByText("There is already an employee named Ravi (Welder), Ravi. Saving adds another.")).toBeInTheDocument();
    expect(api.findEmployeesByName).toHaveBeenCalledWith("Ravi", undefined);
    type("Name", "Ravi K");
    expect(screen.queryByText(/There is already an employee/)).not.toBeInTheDocument();
  });

  it("uploads ID files after saving", async () => {
    await open();
    type("Name", "Ravi");
    type("Daily wage", "650");
    await userEvent.upload(fileInput(), [makeFile("aadhaar-masked.jpg")]);
    await screen.findByText("aadhaar-masked.jpg");
    await save();
    await waitFor(() => expect(api.addEmployeeFile).toHaveBeenCalledWith(9, "aadhaar-masked.jpg", expect.any(String)));
  });

  it("shows the backend's refusal", async () => {
    api.createEmployee.mockRejectedValue(new Error("Daily wage is too large."));
    await open();
    type("Name", "Ravi");
    type("Daily wage", "650");
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Daily wage is too large.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("editing an employee", () => {
  it("loads the employee and saves in place", async () => {
    await open(3);
    expect(screen.getByLabelText("Name")).toHaveValue("Murugan");
    expect(screen.getByLabelText("Daily wage")).toHaveValue(800);
    expect(screen.getByLabelText("Joined on")).toHaveValue("2025-04-01");
    type("Daily wage", "850");
    await save("Save changes");
    await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledOnce());
    expect(api.updateEmployee.mock.calls[0][0]).toBe(3);
    expect(api.updateEmployee.mock.calls[0][1]).toMatchObject({ name: "Murugan", daily_wage: 850, ot_rate: 100 });
  });

  it("says so when the employee was deleted", async () => {
    api.getEmployee.mockResolvedValue(null);
    render(
      <ToastProvider>
        <EmployeeFormModal employeeId={3} onClose={onClose} onSaved={onSaved} />
      </ToastProvider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This employee no longer exists.");
  });

  it("opens a saved file and reports when it cannot", async () => {
    api.getEmployee.mockResolvedValue({ employee: employee(), files: [{ id: 5, file_name: "id.pdf", mime_type: "application/pdf", size_bytes: 500 }] });
    api.openEmployeeFile.mockRejectedValueOnce(new Error("No program opens PDF files."));
    await open(3);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(api.openEmployeeFile).toHaveBeenCalledWith(5);
    expect(await screen.findByRole("alert")).toHaveTextContent("No program opens PDF files.");
  });

  it("asks before throwing away changes", async () => {
    await open(3);
    type("Role", "Fitter");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard your changes?" })).toBeInTheDocument();
  });
});
