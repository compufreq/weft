import { createSignal, Show } from "solid-js";

/**
 * JSON properties editor for creating or replacing one object.
 * Parent supplies the save handler; parse errors surface inline.
 */
export default function ObjectEditor(props: {
  heading: string;
  initial?: Record<string, unknown>;
  onSave: (properties: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = createSignal(
    JSON.stringify(props.initial ?? {}, null, 2),
  );
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const save = async (e: Event) => {
    e.preventDefault();
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text());
    } catch {
      setError("Properties must be valid JSON.");
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("Properties must be a JSON object, e.g. { \"title\": \"…\" }.");
      return;
    }
    setBusy(true);
    try {
      await props.onSave(parsed as Record<string, unknown>);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={save}
      aria-label={props.heading}
      class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 class="text-sm font-medium">{props.heading}</h2>
      <label class="mt-3 block text-sm">
        <span class="block text-xs font-medium">Properties (JSON)</span>
        <textarea
          rows={12}
          spellcheck={false}
          class="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-3 font-mono text-xs leading-relaxed dark:border-zinc-700 dark:bg-zinc-950"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </label>
      <Show when={error()}>
        <p role="alert" class="mt-2 text-sm text-red-700 dark:text-red-300">
          {error()}
        </p>
      </Show>
      <div class="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={busy()}
          class="rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
        >
          {busy() ? "Saving…" : "Save"}
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
