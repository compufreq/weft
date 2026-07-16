# Weft

**The missing UI for Weaviate.** A zero-config, self-hosted web interface for browsing and managing [Weaviate](https://weaviate.io) vector databases.

> ✅ **Stable** — the `/api/v1` HTTP API is covered by a [stability commitment](https://compufreq.github.io/weft/upgrading/#compatibility-policy) as of v1.0.0. See the [roadmap](ROADMAP.md) for what's next.

## Why Weft?

If you self-host Weaviate, you get raw APIs and nothing else — the official console targets Weaviate Cloud, and the alternatives are IDE extensions or thin wrappers. Weft is:

- **Zero-config** — one container next to your Weaviate, open your browser, done
- **Web-based** — usable by everyone on the team, not just people with VS Code
- **Weaviate-deep** — multi-tenancy, hybrid search, node health as first-class features, not afterthoughts

## Quickstart

```bash
docker run -d -p 8080:8080 -e WEAVIATE_URL=http://your-weaviate:8080 ghcr.io/compufreq/weft:latest
```

Then open `http://localhost:8080`. One container serves the API and the UI — zero configuration.

📖 **Docs: [compufreq.github.io/weft](https://compufreq.github.io/weft/)**

## Features

- ✅ Zero-config all-in-one container (amd64 + arm64)
- ✅ Multiple Weaviate instances — configured or added at runtime
- ✅ Schema browser with per-collection detail views (properties, vectorizer, index config)
- ✅ Schema export (JSON download) and structural **schema diff** (instance↔instance or instance↔file)
- ✅ Object explorer — cursor pagination, **where-filters, aggregations & facets**, JSON detail panel, streaming NDJSON export
- ✅ Search — BM25 / nearVector / nearText / hybrid, with scores and filters
- ✅ **Data editing** — create/edit/delete objects, batch JSON/NDJSON import with per-item error reports
- ✅ **Schema management** — create collections, add properties, delete behind typed confirmation, collection **aliases** (≥1.32)
- ✅ Raw **GraphQL console** per instance (query-only, safe in read-only mode)
- ✅ First-class **multi-tenancy** — HOT/COLD activation, per-tenant counts, tenant-scoped browsing
- ✅ Ops dashboard — node & shard health, Raft statistics, RBAC visibility, capabilities, backup create/restore
- ✅ **Vector map** — 2D PCA projection of your embedding space, facet-colored
- ✅ Optional auth token (rate-limited, cookie sessions), **read-only mode**, persisted runtime instances
- ✅ Server-side rendered — your data is in the HTML, no JS required

## Architecture

- **Backend:** Rust ([axum](https://github.com/tokio-rs/axum)) — acts as an aggregating proxy; your browser never talks to Weaviate directly
- **Client:** `weft-weaviate`, a from-scratch Rust client for the Weaviate REST/GraphQL APIs
- **Frontend:** [SolidStart](https://start.solidjs.com) with SSR, Tailwind CSS v4, Motion One animations
- **Everything runs in Docker** — dev, tests, and production

## Development

Requires only Docker (no local Rust/Node needed — everything runs in containers):

```bash
docker compose -f compose.dev.yaml up
```

| Service | Host port | What |
|---|---|---|
| frontend | 3100 | SolidStart dev server (HMR) |
| backend | 8180 | Rust API |
| weaviate | 8181 | Weaviate 1.37 with seeded demo data |

Run tests: see [Makefile](Makefile) targets (`make test`, `make lint`, `make security`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Conventional commits required.

## License

[AGPL-3.0](LICENSE)

---

*Weft is an independent open-source project and is **not affiliated with, endorsed by, or sponsored by Weaviate B.V.** "Weaviate" is a trademark of Weaviate B.V.*
