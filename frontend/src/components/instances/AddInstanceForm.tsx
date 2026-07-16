import { createSignal, Show } from "solid-js";
import { api } from "~/lib/api";

/**
 * Register a Weaviate instance at runtime.
 * Note for users: runtime instances are in-memory — they reset when the
 * backend restarts. Persistent instances belong in weft.yaml.
 */
export default function AddInstanceForm(props: { onAdded: () => void }) {
  const [name, setName] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.addInstance({
        name: name(),
        url: url(),
        api_key: apiKey() || undefined,
      });
      setName("");
      setUrl("");
      setApiKey("");
      props.onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      aria-label="Add instance"
      class="rounded-xl border border-dashed border-zinc-300 p-5 dark:border-zinc-700"
    >
      <h2 class="font-medium">Add instance</h2>
      <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Survives restarts only if the deployment sets <code>WEFT_INSTANCES_FILE</code> —
        otherwise put permanent instances in <code>weft.yaml</code>.
      </p>

      <div class="mt-3 space-y-3">
        <div>
          <label for="inst-name" class="block text-xs font-medium">
            Name
          </label>
          <input
            id="inst-name"
            required
            placeholder="Staging cluster"
            class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </div>
        <div>
          <label for="inst-url" class="block text-xs font-medium">
            URL
          </label>
          <input
            id="inst-url"
            required
            type="url"
            placeholder="http://weaviate:8080"
            class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={url()}
            onInput={(e) => setUrl(e.currentTarget.value)}
          />
        </div>
        <div>
          <label for="inst-key" class="block text-xs font-medium">
            API key <span class="font-normal text-zinc-400">(optional)</span>
          </label>
          <input
            id="inst-key"
            type="password"
            autocomplete="off"
            class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={apiKey()}
            onInput={(e) => setApiKey(e.currentTarget.value)}
          />
        </div>
      </div>

      <Show when={error()}>
        <p role="alert" class="mt-3 text-sm text-red-700 dark:text-red-300">
          {error()}
        </p>
      </Show>

      <button
        type="submit"
        disabled={busy()}
        class="mt-4 rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
      >
        {busy() ? "Adding…" : "Add instance"}
      </button>
    </form>
  );
}
