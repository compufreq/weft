/**
 * Typed client for the Weft backend API (`/api/v1`).
 *
 * Same-origin everywhere: in the browser we fetch relative URLs; during SSR we
 * need an absolute URL to the backend container (`WEFT_INTERNAL_API`).
 */
import { isServer } from "solid-js/web";

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

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`);
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
  return (await res.json()) as T;
}

export const api = {
  instances: () => fetchJson<InstanceSummary[]>("/api/v1/instances"),
  schema: (instanceId: string) =>
    fetchJson<Schema>(`/api/v1/instances/${encodeURIComponent(instanceId)}/schema`),
};
