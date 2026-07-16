import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import FilterBuilder, { operatorsFor, rowValue, valueTypeFor, type FilterRow } from "./FilterBuilder";
import type { Property } from "~/lib/api";

const props: Property[] = [
  { name: "title", dataType: ["text"] },
  { name: "wordCount", dataType: ["int"] },
  { name: "published", dataType: ["boolean"] },
];

describe("FilterBuilder helpers", () => {
  it("maps dataTypes to value types and operators", () => {
    expect(valueTypeFor("int")).toBe("int");
    expect(valueTypeFor("text")).toBe("text");
    expect(valueTypeFor("weirdFuture")).toBe("text");
    expect(operatorsFor("int")).toContain("GreaterThan");
    expect(operatorsFor("text")).toContain("Like");
    expect(operatorsFor("boolean")).not.toContain("Like");
  });

  it("converts raw row text to typed values", () => {
    const row = (operator: FilterRow["operator"], raw: string): FilterRow => ({
      path: "x",
      operator,
      raw,
    });
    expect(rowValue(row("Equal", "42"), "int")).toBe(42);
    expect(rowValue(row("Equal", "4.5"), "number")).toBe(4.5);
    expect(rowValue(row("Equal", "true"), "boolean")).toBe(true);
    expect(rowValue(row("Equal", "hi"), "text")).toBe("hi");
    expect(rowValue(row("ContainsAny", "a, b , c"), "text")).toEqual(["a", "b", "c"]);
    expect(rowValue(row("IsNull", ""), "text")).toBe(true);
    expect(() => rowValue(row("Equal", "abc"), "int")).toThrow(/not an integer/);
  });
});

describe("FilterBuilder", () => {
  it("adds a row with the first property preselected", () => {
    const onChange = vi.fn();
    render(() => (
      <FilterBuilder properties={props} rows={[]} onChange={onChange} onApply={vi.fn()} />
    ));
    fireEvent.click(screen.getByText("+ Add filter"));
    expect(onChange).toHaveBeenCalledWith([
      { path: "title", operator: "Equal", raw: "" },
    ]);
  });

  it("applies and clears", () => {
    const onApply = vi.fn();
    const onChange = vi.fn();
    render(() => (
      <FilterBuilder
        properties={props}
        rows={[{ path: "title", operator: "Like", raw: "*x*" }]}
        onChange={onChange}
        onApply={onApply}
      />
    ));
    fireEvent.click(screen.getByText("Apply filters"));
    expect(onApply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(onApply).toHaveBeenCalledTimes(2);
  });

  it("hides the value input for IsNull and offers booleans as a select", () => {
    render(() => (
      <FilterBuilder
        properties={props}
        rows={[
          { path: "title", operator: "IsNull", raw: "" },
          { path: "published", operator: "Equal", raw: "true" },
        ]}
        onChange={vi.fn()}
        onApply={vi.fn()}
      />
    ));
    expect(screen.queryByLabelText("Filter 1 value")).not.toBeInTheDocument();
    const boolSelect = screen.getByLabelText("Filter 2 value");
    expect(boolSelect.tagName).toBe("SELECT");
  });

  it("removes a row", () => {
    const onChange = vi.fn();
    render(() => (
      <FilterBuilder
        properties={props}
        rows={[
          { path: "title", operator: "Equal", raw: "a" },
          { path: "wordCount", operator: "GreaterThan", raw: "5" },
        ]}
        onChange={onChange}
        onApply={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByLabelText("Remove filter 1"));
    expect(onChange).toHaveBeenCalledWith([
      { path: "wordCount", operator: "GreaterThan", raw: "5" },
    ]);
  });
});
