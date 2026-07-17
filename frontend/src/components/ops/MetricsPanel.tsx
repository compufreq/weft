import { For, Show } from "solid-js";
import type { MetricsSnapshot } from "~/lib/api";

/** One polled sample with its wall-clock timestamp (ms). */
export interface MetricsSample {
  at: number;
  snapshot: MetricsSnapshot;
}

/** Rolling window the panel charts (10s polling → ~5 minutes). */
export const MAX_SAMPLES = 30;

/** Append a sample, keeping the window bounded. */
export function pushSample(window: MetricsSample[], sample: MetricsSample): MetricsSample[] {
  return [...window, sample].slice(-MAX_SAMPLES);
}

/** Series of a numeric field across the window (nulls dropped). */
function series(
  window: MetricsSample[],
  pick: (s: MetricsSnapshot) => number | null | undefined,
): number[] {
  return window
    .map((w) => pick(w.snapshot))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/**
 * Per-second rate derived from a counter field across the window
 * (e.g. requests_total → QPS). Negative deltas (counter reset) clamp to 0.
 */
export function rateSeries(
  window: MetricsSample[],
  pick: (s: MetricsSnapshot) => number | null | undefined,
): number[] {
  const out: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const a = pick(window[i - 1].snapshot);
    const b = pick(window[i].snapshot);
    const dt = (window[i].at - window[i - 1].at) / 1000;
    if (typeof a !== "number" || typeof b !== "number" || dt <= 0) continue;
    out.push(Math.max(0, (b - a) / dt));
  }
  return out;
}

/** Points attribute for a fixed-viewBox sparkline polyline. */
export function sparklinePoints(values: number[], width = 120, height = 32): string {
  if (values.length === 0) return "";
  if (values.length === 1) return `0,${height / 2} ${width},${height / 2}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GiB`;
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MiB`;
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(1)} KiB`;
  return `${bytes.toFixed(0)} B`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function MetricCard(props: { label: string; value: string; values: number[] }) {
  return (
    <div class="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-xs font-medium text-zinc-500 dark:text-zinc-400">{props.label}</p>
      <p class="mt-1 text-lg font-semibold tabular-nums">{props.value}</p>
      <Show when={props.values.length > 1}>
        <svg
          viewBox="0 0 120 32"
          role="img"
          aria-label={`${props.label} trend`}
          class="mt-1 h-8 w-full text-weft-500"
          preserveAspectRatio="none"
        >
          <polyline
            points={sparklinePoints(props.values)}
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
      </Show>
    </div>
  );
}

/**
 * Live metrics: a rolling in-browser window of the backend's Prometheus
 * snapshot. No storage — history starts when the page opens.
 */
export default function MetricsPanel(props: { window: MetricsSample[] }) {
  const latest = () => props.window[props.window.length - 1]?.snapshot;
  const num = (v: number | null | undefined) => (typeof v === "number" ? v : null);

  return (
    <section aria-label="Live metrics">
      <Show
        when={latest()?.supported}
        fallback={
          <div class="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <p class="font-medium text-zinc-700 dark:text-zinc-200">Live metrics</p>
            <p class="mt-1">
              {latest()?.reason ??
                "Waiting for the first scrape of the metrics endpoint…"}
            </p>
          </div>
        }
      >
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Show when={num(latest()?.heap_inuse_bytes) !== null}>
            <MetricCard
              label="Heap in use"
              value={formatBytes(num(latest()?.heap_inuse_bytes) ?? 0)}
              values={series(props.window, (s) => s.heap_inuse_bytes)}
            />
          </Show>
          <Show when={num(latest()?.goroutines) !== null}>
            <MetricCard
              label="Goroutines"
              value={formatCount(num(latest()?.goroutines) ?? 0)}
              values={series(props.window, (s) => s.goroutines)}
            />
          </Show>
          <Show when={num(latest()?.cpu_seconds_total) !== null}>
            <MetricCard
              label="CPU"
              value={`${(rateSeries(props.window, (s) => s.cpu_seconds_total).at(-1) ?? 0).toFixed(2)} cores`}
              values={rateSeries(props.window, (s) => s.cpu_seconds_total)}
            />
          </Show>
          <Show when={num(latest()?.requests_total) !== null}>
            <MetricCard
              label="Requests/s"
              value={(rateSeries(props.window, (s) => s.requests_total).at(-1) ?? 0).toFixed(1)}
              values={rateSeries(props.window, (s) => s.requests_total)}
            />
          </Show>
          <Show when={num(latest()?.objects_total) !== null}>
            <MetricCard
              label="Objects"
              value={formatCount(num(latest()?.objects_total) ?? 0)}
              values={series(props.window, (s) => s.objects_total)}
            />
          </Show>
          <Show when={num(latest()?.vector_index_size) !== null}>
            <MetricCard
              label="Vector index size"
              value={formatCount(num(latest()?.vector_index_size) ?? 0)}
              values={series(props.window, (s) => s.vector_index_size)}
            />
          </Show>
        </div>
        <Show when={(latest()?.objects_by_class?.length ?? 0) > 0}>
          <div class="mt-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <p class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Objects by collection
            </p>
            <ul class="mt-2 space-y-1 text-sm">
              <For each={latest()?.objects_by_class ?? []}>
                {(c) => (
                  <li class="flex items-center justify-between gap-3">
                    <span class="truncate font-mono text-xs">{c.class}</span>
                    <span class="tabular-nums text-xs">{formatCount(c.count)}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </Show>
    </section>
  );
}
