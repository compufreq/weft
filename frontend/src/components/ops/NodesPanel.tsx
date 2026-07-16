import { For, Show } from "solid-js";
import type { ClusterNode } from "~/lib/api";

/** Cluster node cards + shard table. Pure component for testability. */
export default function NodesPanel(props: { nodes: ClusterNode[] }) {
  const allShards = () =>
    props.nodes.flatMap((n) => (n.shards ?? []).map((s) => ({ node: n.name, ...s })));

  return (
    <Show
      when={props.nodes.length > 0}
      fallback={
        <p class="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No node information available.
        </p>
      }
    >
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <For each={props.nodes}>
          {(node) => (
            <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div class="flex items-center justify-between gap-2">
                <h3 class="font-medium">{node.name}</h3>
                <span
                  class={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    node.status === "HEALTHY"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                  }`}
                >
                  {node.status}
                </span>
              </div>
              <dl class="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
                <div class="flex justify-between">
                  <dt>Version</dt>
                  <dd>
                    <code class="text-xs">{node.version ?? "—"}</code>
                  </dd>
                </div>
                <div class="flex justify-between">
                  <dt>Objects</dt>
                  <dd>{node.stats?.objectCount ?? "—"}</dd>
                </div>
                <div class="flex justify-between">
                  <dt>Shards</dt>
                  <dd>{node.stats?.shardCount ?? "—"}</dd>
                </div>
              </dl>
            </div>
          )}
        </For>
      </div>

      <Show when={allShards().length > 0}>
        <h3 class="mt-8 text-lg font-semibold tracking-tight">Shards</h3>
        <div
          tabindex="0"
          role="region"
          aria-label="Shards"
          class="mt-3 overflow-x-auto rounded-lg border border-zinc-200 focus-visible:outline-2 focus-visible:outline-weft-500 dark:border-zinc-800"
        >
          <table class="w-full text-left text-sm">
            <thead class="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th scope="col" class="px-4 py-3 font-medium">
                  Node
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  Collection
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  Shard
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  Objects
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  Indexing
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
              <For each={allShards()}>
                {(shard) => (
                  <tr>
                    <td class="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{shard.node}</td>
                    <td class="px-4 py-2.5 font-medium">{shard.class}</td>
                    <td class="px-4 py-2.5">
                      <code class="text-xs">{shard.name}</code>
                    </td>
                    <td class="px-4 py-2.5">{shard.objectCount ?? "—"}</td>
                    <td class="px-4 py-2.5">
                      <code class="text-xs">{shard.vectorIndexingStatus ?? "—"}</code>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </Show>
  );
}
