import { For, Show } from "solid-js";
import type { FilterValueType, Property, WhereOperator } from "~/lib/api";

/** One editable filter row: raw text value, converted on submit. */
export interface FilterRow {
  path: string;
  operator: WhereOperator;
  raw: string;
}

const TEXT_OPS: WhereOperator[] = ["Equal", "NotEqual", "Like", "ContainsAny", "IsNull"];
const NUMERIC_OPS: WhereOperator[] = [
  "Equal",
  "NotEqual",
  "GreaterThan",
  "GreaterThanEqual",
  "LessThan",
  "LessThanEqual",
  "IsNull",
];
const BOOL_OPS: WhereOperator[] = ["Equal", "NotEqual", "IsNull"];

/** Map a Weaviate dataType to the filter value type (primitive types only). */
export function valueTypeFor(dataType: string | undefined): FilterValueType {
  switch (dataType) {
    case "int":
      return "int";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    default:
      return "text";
  }
}

export function operatorsFor(dataType: string | undefined): WhereOperator[] {
  switch (valueTypeFor(dataType)) {
    case "int":
    case "number":
    case "date":
      return NUMERIC_OPS;
    case "boolean":
      return BOOL_OPS;
    default:
      return TEXT_OPS;
  }
}

/** Convert a row's raw text into a typed condition value. Throws on bad numbers. */
export function rowValue(row: FilterRow, vtype: FilterValueType): unknown {
  if (row.operator === "IsNull") return true;
  if (row.operator === "ContainsAny" || row.operator === "ContainsAll") {
    return row.raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  switch (vtype) {
    case "int": {
      const n = Number.parseInt(row.raw, 10);
      if (Number.isNaN(n)) throw new Error(`"${row.raw}" is not an integer`);
      return n;
    }
    case "number": {
      const n = Number.parseFloat(row.raw);
      if (Number.isNaN(n)) throw new Error(`"${row.raw}" is not a number`);
      return n;
    }
    case "boolean":
      return row.raw === "true";
    default:
      return row.raw;
  }
}

/**
 * Structured where-filter rows (flat AND). Property + operator dropdowns are
 * driven by the collection's schema so value types always match.
 */
export default function FilterBuilder(props: {
  properties: Property[];
  rows: FilterRow[];
  onChange: (rows: FilterRow[]) => void;
  onApply: () => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<FilterRow>) => {
    props.onChange(props.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const propType = (path: string) =>
    props.properties.find((p) => p.name === path)?.dataType[0];

  const addRow = () => {
    const first = props.properties[0];
    if (!first) return;
    props.onChange([
      ...props.rows,
      { path: first.name, operator: operatorsFor(first.dataType[0])[0], raw: "" },
    ]);
  };

  return (
    <fieldset class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <legend class="px-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Filters (AND)
      </legend>
      <div class="space-y-2">
        <For each={props.rows}>
          {(row, i) => (
            <div class="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Filter ${i() + 1} property`}
                class="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                value={row.path}
                onChange={(e) => {
                  const path = e.currentTarget.value;
                  update(i(), { path, operator: operatorsFor(propType(path))[0], raw: "" });
                }}
              >
                <For each={props.properties}>
                  {(p) => <option value={p.name}>{p.name}</option>}
                </For>
              </select>
              <select
                aria-label={`Filter ${i() + 1} operator`}
                class="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                value={row.operator}
                onChange={(e) =>
                  update(i(), { operator: e.currentTarget.value as WhereOperator })
                }
              >
                <For each={operatorsFor(propType(row.path))}>
                  {(op) => <option value={op}>{op}</option>}
                </For>
              </select>
              <Show when={row.operator !== "IsNull"}>
                <Show
                  when={valueTypeFor(propType(row.path)) === "boolean"}
                  fallback={
                    <input
                      aria-label={`Filter ${i() + 1} value`}
                      placeholder={
                        row.operator === "ContainsAny" || row.operator === "ContainsAll"
                          ? "a, b, c"
                          : "value"
                      }
                      class="w-44 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      value={row.raw}
                      onInput={(e) => update(i(), { raw: e.currentTarget.value })}
                    />
                  }
                >
                  <select
                    aria-label={`Filter ${i() + 1} value`}
                    class="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    value={row.raw || "true"}
                    onChange={(e) => update(i(), { raw: e.currentTarget.value })}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </Show>
              </Show>
              <button
                type="button"
                aria-label={`Remove filter ${i() + 1}`}
                onClick={() => props.onChange(props.rows.filter((_, j) => j !== i()))}
                class="rounded px-2 py-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
              >
                ×
              </button>
            </div>
          )}
        </For>
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            disabled={props.properties.length === 0}
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:border-weft-400 disabled:opacity-50 dark:border-zinc-700 dark:hover:border-weft-500"
          >
            + Add filter
          </button>
          <Show when={props.rows.length > 0}>
            <button
              type="button"
              onClick={() => props.onApply()}
              disabled={props.disabled}
              class="rounded-lg bg-weft-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-weft-700 disabled:opacity-50"
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={() => {
                props.onChange([]);
                props.onApply();
              }}
              class="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Clear
            </button>
          </Show>
        </div>
      </div>
    </fieldset>
  );
}
