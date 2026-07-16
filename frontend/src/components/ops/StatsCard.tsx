import { For, Show } from "solid-js";
import type { ClusterStatistics } from "~/lib/api";

/** Raft cluster statistics: synchronization + per-node leader/status. */
export default function StatsCard(props: { stats: ClusterStatistics }) {
  return (
    <section
      aria-label="Cluster statistics"
      class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-medium">Cluster statistics</h2>
        <span
          class={`rounded-full px-2 py-0.5 text-xs font-medium ${
            props.stats.synchronized
              ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          }`}
        >
          {props.stats.synchronized ? "synchronized" : "not synchronized"}
        </span>
      </div>
      <ul class="mt-3 space-y-1" aria-label="Raft nodes">
        <For each={props.stats.statistics}>
          {(node) => (
            <li class="flex flex-wrap items-center gap-2 text-sm">
              <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                {node.name}
              </code>
              <Show when={node.leaderId}>
                <span class="text-xs text-zinc-500 dark:text-zinc-400">
                  leader: {node.leaderId}
                </span>
              </Show>
              <Show when={node.status}>
                <span class="text-xs text-zinc-500 dark:text-zinc-400">{node.status}</span>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
