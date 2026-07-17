import { A, useParams, useSearchParams } from "@solidjs/router";
import { createSignal, Match, onMount, Show, Switch } from "solid-js";
import { useAuth } from "~/components/AuthGate";
import AggregatePanel from "~/components/explorer/AggregatePanel";
import ImportPanel from "~/components/explorer/ImportPanel";
import ObjectEditor from "~/components/explorer/ObjectEditor";
import FilterBuilder, {
  emptyGroup,
  toWhereFilter,
  type FilterGroup,
} from "~/components/explorer/FilterBuilder";
import ObjectsTable from "~/components/explorer/ObjectsTable";
import SearchResults from "~/components/explorer/SearchResults";
import VectorMap, { type MapPoint } from "~/components/explorer/VectorMap";
import {
  api,
  type AggregateResult,
  type Property,
  type SearchHit,
  type SearchInput,
  type WeaviateObject,
  type WhereFilter,
} from "~/lib/api";

type Mode = "browse" | "search" | "import" | "map";

const MAP_SAMPLE = 200;
type SearchKind = "bm25" | "hybrid" | "near_text" | "near_vector";

export default function ObjectsPage() {
  const params = useParams();
  const instanceId = () => params.id ?? "";
  const className = () => params.name ?? "";

  const [searchParams] = useSearchParams();
  const [mode, setMode] = createSignal<Mode>("browse");
  const auth = useAuth();
  const readOnly = () => auth?.status()?.read_only ?? false;
  // null = closed, "new" = create, otherwise the object being edited.
  const [editing, setEditing] = createSignal<"new" | WeaviateObject | SearchHit | null>(null);
  const [writeError, setWriteError] = createSignal<string | null>(null);
  // Deep-linkable: /objects?tenant=acme preselects the tenant.
  const initialTenant = typeof searchParams.tenant === "string" ? searchParams.tenant : "";
  const [tenant, setTenant] = createSignal(initialTenant);
  const [selected, setSelected] = createSignal<WeaviateObject | SearchHit | null>(null);

  // --- filter state (shared by browse, search, aggregate) ---
  const [properties, setProperties] = createSignal<Property[]>([]);
  const [filterGroup, setFilterGroup] = createSignal<FilterGroup>(emptyGroup());

  /** Group tree → typed filter, or undefined when empty. Throws on bad input. */
  const buildFilter = (): WhereFilter | undefined =>
    toWhereFilter(filterGroup(), properties());

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

  // --- vector map state ---
  const [mapPoints, setMapPoints] = createSignal<MapPoint[] | null>(null);
  const [mapError, setMapError] = createSignal<string | null>(null);
  const [mapLoading, setMapLoading] = createSignal(false);

  const loadMap = async () => {
    setMapLoading(true);
    setMapError(null);
    try {
      const page = await api.objects(instanceId(), className(), {
        limit: MAP_SAMPLE,
        tenant: tenant() || undefined,
        includeVector: true,
      });
      const withVectors = page.objects.filter(
        (o) => Array.isArray(o.vector) && o.vector.length > 1,
      );
      // Color by the text property that looks most like a facet: the one
      // with the fewest distinct values (but more than one, at most 10).
      let groupProp: string | undefined;
      let best = Number.POSITIVE_INFINITY;
      for (const p of properties().filter((p) => p.dataType[0] === "text")) {
        const distinct = new Set(
          withVectors.map((o) => String(o.properties[p.name] ?? "")),
        ).size;
        if (distinct > 1 && distinct <= 10 && distinct < best) {
          best = distinct;
          groupProp = p.name;
        }
      }
      const points: MapPoint[] = withVectors.map((o) => ({
        id: o.id,
        vector: o.vector as number[],
        label: String(Object.values(o.properties)[0] ?? o.id).slice(0, 60) || o.id,
        group: groupProp ? String(o.properties[groupProp] ?? "") : undefined,
      }));
      if (points.length === 0) {
        setMapError(
          "No vectors found — this collection may have no vector index, or objects were inserted without vectors.",
        );
        setMapPoints(null);
      } else {
        setMapPoints(points);
      }
    } catch (err) {
      setMapError(err instanceof Error ? err.message : String(err));
      setMapPoints(null);
    } finally {
      setMapLoading(false);
    }
  };

  // --- write path (hidden on read-only deployments) ---
  const saveObject = async (properties: Record<string, unknown>) => {
    const current = editing();
    if (current === "new") {
      await api.createObject(instanceId(), className(), {
        properties,
        tenant: tenant() || undefined,
      });
    } else if (current) {
      await api.replaceObject(instanceId(), className(), current.id, {
        properties,
        tenant: tenant() || undefined,
      });
    }
    setEditing(null);
    setSelected(null);
    await loadPage(true);
  };

  const deleteObject = async (obj: WeaviateObject | SearchHit) => {
    if (!confirm(`Delete object ${obj.id}? This cannot be undone.`)) return;
    setWriteError(null);
    try {
      await api.deleteObject(instanceId(), className(), obj.id, tenant() || undefined);
      setSelected(null);
      await loadPage(true);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    }
  };

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
          <Show when={!readOnly()}>
            <button
              type="button"
              onClick={() => setEditing("new")}
              class="rounded-lg bg-weft-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-weft-700"
            >
              New object
            </button>
          </Show>
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
        <button
          role="tab"
          aria-selected={mode() === "map"}
          onClick={() => {
            setMode("map");
            if (!mapPoints() && !mapLoading()) void loadMap();
          }}
          class={`rounded-t-lg px-4 py-2 text-sm font-medium ${
            mode() === "map"
              ? "border-b-2 border-weft-500 text-weft-600 dark:text-weft-400"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          Map
        </button>
        <Show when={!readOnly()}>
          <button
            role="tab"
            aria-selected={mode() === "import"}
            onClick={() => setMode("import")}
            class={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              mode() === "import"
                ? "border-b-2 border-weft-500 text-weft-600 dark:text-weft-400"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            Import
          </button>
        </Show>
      </div>

      <Show when={writeError()}>
        <div
          role="alert"
          class="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {writeError()}
        </div>
      </Show>

      <div class="mt-4">
        <FilterBuilder
          properties={properties()}
          group={filterGroup()}
          onChange={setFilterGroup}
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

            <Match when={mode() === "map"}>
              <Show when={mapError()}>
                <div
                  role="alert"
                  class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                >
                  {mapError()}
                </div>
              </Show>
              <Show when={mapLoading()}>
                <p class="text-sm text-zinc-500">Projecting vectors…</p>
              </Show>
              <Show when={mapPoints()}>
                {(points) => (
                  <VectorMap
                    points={points()}
                    selectedId={selected()?.id ?? null}
                    onSelect={(id) => {
                      void (async () => {
                        try {
                          setSelected(await api.getObject(instanceId(), className(), id, tenant() || undefined));
                        } catch {
                          // Selection is best-effort; the map itself still works.
                        }
                      })();
                    }}
                  />
                )}
              </Show>
            </Match>

            <Match when={mode() === "import"}>
              <ImportPanel
                properties={properties()}
                onImport={(objects) =>
                  api
                    .importObjects(instanceId(), className(), {
                      objects,
                      tenant: tenant() || undefined,
                    })
                    .then((report) => {
                      void loadPage(true);
                      return report;
                    })
                }
              />
            </Match>
          </Switch>
        </div>

        <div aria-label="Object detail" class="min-w-0">
          <Switch>
            <Match when={editing() === "new"}>
              <ObjectEditor
                heading="New object"
                onSave={saveObject}
                onCancel={() => setEditing(null)}
              />
            </Match>
            <Match when={editing() && editing() !== "new"}>
              <ObjectEditor
                heading="Edit object"
                initial={(editing() as WeaviateObject).properties}
                onSave={saveObject}
                onCancel={() => setEditing(null)}
              />
            </Match>
            <Match when={selected()}>
              {(sel) => (
                <div class="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <div class="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                    <h2 class="text-sm font-medium">Object</h2>
                    <div class="flex items-center gap-1.5">
                      <Show when={!readOnly()}>
                        <button
                          type="button"
                          onClick={() => setEditing(sel())}
                          class="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:border-weft-400 dark:border-zinc-700 dark:hover:border-weft-500"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteObject(sel())}
                          class="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                        >
                          Delete
                        </button>
                      </Show>
                      <button
                        type="button"
                        aria-label="Close detail"
                        onClick={() => setSelected(null)}
                        class="rounded px-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                      >
                        ×
                      </button>
                    </div>
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
            </Match>
            <Match when={true}>
              <p class="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-400">
                Select an object to inspect it.
              </p>
            </Match>
          </Switch>
        </div>
      </div>
    </section>
  );
}
