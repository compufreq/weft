import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import NodesPanel from "./NodesPanel";
import type { ClusterNode } from "~/lib/api";

const nodes: ClusterNode[] = [
  {
    name: "node1",
    status: "HEALTHY",
    version: "1.37.2",
    stats: { objectCount: 35, shardCount: 3 },
    shards: [
      { name: "abc1", class: "Article", objectCount: 25, vectorIndexingStatus: "READY" },
      { name: "def2", class: "Product", objectCount: 10 },
    ],
  },
  { name: "node2", status: "UNHEALTHY", shards: null },
];

describe("NodesPanel", () => {
  it("renders a card per node with status tone", () => {
    render(() => <NodesPanel nodes={nodes} />);
    // "node1" appears in the card heading AND the shard table rows.
    expect(screen.getAllByText("node1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("HEALTHY")).toBeInTheDocument();
    expect(screen.getByText("UNHEALTHY")).toBeInTheDocument();
    expect(screen.getByText("1.37.2")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
  });

  it("renders the shard table across nodes", () => {
    render(() => <NodesPanel nodes={nodes} />);
    expect(screen.getByRole("heading", { name: "Shards" })).toBeInTheDocument();
    expect(screen.getByText("Article")).toBeInTheDocument();
    expect(screen.getByText("READY")).toBeInTheDocument();
  });

  it("renders an empty state", () => {
    render(() => <NodesPanel nodes={[]} />);
    expect(screen.getByText(/no node information/i)).toBeInTheDocument();
  });
});
