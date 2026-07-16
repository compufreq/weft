import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import CollectionForm from "./CollectionForm";

describe("CollectionForm", () => {
  it("builds a class definition from the guided form", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(() => <CollectionForm onCreate={onCreate} onCancel={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Report" } });
    fireEvent.input(screen.getByLabelText("Property 1 name"), { target: { value: "title" } });
    fireEvent.change(screen.getByLabelText("Property 1 type"), { target: { value: "text" } });
    fireEvent.click(screen.getByLabelText("Multi-tenant"));
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        class: "Report",
        vectorizer: "none",
        properties: [{ name: "title", dataType: ["text"] }],
        multiTenancyConfig: { enabled: true },
      }),
    );
  });

  it("rejects non-UpperCamelCase names client-side", async () => {
    const onCreate = vi.fn();
    render(() => <CollectionForm onCreate={onCreate} onCancel={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "bad name" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/UpperCamelCase/);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("raw JSON mode passes the parsed document through", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(() => <CollectionForm onCreate={onCreate} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("raw JSON"));
    fireEvent.input(screen.getByLabelText(/Class definition/), {
      target: { value: '{ "class": "Raw", "vectorizer": "text2vec-x" }' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({ class: "Raw", vectorizer: "text2vec-x" }),
    );
  });

  it("surfaces backend errors", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("already exists"));
    render(() => <CollectionForm onCreate={onCreate} onCancel={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Dup" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });
});
