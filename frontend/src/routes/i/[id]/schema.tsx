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

      <h1 id="schema-heading" class="mt-2 text-2xl font-semibold tracking-tight">
        Schema
      </h1>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Collections on <code class="text-xs">{params.id}</code>.
      </p>

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
          <Show when={schema()}>{(s) => <SchemaTable classes={s().classes} />}</Show>
        </ErrorBoundary>
      </div>
    </section>
  );
}
