import { For, Show } from "solid-js";
import type { Tenant } from "~/lib/api";

/**
 * Tenant list with activity badges, counts, and lifecycle actions.
 * Pure component: actions are reported upward.
 */
export default function TenantTable(props: {
  tenants: Tenant[];
  onToggle?: (tenant: Tenant) => void;
  onBrowse?: (tenant: Tenant) => void;
  busyTenant?: string | null;
}) {
  return (
    <Show
      when={props.tenants.length > 0}
      fallback={
        <p class="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No tenants on this collection yet.
        </p>
      }
    >
      <div
        tabindex="0"
        role="region"
        aria-label="Tenants"
        class="overflow-x-auto rounded-lg border border-zinc-200 focus-visible:outline-2 focus-visible:outline-weft-500 dark:border-zinc-800"
      >
        <table class="w-full text-left text-sm">
          <thead class="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">
                Tenant
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                Objects
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            <For each={props.tenants}>
              {(tenant) => {
                const hot = () => tenant.activityStatus === "HOT";
                return (
                  <tr>
                    <td class="px-4 py-2.5 font-medium">{tenant.name}</td>
                    <td class="px-4 py-2.5">
                      <span
                        class={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          hot()
                            ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                            : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
                        }`}
                      >
                        {tenant.activityStatus}
                      </span>
                    </td>
                    <td class="px-4 py-2.5 text-zinc-600 dark:text-zinc-300">
                      {tenant.count ?? "—"}
                    </td>
                    <td class="px-4 py-2.5">
                      <div class="flex justify-end gap-2">
                        <Show when={hot()}>
                          <button
                            type="button"
                            onClick={() => props.onBrowse?.(tenant)}
                            class="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium hover:border-weft-400 dark:border-zinc-700 dark:hover:border-weft-500"
                          >
                            Browse
                          </button>
                        </Show>
                        <button
                          type="button"
                          disabled={props.busyTenant === tenant.name}
                          onClick={() => props.onToggle?.(tenant)}
                          class="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium hover:border-weft-400 disabled:opacity-50 dark:border-zinc-700 dark:hover:border-weft-500"
                        >
                          {props.busyTenant === tenant.name
                            ? "…"
                            : hot()
                              ? "Deactivate"
                              : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
