import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PlaceFormModal from "./PlaceFormModal";
import { ToastProvider } from "../ui";
import { PlaceDetail, PlaceInput } from "../../types/rental";
import { fileInput, makeFile } from "../../test/helpers";

const api = vi.hoisted(() => ({
  addRentalFile: vi.fn(),
  createRentalPlace: vi.fn(),
  getRentalPlace: vi.fn(),
  openRentalFile: vi.fn(),
  removeRentalFile: vi.fn(),
  updateRentalPlace: vi.fn(),
}));
vi.mock("../../services/api", () => api);

const detail = (over: Partial<PlaceDetail["place"]> = {}): PlaceDetail => ({
  place: { id: 4, name: "Shop 1", address: "Main Road", monthly_rent: 6000, notes: null, created_at: "", updated_at: "", ...over },
  files: [],
});

let onClose: Mock<() => void>;
let onSaved: Mock<(id: number) => void>;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.createRentalPlace.mockImplementation(async (input: PlaceInput) => detail({ id: 8, ...input }));
  api.updateRentalPlace.mockImplementation(async (id: number) => detail({ id }));
  api.getRentalPlace.mockResolvedValue(detail());
  api.addRentalFile.mockResolvedValue({});
  onClose = vi.fn<() => void>();
  onSaved = vi.fn<(id: number) => void>();
});

const open = async (placeId?: number) => {
  render(
    <ToastProvider>
      <PlaceFormModal placeId={placeId} onClose={onClose} onSaved={onSaved} />
    </ToastProvider>
  );
  if (placeId !== undefined) await screen.findByRole("dialog", { name: "Edit place" });
};

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("PlaceFormModal", () => {
  it("saves a new place, with no rent meaning 0", async () => {
    await open();
    type("Name", "  Flat 2B ");
    type("Address", " ");
    await userEvent.click(screen.getByRole("button", { name: "Save place" }));
    await waitFor(() => expect(api.createRentalPlace).toHaveBeenCalledOnce());
    expect(api.createRentalPlace.mock.calls[0][0]).toEqual({ name: "Flat 2B", address: null, monthly_rent: 0, notes: null });
    expect(await screen.findByText("Place saved")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(8);
  });

  it("refuses no name or a negative rent", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Save place" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the place name.");
    type("Name", "Shop 2");
    type("Usual monthly rent", "-100");
    await userEvent.click(screen.getByRole("button", { name: "Save place" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Monthly rent can't be negative.");
    expect(api.createRentalPlace).not.toHaveBeenCalled();
  });

  it("stores files as the place's own", async () => {
    await open();
    type("Name", "Godown");
    await userEvent.upload(fileInput(), [makeFile("eb-bill.pdf")]);
    await screen.findByText("eb-bill.pdf");
    await userEvent.click(screen.getByRole("button", { name: "Save place" }));
    await waitFor(() => expect(api.addRentalFile).toHaveBeenCalledWith("PLACE", 8, "eb-bill.pdf", expect.any(String)));
  });

  it("loads a saved place, leaving a 0 rent empty, and saves in place", async () => {
    api.getRentalPlace.mockResolvedValue(detail({ monthly_rent: 0 }));
    await open(4);
    expect(screen.getByText("Shop 1", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Shop 1");
    expect(screen.getByLabelText("Usual monthly rent")).toHaveValue(null);
    type("Usual monthly rent", "6500");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateRentalPlace).toHaveBeenCalledWith(4, { name: "Shop 1", address: "Main Road", monthly_rent: 6500, notes: null }));
  });

  it("says so when the place was deleted", async () => {
    api.getRentalPlace.mockResolvedValue(null);
    render(
      <ToastProvider>
        <PlaceFormModal placeId={4} onClose={onClose} onSaved={onSaved} />
      </ToastProvider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This place no longer exists.");
  });
});
