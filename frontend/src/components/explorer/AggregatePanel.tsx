import { For, Show } from "solid-js";
import type { AggregateResult } from "~/lib/api";

/**
 * Aggregation summary: total (filtered) count plus per-property facet bars.
 */
export default function AggregatePanel(props: {
  result: AggregateResult | null;
  groupBy: string;
  groupable: string[];
  onGroupBy: (prop: string) => void;
  loading?: boolean;
}) {
  const maxCount = () =>
    Math.max(1, ...(props.result?.groups ?? []).map((g) => g.count));

  return (
    <section
      aria-label="Aggregations"
      class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-medium">Aggregations</h2>
        <label class="text-xs text-zinc-500 dark:text-zinc-400">
          Facet by{" "}
          <select
            aria-label="Facet property"
            class="ml-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            value={props.groupBy}
            onChange={(e) => props.onGroupBy(e.currentTarget.value)}
          >
            <option value="">— none —</option>
            <For each={props.groupable}>{(p) => <option value={p}>{p}</option>}</For>
          </select>
        </label>
      </div>

      <Show when={!props.loading} fallback={<p class="mt-3 text-xs text-zinc-500">Loading…</p>}>
        <Show when={props.result}>
          {(r) => (
            <>
              <p class="mt-2 text-2xl font-semibold tabular-nums" role="status">
                {r().count.toLocaleString()}
                <span class="ml-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  matching objects
                </span>
              </p>
              <Show when={r().groups}>
                {(groups) => (
                  <ul class="mt-3 space-y-1.5" aria-label="Facet buckets">
                    <For each={groups()}>
                      {(g) => (
                        <li class="flex items-center gap-2 text-xs">
                          <span class="w-28 shrink-0 truncate" title={String(g.value)}>
                            {String(g.value)}
                          </span>
                          {/* Bounded track so the % bar can never widen the row. */}
                          <span aria-hidden="true" class="min-w-0 flex-1">
                            <span
                              class="block h-3 max-w-full rounded-sm bg-weft-500/70"
                              style={{
                                width: `${Math.max(2, (g.count / maxCount()) * 100)}%`,
                              }}
                            />
                          </span>
                          <span class="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                            {g.count.toLocaleString()}
                          </span>
                        </li>
                      )}
                    </For>
                    <Show when={r().groups_truncated}>
                      <li class="text-xs text-zinc-400 dark:text-zinc-400">
                        … more buckets truncated
                      </li>
                    </Show>
                  </ul>
                )}
              </Show>
            </>
          )}
        </Show>
      </Show>
    </section>
  );
}
