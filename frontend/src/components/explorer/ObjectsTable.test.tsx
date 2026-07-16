import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ObjectsTable from "./ObjectsTable";
import type { WeaviateObject } from "~/lib/api";

const objects: WeaviateObject[] = [
  {
    id: "11111111-aaaa-bbbb-cccc-000000000000",
    properties: { title: "First article", category: "tech", wordCount: 40 },
  },
  {
    id: "22222222-aaaa-bbbb-cccc-000000000000",
    properties: { title: "Second article", category: "science", wordCount: 47 },
  },
];

describe("ObjectsTable", () => {
  it("derives columns from properties and renders values", () => {
    render(() => <ObjectsTable objects={objects} />);
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("category")).toBeInTheDocument();
    expect(screen.getByText("First article")).toBeInTheDocument();
    expect(screen.getByText("science")).toBeInTheDocument();
  });

  it("shows truncated ids and reports row selection", () => {
    const onSelect = vi.fn();
    render(() => <ObjectsTable objects={objects} onSelect={onSelect} />);
    expect(screen.getByText("11111111…")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Second article"));
    expect(onSelect).toHaveBeenCalledWith(objects[1]);
  });

  it("renders an empty state", () => {
    render(() => <ObjectsTable objects={[]} />);
    expect(screen.getByText(/no objects/i)).toBeInTheDocument();
  });
});
