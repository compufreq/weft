import { createSignal, For, Show } from "solid-js";

const DATA_TYPES = ["text", "int", "number", "boolean", "date", "text[]", "uuid"];

/** Inline "add property" form for an existing collection. */
export function AddPropertyForm(props: {
  onAdd: (property: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = createSignal("");
  const [dataType, setDataType] = createSignal("text");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await props.onAdd({ name: name().trim(), dataType: [dataType()] });
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label="Add property" class="flex flex-wrap items-end gap-2">
      <label class="text-sm">
        <span class="block text-xs font-medium">Property name</span>
        <input
          required
          placeholder="summary"
          class="mt-1 w-40 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
      </label>
      <label class="text-sm">
        <span class="block text-xs font-medium">Type</span>
        <select
          class="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={dataType()}
          onChange={(e) => setDataType(e.currentTarget.value)}
        >
          <For each={DATA_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
        </select>
      </label>
      <button
        type="submit"
        disabled={busy() || !name().trim()}
        class="rounded-lg bg-weft-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
      >
        {busy() ? "Adding…" : "Add property"}
      </button>
      <Show when={error()}>
        <p role="alert" class="w-full text-sm text-red-700 dark:text-red-300">
          {error()}
        </p>
      </Show>
    </form>
  );
}

/**
 * Typed-confirmation collection delete: the button only arms once the user
 * types the collection name (native confirm dialogs are not enough for
 * "drops all objects" destructiveness).
 */
export function DeleteCollection(props: {
  collectionName: string;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = createSignal(false);
  const [typed, setTyped] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const armed = () => typed() === props.collectionName;

  return (
    <div>
      <Show
        when={open()}
        fallback={
          <button
            type="button"
            onClick={() => setOpen(true)}
            class="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
          >
            Delete collection…
          </button>
        }
      >
        <form
          aria-label="Confirm collection deletion"
          class="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950"
          onSubmit={(e) => {
            e.preventDefault();
            if (!armed()) return;
            setError(null);
            setBusy(true);
            props
              .onDelete()
              .catch((err) => {
                setError(err instanceof Error ? err.message : String(err));
              })
              .finally(() => setBusy(false));
          }}
        >
          <p class="text-sm text-red-800 dark:text-red-200">
            This deletes <strong>{props.collectionName}</strong> and{" "}
            <strong>every object in it</strong>. Type the collection name to confirm.
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <input
              aria-label="Type the collection name to confirm"
              placeholder={props.collectionName}
              class="w-48 rounded-lg border border-red-300 bg-white px-2 py-1.5 text-sm dark:border-red-800 dark:bg-zinc-950"
              value={typed()}
              onInput={(e) => setTyped(e.currentTarget.value)}
            />
            <button
              type="submit"
              disabled={!armed() || busy()}
              class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy() ? "Deleting…" : "Delete forever"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
              class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
            >
              Cancel
            </button>
          </div>
          <Show when={error()}>
            <p role="alert" class="mt-2 text-sm text-red-800 dark:text-red-200">
              {error()}
            </p>
          </Show>
        </form>
      </Show>
    </div>
  );
}
