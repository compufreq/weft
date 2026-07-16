import { createSignal, For, Show } from "solid-js";
import type { ImportReport } from "~/lib/api";

interface ImportObject {
  properties: Record<string, unknown>;
  id?: string;
  vector?: number[];
}

/**
 * Parse pasted import text: a JSON array, one wrapped `{objects: [...]}`, or
 * NDJSON (one JSON object per line). Each entry may be either a bare
 * properties object or `{ properties, id?, vector? }`.
 */
export function parseImportText(text: string): ImportObject[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to import.");

  let entries: unknown[];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Not one JSON document — try NDJSON below.
      parsed = undefined;
    }
    if (Array.isArray(parsed)) {
      entries = parsed;
    } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { objects?: unknown[] }).objects)) {
      entries = (parsed as { objects: unknown[] }).objects;
    } else if (parsed && typeof parsed === "object") {
      entries = [parsed];
    } else {
      entries = trimmed.split("\n").map((line, i) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          throw new Error(`Line ${i + 1} is not valid JSON.`);
        }
      });
    }
  } else {
    throw new Error("Paste a JSON array or NDJSON (one object per line).");
  }

  return entries.map((e, i) => {
    if (e === null || typeof e !== "object" || Array.isArray(e)) {
      throw new Error(`Entry ${i + 1} must be a JSON object.`);
    }
    const obj = e as Record<string, unknown>;
    // Accept exported shapes ({id, properties, …}) and bare property maps.
    if (obj.properties && typeof obj.properties === "object") {
      return {
        properties: obj.properties as Record<string, unknown>,
        id: typeof obj.id === "string" ? obj.id : undefined,
        vector: Array.isArray(obj.vector) ? (obj.vector as number[]) : undefined,
      };
    }
    return { properties: obj };
  });
}

/** Paste-to-import: JSON array / NDJSON in, per-item outcome report out. */
export default function ImportPanel(props: {
  onImport: (objects: ImportObject[]) => Promise<ImportReport>;
}) {
  const [text, setText] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [report, setReport] = createSignal<ImportReport | null>(null);
  const [busy, setBusy] = createSignal(false);

  const run = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setReport(null);
    let objects: ImportObject[];
    try {
      objects = parseImportText(text());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setBusy(true);
    try {
      setReport(await props.onImport(objects));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={run} aria-label="Import objects" class="space-y-3">
      <label class="block text-sm">
        <span class="block text-xs font-medium">
          Objects — JSON array or NDJSON (works with Weft's NDJSON export)
        </span>
        <textarea
          rows={10}
          spellcheck={false}
          placeholder={'[{ "title": "…" }, …]  or one JSON object per line'}
          class="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-3 font-mono text-xs leading-relaxed dark:border-zinc-700 dark:bg-zinc-950"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </label>
      <button
        type="submit"
        disabled={busy() || !text().trim()}
        class="rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
      >
        {busy() ? "Importing…" : "Import"}
      </button>

      <Show when={error()}>
        <p role="alert" class="text-sm text-red-700 dark:text-red-300">
          {error()}
        </p>
      </Show>
      <Show when={report()}>
        {(r) => (
          <div
            role="status"
            class="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p>
              <span class="font-medium text-green-700 dark:text-green-400">
                {r().inserted} inserted
              </span>
              <Show when={r().failed > 0}>
                <span class="ml-2 font-medium text-red-700 dark:text-red-400">
                  {r().failed} failed
                </span>
              </Show>
            </p>
            <Show when={r().errors.length > 0}>
              <ul class="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                <For each={r().errors}>
                  {(e) => (
                    <li>
                      <span class="font-mono">#{e.index}</span> — {e.message}
                    </li>
                  )}
                </For>
                <Show when={r().errors_truncated}>
                  <li class="text-zinc-400">… more errors truncated</li>
                </Show>
              </ul>
            </Show>
          </div>
        )}
      </Show>
    </form>
  );
}
