---
title: Getting started
description: Run Weft next to your Weaviate instance in one command.
---

## Run the container

```bash
docker run -d -p 8080:8080 \
  -e WEAVIATE_URL=http://your-weaviate:8080 \
  ghcr.io/compufreq/weft:latest
```

Open **http://localhost:8080** — your Weaviate instance appears on the Instances page, ready to browse.

That's the whole setup. One container serves both the API and the UI; your browser never talks to Weaviate directly.

### With an API key

```bash
docker run -d -p 8080:8080 \
  -e WEAVIATE_URL=https://weaviate.example.com \
  -e WEAVIATE_API_KEY=your-key \
  ghcr.io/compufreq/weft:latest
```

The key is sent to Weaviate as a Bearer token. It's held in memory, redacted in every API response, and never logged.

### Alongside Weaviate in Docker Compose

```yaml
services:
  weaviate:
    image: cr.weaviate.io/semitechnologies/weaviate:1.37.2
    # … your existing Weaviate config …

  weft:
    image: ghcr.io/compufreq/weft:latest
    environment:
      WEAVIATE_URL: http://weaviate:8080
    ports:
      - "8080:8080"
```

The image is published for **amd64 and arm64** (Apple Silicon, Raspberry Pi 5, Graviton) — Docker picks the right one automatically.

## What you can do

- **Browse schemas** — collections, properties, vectorizers, index config, multi-tenancy status
- **Manage connections** — register multiple Weaviate instances at runtime
- **Export & diff schemas** — one-click JSON download; compare two instances, or an instance against an earlier export
- **Explore objects** — cursor-paginated browser with a JSON detail panel and streaming NDJSON export
- **Edit data** — create, edit, and delete objects from the UI; batch-import JSON/NDJSON with per-item error reports (all disabled in read-only mode)
- **Filter & aggregate** — structured where-filters on browse and search, live counts, per-property facets
- **Search** — BM25, nearVector, nearText, and hybrid, with scores
- **Query console** — raw GraphQL scratchpad per instance (query-only, safe in read-only mode)
- **Manage tenants** — HOT/COLD activation, per-tenant object counts, tenant-scoped browsing
- **Watch your cluster** — node & shard health, capabilities, backup create/restore
- **Lock it down** — optional access token ([`WEFT_AUTH_TOKEN`](/weft/configuration/#authentication-v06)) and [read-only mode](/weft/configuration/#read-only-mode)

See the [roadmap](https://github.com/compufreq/weft/blob/main/ROADMAP.md) for what's next.

## Developing / building from source

You need Docker and nothing else:

```bash
git clone https://github.com/compufreq/weft && cd weft
docker compose -f compose.dev.yaml up
```

| Service  | Port | What                                    |
| -------- | ---- | --------------------------------------- |
| frontend | 3100 | SolidStart dev server (HMR)             |
| backend  | 8180 | Rust API                                |
| weaviate | 8181 | Weaviate 1.37 with seeded demo data     |
