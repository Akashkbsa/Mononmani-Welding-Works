import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RichTextBox, { isRichEmpty } from "./RichTextBox";

// jsdom has no editing commands; record what the box asks for instead.
const execCommand = vi.fn(() => true);
Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

describe("RichTextBox", () => {
  it("shows the stored text with only the allowed formatting", () => {
    render(<RichTextBox ariaLabel="Description" value={'<b>Gate</b> <script>x</script>'} onChange={() => {}} />);
    const box = screen.getByRole("textbox", { name: "Description" });
    expect(box.innerHTML).toBe("<b>Gate</b> &lt;script&gt;x&lt;/script&gt;");
    expect(box).toHaveAttribute("contenteditable", "true");
    expect(box).toHaveAttribute("aria-multiline", "true");
  });

  it("reports what is typed, cleaned", () => {
    const onChange = vi.fn();
    render(<RichTextBox ariaLabel="Description" value="" onChange={onChange} />);
    const box = screen.getByRole("textbox");
    box.innerHTML = '<b>Grill</b><span style="color:red"> work</span>';
    fireEvent.input(box);
    expect(onChange).toHaveBeenLastCalledWith("<b>Grill</b> work");
  });

  it("does not reset the box when its own value comes back", () => {
    function Host() {
      const [v, setV] = useState("start");
      return <RichTextBox ariaLabel="Description" value={v} onChange={setV} />;
    }
    render(<Host />);
    const box = screen.getByRole("textbox");
    // A browser would put the cursor inside this node; replacing it would lose the cursor.
    box.innerHTML = "start more";
    const node = box.firstChild;
    fireEvent.input(box);
    expect(box.firstChild).toBe(node);
  });

  it("replaces the content when a new value comes from outside", () => {
    const { rerender } = render(<RichTextBox ariaLabel="Description" value="one" onChange={() => {}} />);
    rerender(<RichTextBox ariaLabel="Description" value="<i>two</i>" onChange={() => {}} />);
    expect(screen.getByRole("textbox").innerHTML).toBe("<i>two</i>");
  });

  it("clears a box emptied down to nothing so the placeholder shows", () => {
    const onChange = vi.fn();
    render(<RichTextBox ariaLabel="Description" value="x" onChange={onChange} placeholder="Item description" />);
    const box = screen.getByRole("textbox");
    expect(box).toHaveAttribute("data-placeholder", "Item description");
    box.innerHTML = "<b></b>";
    fireEvent.blur(box);
    expect(box.innerHTML).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("Enter adds a line break instead of a new paragraph", () => {
    execCommand.mockClear();
    render(<RichTextBox ariaLabel="Description" value="" onChange={() => {}} />);
    const prevented = !fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(prevented).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("insertLineBreak");
  });

  it("pastes plain text only, line by line", () => {
    execCommand.mockClear();
    render(<RichTextBox ariaLabel="Description" value="" onChange={() => {}} />);
    const clipboardData = { getData: (type: string) => (type === "text/plain" ? "line one\r\n\r\nline three" : "<b>html</b>") };
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData });
    expect(execCommand.mock.calls).toEqual([
      ["insertText", false, "line one"],
      ["insertLineBreak"],
      ["insertLineBreak"],
      ["insertText", false, "line three"],
    ]);
  });

  it("refuses dropped content", () => {
    render(<RichTextBox ariaLabel="Description" value="" onChange={() => {}} />);
    expect(fireEvent.drop(screen.getByRole("textbox"))).toBe(false);
  });

  it("has no style bar until text is selected", () => {
    render(<RichTextBox ariaLabel="Description" value="text" onChange={() => {}} />);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });
});

describe("isRichEmpty", () => {
  it("is true for formatting without characters", () => {
    expect(isRichEmpty("")).toBe(true);
    expect(isRichEmpty("<b></b><br>")).toBe(true);
    expect(isRichEmpty("   ")).toBe(true);
  });

  it("is false when there is text", () => {
    expect(isRichEmpty("<b>x</b>")).toBe(false);
    expect(isRichEmpty("&lt;")).toBe(false);
  });
});
