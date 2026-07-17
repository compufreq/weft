import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import FilterBuilder, {
  countRows,
  emptyGroup,
  operatorsFor,
  rowValue,
  toWhereFilter,
  valueTypeFor,
  type FilterGroup,
  type FilterRow,
} from "./FilterBuilder";
import type { Property } from "~/lib/api";

const props: Property[] = [
  { name: "title", dataType: ["text"] },
  { name: "wordCount", dataType: ["int"] },
  { name: "published", dataType: ["boolean"] },
];

const group = (partial: Partial<FilterGroup>): FilterGroup => ({
  ...emptyGroup(),
  ...partial,
});

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

  it("converts a group tree to the API WhereFilter shape", () => {
    expect(toWhereFilter(emptyGroup(), props)).toBeUndefined();

    const tree = group({
      combinator: "And",
      rows: [{ path: "wordCount", operator: "GreaterThan", raw: "10" }],
      groups: [
        group({
          combinator: "Or",
          rows: [
            { path: "title", operator: "Equal", raw: "a" },
            { path: "title", operator: "Equal", raw: "b" },
          ],
        }),
        // Empty subgroup is pruned.
        emptyGroup("Or"),
      ],
    });
    expect(toWhereFilter(tree, props)).toEqual({
      operator: "And",
      conditions: [
        { path: "wordCount", operator: "GreaterThan", value: 10, value_type: "int" },
      ],
      groups: [
        {
          operator: "Or",
          conditions: [
            { path: "title", operator: "Equal", value: "a", value_type: "text" },
            { path: "title", operator: "Equal", value: "b", value_type: "text" },
          ],
          groups: [],
        },
      ],
    });
    expect(countRows(tree)).toBe(3);
  });
});

describe("FilterBuilder", () => {
  it("adds a row with the first property preselected", () => {
    const onChange = vi.fn();
    render(() => (
      <FilterBuilder
        properties={props}
        group={emptyGroup()}
        onChange={onChange}
        onApply={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByText("+ Add filter"));
    expect(onChange).toHaveBeenCalledWith(
      group({ rows: [{ path: "title", operator: "Equal", raw: "" }] }),
    );
  });

  it("adds a subgroup with the opposite combinator", () => {
    const onChange = vi.fn();
    render(() => (
      <FilterBuilder
        properties={props}
        group={group({ rows: [{ path: "title", operator: "Like", raw: "*x*" }] })}
        onChange={onChange}
        onApply={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByLabelText("Add group"));
    expect(onChange).toHaveBeenCalledWith(
      group({
        rows: [{ path: "title", operator: "Like", raw: "*x*" }],
        groups: [emptyGroup("Or")],
      }),
    );
  });

  it("shows the match-mode select once there are two operands and switches to OR", () => {
    const onChange = vi.fn();
    const two = group({
      rows: [
        { path: "title", operator: "Equal", raw: "a" },
        { path: "title", operator: "Equal", raw: "b" },
      ],
    });
    render(() => (
      <FilterBuilder properties={props} group={two} onChange={onChange} onApply={vi.fn()} />
    ));
    const mode = screen.getByLabelText("Match mode");
    fireEvent.change(mode, { target: { value: "Or" } });
    expect(onChange).toHaveBeenCalledWith({ ...two, combinator: "Or" });
  });

  it("renders nested group rows with scoped labels and removes a group", () => {
    const onChange = vi.fn();
    const tree = group({
      rows: [{ path: "title", operator: "Equal", raw: "a" }],
      groups: [
        group({
          combinator: "Or",
          rows: [{ path: "wordCount", operator: "GreaterThan", raw: "5" }],
        }),
      ],
    });
    render(() => (
      <FilterBuilder properties={props} group={tree} onChange={onChange} onApply={vi.fn()} />
    ));
    expect(screen.getByLabelText("Group 1 filter 1 property")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove group 1"));
    expect(onChange).toHaveBeenCalledWith({ ...tree, groups: [] });
  });

  it("applies and clears", () => {
    const onApply = vi.fn();
    const onChange = vi.fn();
    render(() => (
      <FilterBuilder
        properties={props}
        group={group({ rows: [{ path: "title", operator: "Like", raw: "*x*" }] })}
        onChange={onChange}
        onApply={onApply}
      />
    ));
    fireEvent.click(screen.getByText("Apply filters"));
    expect(onApply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith(emptyGroup());
    expect(onApply).toHaveBeenCalledTimes(2);
  });

  it("hides the value input for IsNull and offers booleans as a select", () => {
    render(() => (
      <FilterBuilder
        properties={props}
        group={group({
          rows: [
            { path: "title", operator: "IsNull", raw: "" },
            { path: "published", operator: "Equal", raw: "true" },
          ],
        })}
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
        group={group({
          rows: [
            { path: "title", operator: "Equal", raw: "a" },
            { path: "wordCount", operator: "GreaterThan", raw: "5" },
          ],
        })}
        onChange={onChange}
        onApply={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByLabelText("Remove filter 1"));
    expect(onChange).toHaveBeenCalledWith(
      group({ rows: [{ path: "wordCount", operator: "GreaterThan", raw: "5" }] }),
    );
  });
});
