import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import SearchResults from "./SearchResults";
import type { SearchHit } from "~/lib/api";

const hits: SearchHit[] = [
  {
    id: "11111111-aaaa-bbbb-cccc-000000000000",
    score: 1.2345678,
    distance: null,
    properties: { title: "BM25 hit about science" },
  },
  {
    id: "22222222-aaaa-bbbb-cccc-000000000000",
    score: null,
    distance: 0.0000012,
    properties: { title: "Vector neighbor" },
  },
];

describe("SearchResults", () => {
  it("renders score and distance badges appropriately per hit", () => {
    render(() => <SearchResults hits={hits} />);
    expect(screen.getByText("score 1.2346")).toBeInTheDocument();
    expect(screen.getByText("distance 0.0000")).toBeInTheDocument();
    expect(screen.getByText("BM25 hit about science")).toBeInTheDocument();
    expect(screen.getByText("Vector neighbor")).toBeInTheDocument();
  });

  it("shows a no-results status when empty", () => {
    render(() => <SearchResults hits={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/no results/i);
  });
});
