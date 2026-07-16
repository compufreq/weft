import { For, Show } from "solid-js";
import { Motion } from "solid-motionone";
import type { ClassInfo } from "~/lib/api";

/**
 * Renders an instance's collections as a table.
 * Pure component (data in via props) so it's unit-testable without a server.
 * When `instanceId` is set, collection names link to their detail page.
 */
export default function SchemaTable(props: { classes: ClassInfo[]; instanceId?: string }) {
  return (
    <Show
      when={props.classes.length > 0}
      fallback={
        <p class="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No collections found on this instance.
        </p>
      }
    >
      {/* tabindex + region role: keyboard users must be able to scroll wide tables */}
      <div
        tabindex="0"
        role="region"
        aria-label="Collections"
        class="overflow-x-auto rounded-lg border border-zinc-200 focus-visible:outline-2 focus-visible:outline-weft-500 dark:border-zinc-800"
      >
        <table class="w-full text-left text-sm">
          <thead class="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">
                Collection
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Properties
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Vectorizer
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Multi-tenancy
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            <For each={props.classes}>
              {(cls, i) => (
                <Motion.tr
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: i() * 0.04 }}
                >
                  <td class="px-4 py-3">
                    <Show
                      when={props.instanceId}
                      fallback={<span class="font-medium">{cls.class}</span>}
                    >
                      <a
                        href={`/i/${props.instanceId}/c/${encodeURIComponent(cls.class)}`}
                        class="font-medium text-weft-600 hover:underline dark:text-weft-400"
                      >
                        {cls.class}
                      </a>
                    </Show>
                    <Show when={cls.description}>
                      <p class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {cls.description}
                      </p>
                    </Show>
                  </td>
                  <td class="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                    {cls.properties.length}
                  </td>
                  <td class="px-4 py-3">
                    <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                      {cls.vectorizer ?? "—"}
                    </code>
                  </td>
                  <td class="px-4 py-3">
                    <Show
                      when={cls.multiTenancyConfig?.enabled}
                      fallback={<span class="text-zinc-400 dark:text-zinc-500">off</span>}
                    >
                      <span class="rounded-full bg-weft-50 px-2 py-0.5 text-xs font-medium text-weft-700 dark:bg-weft-700/20 dark:text-weft-400">
                        enabled
                      </span>
                    </Show>
                  </td>
                </Motion.tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
