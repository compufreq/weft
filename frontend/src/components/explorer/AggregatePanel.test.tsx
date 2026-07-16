import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import AggregatePanel from "./AggregatePanel";

describe("AggregatePanel", () => {
  it("shows the matching count", () => {
    render(() => (
      <AggregatePanel
        result={{ count: 1234, groups: null }}
        groupBy=""
        groupable={["category"]}
        onGroupBy={vi.fn()}
      />
    ));
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.queryByLabelText("Facet buckets")).not.toBeInTheDocument();
  });

  it("renders facet buckets with counts and truncation notice", () => {
    render(() => (
      <AggregatePanel
        result={{
          count: 25,
          groups: [
            { value: "tech", count: 7 },
            { value: "science", count: 6 },
          ],
          groups_truncated: true,
        }}
        groupBy="category"
        groupable={["category"]}
        onGroupBy={vi.fn()}
      />
    ));
    expect(screen.getByText("tech")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/truncated/)).toBeInTheDocument();
  });

  it("emits group-by changes", () => {
    const onGroupBy = vi.fn();
    render(() => (
      <AggregatePanel
        result={{ count: 1, groups: null }}
        groupBy=""
        groupable={["category", "title"]}
        onGroupBy={onGroupBy}
      />
    ));
    fireEvent.change(screen.getByLabelText("Facet property"), {
      target: { value: "category" },
    });
    expect(onGroupBy).toHaveBeenCalledWith("category");
  });
});
