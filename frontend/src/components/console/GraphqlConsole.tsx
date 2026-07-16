import { createSignal, Show } from "solid-js";

const PLACEHOLDER = `{ Aggregate { YourCollection { meta { count } } } }`;

/**
 * Raw GraphQL scratchpad. Weaviate's GraphQL schema is query-only, so this is
 * safe even on read-only deployments. The parent supplies the runner (API
 * call) and optional initial text (persistence).
 */
export default function GraphqlConsole(props: {
  onRun: (query: string) => Promise<unknown>;
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
}) {
  const [query, setQuery] = createSignal(props.initialQuery ?? "");
  const [result, setResult] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [running, setRunning] = createSignal(false);

  const run = async (e?: Event) => {
    e?.preventDefault();
    if (!query().trim() || running()) return;
    setRunning(true);
    setError(null);
    try {
      const envelope = await props.onRun(query());
      setResult(JSON.stringify(envelope, null, 2));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <form onSubmit={run} class="grid gap-4 lg:grid-cols-2">
      <div>
        <label class="block text-sm">
          <span class="block text-xs font-medium">GraphQL query</span>
          <textarea
            rows={14}
            spellcheck={false}
            placeholder={PLACEHOLDER}
            class="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-3 font-mono text-xs leading-relaxed dark:border-zinc-700 dark:bg-zinc-950"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              props.onQueryChange?.(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter runs — the muscle memory every console has.
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void run();
            }}
          />
        </label>
        <div class="mt-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={running() || !query().trim()}
            class="rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
          >
            {running() ? "Running…" : "Run (Ctrl+Enter)"}
          </button>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">
            Get / Aggregate / Explore — Weaviate GraphQL is read-only.
          </p>
        </div>
      </div>

      <div aria-label="Query result">
        <Show when={error()}>
          <div
            role="alert"
            class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {error()}
          </div>
        </Show>
        <Show when={result()}>
          {(r) => (
            <pre
              tabindex="0"
              role="region"
              aria-label="Result JSON"
              class="max-h-[70vh] overflow-auto rounded-lg border border-zinc-200 bg-white p-4 text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-weft-500 dark:border-zinc-800 dark:bg-zinc-900"
            >
              {r()}
            </pre>
          )}
        </Show>
        <Show when={!result() && !error()}>
          <p class="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-400">
            Results appear here.
          </p>
        </Show>
      </div>
    </form>
  );
}
