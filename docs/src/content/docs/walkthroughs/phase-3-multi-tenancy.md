---
title: "v0.4 — Multi-tenancy"
description: Tenant lifecycle management — list, counts, HOT/COLD, scoped browsing.
---

Multi-tenancy is where self-hosted Weaviate deployments get operationally painful — and where most UIs stop. v0.4.0 makes tenants first-class.

## Tenants view

Multi-tenant collections get a **Tenants** button on their detail page:

- **Live status** — every tenant with its `HOT`/`COLD` activity status
- **Object counts** — fetched per HOT tenant with a bounded concurrent fan-out (COLD tenants aren't queryable, shown as —)
- **One-click lifecycle** — Deactivate (HOT→COLD) frees memory for inactive tenants; Activate brings them back
- **Browse** — jumps straight into the object explorer scoped to that tenant (`/objects?tenant=…` is deep-linkable)
- **Add tenants** — create new tenants inline

## Why COLD matters

Inactive tenants on HOT status hold memory (HNSW indexes stay loaded). Deactivating idle tenants is the #1 lever for multi-tenant cluster footprint — Weft makes it a button instead of an API call.

Weft won't let you footgun quietly: querying a COLD tenant returns a readable error, and the tenants view shows exactly which state everything is in.

## API

```bash
# list with counts
curl "…/collections/Product/tenants?counts=true"
# create
curl -X POST "…/collections/Product/tenants" -H 'content-type: application/json' \
  -d '{"names":["customer-42"]}'
# deactivate / activate
curl -X PUT "…/collections/Product/tenants" -H 'content-type: application/json' \
  -d '{"updates":[{"name":"customer-42","status":"COLD"}]}'
```
