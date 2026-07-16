import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import VectorMap, { type MapPoint } from "./VectorMap";

const points: MapPoint[] = [
  { id: "a", vector: [1, 0, 0], label: "alpha", group: "tech" },
  { id: "b", vector: [0, 1, 0], label: "beta", group: "science" },
  { id: "c", vector: [0, 0, 1], label: "gamma", group: "tech" },
];

describe("VectorMap", () => {
  it("renders one point per vector with a legend for groups", () => {
    render(() => <VectorMap points={points} onSelect={vi.fn()} />);
    expect(screen.getByLabelText("Object alpha")).toBeInTheDocument();
    expect(screen.getByLabelText("Object beta")).toBeInTheDocument();
    expect(screen.getByLabelText("Object gamma")).toBeInTheDocument();
    expect(screen.getByLabelText("Group legend")).toHaveTextContent("tech");
    expect(screen.getByLabelText("Group legend")).toHaveTextContent("science");
    expect(screen.getByText(/3 vectors/)).toBeInTheDocument();
  });

  it("selects a point on click and on keyboard activation", () => {
    const onSelect = vi.fn();
    render(() => <VectorMap points={points} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText("Object beta"));
    expect(onSelect).toHaveBeenCalledWith("b");
    fireEvent.keyDown(screen.getByLabelText("Object gamma"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("c");
  });
});
