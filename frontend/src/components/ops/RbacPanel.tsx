import { For, Show } from "solid-js";
import type { RbacOverview } from "~/lib/api";

/**
 * Read-only RBAC visibility: roles with permission counts, users with their
 * assigned roles. Weaviate-side RBAC management stays CLI/API territory.
 */
export default function RbacPanel(props: { data: RbacOverview }) {
  return (
    <section
      aria-label="Access control"
      class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 class="text-sm font-medium">Access control (RBAC)</h2>
      <Show
        when={props.data.enabled}
        fallback={
          <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {props.data.reason ?? "RBAC is not enabled on this instance."}
          </p>
        }
      >
        <div class="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Roles ({props.data.roles.length})
            </h3>
            <ul class="mt-2 space-y-1" aria-label="Roles">
              <For each={props.data.roles}>
                {(role) => (
                  <li class="flex items-center justify-between gap-2 text-sm">
                    <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                      {role.name}
                    </code>
                    <span class="text-xs text-zinc-500 dark:text-zinc-400">
                      {(role.permissions ?? []).length} permissions
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </div>
          <div>
            <h3 class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Users ({props.data.users.length}
              {props.data.users_truncated ? "+" : ""})
            </h3>
            <ul class="mt-2 space-y-1" aria-label="Users">
              <For each={props.data.users}>
                {(user) => (
                  <li class="text-sm">
                    <span class="font-medium">{user.user_id}</span>
                    <Show when={user.active === false}>
                      <span class="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        inactive
                      </span>
                    </Show>
                    <span class="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {user.roles.length > 0 ? user.roles.join(", ") : "no roles"}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </div>
      </Show>
    </section>
  );
}
