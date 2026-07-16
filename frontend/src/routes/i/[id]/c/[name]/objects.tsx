import { A, useParams, useSearchParams } from "@solidjs/router";
import { createSignal, Match, onMount, Show, Switch } from "solid-js";
import AggregatePanel from "~/components/explorer/AggregatePanel";
import FilterBuilder, {
  rowValue,
  valueTypeFor,
  type FilterRow,
} from "~/components/explorer/FilterBuilder";
import ObjectsTable from "~/components/explorer/ObjectsTable";
import SearchResults from "~/components/explorer/SearchResults";
import {
  api,
  type AggregateResult,
  type Property,
  type SearchHit,
  type SearchInput,
  type WeaviateObject,
  type WhereFilter,
} from "~/lib/api";

type Mode = "browse" | "search";
type SearchKind = "bm25" | "hybrid" | "near_text" | "near_vector";

export default function ObjectsPage() {
  const params = useParams();
  const instanceId = () => params.id ?? "";
  const className = () => params.name ?? "";

  const [searchParams] = useSearchParams();
  const [mode, setMode] = createSignal<Mode>("browse");
  // Deep-linkable: /objects?tenant=acme preselects the tenant.
  const initialTenant = typeof searchParams.tenant === "string" ? searchParams.tenant : "";
  const [tenant, setTenant] = createSignal(initialTenant);
  const [selected, setSelected] = createSignal<WeaviateObject | SearchHit | null>(null);

  // --- filter state (shared by browse, search, aggregate) ---
  const [properties, setProperties] = createSignal<Property[]>([]);
  const [filterRows, setFilterRows] = createSignal<FilterRow[]>([]);

  /** Rows → typed filter, or undefined when no filters. Throws on bad input. */
  const buildFilter = (): WhereFilter | undefined => {
    const rows = filterRows();
    if (rows.length === 0) return undefined;
    return {
      conditions: rows.map((row) => {
        const vtype = valueTypeFor(
          properties().find((p) => p.name === row.path)?.dataType[0],
        );
        return {
          path: row.path,
          operator: row.operator,
          value: rowValue(row, vtype),
          value_type: vtype,
        };
      }),
    };
  };

  // --- browse state: accumulated pages ---
  const [objects, setObjects] = createSignal<WeaviateObject[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [exhausted, setExhausted] = createSignal(false);
  const [browseError, setBrowseError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  // --- aggregate state ---
  const [groupBy, setGroupBy] = createSignal("");
  const [aggResult, setAggResult] = createSignal<AggregateResult | null>(null);
  const [aggLoading, setAggLoading] = createSignal(false);

  const runAggregate = async (filter: WhereFilter | undefined) => {
    setAggLoading(true);
    try {
      setAggResult(
        await api.aggregate(instanceId(), className(), {
          tenant: tenant() || undefined,
          where: filter,
          group_by: groupBy() || undefined,
        }),
      );
    } catch {
      // Aggregations are auxiliary — browse errors already surface below.
      setAggResult(null);
    } finally {
      setAggLoading(false);
    }
  };

  const loadPage = async (reset: boolean) => {
    setLoading(true);
    setBrowseError(null);
    try {
      const filter = buildFilter();
      const page = await api.objects(instanceId(), className(), {
        limit: 25,
        cursor: reset ? undefined : (cursor() ?? undefined),
        tenant: tenant() || undefined,
        where: filter,
      });
      setObjects(reset ? page.objects : [...objects(), ...page.objects]);
      setCursor(page.next_cursor);
      setExhausted(page.next_cursor === null);
      if (reset) void runAggregate(filter);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : String(err));
      if (reset) setObjects([]);
    } finally {
      setLoading(false);
    }
  };

  // Initial load is client-only (the data grid mutates signals as it pages;
  // the schema pages remain the SSR showcase).
  onMount(() => {
    void loadPage(true);
    void (async () => {
      try {
        const schema = await api.schema(instanceId());
        const cls = schema.classes.find((c) => c.class === className());
        // Primitive types only (lowercase by Weaviate convention) — those are
        // the filterable ones.
        setProperties(
          (cls?.properties ?? []).filter((p) =>
            /^[a-z]/.test(p.dataType[0] ?? ""),
          ),
        );
      } catch {
        // No schema → filter builder simply stays empty.
      }
    })();
  });

  // --- search state ---
  const [kind, setKind] = createSignal<SearchKind>("bm25");
  const [query, setQuery] = createSignal("");
  const [vectorText, setVectorText] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[] | null>(null);
  const [searchError, setSearchError] = createSignal<string | null>(null);
  const [searching, setSearching] = createSignal(false);

  const runSearch = async (e: Event) => {
    e.preventDefault();
    setSearching(true);
    setSearchError(null);
    setHits(null);
    try {
      let input: SearchInput;
      const common = {
        limit: 25,
        tenant: tenant() || undefined,
        where: buildFilter(),
      };
      const parseVector = (): number[] => {
        const v = JSON.parse(vectorText());
        if (!Array.isArray(v) || v.some((x) => typeof x !== "number")) {
          throw new Error("Vector must be a JSON array of numbers, e.g. [0.1, 0.2]");
        }
        return v as number[];
      };
      switch (kind()) {
        case "bm25":
          input = { kind: "bm25", query: query(), ...common };
          break;
        case "near_text":
          input = { kind: "near_text", query: query(), ...common };
          break;
        case "near_vector":
          input = { kind: "near_vector", vector: parseVector(), ...common };
          break;
        case "hybrid":
          input = {
            kind: "hybrid",
            query: query(),
            vector: vectorText().trim() ? parseVector() : undefined,
            ...common,
          };
          break;
      }
      const res = await api.search(instanceId(), className(), input);
      setHits(res.results);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const needsQuery = () => kind() !== "near_vector";
  const needsVector = () => kind() === "near_vector" || kind() === "hybrid";

  return (
    <section aria-labelledby="objects-heading">
      <nav aria-label="Breadcrumb" class="text-sm text-zinc-500 dark:text-zinc-400">
        <A href="/" class="hover:text-weft-600 dark:hover:text-weft-400">
          Instances
        </A>
        <span aria-hidden="true"> / </span>
        <A
          href={`/i/${instanceId()}/schema`}
          class="hover:text-weft-600 dark:hover:text-weft-400"
        >
          {instanceId()}
        </A>
        <span aria-hidden="true"> / </span>
        <A
          href={`/i/${instanceId()}/c/${className()}`}
          class="hover:text-weft-600 dark:hover:text-weft-400"
        >
          {className()}
        </A>
        <span aria-hidden="true"> / </span>
        <span class="text-zinc-900 dark:text-zinc-100">objects</span>
      </nav>

      <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 id="objects-heading" class="text-2xl font-semibold tracking-tight">
          {className()} objects
        </h1>
        <div class="flex items-center gap-2">
          <input
            aria-label="Tenant (for multi-tenant collections)"
            placeholder="tenant (optional)"
            class="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={tenant()}
            onInput={(e) => setTenant(e.currentTarget.value)}
            onChange={() => void loadPage(true)}
          />
          <a
            href={api.exportObjectsUrl(instanceId(), className(), tenant() || undefined)}
            download={`weft-objects-${className()}.ndjson`}
            class="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:border-weft-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-weft-500"
          >
            Export NDJSON
          </a>
        </div>
      </div>

      <div role="tablist" aria-label="Explorer mode" class="mt-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <button
          role="tab"
          aria-selected={mode() === "browse"}
          onClick={() => setMode("browse")}
          class={`rounded-t-lg px-4 py-2 text-sm font-medium ${
            mode() === "browse"
              ? "border-b-2 border-weft-500 text-weft-600 dark:text-weft-400"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          Browse
        </button>
        <button
          role="tab"
          aria-selected={mode() === "search"}
          onClick={() => setMode("search")}
          class={`rounded-t-lg px-4 py-2 text-sm font-medium ${
            mode() === "search"
              ? "border-b-2 border-weft-500 text-weft-600 dark:text-weft-400"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          Search
        </button>
      </div>

      <div class="mt-4">
        <FilterBuilder
          properties={properties()}
          rows={filterRows()}
          onChange={setFilterRows}
          onApply={() => {
            if (mode() === "browse") void loadPage(true);
          }}
          disabled={loading()}
        />
      </div>

      {/* min-w-0: let each column shrink below content width so inner
          overflow-x-auto regions scroll instead of widening the page */}
      <div class="mt-6 grid gap-6 lg:grid-cols-[1fr_minmax(280px,380px)]">
        <div class="min-w-0">
          <Switch>
            <Match when={mode() === "browse"}>
              <div class="mb-4">
                <AggregatePanel
                  result={aggResult()}
                  groupBy={groupBy()}
                  groupable={properties()
                    .filter((p) => p.dataType[0] === "text")
                    .map((p) => p.name)}
                  onGroupBy={(prop) => {
                    setGroupBy(prop);
                    try {
                      void runAggregate(buildFilter());
                    } catch {
                      // bad filter row — count refreshes on next apply
                    }
                  }}
                  loading={aggLoading()}
                />
              </div>
              <Show when={browseError()}>
                <div
                  role="alert"
                  class="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                >
                  {browseError()}
                  <Show when={browseError()?.includes("tenant")}>
                    <p class="mt-1 text-xs">
                      This looks like a multi-tenant collection — set a tenant above.
                    </p>
                  </Show>
                </div>
              </Show>
              <Show
                when={!loading() || objects().length > 0}
                fallback={<p class="text-sm text-zinc-500">Loading…</p>}
              >
                <ObjectsTable
                  objects={objects()}
                  selectedId={selected() && "id" in selected()! ? selected()!.id : null}
                  onSelect={(o) => setSelected(o)}
                />
              </Show>
              <div class="mt-4 flex items-center gap-3">
                <Show when={!exhausted() && objects().length > 0}>
                  <button
                    type="button"
                    disabled={loading()}
                    onClick={() => void loadPage(false)}
                    class="rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
                  >
                    {loading() ? "Loading…" : "Load more"}
                  </button>
                </Show>
                <p class="text-xs text-zinc-500 dark:text-zinc-400" role="status">
                  {objects().length} loaded{exhausted() ? " · end of collection" : ""}
                </p>
              </div>
            </Match>

            <Match when={mode() === "search"}>
              <form onSubmit={runSearch} class="space-y-3">
                <div class="flex flex-wrap gap-3">
                  <label class="text-sm">
                    <span class="block text-xs font-medium">Mode</span>
                    <select
                      class="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      value={kind()}
                      onChange={(e) => setKind(e.currentTarget.value as SearchKind)}
                    >
                      <option value="bm25">BM25 (keyword)</option>
                      <option value="hybrid">Hybrid</option>
                      <option value="near_vector">nearVector</option>
                      <option value="near_text">nearText (needs vectorizer)</option>
                    </select>
                  </label>
                  <Show when={needsQuery()}>
                    <label class="min-w-56 flex-1 text-sm">
                      <span class="block text-xs font-medium">Query</span>
                      <input
                        required
                        class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        value={query()}
                        onInput={(e) => setQuery(e.currentTarget.value)}
                      />
                    </label>
                  </Show>
                </div>
                <Show when={needsVector()}>
                  <label class="block text-sm">
                    <span class="block text-xs font-medium">
                      Vector {kind() === "hybrid" ? "(optional)" : ""}
                    </span>
                    <input
                      placeholder="[0.1, 0.2, …]"
                      class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      value={vectorText()}
                      onInput={(e) => setVectorText(e.currentTarget.value)}
                    />
                  </label>
                </Show>
                <button
                  type="submit"
                  disabled={searching()}
                  class="rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
                >
                  {searching() ? "Searching…" : "Search"}
                </button>
              </form>

              <Show when={searchError()}>
                <div
                  role="alert"
                  class="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                >
                  {searchError()}
                </div>
              </Show>
              <Show when={hits()}>
                {(h) => (
                  <div class="mt-6">
                    <SearchResults hits={h()} onSelect={(hit) => setSelected(hit)} />
                  </div>
                )}
              </Show>
            </Match>
          </Switch>
        </div>

        <div aria-label="Object detail" class="min-w-0">
          <Show
            when={selected()}
            fallback={
              <p class="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-400">
                Select an object to inspect it.
              </p>
            }
          >
            {(sel) => (
              <div class="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div class="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                  <h2 class="text-sm font-medium">Object</h2>
                  <button
                    type="button"
                    aria-label="Close detail"
                    onClick={() => setSelected(null)}
                    class="rounded px-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    ×
                  </button>
                </div>
                {/* tabindex: keyboard users must be able to scroll the JSON */}
                <pre
                  tabindex="0"
                  role="region"
                  aria-label="Object JSON"
                  class="max-h-[32rem] overflow-auto p-4 text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-weft-500"
                >
                  {JSON.stringify(sel(), null, 2)}
                </pre>
              </div>
            )}
          </Show>
        </div>
      </div>
    </section>
  );
}
