---
title: Security model
description: Weft's threat model — trust boundaries, protections, and the risks operators accept.
---

This page is the v1.0 security review: what Weft protects, how, and which risks deliberately remain with the operator. Report vulnerabilities per [SECURITY.md](https://github.com/compufreq/weft/blob/main/SECURITY.md).

## Architecture & trust boundaries

```
Browser ──(1)── Weft container ──(2)── Weaviate instance(s)
```

1. **Browser ↔ Weft** — Weft serves plain HTTP; the SSR shell is public, all data flows through `/api/v1`. Everything on this boundary is same-origin (the Rust server is the front door and reverse-proxies the UI), so there is **no CORS surface at all**.
2. **Weft ↔ Weaviate** — Weft is an aggregating proxy: browsers never talk to Weaviate. Weaviate API keys live only server-side.

**Deployment assumptions:** you terminate TLS in front of Weft before crossing untrusted networks, and the people who hold the access token are trusted to administer the connected Weaviate instances.

## Authentication & authorization

| Control | Mechanism |
| --- | --- |
| API access | Optional shared token (`WEFT_AUTH_TOKEN`): `Authorization: Bearer` or an HttpOnly, SameSite=Strict session cookie (7 days) |
| Brute force | `POST /api/v1/auth/session` limited to 5 attempts/min per client IP, checked before token verification (no oracle); `X-Forwarded-For` deliberately ignored (spoofable) |
| Token comparison | Constant-time (`ct_eq`) — length leaks, contents don't |
| Write protection | `WEFT_READ_ONLY=true` rejects every mutation server-side (`403 read_only`); query-style POSTs (search, aggregate, diff, GraphQL) are explicitly allowlisted since Weaviate's GraphQL schema is query-only |
| Probes | `/healthz`, `/readyz` stay open for orchestrators |

**One token = one identity.** Weft has no per-user accounts, roles, or audit trail pre-1.x — everyone with the token has the same (full or read-only) power. If you need to hand out different levels of access, run two deployments: one read-only, one not.

## Secrets handling

- Weaviate API keys and the auth token are wrapped in [`secrecy`](https://docs.rs/secrecy) types: never serialized into API responses, never logged, redacted everywhere.
- `WEFT_INSTANCES_FILE` (optional) stores runtime-added instances **including their API keys in plain text** — required to rebuild clients after a restart. The file needs the same protection as `weft.yaml`. Writes are atomic (temp + rename); corrupt files never block boot.
- Session cookies carry the token value itself rather than a server-side session id — a deliberate trade-off to keep Weft stateless; the cookie is HttpOnly + SameSite=Strict, and rotating `WEFT_AUTH_TOKEN` invalidates every session at once.

## Injection defenses

- **GraphQL injection:** every query Weft builds validates identifiers (class/property/alias names: `[A-Za-z0-9_]`, classes UpperCamelCase) and JSON-encodes every user value; injection tests are part of the unit suite. The raw console forwards user GraphQL verbatim — safe because Weaviate GraphQL cannot mutate.
- **Path traversal:** object ids, backup ids/backends, and alias names are validated before being interpolated into upstream URL paths.
- **Request bounds:** console queries ≤ 64 KB, imports ≤ 10k objects/request, facet buckets and RBAC user fan-out capped, list pages clamped to 200.

## Mutation surface (inventory)

Everything below is blocked in read-only mode and hidden in the read-only UI: instance add/remove · tenant create/HOT-COLD · backup create/restore · object create/replace/delete · batch import · collection create/delete · add property · alias create/repoint/delete.

## Accepted risks (operator responsibilities)

1. **SSRF by design** — an authorized user can register any URL as an instance and Weft will send Weaviate-shaped requests to it. Mitigate with network policy around the Weft container; don't give the token to anyone you wouldn't let `curl` from inside that network segment.
2. **No TLS in Weft** — put a terminator in front; the session cookie has no `Secure` flag on plain HTTP.
3. **Shared-token identity** — no per-user attribution or audit log (open-core roadmap).
4. **Plain-text keys at rest** in `weft.yaml` / `WEFT_INSTANCES_FILE` — protect the volume.
5. **The GraphQL console reads anything** the connected Weaviate can serve — same reach as the rest of the read path, listed here for completeness.

## Supply chain & CI

Every commit runs clippy (`-D warnings`), cargo-audit, cargo-deny, eslint (security plugin), gitleaks, hadolint, and Trivy (filesystem + image, HIGH/CRITICAL fail the build). Images are multi-stage, run as a non-root user, and ship with a healthcheck; releases are built from annotated tags whose version must match the workspace.
