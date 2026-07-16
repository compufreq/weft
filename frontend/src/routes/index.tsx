import { A, createAsync, query, revalidate } from "@solidjs/router";
import { ErrorBoundary, For, Show } from "solid-js";
import { Motion } from "solid-motionone";
import AddInstanceForm from "~/components/instances/AddInstanceForm";
import { api } from "~/lib/api";

const getInstances = query(() => api.instances(), "instances");

export const route = {
  preload: () => getInstances(),
};

export default function Home() {
  const instances = createAsync(() => getInstances());
  const refresh = () => revalidate(getInstances.key);

  const remove = async (id: string) => {
    await api.deleteInstance(id);
    await refresh();
  };

  return (
    <section aria-labelledby="instances-heading">
      <h1 id="instances-heading" class="text-2xl font-semibold tracking-tight">
        Instances
      </h1>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Weaviate instances registered with this Weft deployment.
      </p>

      <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* A 401 during SSR preload must not crash the shell — the AuthGate
            overlay handles authentication client-side. */}
        <ErrorBoundary fallback={<></>}>
        <Show when={instances()}>
          <For each={instances()}>
            {(instance, i) => (
              <Motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i() * 0.06 }}
              >
                <div class="group relative rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-weft-400 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-weft-500">
                  <h2 class="font-medium">{instance.name}</h2>
                  <p class="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {instance.url}
                  </p>
                  <div class="mt-3 flex items-center justify-between">
                    <A
                      href={`/i/${instance.id}/schema`}
                      class="text-sm font-medium text-weft-600 dark:text-weft-400"
                    >
                      Browse schema →
                    </A>
                    <button
                      type="button"
                      aria-label={`Remove ${instance.name}`}
                      title="Remove from Weft (does not touch the Weaviate instance)"
                      class="rounded px-2 py-1 text-xs text-zinc-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-red-950 dark:hover:text-red-400"
                      onClick={() => void remove(instance.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </Motion.div>
            )}
          </For>
        </Show>
        </ErrorBoundary>

        <AddInstanceForm onAdded={() => void refresh()} />
      </div>
    </section>
  );
}
