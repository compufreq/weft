import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import GraphqlConsole from "./GraphqlConsole";

describe("GraphqlConsole", () => {
  it("runs the query and pretty-prints the envelope", async () => {
    const onRun = vi.fn().mockResolvedValue({ data: { Aggregate: { A: [{ meta: { count: 25 } }] } } });
    render(() => <GraphqlConsole onRun={onRun} initialQuery="{ Aggregate }" />);
    fireEvent.click(screen.getByRole("button", { name: /run/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Result JSON").textContent).toContain('"count": 25');
    });
    expect(onRun).toHaveBeenCalledWith("{ Aggregate }");
  });

  it("shows transport errors as an alert", async () => {
    const onRun = vi.fn().mockRejectedValue(new Error("backend unreachable"));
    render(() => <GraphqlConsole onRun={onRun} initialQuery="{ x }" />);
    fireEvent.click(screen.getByRole("button", { name: /run/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("backend unreachable");
    });
  });

  it("disables Run for an empty buffer and persists edits", () => {
    const onQueryChange = vi.fn();
    render(() => <GraphqlConsole onRun={vi.fn()} onQueryChange={onQueryChange} />);
    const button = screen.getByRole("button", { name: /run/i });
    expect(button).toBeDisabled();
    fireEvent.input(screen.getByLabelText(/GraphQL query/i), {
      target: { value: "{ Get }" },
    });
    expect(onQueryChange).toHaveBeenCalledWith("{ Get }");
    expect(button).not.toBeDisabled();
  });
});
