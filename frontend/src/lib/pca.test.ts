import { describe, expect, it } from "vitest";
import { project2d } from "./pca";

describe("project2d", () => {
  it("separates two obvious clusters along the first component", () => {
    // Two tight clusters far apart in 8D space.
    const clusterA = Array.from({ length: 10 }, (_, i) => [
      10 + i * 0.01, 10, 10, 10, 0, 0, 0, 0,
    ]);
    const clusterB = Array.from({ length: 10 }, (_, i) => [
      -10 - i * 0.01, -10, -10, -10, 0, 0, 0, 0,
    ]);
    const coords = project2d([...clusterA, ...clusterB]);

    const xsA = coords.slice(0, 10).map((c) => c[0]);
    const xsB = coords.slice(10).map((c) => c[0]);
    // Every A point sits strictly on one side, every B on the other.
    const maxA = Math.max(...xsA);
    const minA = Math.min(...xsA);
    const maxB = Math.max(...xsB);
    const minB = Math.min(...xsB);
    expect(minA > maxB || minB > maxA).toBe(true);
  });

  it("preserves input order and length", () => {
    const vectors = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1],
    ];
    const coords = project2d(vectors);
    expect(coords).toHaveLength(4);
    expect(coords.every((c) => c.length === 2 && c.every(Number.isFinite))).toBe(true);
  });

  it("handles degenerate inputs without exploding", () => {
    expect(project2d([])).toEqual([]);
    expect(project2d([[1, 2]])).toEqual([[0, 0]]);
    expect(project2d([[1], [2], [3]])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    // Identical vectors → zero variance, finite output.
    const same = project2d([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);
    expect(same.every((c) => c.every(Number.isFinite))).toBe(true);
  });
});
