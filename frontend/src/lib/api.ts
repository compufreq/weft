/**
 * Typed client for the Weft backend API (`/api/v1`).
 *
 * Same-origin everywhere: in the browser we fetch relative URLs; during SSR we
 * need an absolute URL to the backend container (`WEFT_INTERNAL_API`).
 */
import { getRequestEvent, isServer } from "solid-js/web";

export interface InstanceSummary {
  id: string;
  name: string;
  url: string;
}

export interface Property {
  name: string;
  dataType: string[];
  description?: string | null;
}

export interface ClassInfo {
  class: string;
  description?: string | null;
  vectorizer?: string | null;
  vectorIndexType?: string | null;
  multiTenancyConfig?: { enabled: boolean } | null;
  properties: Property[];
}

export interface Schema {
  classes: ClassInfo[];
}

function base(): string {
  if (!isServer) return "";
  return (
    process.env.WEFT_INTERNAL_API ?? process.env.WEFT_API_URL ?? "http://backend:8080"
  );
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  // During SSR, forward the browser's cookies so auth-enabled deployments can
  // server-render authenticated data.
  if (isServer) {
    const cookie = getRequestEvent()?.request.headers.get("cookie");
    if (cookie) {
      init = { ...init, headers: { ...(init?.headers as object), cookie } };
    }
  }
  const res = await fetch(`${base()}${path}`, init);
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** One entry of a schema diff, mirrored from the backend's DiffEntry enum. */
export interface DiffEntryT {
  kind:
    | "class_added"
    | "class_removed"
    | "field_changed"
    | "property_added"
    | "property_removed"
    | "property_field_changed";
  class: string;
  field?: string;
  property?: string;
  left?: unknown;
  right?: unknown;
}

export interface DiffResult {
  left: string;
  right: string;
  entries: DiffEntryT[];
}

export interface AddInstanceInput {
  id?: string;
  name: string;
  url: string;
  api_key?: string;
}

/** A Weaviate object as returned by the REST objects API. */
export interface WeaviateObject {
  id: string;
  class?: string;
  properties: Record<string, unknown>;
  vector?: number[];
  creationTimeUnix?: number;
}

export interface ObjectsPage {
  objects: WeaviateObject[];
  next_cursor: string | null;
}

export type SearchInput =
  | { kind: "bm25"; query: string; limit?: number; tenant?: string }
  | { kind: "near_text"; query: string; limit?: number; tenant?: string }
  | { kind: "near_vector"; vector: number[]; limit?: number; tenant?: string }
  | {
      kind: "hybrid";
      query: string;
      vector?: number[];
      alpha?: number;
      limit?: number;
      tenant?: string;
    };

export interface SearchHit {
  id: string;
  score: number | null;
  distance: number | null;
  properties: Record<string, unknown>;
}

export interface Tenant {
  name: string;
  activityStatus: "HOT" | "COLD" | string;
  /** Object count — only fetched for HOT tenants when counts=true. */
  count?: number | null;
}

export interface NodeShard {
  name: string;
  class: string;
  objectCount?: number;
  vectorIndexingStatus?: string;
}

export interface ClusterNode {
  name: string;
  status: string;
  version?: string;
  stats?: { objectCount?: number; shardCount?: number };
  shards?: NodeShard[] | null;
}

export interface Capabilities {
  version: string;
  modules: string[];
  backup_backends: string[];
}

export interface Backup {
  id: string;
  status?: string;
  classes?: string[];
}

export const api = {
  instances: () => fetchJson<InstanceSummary[]>("/api/v1/instances"),
  addInstance: (input: AddInstanceInput) =>
    postJson<InstanceSummary>("/api/v1/instances", input),
  deleteInstance: (instanceId: string) =>
    fetchJson<void>(`/api/v1/instances/${encodeURIComponent(instanceId)}`, {
      method: "DELETE",
    }),
  schema: (instanceId: string) =>
    fetchJson<Schema>(`/api/v1/instances/${encodeURIComponent(instanceId)}/schema`),
  diff: (
    instanceId: string,
    against: { against_instance?: string; against_schema?: unknown },
  ) =>
    postJson<DiffResult>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/schema/diff`,
      against,
    ),
  /** Browser-only: URL for the schema JSON download. */
  exportUrl: (instanceId: string) =>
    `/api/v1/instances/${encodeURIComponent(instanceId)}/schema/export`,
  objects: (
    instanceId: string,
    className: string,
    opts: { cursor?: string; limit?: number; tenant?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.tenant) params.set("tenant", opts.tenant);
    const qs = params.size > 0 ? `?${params}` : "";
    return fetchJson<ObjectsPage>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/collections/${encodeURIComponent(className)}/objects${qs}`,
    );
  },
  search: (instanceId: string, className: string, input: SearchInput) =>
    postJson<{ results: SearchHit[] }>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/collections/${encodeURIComponent(className)}/search`,
      input,
    ),
  tenants: (instanceId: string, className: string, counts = true) =>
    fetchJson<{ tenants: Tenant[] }>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/collections/${encodeURIComponent(className)}/tenants${counts ? "?counts=true" : ""}`,
    ),
  createTenants: (instanceId: string, className: string, names: string[]) =>
    postJson<unknown>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/collections/${encodeURIComponent(className)}/tenants`,
      { names },
    ),
  updateTenants: (
    instanceId: string,
    className: string,
    updates: { name: string; status: "HOT" | "COLD" }[],
  ) =>
    fetchJson<unknown>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/collections/${encodeURIComponent(className)}/tenants`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates }),
      },
    ),
  nodes: (instanceId: string) =>
    fetchJson<{ nodes: ClusterNode[] }>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/nodes`,
    ),
  capabilities: (instanceId: string) =>
    fetchJson<Capabilities>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/capabilities`,
    ),
  backups: (instanceId: string, backend: string) =>
    fetchJson<{ backups: Backup[]; list_supported?: boolean }>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/backups/${encodeURIComponent(backend)}`,
    ),
  createBackup: (instanceId: string, backend: string, id?: string) =>
    postJson<Backup>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/backups/${encodeURIComponent(backend)}`,
      { id },
    ),
  restoreBackup: (instanceId: string, backend: string, backupId: string) =>
    postJson<Backup>(
      `/api/v1/instances/${encodeURIComponent(instanceId)}/backups/${encodeURIComponent(backend)}/${encodeURIComponent(backupId)}/restore`,
      {},
    ),
  /** Browser-only: URL for the NDJSON objects download. */
  exportObjectsUrl: (instanceId: string, className: string, tenant?: string) => {
    const qs = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";
    return `/api/v1/instances/${encodeURIComponent(instanceId)}/collections/${encodeURIComponent(className)}/export.ndjson${qs}`;
  },
};
