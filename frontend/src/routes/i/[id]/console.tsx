import { A, useParams } from "@solidjs/router";
import GraphqlConsole from "~/components/console/GraphqlConsole";
import { api } from "~/lib/api";

/** Per-instance localStorage key, mirroring the Qdrant console's persistence. */
const storageKey = (id: string) => `weft.console.${id}`;

export default function ConsolePage() {
  const params = useParams();
  const instanceId = () => params.id ?? "";

  const initial = () => {
    try {
      return localStorage.getItem(storageKey(instanceId())) ?? "";
    } catch {
      return "";
    }
  };

  return (
    <section aria-labelledby="console-heading">
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
        <span class="text-zinc-900 dark:text-zinc-100">console</span>
      </nav>

      <h1 id="console-heading" class="mt-2 text-2xl font-semibold tracking-tight">
        GraphQL console
      </h1>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Run raw queries against this instance. The buffer is kept in your browser.
      </p>

      <div class="mt-6">
        <GraphqlConsole
          onRun={(q) => api.graphql(instanceId(), q)}
          initialQuery={initial()}
          onQueryChange={(q) => {
            try {
              localStorage.setItem(storageKey(instanceId()), q);
            } catch {
              // storage full/blocked — persistence is best-effort
            }
          }}
        />
      </div>
    </section>
  );
}
