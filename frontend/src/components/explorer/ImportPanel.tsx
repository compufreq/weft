import { createSignal, For, Show } from "solid-js";
import type { ImportReport, Property } from "~/lib/api";

interface ImportObject {
  properties: Record<string, unknown>;
  id?: string;
  vector?: number[];
}

/**
 * Parse CSV text into rows of fields per RFC 4180: comma-separated, optional
 * double-quoted fields, `""` escapes a quote inside a quoted field, CRLF or
 * LF line endings. Dependency-free.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      pushField();
      i += 1;
    } else if (c === "\n") {
      pushRow();
      i += 1;
    } else if (c === "\r") {
      // CRLF (or a stray CR) ends the line.
      pushRow();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (inQuotes) throw new Error("Unclosed quote in CSV.");
  // Flush the last line unless the text ended with a newline.
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

/**
 * Convert CSV text into import objects. The header row names the properties;
 * values are coerced using the collection schema (`int`, `number`,
 * `boolean` — everything else stays text). Two special columns: `id` (object
 * UUID) and `vector` (a JSON number array — quote it in the CSV). Empty
 * cells are omitted.
 */
export function parseCsvObjects(text: string, properties: Property[]): ImportObject[] {
  const rows = parseCsvRows(text.trim());
  if (rows.length < 2) {
    throw new Error("CSV needs a header row and at least one data row.");
  }
  const header = rows[0].map((h) => h.trim());
  if (header.some((h) => h === "")) throw new Error("CSV header has an empty column name.");
  const typeOf = (name: string) =>
    properties.find((p) => p.name === name)?.dataType[0] ?? "text";

  return rows.slice(1).map((cells, r) => {
    const rowNo = r + 2; // 1-based, counting the header
    if (cells.length !== header.length) {
      throw new Error(
        `Row ${rowNo} has ${cells.length} fields, header has ${header.length}.`,
      );
    }
    const obj: ImportObject = { properties: {} };
    header.forEach((name, c) => {
      const raw = cells[c];
      if (raw === "") return; // omit empty cells
      if (name === "id") {
        obj.id = raw.trim();
        return;
      }
      if (name === "vector") {
        let v: unknown;
        try {
          v = JSON.parse(raw);
        } catch {
          v = undefined;
        }
        if (!Array.isArray(v) || v.some((x) => typeof x !== "number")) {
          throw new Error(
            `Row ${rowNo}: "vector" must be a JSON number array, e.g. "[0.1, 0.2]".`,
          );
        }
        obj.vector = v as number[];
        return;
      }
      switch (typeOf(name)) {
        case "int": {
          const n = Number(raw.trim());
          if (!Number.isInteger(n)) {
            throw new Error(`Row ${rowNo}: "${raw}" is not an integer for "${name}".`);
          }
          obj.properties[name] = n;
          break;
        }
        case "number": {
          const n = Number(raw.trim());
          if (Number.isNaN(n)) {
            throw new Error(`Row ${rowNo}: "${raw}" is not a number for "${name}".`);
          }
          obj.properties[name] = n;
          break;
        }
        case "boolean": {
          const b = raw.trim().toLowerCase();
          if (b !== "true" && b !== "false") {
            throw new Error(`Row ${rowNo}: "${raw}" is not true/false for "${name}".`);
          }
          obj.properties[name] = b === "true";
          break;
        }
        default:
          obj.properties[name] = raw;
      }
    });
    return obj;
  });
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

/**
 * Paste- or file-to-import: JSON array / NDJSON / CSV in, per-item outcome
 * report out. CSV is detected by the first character (JSON starts with `[`
 * or `{`) and parsed client-side against the collection schema.
 */
export default function ImportPanel(props: {
  onImport: (objects: ImportObject[]) => Promise<ImportReport>;
  /** Collection schema properties — used to type CSV cells. */
  properties?: Property[];
}) {
  const [text, setText] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [report, setReport] = createSignal<ImportReport | null>(null);
  const [busy, setBusy] = createSignal(false);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setText(await file.text());
  };

  const run = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setReport(null);
    let objects: ImportObject[];
    try {
      const trimmed = text().trim();
      objects =
        trimmed.startsWith("[") || trimmed.startsWith("{")
          ? parseImportText(text())
          : parseCsvObjects(text(), props.properties ?? []);
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
          Objects — JSON array, NDJSON (works with Weft's NDJSON export), or
          CSV with a header row
        </span>
        <textarea
          rows={10}
          spellcheck={false}
          placeholder={'[{ "title": "…" }, …]  ·  one JSON object per line  ·  CSV: title,category'}
          class="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-3 font-mono text-xs leading-relaxed dark:border-zinc-700 dark:bg-zinc-950"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </label>
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy() || !text().trim()}
          class="rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
        >
          {busy() ? "Importing…" : "Import"}
        </button>
        <label class="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          … or load a file
          <input
            type="file"
            accept=".csv,.json,.ndjson,.jsonl,text/csv,application/json"
            class="ml-2 text-xs file:mr-2 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:border-weft-400 dark:file:border-zinc-700 dark:file:bg-zinc-900"
            onChange={(e) => void loadFile(e.currentTarget.files?.[0])}
          />
        </label>
      </div>

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
