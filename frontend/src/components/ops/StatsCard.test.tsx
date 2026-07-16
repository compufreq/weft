import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import StatsCard from "./StatsCard";

describe("StatsCard", () => {
  it("shows synchronized state and node details", () => {
    render(() => (
      <StatsCard
        stats={{
          synchronized: true,
          statistics: [{ name: "node1", status: "HEALTHY", leaderId: "node1" }],
        }}
      />
    ));
    expect(screen.getByText("synchronized")).toBeInTheDocument();
    expect(screen.getByText("node1")).toBeInTheDocument();
    expect(screen.getByText("leader: node1")).toBeInTheDocument();
  });

  it("flags an unsynchronized cluster", () => {
    render(() => (
      <StatsCard stats={{ synchronized: false, statistics: [{ name: "n1" }] }} />
    ));
    expect(screen.getByText("not synchronized")).toBeInTheDocument();
  });
});
