import { For, Show } from "solid-js";
import type { Backup } from "~/lib/api";

const STATUS_TONE: Record<string, string> = {
  SUCCESS: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

/** Backup list with restore actions. Pure component for testability. */
export default function BackupsTable(props: {
  backups: Backup[];
  onRestore?: (backup: Backup) => void;
}) {
  return (
    <Show
      when={props.backups.length > 0}
      fallback={
        <p class="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No backups yet.
        </p>
      }
    >
      <div
        tabindex="0"
        role="region"
        aria-label="Backups"
        class="overflow-x-auto rounded-lg border border-zinc-200 focus-visible:outline-2 focus-visible:outline-weft-500 dark:border-zinc-800"
      >
        <table class="w-full text-left text-sm">
          <thead class="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">
                Backup
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Collections
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            <For each={props.backups}>
              {(backup) => (
                <tr>
                  <td class="px-4 py-2.5 font-medium">
                    <code class="text-xs">{backup.id}</code>
                  </td>
                  <td class="px-4 py-2.5">
                    <span
                      class={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_TONE[backup.status ?? ""] ??
                        "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      }`}
                    >
                      {backup.status ?? "UNKNOWN"}
                    </span>
                  </td>
                  <td class="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">
                    {backup.classes?.join(", ") ?? "—"}
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => props.onRestore?.(backup)}
                      class="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium hover:border-weft-400 dark:border-zinc-700 dark:hover:border-weft-500"
                    >
                      Restore…
                    </button>
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
