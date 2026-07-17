import { createSignal, For, Show } from "solid-js";
import type { RbacOverview, RbacRole } from "~/lib/api";

/** Curated permission actions the guided builder offers. */
export const PERMISSION_ACTIONS = [
  "read_data",
  "create_data",
  "update_data",
  "delete_data",
  "read_collections",
  "create_collections",
  "update_collections",
  "delete_collections",
  "manage_backups",
  "read_cluster",
] as const;

/**
 * Build one Weaviate permission object for an action, scoping it to a
 * collection filter where the action's domain takes one.
 */
export function buildPermission(action: string, collection: string): Record<string, unknown> {
  const c = collection.trim() || "*";
  if (action.endsWith("_data")) return { action, data: { collection: c } };
  if (action.endsWith("_collections")) return { action, collections: { collection: c } };
  if (action === "manage_backups") return { action, backups: { collection: c } };
  return { action };
}

/** One-line human summary of a permission object (best-effort). */
export function permissionSummary(p: Record<string, unknown>): string {
  const action = String(p.action ?? "?");
  for (const key of ["data", "collections", "backups", "tenants", "roles", "nodes"]) {
    const resource = p[key];
    if (resource && typeof resource === "object") {
      const filter =
        (resource as Record<string, unknown>).collection ??
        (resource as Record<string, unknown>).role ??
        "*";
      return `${action} (${String(filter)})`;
    }
  }
  return action;
}

/** Weaviate's assign/revoke userType for an overview user_type value. */
export function apiUserType(userType: string | null | undefined): string | undefined {
  return userType?.startsWith("db") ? "db" : undefined;
}

/**
 * RBAC visibility + management: roles with editable permissions, users with
 * assignable roles. Management controls hide in read-only deployments and
 * when RBAC is disabled.
 */
