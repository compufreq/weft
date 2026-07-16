import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ObjectEditor from "./ObjectEditor";

describe("ObjectEditor", () => {
  it("prefills initial properties and saves parsed JSON", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <ObjectEditor
        heading="Edit object"
        initial={{ title: "hello" }}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    ));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>(/Properties/);
    expect(textarea.value).toContain('"title": "hello"');
    fireEvent.input(textarea, { target: { value: '{ "title": "changed" }' } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: "changed" }));
  });

  it("rejects invalid JSON and non-objects without calling onSave", async () => {
    const onSave = vi.fn();
    render(() => <ObjectEditor heading="New object" onSave={onSave} onCancel={vi.fn()} />);
    const textarea = screen.getByLabelText(/Properties/);
    fireEvent.input(textarea, { target: { value: "not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid JSON/);

    fireEvent.input(textarea, { target: { value: "[1,2]" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/JSON object/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("surfaces backend save errors and supports cancel", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("read_only"));
    const onCancel = vi.fn();
    render(() => (
      <ObjectEditor heading="New object" initial={{ a: 1 }} onSave={onSave} onCancel={onCancel} />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("read_only");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
