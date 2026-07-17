import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import MetricsPanel, {
  formatBytes,
  formatCount,
  MAX_SAMPLES,
  pushSample,
  rateSeries,
  sparklinePoints,
  type MetricsSample,
} from "./MetricsPanel";
import type { MetricsSnapshot } from "~/lib/api";

const snap = (partial: Partial<MetricsSnapshot>): MetricsSnapshot => ({
  supported: true,
  ...partial,
});

const sample = (at: number, partial: Partial<MetricsSnapshot>): MetricsSample => ({
  at,
  snapshot: snap(partial),
});

describe("MetricsPanel helpers", () => {
  it("keeps the rolling window bounded", () => {
    let w: MetricsSample[] = [];
    for (let i = 0; i < MAX_SAMPLES + 10; i++) {
      w = pushSample(w, sample(i * 1000, { goroutines: i }));
    }
    expect(w).toHaveLength(MAX_SAMPLES);
    expect(w[w.length - 1].snapshot.goroutines).toBe(MAX_SAMPLES + 9);
  });

  it("derives per-second rates from counters and clamps resets", () => {
    const w = [
      sample(0, { requests_total: 100 }),
      sample(10_000, { requests_total: 200 }), // +100 over 10s → 10/s
      sample(20_000, { requests_total: 50 }), // counter reset → 0, not negative
    ];
    expect(rateSeries(w, (s) => s.requests_total)).toEqual([10, 0]);
  });

  it("builds sparkline points within the viewBox", () => {
    const pts = sparklinePoints([1, 2, 3], 120, 32);
    const coords = pts.split(" ").map((p) => p.split(",").map(Number));
    expect(coords).toHaveLength(3);
    expect(coords[0][0]).toBe(0);
    expect(coords[2][0]).toBe(120);
    for (const [, y] of coords) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(32);
    }
    expect(sparklinePoints([])).toBe("");
  });

  it("formats bytes and counts", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MiB");
    expect(formatCount(1_000_000)).toBe("1.00M");
    expect(formatCount(1500)).toBe("1.5k");
    expect(formatCount(42)).toBe("42");
  });
});

describe("MetricsPanel", () => {
  it("renders cards for present series and hides missing ones", () => {
    const w = [
      sample(0, { goroutines: 40, heap_inuse_bytes: 1024 * 1024, objects_total: 1525 }),
      sample(10_000, { goroutines: 42, heap_inuse_bytes: 2 * 1024 * 1024, objects_total: 1525 }),
    ];
    render(() => <MetricsPanel window={w} />);
    expect(screen.getByText("Goroutines")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Heap in use")).toBeInTheDocument();
    expect(screen.getByText("2.0 MiB")).toBeInTheDocument();
    expect(screen.getByText("Objects")).toBeInTheDocument();
    expect(screen.queryByText("Requests/s")).not.toBeInTheDocument();
    expect(screen.queryByText("Vector index size")).not.toBeInTheDocument();
  });

  it("shows the degrade reason when unsupported", () => {
    const w = [
      { at: 0, snapshot: { supported: false, reason: "metrics endpoint not reachable" } },
    ];
    render(() => <MetricsPanel window={w} />);
    expect(screen.getByText(/not reachable/)).toBeInTheDocument();
  });

  it("lists objects by collection", () => {
    const w = [
      sample(0, {
        objects_total: 2600,
        objects_by_class: [
          { class: "PerfDoc", count: 1400 },
          { class: "Article", count: 25 },
        ],
      }),
    ];
    render(() => <MetricsPanel window={w} />);
    expect(screen.getByText("Objects by collection")).toBeInTheDocument();
    expect(screen.getByText("PerfDoc")).toBeInTheDocument();
    expect(screen.getByText("1.4k")).toBeInTheDocument();
  });
});
