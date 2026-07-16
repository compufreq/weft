# Walkthrough: Phase 0 — Walking Skeleton (v0.1.0)

> What ships in v0.1.0 and how to see it working, end to end.

## What you get

- A dockerized dev stack: Weaviate 1.37 (seeded with demo data) + Rust API + SolidStart UI
- An **instances overview** page listing every Weaviate instance Weft knows about
- A **schema browser**: collections with property counts, vectorizer, and multi-tenancy status, server-side rendered

## Try it

```bash
git clone https://github.com/compufreq/weft && cd weft
docker compose -f compose.dev.yaml up
```

Wait for the seeder to finish (`seeded: Article (25 objects), Product (multi-tenant…)`), then open **http://localhost:3100**.

1. **Instances page** — you'll see the `Local Weaviate` card. Click it.
2. **Schema page** — the seeded `Article` and `Product` collections render in a table; `Product` shows the multi-tenancy badge.
3. **It's SSR** — view page source: the table is in the HTML, no client JS required.
4. **API directly** — `curl localhost:8180/api/v1/instances/local/schema`

## Screenshots

_(captured during the Preview UI/UX walkthrough — added at gate close)_

## What's next

v0.2.0 adds multi-instance management, schema detail views, export/diff, and the zero-config all-in-one image. See [ROADMAP.md](../../ROADMAP.md).