export default function RbacPanel(props: {
  data: RbacOverview;
  readOnly: boolean;
  onCreateRole: (name: string, permissions: unknown[]) => Promise<void>;
  onDeleteRole: (role: string) => Promise<void>;
  onAddPermission: (role: string, permission: unknown) => Promise<void>;
  onRemovePermission: (role: string, permission: unknown) => Promise<void>;
  onAssign: (userId: string, role: string, userType?: string) => Promise<void>;
  onRevoke: (userId: string, role: string, userType?: string) => Promise<void>;
}) {
  const [error, setError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal<string | null>(null);
  const [newRole, setNewRole] = createSignal("");
  const [newAction, setNewAction] = createSignal<string>(PERMISSION_ACTIONS[0]);
  const [newCollection, setNewCollection] = createSignal("*");

  const run = (op: Promise<unknown>) => {
    setError(null);
    return op.catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const manage = () => !props.readOnly && props.data.enabled;

  return (
    <section
      aria-label="Access control"
      class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 class="text-sm font-medium">Access control (RBAC)</h2>
      <Show when={error()}>
        <p role="alert" class="mt-2 text-xs text-red-700 dark:text-red-300">
          {error()}
        </p>
      </Show>
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
                {(role: RbacRole) => (
                  <li class="text-sm">
                    <div class="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        aria-expanded={expanded() === role.name}
                        aria-label={`Toggle permissions of ${role.name}`}
                        onClick={() =>
                          setExpanded(expanded() === role.name ? null : role.name)
                        }
                        class="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                      >
                        {role.name}
                      </button>
                      <span class="text-xs text-zinc-500 dark:text-zinc-400">
                        {(role.permissions ?? []).length} permissions
                        <Show when={manage()}>
                          <button
                            type="button"
                            aria-label={`Delete role ${role.name}`}
                            onClick={() => {
                              if (window.confirm(`Delete role "${role.name}"? Assignments are removed too.`))
                                void run(props.onDeleteRole(role.name));
                            }}
                            class="ml-1.5 rounded px-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                          >
                            ×
                          </button>
                        </Show>
                      </span>
                    </div>
                    <Show when={expanded() === role.name}>
                      <ul
                        aria-label={`Permissions of ${role.name}`}
                        class="mt-1 space-y-0.5 pl-3 text-xs text-zinc-600 dark:text-zinc-300"
                      >
                        <For each={(role.permissions ?? []) as Record<string, unknown>[]}>
                          {(p) => (
                            <li class="flex items-center gap-1.5">
                              <code>{permissionSummary(p)}</code>
                              <Show when={manage()}>
                                <button
                                  type="button"
                                  aria-label={`Remove permission ${permissionSummary(p)} from ${role.name}`}
                                  onClick={() =>
                                    void run(props.onRemovePermission(role.name, p))
                                  }
                                  class="rounded px-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                                >
                                  ×
                                </button>
                              </Show>
                            </li>
                          )}
                        </For>
                        <Show when={manage()}>
                          <li class="flex flex-wrap items-center gap-1.5 pt-1">
                            <select
                              aria-label={`New permission action for ${role.name}`}
                              class="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                              value={newAction()}
                              onChange={(e) => setNewAction(e.currentTarget.value)}
                            >
                              <For each={[...PERMISSION_ACTIONS]}>
                                {(a) => <option value={a}>{a}</option>}
                              </For>
                            </select>
                            <input
                              aria-label={`New permission collection for ${role.name}`}
                              class="w-20 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                              value={newCollection()}
                              onInput={(e) => setNewCollection(e.currentTarget.value)}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                void run(
                                  props.onAddPermission(
                                    role.name,
                                    buildPermission(newAction(), newCollection()),
                                  ),
                                )
                              }
                              class="rounded border border-zinc-300 px-1.5 py-0.5 text-xs font-medium hover:border-weft-400 dark:border-zinc-700 dark:hover:border-weft-500"
                            >
                              + Add permission
                            </button>
                          </li>
                        </Show>
                      </ul>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <Show when={manage()}>
              <form
                aria-label="New role"
                class="mt-3 flex flex-wrap items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newRole().trim();
                  if (!name) return;
                  void run(
                    props
                      .onCreateRole(name, [buildPermission(newAction(), newCollection())])
                      .then(() => setNewRole("")),
                  );
                }}
              >
                <input
                  aria-label="New role name"
                  placeholder="role name"
                  class="w-28 rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  value={newRole()}
                  onInput={(e) => setNewRole(e.currentTarget.value)}
                />
                <select
                  aria-label="New role first action"
                  class="rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  value={newAction()}
                  onChange={(e) => setNewAction(e.currentTarget.value)}
                >
                  <For each={[...PERMISSION_ACTIONS]}>
                    {(a) => <option value={a}>{a}</option>}
                  </For>
                </select>
                <input
                  aria-label="New role collection filter"
                  class="w-20 rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  value={newCollection()}
                  onInput={(e) => setNewCollection(e.currentTarget.value)}
                />
                <button
                  type="submit"
                  disabled={!newRole().trim()}
                  class="rounded-lg bg-weft-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-weft-700 disabled:opacity-50"
                >
                  Create role
                </button>
              </form>
            </Show>
          </div>
          <div>
            <h3 class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Users ({props.data.users.length}
              {props.data.users_truncated ? "+" : ""})
            </h3>
            <ul class="mt-2 space-y-1.5" aria-label="Users">
              <For each={props.data.users}>
                {(user) => (
                  <li class="text-sm">
                    <span class="font-medium">{user.user_id}</span>
                    <Show when={user.active === false}>
                      <span class="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        inactive
                      </span>
                    </Show>
                    <span class="ml-2 inline-flex flex-wrap items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <Show when={user.roles.length === 0}>no roles</Show>
                      <For each={user.roles}>
                        {(r) => (
                          <span class="inline-flex items-center rounded-full bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                            {r}
                            <Show when={manage()}>
                              <button
                                type="button"
                                aria-label={`Revoke ${r} from ${user.user_id}`}
                                onClick={() =>
                                  void run(
                                    props.onRevoke(user.user_id, r, apiUserType(user.user_type)),
                                  )
                                }
                                class="ml-0.5 rounded px-0.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                              >
                                ×
                              </button>
                            </Show>
                          </span>
                        )}
                      </For>
                      <Show when={manage()}>
                        <select
                          aria-label={`Assign role to ${user.user_id}`}
                          class="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                          value=""
                          onChange={(e) => {
                            const role = e.currentTarget.value;
                            e.currentTarget.value = "";
                            if (role)
                              void run(
                                props.onAssign(user.user_id, role, apiUserType(user.user_type)),
                              );
                          }}
                        >
                          <option value="">+ assign…</option>
                          <For
                            each={props.data.roles
                              .map((r) => r.name)
                              .filter((n) => !user.roles.includes(n))}
                          >
                            {(n) => <option value={n}>{n}</option>}
                          </For>
                        </select>
                      </Show>
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
