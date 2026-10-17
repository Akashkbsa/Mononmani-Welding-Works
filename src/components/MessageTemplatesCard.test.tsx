import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageTemplatesCard from "./MessageTemplatesCard";
import { ToastProvider } from "./ui";
import { MessageTemplate } from "../types/messages";

const api = vi.hoisted(() => ({ getMessageTemplates: vi.fn(), saveMessageTemplate: vi.fn() }));
vi.mock("../services/api", () => api);

const template = (over: Partial<MessageTemplate>): MessageTemplate => ({
  kind: "EMPLOYEE_PAY",
  title: "Employee pay",
  used_for: "Sent from an employee's month on the pay sheet.",
  template: "Hello {employee_name}",
  default_template: "Hello {employee_name}, default",
  keywords: [
    { key: "employee_name", label: "Employee name", sample: "Murugan" },
    { key: "balance", label: "Still to pay", sample: "₹2,200.00" },
  ],
  ...over,
});

const rent = template({
  kind: "RENT_REMINDER",
  title: "Rent reminder",
  used_for: "Sent to tenants.",
  template: "Hi {tenant_name}",
  default_template: "Hi {tenant_name}",
  keywords: [{ key: "tenant_name", label: "Tenant name", sample: "Ravi" }],
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getMessageTemplates.mockResolvedValue([rent, template({})]);
  api.saveMessageTemplate.mockImplementation(async (kind: string, text: string) => template({ kind: kind as MessageTemplate["kind"], template: text }));
});

const open = async () => {
  render(
    <ToastProvider>
      <MessageTemplatesCard />
    </ToastProvider>
  );
  return (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
};
const preview = () => screen.getByLabelText("Preview").textContent;

describe("MessageTemplatesCard", () => {
  it("opens on the employee message and previews it with sample details", async () => {
    const box = await open();
    expect(box).toHaveValue("Hello {employee_name}");
    expect(preview()).toBe("Hello Murugan");
    expect(screen.getByRole("button", { name: "Save message" })).toBeDisabled();
  });

  it("inserts a keyword where the cursor is and saves", async () => {
    const box = await open();
    box.setSelectionRange(5, 5);
    await userEvent.click(screen.getByRole("button", { name: "+ Still to pay" }));
    expect(box).toHaveValue("Hello{balance} {employee_name}");
    expect(preview()).toBe("Hello₹2,200.00 Murugan");
    await userEvent.click(screen.getByRole("button", { name: "Save message" }));
    await waitFor(() => expect(api.saveMessageTemplate).toHaveBeenCalledWith("EMPLOYEE_PAY", "Hello{balance} {employee_name}"));
    expect(await screen.findByText("Employee pay message saved")).toBeInTheDocument();
  });

  it("points out a keyword that does not belong and won't save it", async () => {
    const box = await open();
    fireEvent.change(box, { target: { value: "Hi {tenant_name}" } });
    expect(screen.getByText("{tenant_name} is not a keyword for this message.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save message" })).toBeDisabled();
  });

  it("keeps each message's changes when switching, and can go back to the default", async () => {
    const box = await open();
    fireEvent.change(box, { target: { value: "Changed {employee_name}" } });
    await userEvent.click(screen.getByRole("button", { name: "Rent reminder" }));
    expect(screen.getByLabelText("Message")).toHaveValue("Hi {tenant_name}");
    expect(preview()).toBe("Hi Ravi");
    await userEvent.click(screen.getByRole("button", { name: /Employee pay/ }));
    expect(screen.getByLabelText("Message")).toHaveValue("Changed {employee_name}");
    await userEvent.click(screen.getByRole("button", { name: "Use the default message" }));
    expect(screen.getByLabelText("Message")).toHaveValue("Hello {employee_name}, default");
    await userEvent.click(screen.getByRole("button", { name: "Undo changes" }));
    expect(screen.getByLabelText("Message")).toHaveValue("Hello {employee_name}");
  });

  it("shows the app's refusal", async () => {
    api.saveMessageTemplate.mockRejectedValue(new Error("The message can be at most 2000 characters."));
    const box = await open();
    fireEvent.change(box, { target: { value: "New {employee_name}" } });
    await userEvent.click(screen.getByRole("button", { name: "Save message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The message can be at most 2000 characters.");
  });
});
