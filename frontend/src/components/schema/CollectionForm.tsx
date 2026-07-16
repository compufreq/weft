import { createSignal, For, Show } from "solid-js";

interface PropertyRow {
  name: string;
  dataType: string;
}

const DATA_TYPES = ["text", "int", "number", "boolean", "date", "text[]", "uuid"];

/**
 * Guided collection creation (name, multi-tenancy, properties) with a raw
 * JSON escape hatch for everything the form doesn't cover.
 */
export default function CollectionForm(props: {
  onCreate: (classDef: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = createSignal("");
  const [multiTenancy, setMultiTenancy] = createSignal(false);
  const [rows, setRows] = createSignal<PropertyRow[]>([{ name: "", dataType: "text" }]);
  const [rawMode, setRawMode] = createSignal(false);
  const [rawText, setRawText] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const buildDef = (): Record<string, unknown> => {
    if (rawMode()) {
      const parsed: unknown = JSON.parse(rawText());
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("The definition must be a JSON object.");
      }
      return parsed as Record<string, unknown>;
    }
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(name())) {
      throw new Error("Collection names are UpperCamelCase (e.g. Article).");
    }
    const properties = rows()
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        dataType: [r.dataType],
      }));
    const def: Record<string, unknown> = {
      class: name(),
      vectorizer: "none",
      properties,
    };
    if (multiTenancy()) def.multiTenancyConfig = { enabled: true };
    return def;
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    let def: Record<string, unknown>;
    try {
      def = buildDef();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid definition.");
      return;
    }
    setBusy(true);
    try {
      await props.onCreate(def);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      aria-label="New collection"
      class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-medium">New collection</h2>
        <label class="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={rawMode()}
            onChange={(e) => setRawMode(e.currentTarget.checked)}
          />
          raw JSON
        </label>
      </div>

      <Show
        when={!rawMode()}
        fallback={
          <label class="mt-3 block text-sm">
            <span class="block text-xs font-medium">Class definition (JSON)</span>
            <textarea
              rows={10}
              spellcheck={false}
              placeholder='{ "class": "Article", "vectorizer": "none", "properties": [...] }'
              class="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
              value={rawText()}
              onInput={(e) => setRawText(e.currentTarget.value)}
            />
          </label>
        }
      >
        <label class="mt-3 block text-sm">
          <span class="block text-xs font-medium">Name</span>
          <input
            required
            placeholder="Article"
            class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <label class="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={multiTenancy()}
            onChange={(e) => setMultiTenancy(e.currentTarget.checked)}
          />
          Multi-tenant
        </label>

        <fieldset class="mt-3">
          <legend class="text-xs font-medium">Properties</legend>
          <div class="mt-1 space-y-2">
            <For each={rows()}>
              {(row, i) => (
                <div class="flex items-center gap-2">
                  <input
                    aria-label={`Property ${i() + 1} name`}
                    placeholder="title"
                    class="w-40 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={row.name}
                    onInput={(e) =>
                      setRows(rows().map((r, j) => (j === i() ? { ...r, name: e.currentTarget.value } : r)))
                    }
                  />
                  <select
                    aria-label={`Property ${i() + 1} type`}
                    class="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    value={row.dataType}
                    onChange={(e) =>
                      setRows(rows().map((r, j) => (j === i() ? { ...r, dataType: e.currentTarget.value } : r)))
                    }
                  >
                    <For each={DATA_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove property ${i() + 1}`}
                    onClick={() => setRows(rows().filter((_, j) => j !== i()))}
                    class="rounded px-2 py-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    ×
                  </button>
                </div>
              )}
            </For>
            <button
              type="button"
              onClick={() => setRows([...rows(), { name: "", dataType: "text" }])}
              class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:border-weft-400 dark:border-zinc-700 dark:hover:border-weft-500"
            >
              + Add property
            </button>
          </div>
        </fieldset>
        <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Vectorizer defaults to <code>none</code> — use raw JSON for vectorizer/module config.
        </p>
      </Show>

      <Show when={error()}>
        <p role="alert" class="mt-3 text-sm text-red-700 dark:text-red-300">
          {error()}
        </p>
      </Show>
      <div class="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy()}
          class="rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
        >
          {busy() ? "Creating…" : "Create collection"}
        </button>
        <button
          type="button"
          onClick={() => props.onCancel()}
          class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
