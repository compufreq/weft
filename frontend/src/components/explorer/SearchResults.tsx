import { For, Show } from "solid-js";
import type { SearchHit } from "~/lib/api";

function preview(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > 100 ? `${s.slice(0, 97)}…` : s;
}

/** Scored search hits. Pure component for testability. */
export default function SearchResults(props: {
  hits: SearchHit[];
  onSelect?: (hit: SearchHit) => void;
}) {
  return (
    <Show
      when={props.hits.length > 0}
      fallback={
        <p role="status" class="text-sm text-zinc-500 dark:text-zinc-400">
          No results.
        </p>
      }
    >
      <ol class="space-y-2" aria-label="Search results">
        <For each={props.hits}>
          {(hit, i) => (
            <li>
              <button
                type="button"
                onClick={() => props.onSelect?.(hit)}
                class="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left transition hover:border-weft-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-weft-500"
              >
                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs text-zinc-500 dark:text-zinc-400">
                    #{i() + 1} · <code>{hit.id.slice(0, 8)}…</code>
                  </span>
                  <span class="flex gap-2">
                    <Show when={hit.score !== null && hit.score !== undefined}>
                      <span class="rounded-full bg-weft-50 px-2 py-0.5 text-xs font-medium text-weft-700 dark:bg-weft-700/20 dark:text-weft-400">
                        score {hit.score?.toFixed(4)}
                      </span>
                    </Show>
                    <Show when={hit.distance !== null && hit.distance !== undefined}>
                      <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        distance {hit.distance?.toFixed(4)}
                      </span>
                    </Show>
                  </span>
                </div>
                <p class="mt-2 text-sm">
                  {preview(Object.values(hit.properties ?? {}).find((v) => typeof v === "string"))}
                </p>
              </button>
            </li>
          )}
        </For>
      </ol>
    </Show>
  );
}
