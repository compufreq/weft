import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { AddPropertyForm, DeleteCollection } from "./CollectionActions";

describe("AddPropertyForm", () => {
  it("adds a typed property and clears the input", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(() => <AddPropertyForm onAdd={onAdd} />);
    fireEvent.input(screen.getByLabelText("Property name"), { target: { value: "summary" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "int" } });
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ name: "summary", dataType: ["int"] }),
    );
    expect(screen.getByLabelText<HTMLInputElement>("Property name").value).toBe("");
  });
});

describe("DeleteCollection", () => {
  it("arms only when the exact collection name is typed", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(() => <DeleteCollection collectionName="Article" onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete collection…" }));

    const confirmBtn = screen.getByRole("button", { name: "Delete forever" });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText("Type the collection name to confirm");
    fireEvent.input(input, { target: { value: "Artic" } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.input(input, { target: { value: "Article" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });

  it("cancel disarms and resets", () => {
    render(() => <DeleteCollection collectionName="Article" onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete collection…" }));
    fireEvent.input(screen.getByLabelText("Type the collection name to confirm"), {
      target: { value: "Article" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete collection…" })).toBeInTheDocument();
  });
});
