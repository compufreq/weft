import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import DiffTable from "./DiffTable";
import type { DiffEntryT } from "~/lib/api";

const entries: DiffEntryT[] = [
  { kind: "class_added", class: "NewCollection" },
  { kind: "class_removed", class: "OldCollection" },
  {
    kind: "field_changed",
    class: "Article",
    field: "vectorizer",
    left: "none",
    right: "text2vec-openai",
  },
  {
    kind: "property_field_changed",
    class: "Article",
    property: "title",
    field: "dataType",
    left: ["text"],
    right: ["string"],
  },
];

describe("DiffTable", () => {
  it("renders one row per diff entry with kind badges", () => {
    render(() => <DiffTable entries={entries} />);
    expect(screen.getByText("class added")).toBeInTheDocument();
    expect(screen.getByText("class removed")).toBeInTheDocument();
    expect(screen.getByText("field changed")).toBeInTheDocument();
    expect(screen.getByText("property changed")).toBeInTheDocument();
    expect(screen.getByText("NewCollection")).toBeInTheDocument();
  });

  it("shows left/right values including JSON-encoded arrays", () => {
    render(() => <DiffTable entries={entries} />);
    expect(screen.getByText("none")).toBeInTheDocument();
    expect(screen.getByText("text2vec-openai")).toBeInTheDocument();
    expect(screen.getByText('["text"]')).toBeInTheDocument();
    expect(screen.getByText('["string"]')).toBeInTheDocument();
  });

  it("shows an identical-schemas message when there are no entries", () => {
    render(() => <DiffTable entries={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/identical/i);
  });
});
