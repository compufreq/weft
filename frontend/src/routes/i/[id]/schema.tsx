import { createAsync, query, useParams, A } from "@solidjs/router";
import { ErrorBoundary, Show } from "solid-js";
import SchemaTable from "~/components/schema/SchemaTable";
import { api } from "~/lib/api";

const getSchema = query((instanceId: string) => api.schema(instanceId), "schema");

export const route = {
  preload: ({ params }: { params: { id: string } }) => getSchema(params.id),
};

export default function SchemaPage() {
  const params = useParams();
  const schema = createAsync(() => getSchema(params.id ?? ""));

  return (
    <section aria-labelledby="schema-heading">
      <nav aria-label="Breadcrumb" class="text-sm text-zinc-500 dark:text-zinc-400">
        <A href="/" class="hover:text-weft-600 dark:hover:text-weft-400">
          Instances
        </A>
        <span aria-hidden="true"> / </span>
        <span class="text-zinc-900 dark:text-zinc-100">{params.id}</span>
      </nav>

      <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="schema-heading" class="text-2xl font-semibold tracking-tight">
            Schema
          </h1>
          <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Collections on <code class="text-xs">{params.id}</code>. Click a collection for
            details.
          </p>
        </div>
        <div class="flex gap-2">
          <a
            href={api.exportUrl(params.id ?? "")}
            download={`weft-schema-${params.id}.json`}
            class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:border-weft-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-weft-500"
          >
            Export JSON
          </a>
          <A
            href={`/i/${params.id}/diff`}
            class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:border-weft-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-weft-500"
          >
            Compare…
          </A>
        </div>
      </div>

      <div class="mt-6">
        <ErrorBoundary
          fallback={(err) => (
            <div
              role="alert"
              class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
            >
              <p class="font-medium">Could not load schema</p>
              <p class="mt-1">{err instanceof Error ? err.message : String(err)}</p>
            </div>
          )}
        >
          <Show when={schema()}>
            {(s) => <SchemaTable classes={s().classes} instanceId={params.id ?? ""} />}
          </Show>
        </ErrorBoundary>
      </div>
    </section>
  );
}
