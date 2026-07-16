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

## What you can do today (v0.2)

- **Browse schemas** — collections, properties, vectorizers, index config, multi-tenancy status
- **Manage connections** — register multiple Weaviate instances at runtime
- **Export schemas** — one-click JSON download
- **Diff schemas** — compare two instances, or an instance against an earlier export

Object browsing and search land in v0.3 — see the [roadmap](https://github.com/compufreq/weft/blob/main/ROADMAP.md).

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
