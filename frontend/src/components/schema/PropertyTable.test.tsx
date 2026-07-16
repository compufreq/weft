import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import PropertyTable from "./PropertyTable";

describe("PropertyTable", () => {
  it("renders property name, data types, and description", () => {
    render(() => (
      <PropertyTable
        properties={[
          { name: "title", dataType: ["text"], description: "Headline" },
          { name: "tags", dataType: ["text[]"] },
        ]}
      />
    ));
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("Headline")).toBeInTheDocument();
    expect(screen.getByText("text[]")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // missing description
  });

  it("shows an empty state for a property-less collection", () => {
    render(() => <PropertyTable properties={[]} />);
    expect(screen.getByText(/no properties/i)).toBeInTheDocument();
  });
});
