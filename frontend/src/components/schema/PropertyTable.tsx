import { For, Show } from "solid-js";
import type { Property } from "~/lib/api";

/** Properties of a single collection. Pure component for testability. */
export default function PropertyTable(props: { properties: Property[] }) {
  return (
    <Show
      when={props.properties.length > 0}
      fallback={
        <p class="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          This collection has no properties.
        </p>
      }
    >
      <div
        tabindex="0"
        role="region"
        aria-label="Properties"
        class="overflow-x-auto rounded-lg border border-zinc-200 focus-visible:outline-2 focus-visible:outline-weft-500 dark:border-zinc-800"
      >
        <table class="w-full text-left text-sm">
          <thead class="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">
                Property
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Data type
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Description
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            <For each={props.properties}>
              {(prop) => (
                <tr>
                  <td class="px-4 py-3 font-medium">{prop.name}</td>
                  <td class="px-4 py-3">
                    <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                      {prop.dataType.join(", ")}
                    </code>
                  </td>
                  <td class="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                    {prop.description ?? "—"}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
