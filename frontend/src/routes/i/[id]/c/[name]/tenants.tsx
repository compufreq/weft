import { A, useNavigate, useParams } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";
import TenantTable from "~/components/tenants/TenantTable";
import { api, type Tenant } from "~/lib/api";

export default function TenantsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const instanceId = () => params.id ?? "";
  const className = () => params.name ?? "";

  const [tenants, setTenants] = createSignal<Tenant[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [busyTenant, setBusyTenant] = createSignal<string | null>(null);
  const [newName, setNewName] = createSignal("");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.tenants(instanceId(), className());
      setTenants(res.tenants);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTenants([]);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void refresh());

  const toggle = async (tenant: Tenant) => {
    setBusyTenant(tenant.name);
    setError(null);
    try {
      const status = tenant.activityStatus === "HOT" ? "COLD" : "HOT";
      await api.updateTenants(instanceId(), className(), [{ name: tenant.name, status }]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyTenant(null);
    }
  };

  const addTenant = async (e: Event) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createTenants(instanceId(), className(), [newName().trim()]);
      setNewName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section aria-labelledby="tenants-heading">
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
        <span class="text-zinc-900 dark:text-zinc-100">tenants</span>
      </nav>

      <h1 id="tenants-heading" class="mt-2 text-2xl font-semibold tracking-tight">
        {className()} tenants
      </h1>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        HOT tenants serve queries; COLD tenants are deactivated (stored, not queryable). Counts
        are fetched for HOT tenants only.
      </p>

      <Show when={error()}>
        <div
          role="alert"
          class="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error()}
        </div>
      </Show>

      <div class="mt-6">
        <Show when={!loading() || tenants().length > 0} fallback={<p class="text-sm text-zinc-500">Loading…</p>}>
          <TenantTable
            tenants={tenants()}
            busyTenant={busyTenant()}
            onToggle={(t) => void toggle(t)}
            onBrowse={(t) =>
              navigate(
                `/i/${instanceId()}/c/${encodeURIComponent(className())}/objects?tenant=${encodeURIComponent(t.name)}`,
              )
            }
          />
        </Show>
      </div>

      <form onSubmit={addTenant} class="mt-6 flex max-w-md items-end gap-2">
        <label class="flex-1 text-sm">
          <span class="block text-xs font-medium">New tenant name</span>
          <input
            required
            placeholder="customer-42"
            class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
          />
        </label>
        <button
          type="submit"
          class="rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700"
        >
          Add tenant
        </button>
      </form>
    </section>
  );
}
