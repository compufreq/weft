import { A, createAsync, query } from "@solidjs/router";
import { For, Show } from "solid-js";
import { Motion } from "solid-motionone";
import { api } from "~/lib/api";

const getInstances = query(() => api.instances(), "instances");

export const route = {
  preload: () => getInstances(),
};

export default function Home() {
  const instances = createAsync(() => getInstances());

  return (
    <section aria-labelledby="instances-heading">
      <h1 id="instances-heading" class="text-2xl font-semibold tracking-tight">
        Instances
      </h1>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Weaviate instances registered with this Weft deployment.
      </p>

      <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Show when={instances()}>
          <For each={instances()}>
            {(instance, i) => (
              <Motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i() * 0.06 }}
              >
                <A
                  href={`/i/${instance.id}/schema`}
                  class="block rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-weft-400 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-weft-500"
                >
                  <h2 class="font-medium">{instance.name}</h2>
                  <p class="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {instance.url}
                  </p>
                  <span class="mt-3 inline-block text-sm font-medium text-weft-600 dark:text-weft-400">
                    Browse schema →
                  </span>
                </A>
              </Motion.div>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}
