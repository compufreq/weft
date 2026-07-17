import { For, Show } from "solid-js";
import type {
  FilterCombinator,
  FilterValueType,
  Property,
  WhereFilter,
  WhereOperator,
} from "~/lib/api";

/** One editable filter row: raw text value, converted on submit. */
export interface FilterRow {
  path: string;
  operator: WhereOperator;
  raw: string;
}

/** An editable group: rows + nested groups combined with one operator. */
export interface FilterGroup {
  combinator: FilterCombinator;
  rows: FilterRow[];
  groups: FilterGroup[];
}

/** Deepest group nesting the UI offers (the server caps at 5). */
export const MAX_GROUP_DEPTH = 3;

export const emptyGroup = (combinator: FilterCombinator = "And"): FilterGroup => ({
  combinator,
  rows: [],
  groups: [],
});

/** Total condition rows across the whole tree. */
export function countRows(group: FilterGroup): number {
  return group.rows.length + group.groups.reduce((n, g) => n + countRows(g), 0);
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
 * Convert an editable group tree into the API's `WhereFilter` shape.
 * Empty groups are pruned; returns undefined when nothing is set.
 * Throws on unparsable values (bad numbers).
 */
export function toWhereFilter(
  group: FilterGroup,
  properties: Property[],
): WhereFilter | undefined {
  const conditions = group.rows.map((row) => {
    const vtype = valueTypeFor(
      properties.find((p) => p.name === row.path)?.dataType[0],
    );
    return {
      path: row.path,
      operator: row.operator,
      value: rowValue(row, vtype),
      value_type: vtype,
    };
  });
  const groups = group.groups
    .map((g) => toWhereFilter(g, properties))
    .filter((g): g is WhereFilter => g !== undefined);
  if (conditions.length === 0 && groups.length === 0) return undefined;
  return { conditions, operator: group.combinator, groups };
}

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** One group's rows, nested groups, and controls. Recursive. */
function GroupEditor(props: {
  properties: Property[];
  group: FilterGroup;
  onChange: (group: FilterGroup) => void;
  /** "" for the root; "1", "1.2", … for nested groups. */
  path: string;
  depth: number;
}) {
  const rowLabel = (i: number) =>
    props.path ? `Group ${props.path} filter ${i + 1}` : `Filter ${i + 1}`;
  const patch = (partial: Partial<FilterGroup>) =>
    props.onChange({ ...props.group, ...partial });
  const updateRow = (i: number, partial: Partial<FilterRow>) =>
    patch({
      rows: props.group.rows.map((r, j) => (j === i ? { ...r, ...partial } : r)),
    });
  const propType = (path: string) =>
    props.properties.find((p) => p.name === path)?.dataType[0];

  const addRow = () => {
    const first = props.properties[0];
    if (!first) return;
    patch({
      rows: [
        ...props.group.rows,
        { path: first.name, operator: operatorsFor(first.dataType[0])[0], raw: "" },
      ],
    });
  };

  return (
    <div class="space-y-2">
      <Show when={props.group.rows.length + props.group.groups.length > 1}>
        <select
          aria-label={props.path ? `Group ${props.path} match mode` : "Match mode"}
          class={inputClass}
          value={props.group.combinator}
          onChange={(e) => patch({ combinator: e.currentTarget.value as FilterCombinator })}
        >
          <option value="And">Match all (AND)</option>
          <option value="Or">Match any (OR)</option>
        </select>
      </Show>
      <For each={props.group.rows}>
        {(row, i) => (
          <div class="flex flex-wrap items-center gap-2">
            <select
              aria-label={`${rowLabel(i())} property`}
              class={inputClass}
              value={row.path}
              onChange={(e) => {
                const path = e.currentTarget.value;
                updateRow(i(), {
                  path,
                  operator: operatorsFor(propType(path))[0],
                  raw: "",
                });
              }}
            >
              <For each={props.properties}>
                {(p) => <option value={p.name}>{p.name}</option>}
              </For>
            </select>
            <select
              aria-label={`${rowLabel(i())} operator`}
              class={inputClass}
              value={row.operator}
              onChange={(e) =>
                updateRow(i(), { operator: e.currentTarget.value as WhereOperator })
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
                    aria-label={`${rowLabel(i())} value`}
                    placeholder={
                      row.operator === "ContainsAny" || row.operator === "ContainsAll"
                        ? "a, b, c"
                        : "value"
                    }
                    class={`w-44 ${inputClass}`}
                    value={row.raw}
                    onInput={(e) => updateRow(i(), { raw: e.currentTarget.value })}
                  />
                }
              >
                <select
                  aria-label={`${rowLabel(i())} value`}
                  class={inputClass}
                  value={row.raw || "true"}
                  onChange={(e) => updateRow(i(), { raw: e.currentTarget.value })}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </Show>
            </Show>
            <button
              type="button"
              aria-label={`Remove ${rowLabel(i()).toLowerCase()}`}
              onClick={() =>
                patch({ rows: props.group.rows.filter((_, j) => j !== i()) })
              }
              class="rounded px-2 py-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
            >
              ×
            </button>
          </div>
        )}
      </For>
      <For each={props.group.groups}>
        {(sub, k) => {
          const subPath = props.path ? `${props.path}.${k() + 1}` : `${k() + 1}`;
          return (
            <div class="rounded-lg border border-dashed border-zinc-300 p-2 pl-3 dark:border-zinc-700">
              <div class="mb-1 flex items-center justify-between">
                <span class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Group {subPath}
                </span>
                <button
                  type="button"
                  aria-label={`Remove group ${subPath}`}
                  onClick={() =>
                    patch({ groups: props.group.groups.filter((_, j) => j !== k()) })
                  }
                  class="rounded px-2 py-0.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  ×
                </button>
              </div>
              <GroupEditor
                properties={props.properties}
                group={sub}
                onChange={(g) =>
                  patch({
                    groups: props.group.groups.map((x, j) => (j === k() ? g : x)),
                  })
                }
                path={subPath}
                depth={props.depth + 1}
              />
            </div>
          );
        }}
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
        <Show when={props.depth < MAX_GROUP_DEPTH}>
          <button
            type="button"
            aria-label={
              props.path ? `Add group inside group ${props.path}` : "Add group"
            }
            onClick={() =>
              patch({
                groups: [
                  ...props.group.groups,
                  emptyGroup(props.group.combinator === "And" ? "Or" : "And"),
                ],
              })
            }
            disabled={props.properties.length === 0}
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:border-weft-400 disabled:opacity-50 dark:border-zinc-700 dark:hover:border-weft-500"
          >
            + Add group
          </button>
        </Show>
      </div>
    </div>
  );
}

/**
 * Structured where-filter builder: rows and nested groups, each level
 * combined with AND or OR. Property + operator dropdowns are driven by the
 * collection's schema so value types always match.
 */
export default function FilterBuilder(props: {
  properties: Property[];
  group: FilterGroup;
  onChange: (group: FilterGroup) => void;
  onApply: () => void;
  disabled?: boolean;
}) {
  return (
    <fieldset class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <legend class="px-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Filters
      </legend>
      <div class="space-y-2">
        <GroupEditor
          properties={props.properties}
          group={props.group}
          onChange={props.onChange}
          path=""
          depth={1}
        />
        <Show when={countRows(props.group) > 0}>
          <div class="flex items-center gap-2">
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
                props.onChange(emptyGroup());
                props.onApply();
              }}
              class="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Clear
            </button>
          </div>
        </Show>
      </div>
    </fieldset>
  );
}
