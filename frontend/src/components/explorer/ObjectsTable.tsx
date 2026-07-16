import { createMemo, For, Show } from "solid-js";
import type { WeaviateObject } from "~/lib/api";

function preview(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/**
 * Object rows with a stable column set derived from the data.
 * Pure component; row click reports the selected object upward.
 */
export default function ObjectsTable(props: {
  objects: WeaviateObject[];
  onSelect?: (obj: WeaviateObject) => void;
  selectedId?: string | null;
}) {
  // Columns: union of property keys across the page, in first-seen order (max 5 shown).
  const columns = createMemo(() => {
    const cols: string[] = [];
    for (const obj of props.objects) {
      for (const key of Object.keys(obj.properties ?? {})) {
        if (!cols.includes(key)) cols.push(key);
      }
    }
    return cols.slice(0, 5);
  });

  return (
    <Show
      when={props.objects.length > 0}
      fallback={
        <p class="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No objects found.
        </p>
      }
    >
      <div
        tabindex="0"
        role="region"
        aria-label="Objects"
        class="overflow-x-auto rounded-lg border border-zinc-200 focus-visible:outline-2 focus-visible:outline-weft-500 dark:border-zinc-800"
      >
        <table class="w-full text-left text-sm">
          <thead class="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">
                ID
              </th>
              <For each={columns()}>
                {(col) => (
                  <th scope="col" class="px-4 py-3 font-medium">
                    {col}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            <For each={props.objects}>
              {(obj) => (
                <tr
                  class={`cursor-pointer transition hover:bg-weft-50/60 dark:hover:bg-weft-700/10 ${
                    props.selectedId === obj.id ? "bg-weft-50 dark:bg-weft-700/20" : ""
                  }`}
                  onClick={() => props.onSelect?.(obj)}
                >
                  <td class="px-4 py-2.5">
                    <code class="text-xs text-zinc-500 dark:text-zinc-400">
                      {obj.id.slice(0, 8)}…
                    </code>
                  </td>
                  <For each={columns()}>
                    {(col) => <td class="px-4 py-2.5">{preview(obj.properties?.[col])}</td>}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
