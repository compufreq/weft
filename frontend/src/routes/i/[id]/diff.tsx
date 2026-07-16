import { A, createAsync, query, useParams } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import DiffTable from "~/components/schema/DiffTable";
import { api, type DiffResult } from "~/lib/api";

const getInstances = query(() => api.instances(), "instances");

export const route = {
  preload: () => getInstances(),
};

export default function DiffPage() {
  const params = useParams();
  const instances = createAsync(() => getInstances());
  const others = () => (instances() ?? []).filter((i) => i.id !== params.id);

  const [mode, setMode] = createSignal<"instance" | "json">("instance");
  const [target, setTarget] = createSignal("");
  const [pasted, setPasted] = createSignal("");
  const [result, setResult] = createSignal<DiffResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const run = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      if (mode() === "instance") {
        if (!target()) throw new Error("Pick an instance to compare against.");
        setResult(await api.diff(params.id ?? "", { against_instance: target() }));
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(pasted());
        } catch {
          throw new Error("The pasted text is not valid JSON.");
        }
        setResult(await api.diff(params.id ?? "", { against_schema: parsed }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="diff-heading">
      <nav aria-label="Breadcrumb" class="text-sm text-zinc-500 dark:text-zinc-400">
        <A href="/" class="hover:text-weft-600 dark:hover:text-weft-400">
          Instances
        </A>
        <span aria-hidden="true"> / </span>
        <A href={`/i/${params.id}/schema`} class="hover:text-weft-600 dark:hover:text-weft-400">
          {params.id}
        </A>
        <span aria-hidden="true"> / </span>
        <span class="text-zinc-900 dark:text-zinc-100">diff</span>
      </nav>

      <h1 id="diff-heading" class="mt-2 text-2xl font-semibold tracking-tight">
        Schema diff
      </h1>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Compare <code class="text-xs">{params.id}</code> against another instance or a pasted
        schema JSON (e.g. an earlier export).
      </p>

      <form onSubmit={run} class="mt-6 space-y-4">
        <fieldset class="flex gap-4">
          <legend class="sr-only">Comparison target</legend>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="instance"
              checked={mode() === "instance"}
              onChange={() => setMode("instance")}
            />
            Another instance
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="json"
              checked={mode() === "json"}
              onChange={() => setMode("json")}
            />
            Pasted schema JSON
          </label>
        </fieldset>

        <Show when={mode() === "instance"}>
          <div>
            <label for="diff-target" class="block text-sm font-medium">
              Compare against
            </label>
            <select
              id="diff-target"
              class="mt-1 w-full max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={target()}
              onChange={(e) => setTarget(e.currentTarget.value)}
            >
              <option value="">Select an instance…</option>
              <For each={others()}>{(i) => <option value={i.id}>{i.name}</option>}</For>
            </select>
            <Show when={others().length === 0}>
              <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                No other instances registered — add one on the Instances page, or paste JSON
                instead.
              </p>
            </Show>
          </div>
        </Show>

        <Show when={mode() === "json"}>
          <div>
            <label for="diff-json" class="block text-sm font-medium">
              Schema JSON
            </label>
            <textarea
              id="diff-json"
              rows={8}
              placeholder='{"classes": [ … ]}'
              class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
              value={pasted()}
              onInput={(e) => setPasted(e.currentTarget.value)}
            />
          </div>
        </Show>

        <button
          type="submit"
          disabled={busy()}
          class="rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
        >
          {busy() ? "Comparing…" : "Compare"}
        </button>
      </form>

      <Show when={error()}>
        <div
          role="alert"
          class="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error()}
        </div>
      </Show>

      <Show when={result()}>
        {(r) => (
          <div class="mt-8">
            <h2 class="text-lg font-semibold tracking-tight">
              {r().left} <span aria-hidden="true">→</span> {r().right}
            </h2>
            <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {r().entries.length} difference{r().entries.length === 1 ? "" : "s"}
            </p>
            <div class="mt-3">
              <DiffTable entries={r().entries} />
            </div>
          </div>
        )}
      </Show>
    </section>
  );
}
