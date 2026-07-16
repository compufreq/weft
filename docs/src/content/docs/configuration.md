---
title: Configuration
description: Environment variables and weft.yaml reference.
---

Weft is zero-config by default: with no configuration at all it registers a single instance pointing at `$WEAVIATE_URL` (falling back to `http://weaviate:8080`).

## Environment variables

| Variable            | Default                 | Purpose                                        |
| ------------------- | ----------------------- | ---------------------------------------------- |
| `WEAVIATE_URL`      | `http://weaviate:8080`  | URL of the default (`local`) instance          |
| `WEAVIATE_API_KEY`  | —                       | Bearer token for the default instance          |
| `WEFT_LISTEN`       | `0.0.0.0:8080`          | Address the server binds                       |
| `WEFT_AUTH_TOKEN`   | — (open)                | When set, the API requires this token (UI prompts for it; API clients send `Authorization: Bearer …`) |
| `WEFT_READ_ONLY`    | `false`                 | Reject all mutating requests (instance changes, tenants, backups) |
| `RUST_LOG`          | `info`                  | Log level (`tracing` filter syntax)            |

## weft.yaml

For multiple permanent instances, mount a `weft.yaml` next to the binary (in the container: `/app/weft.yaml`):

```yaml
listen: "0.0.0.0:8080"

instances:
  - id: local
    name: Local Weaviate
    url: http://weaviate:8080

  - id: staging
    name: Staging cluster
    url: https://weaviate.staging.example.com
    api_key: "sk-..."
```

Environment variables prefixed `WEFT_` override file values.

## Runtime instances

Instances added through the UI (or `POST /api/v1/instances`) are **in-memory** — they reset when the container restarts. Put permanent instances in `weft.yaml`.

## Authentication (v0.6+)

Set `WEFT_AUTH_TOKEN` to protect the API:

```bash
docker run -d -p 8080:8080 \
  -e WEAVIATE_URL=http://weaviate:8080 \
  -e WEFT_AUTH_TOKEN=$(openssl rand -hex 24) \
  ghcr.io/compufreq/weft:latest
```

- **Browsers** get a token prompt on first visit; the token is exchanged for an HttpOnly, SameSite=Strict session cookie (7 days). A **Log out** button appears in the nav while a session is active (v0.7+).
- **API clients** send `Authorization: Bearer <token>`.
- `/healthz` and `/readyz` stay open for orchestrators.

### Brute-force protection (v0.7+)

`POST /api/v1/auth/session` is rate-limited to **5 attempts per minute per client IP**. Over the limit, the endpoint answers `429` with a `Retry-After` header and `{"error":{"code":"rate_limited"}}`; the UI shows a friendly countdown. The limit keys on the TCP peer address — `X-Forwarded-For` is deliberately ignored (it's spoofable), so behind a reverse proxy the limit applies per proxy hop. Combine with a strong random token (`openssl rand -hex 24`); at 5 attempts/minute a 24-byte token is not brute-forceable.

### Logging out

`DELETE /api/v1/auth/session` clears the session cookie (the nav button calls this). The endpoint is unauthenticated by design — an expired or garbage cookie must still be clearable — and idempotent.

## Read-only mode

`WEFT_READ_ONLY=true` turns Weft into a safe viewer: browsing, search, filters, aggregations, the GraphQL console, and export all work; anything mutating (adding instances, tenant changes, backups) is rejected with `403 read_only` and the UI shows a banner. Handy for giving a whole team visibility without handing out write access.

Query-style POST endpoints (`…/search`, `…/aggregate`, `…/schema/diff`, `…/graphql`) are explicitly allowed in read-only mode — they carry request bodies but never mutate. The GraphQL console is safe because Weaviate's GraphQL schema is query-only; all mutations in Weaviate go over REST. *(v0.9 fixed a bug where read-only mode incorrectly blocked search and diff.)*

:::note[There is intentionally no UI toggle]
Read-only mode (like the auth token) is a **deployment-level** switch — it can only be changed by restarting the container without `WEFT_READ_ONLY`. If it were toggleable from the UI, anyone with browser access could disable it, which would defeat its purpose. Check a deployment's current state with `GET /api/v1/auth`:

```json
{ "auth_required": true, "authorized": true, "read_only": true }
```
:::

## Security notes

- API keys and the auth token are held in memory, redacted in every API response, and never logged.
- Weft serves plain HTTP — put TLS in front of it (reverse proxy / ingress) before crossing untrusted networks.
