import { A, useParams } from "@solidjs/router";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import BackupsTable from "~/components/ops/BackupsTable";
import MetricsPanel, {
  pushSample,
  type MetricsSample,
} from "~/components/ops/MetricsPanel";
import NodesPanel from "~/components/ops/NodesPanel";
import RbacPanel from "~/components/ops/RbacPanel";
import StatsCard from "~/components/ops/StatsCard";
import {
  api,
  type Backup,
  type Capabilities,
  type ClusterNode,
  type ClusterStatistics,
  type RbacOverview,
} from "~/lib/api";

const POLL_MS = 10_000;

export default function OpsPage() {
  const params = useParams();
  const instanceId = () => params.id ?? "";

  const [nodes, setNodes] = createSignal<ClusterNode[]>([]);
  const [caps, setCaps] = createSignal<Capabilities | null>(null);
  const [backend, setBackend] = createSignal<string>("");
  const [backups, setBackups] = createSignal<Backup[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [lastRefresh, setLastRefresh] = createSignal<string>("");

  const refreshNodes = async () => {
    try {
      const res = await api.nodes(instanceId());
      setNodes(res.nodes);
      setLastRefresh(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const [listSupported, setListSupported] = createSignal(true);
  const refreshBackups = async () => {
    if (!backend()) return;
    try {
      const res = await api.backups(instanceId(), backend());
      setBackups(res.backups ?? []);
      setListSupported(res.list_supported !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const [rbac, setRbac] = createSignal<RbacOverview | null>(null);
  const [stats, setStats] = createSignal<ClusterStatistics | null>(null);

  // Live metrics: rolling in-browser window, polled with the page.
  const [metricsWindow, setMetricsWindow] = createSignal<MetricsSample[]>([]);
  const refreshMetrics = async () => {
    try {
      const snapshot = await api.metrics(instanceId());
      setMetricsWindow((w) => pushSample(w, { at: Date.now(), snapshot }));
    } catch {
      // Metrics are auxiliary — a failed scrape just skips a sample.
    }
  };

  onMount(() => {
    void (async () => {
      await refreshNodes();
      try {
        const c = await api.capabilities(instanceId());
        setCaps(c);
        if (c.backup_backends.length > 0) {
          setBackend(c.backup_backends[0]);
          await refreshBackups();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      // Auxiliary panels — failures here never block the ops page.
      try {
        setRbac(await api.rbac(instanceId()));
      } catch {
        setRbac(null);
      }
      try {
        setStats(await api.statistics(instanceId()));
      } catch {
        setStats(null);
      }
      void refreshMetrics();
    })();
    const timer = setInterval(() => {
      void refreshNodes();
      void refreshMetrics();
    }, POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const createBackup = async () => {
    setNotice(null);
    setError(null);
    try {
      const started = await api.createBackup(instanceId(), backend());
      setNotice(`Backup ${started.id} started.`);
      // Give the (tiny) backup a moment, then refresh the list.
      setTimeout(() => void refreshBackups(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const restoreBackup = async (backup: Backup) => {
    if (
      !window.confirm(
        `Restore backup "${backup.id}"?\n\nRestore only recreates collections that do not currently exist on the instance.`,
      )
    ) {
      return;
    }
    setNotice(null);
    setError(null);
    try {
      await api.restoreBackup(instanceId(), backend(), backup.id);
      setNotice(`Restore of ${backup.id} started — collections that already exist are skipped/failed by Weaviate.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section aria-labelledby="ops-heading">
      <nav aria-label="Breadcrumb" class="text-sm text-zinc-500 dark:text-zinc-400">
        <A href="/" class="hover:text-weft-600 dark:hover:text-weft-400">
          Instances
        </A>
        <span aria-hidden="true"> / </span>
        <A href={`/i/${instanceId()}/schema`} class="hover:text-weft-600 dark:hover:text-weft-400">
          {instanceId()}
        </A>
        <span aria-hidden="true"> / </span>
        <span class="text-zinc-900 dark:text-zinc-100">ops</span>
      </nav>

      <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 id="ops-heading" class="text-2xl font-semibold tracking-tight">
          Operations
        </h1>
        <p class="text-xs text-zinc-500 dark:text-zinc-400" role="status">
          <Show when={lastRefresh()}>auto-refresh · updated {lastRefresh()}</Show>
        </p>
      </div>

      <Show when={caps()}>
        {(c) => {
          const [showAll, setShowAll] = createSignal(false);
          const visible = () => (showAll() ? c().modules : c().modules.slice(0, 8));
          const hidden = () => c().modules.length - 8;
          return (
            <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              Weaviate <code class="text-xs">{c().version}</code>
              <For each={visible()}>
                {(m) => (
                  <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                    {m}
                  </span>
                )}
              </For>
              <Show when={hidden() > 0}>
                <button
                  type="button"
                  onClick={() => setShowAll(!showAll())}
                  class="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium hover:border-weft-400 dark:border-zinc-700 dark:hover:border-weft-500"
                >
                  {showAll() ? "show fewer" : `+${hidden()} more`}
                </button>
              </Show>
            </p>
          );
        }}
      </Show>

      <Show when={error()}>
        <div
          role="alert"
          class="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error()}
        </div>
      </Show>
      <Show when={notice()}>
        <div
          role="status"
          class="mt-4 rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
        >
          {notice()}
        </div>
      </Show>

      <h2 class="mt-8 text-lg font-semibold tracking-tight">Nodes</h2>
      <div class="mt-3">
        <NodesPanel nodes={nodes()} />
      </div>

      <Show
        when={(caps()?.backup_backends.length ?? 0) > 0}
        fallback={
          <p class="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
            No backup modules enabled on this instance — enable e.g.{" "}
            <code class="text-xs">backup-filesystem</code> to manage backups here.
          </p>
        }
      >
        <div class="mt-8 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold tracking-tight">Backups</h2>
          <div class="flex items-center gap-2">
            <label class="text-sm">
              <span class="sr-only">Backup backend</span>
              <select
                class="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                value={backend()}
                onChange={(e) => {
                  setBackend(e.currentTarget.value);
                  void refreshBackups();
                }}
              >
                <For each={caps()?.backup_backends ?? []}>
                  {(b) => <option value={b}>{b}</option>}
                </For>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void createBackup()}
              class="rounded-lg bg-weft-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-weft-700"
            >
              Create backup
            </button>
          </div>
        </div>
        <Show when={!listSupported()}>
          <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            This Weaviate version can't list existing backups (added in 1.31) — creating
            backups still works.
          </p>
        </Show>
        <div class="mt-3">
          <BackupsTable backups={backups()} onRestore={(b) => void restoreBackup(b)} />
        </div>
      </Show>

      <h2 class="mt-8 text-lg font-semibold tracking-tight">Live metrics</h2>
      <div class="mt-3">
        <MetricsPanel window={metricsWindow()} />
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <Show when={stats()}>{(s) => <StatsCard stats={s()} />}</Show>
        <Show when={rbac()}>{(r) => <RbacPanel data={r()} />}</Show>
      </div>
    </section>
  );
}
