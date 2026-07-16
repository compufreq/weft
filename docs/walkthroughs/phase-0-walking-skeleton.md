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

## Verification (Phase 0 gate)

Verified interactively in a browser against the containerized stack on 2026-07-16:

- **Journeys**: instances overview → instance card → schema table (breadcrumb, property counts, vectorizer, multi-tenancy badge)
- **Accessibility**: axe-core scan on `/` and `/i/local/schema` — zero violations
- **Responsive**: 375px / 768px / desktop — no horizontal page overflow; wide tables scroll inside their own focusable region
- **Themes**: dark verified live; light is the default style layer
- **SSR**: `curl` of `/i/local/schema` contains the fully rendered table — no client JS required
- **Console/network**: no application errors; all requests 200

_Screenshot captures for the docs site land with the Pages setup in v0.2.0._

## What's next

v0.2.0 adds multi-instance management, schema detail views, export/diff, and the zero-config all-in-one image. See [ROADMAP.md](../../ROADMAP.md).
