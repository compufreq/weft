import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import SchemaTable from "./SchemaTable";
import type { ClassInfo } from "~/lib/api";

const classes: ClassInfo[] = [
  {
    class: "Article",
    description: "Demo news articles",
    vectorizer: "none",
    multiTenancyConfig: { enabled: false },
    properties: [
      { name: "title", dataType: ["text"] },
      { name: "body", dataType: ["text"] },
    ],
  },
  {
    class: "Product",
    vectorizer: "none",
    multiTenancyConfig: { enabled: true },
    properties: [{ name: "name", dataType: ["text"] }],
  },
];

describe("SchemaTable", () => {
  it("renders one row per collection with name and property count", () => {
    render(() => <SchemaTable classes={classes} />);
    expect(screen.getByText("Article")).toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("Demo news articles")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // Article property count
  });

  it("shows a multi-tenancy badge only for MT collections", () => {
    render(() => <SchemaTable classes={classes} />);
    expect(screen.getByText("enabled")).toBeInTheDocument();
    expect(screen.getByText("off")).toBeInTheDocument();
  });

  it("shows an empty state when there are no collections", () => {
    render(() => <SchemaTable classes={[]} />);
    expect(screen.getByText(/no collections found/i)).toBeInTheDocument();
  });

  it("uses an accessible table structure", () => {
    render(() => <SchemaTable classes={classes} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  });
});
