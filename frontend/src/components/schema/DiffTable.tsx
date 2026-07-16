import { For, Show } from "solid-js";
import type { DiffEntryT } from "~/lib/api";

const KIND_LABEL: Record<DiffEntryT["kind"], { label: string; tone: string }> = {
  class_added: {
    label: "class added",
    tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  },
  class_removed: {
    label: "class removed",
    tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  field_changed: {
    label: "field changed",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  property_added: {
    label: "property added",
    tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  },
  property_removed: {
    label: "property removed",
    tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  property_field_changed: {
    label: "property changed",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
};

function renderValue(v: unknown): string {
  if (v === undefined || v === null) return "∅";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Renders a schema diff. Pure component for testability. */
export default function DiffTable(props: { entries: DiffEntryT[] }) {
  return (
    <Show
      when={props.entries.length > 0}
      fallback={
        <p
          role="status"
          class="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
        >
          Schemas are identical — no differences found.
        </p>
      }
    >
      <div
        tabindex="0"
        role="region"
        aria-label="Schema differences"
        class="overflow-x-auto rounded-lg border border-zinc-200 focus-visible:outline-2 focus-visible:outline-weft-500 dark:border-zinc-800"
      >
        <table class="w-full text-left text-sm">
          <thead class="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">
                Change
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Where
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Left
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Right
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            <For each={props.entries}>
              {(entry) => {
                const kind = KIND_LABEL[entry.kind];
                return (
                  <tr>
                    <td class="px-4 py-3">
                      <span class={`rounded-full px-2 py-0.5 text-xs font-medium ${kind.tone}`}>
                        {kind.label}
                      </span>
                    </td>
                    <td class="px-4 py-3 font-medium">
                      {entry.class}
                      <Show when={entry.property}>
                        <span class="text-zinc-500 dark:text-zinc-400">.{entry.property}</span>
                      </Show>
                      <Show when={entry.field}>
                        <span class="text-zinc-400 dark:text-zinc-500"> · {entry.field}</span>
                      </Show>
                    </td>
                    <td class="px-4 py-3">
                      <Show when={"left" in entry} fallback="—">
                        <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                          {renderValue(entry.left)}
                        </code>
                      </Show>
                    </td>
                    <td class="px-4 py-3">
                      <Show when={"right" in entry} fallback="—">
                        <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                          {renderValue(entry.right)}
                        </code>
                      </Show>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
