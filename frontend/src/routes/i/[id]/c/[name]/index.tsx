import { A, createAsync, query, revalidate, useNavigate, useParams } from "@solidjs/router";
import { ErrorBoundary, Show } from "solid-js";
import { useAuth } from "~/components/AuthGate";
import { AddPropertyForm, DeleteCollection } from "~/components/schema/CollectionActions";
import PropertyTable from "~/components/schema/PropertyTable";
import { api } from "~/lib/api";

// Same cache key as the schema page — one fetch serves both.
const getSchema = query((instanceId: string) => api.schema(instanceId), "schema");

export const route = {
  preload: ({ params }: { params: { id: string } }) => getSchema(params.id),
};

export default function ClassDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const schema = createAsync(() => getSchema(params.id ?? ""));
  const cls = () => schema()?.classes.find((c) => c.class === params.name);
  const auth = useAuth();
  const readOnly = () => auth?.status()?.read_only ?? false;

  return (
    <section aria-labelledby="class-heading">
      <nav aria-label="Breadcrumb" class="text-sm text-zinc-500 dark:text-zinc-400">
        <A href="/" class="hover:text-weft-600 dark:hover:text-weft-400">
          Instances
        </A>
        <span aria-hidden="true"> / </span>
        <A
          href={`/i/${params.id}/schema`}
          class="hover:text-weft-600 dark:hover:text-weft-400"
        >
          {params.id}
        </A>
        <span aria-hidden="true"> / </span>
        <span class="text-zinc-900 dark:text-zinc-100">{params.name}</span>
      </nav>

      <ErrorBoundary
        fallback={(err) => (
          <div
            role="alert"
            class="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            <p class="font-medium">Could not load collection</p>
            <p class="mt-1">{err instanceof Error ? err.message : String(err)}</p>
          </div>
        )}
      >
        <Show
          when={cls()}
          fallback={
            <Show when={schema()}>
              <p class="mt-6 rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                Collection <code>{params.name}</code> was not found on this instance.
              </p>
            </Show>
          }
        >
          {(c) => (
            <>
              <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap items-center gap-3">
                  <h1 id="class-heading" class="text-2xl font-semibold tracking-tight">
                    {c().class}
                  </h1>
                  <Show when={c().multiTenancyConfig?.enabled}>
                    <span class="rounded-full bg-weft-50 px-2 py-0.5 text-xs font-medium text-weft-700 dark:bg-weft-700/20 dark:text-weft-400">
                      multi-tenant
                    </span>
                  </Show>
                </div>
                <div class="flex gap-2">
                  <Show when={c().multiTenancyConfig?.enabled}>
                    <A
                      href={`/i/${params.id}/c/${encodeURIComponent(c().class)}/tenants`}
                      class="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:border-weft-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-weft-500"
                    >
                      Tenants
                    </A>
                  </Show>
                  <A
                    href={`/i/${params.id}/c/${encodeURIComponent(c().class)}/objects`}
                    class="rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700"
                  >
                    Browse objects →
                  </A>
                </div>
              </div>
              <Show when={c().description}>
                <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{c().description}</p>
              </Show>

              <dl class="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <dt class="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Vectorizer
                  </dt>
                  <dd class="mt-1 font-medium">
                    <code class="text-sm">{c().vectorizer ?? "—"}</code>
                  </dd>
                </div>
                <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <dt class="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Vector index
                  </dt>
                  <dd class="mt-1 font-medium">
                    <code class="text-sm">{c().vectorIndexType ?? "—"}</code>
                  </dd>
                </div>
                <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <dt class="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Properties
                  </dt>
                  <dd class="mt-1 font-medium">{c().properties.length}</dd>
                </div>
              </dl>

              <h2 class="mt-8 text-lg font-semibold tracking-tight">Properties</h2>
              <div class="mt-3">
                <PropertyTable properties={c().properties} />
              </div>
              <Show when={!readOnly()}>
                <div class="mt-4">
                  <AddPropertyForm
                    onAdd={async (property) => {
                      await api.addProperty(params.id ?? "", c().class, property);
                      await revalidate(getSchema.keyFor(params.id ?? ""));
                    }}
                  />
                </div>
              </Show>

              <details class="mt-8">
                <summary class="cursor-pointer text-sm font-medium text-weft-600 dark:text-weft-400">
                  Raw definition (JSON)
                </summary>
                <pre class="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
                  {JSON.stringify(c(), null, 2)}
                </pre>
              </details>

              <Show when={!readOnly()}>
                <div class="mt-8">
                  <DeleteCollection
                    collectionName={c().class}
                    onDelete={async () => {
                      await api.deleteCollection(params.id ?? "", c().class);
                      await revalidate(getSchema.keyFor(params.id ?? ""));
                      navigate(`/i/${params.id}/schema`);
                    }}
                  />
                </div>
              </Show>
            </>
          )}
        </Show>
      </ErrorBoundary>
    </section>
  );
}
