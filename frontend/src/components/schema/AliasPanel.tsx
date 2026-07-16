import { createSignal, For, Show } from "solid-js";
import type { AliasEntry } from "~/lib/api";

/**
 * Collection aliases (Weaviate ≥ 1.32): list, create, repoint, delete.
 * Mutation controls are hidden in read-only deployments.
 */
export default function AliasPanel(props: {
  supported: boolean;
  reason?: string;
  aliases: AliasEntry[];
  classes: string[];
  readOnly: boolean;
  onCreate: (alias: string, className: string) => Promise<void>;
  onRetarget: (alias: string, className: string) => Promise<void>;
  onDelete: (alias: string) => Promise<void>;
}) {
  const [newAlias, setNewAlias] = createSignal("");
  const [newTarget, setNewTarget] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const guard = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Collection aliases"
      class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 class="text-sm font-medium">Aliases</h2>
      <Show
        when={props.supported}
        fallback={
          <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {props.reason ?? "Aliases need Weaviate ≥ 1.32."}
          </p>
        }
      >
        <Show
          when={props.aliases.length > 0}
          fallback={
            <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              No aliases yet — an alias lets you migrate collections without
              changing client code.
            </p>
          }
        >
          <ul class="mt-3 space-y-2" aria-label="Alias list">
            <For each={props.aliases}>
              {(a) => (
                <li class="flex flex-wrap items-center gap-2 text-sm">
                  <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                    {a.alias}
                  </code>
                  <span aria-hidden="true" class="text-zinc-400">
                    →
                  </span>
                  <Show
                    when={!props.readOnly}
                    fallback={<code class="text-xs">{a.class}</code>}
                  >
                    <select
                      aria-label={`Target for alias ${a.alias}`}
                      class="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                      value={a.class}
                      disabled={busy()}
                      onChange={(e) =>
                        void guard(() => props.onRetarget(a.alias, e.currentTarget.value))
                      }
                    >
                      <For each={props.classes}>{(c) => <option value={c}>{c}</option>}</For>
                    </select>
                    <button
                      type="button"
                      aria-label={`Delete alias ${a.alias}`}
                      disabled={busy()}
                      onClick={() => void guard(() => props.onDelete(a.alias))}
                      class="rounded px-2 py-0.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      ×
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={!props.readOnly}>
          <form
            class="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void guard(async () => {
                await props.onCreate(newAlias().trim(), newTarget());
                setNewAlias("");
              });
            }}
          >
            <label class="text-sm">
              <span class="block text-xs font-medium">New alias</span>
              <input
                required
                placeholder="ArticlesLive"
                class="mt-1 w-40 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                value={newAlias()}
                onInput={(e) => setNewAlias(e.currentTarget.value)}
              />
            </label>
            <label class="text-sm">
              <span class="block text-xs font-medium">Points at</span>
              <select
                required
                class="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                value={newTarget()}
                onChange={(e) => setNewTarget(e.currentTarget.value)}
              >
                <option value="" disabled>
                  — collection —
                </option>
                <For each={props.classes}>{(c) => <option value={c}>{c}</option>}</For>
              </select>
            </label>
            <button
              type="submit"
              disabled={busy() || !newAlias().trim() || !newTarget()}
              class="rounded-lg bg-weft-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
            >
              Create alias
            </button>
          </form>
        </Show>

        <Show when={error()}>
          <p role="alert" class="mt-2 text-sm text-red-700 dark:text-red-300">
            {error()}
          </p>
        </Show>
      </Show>
    </section>
  );
}
