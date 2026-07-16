---
title: "v0.2 — Schema & connections"
description: Multi-instance management, schema detail views, export, diff, and the zero-config image.
---

v0.2.0 turns the walking skeleton into a usable schema-management tool and ships the headline **zero-config all-in-one image**.

## What shipped

### Zero-config deploy

One image, one port: the Rust server fronts everything, supervises the SolidStart SSR process inside the container, and reverse-proxies UI requests to it on loopback.

```bash
docker run -d -p 8080:8080 -e WEAVIATE_URL=http://your-weaviate:8080 ghcr.io/compufreq/weft:latest
```

### Manage connections

Register additional Weaviate instances at runtime from the Instances page — name, URL, optional API key. Runtime instances are in-memory; permanent ones belong in `weft.yaml`.

### Collection detail views

Click any collection to see its full definition: properties with data types, vectorizer, vector index type, multi-tenancy status, and the raw JSON definition.

### Schema export

One click downloads the instance's complete schema as JSON — exactly what `GET /v1/schema` returns, suitable for versioning or re-import elsewhere.

### Schema diff

Compare an instance against another instance, or against a pasted schema JSON (e.g. yesterday's export). The diff is structural and forward-compatible: classes added/removed, class-level fields changed, properties added/removed/changed — including fields Weft doesn't know about yet.

## Try the diff

1. Open an instance → **Compare…**
2. Pick another instance, or paste `{"classes": []}` to see every collection reported as removed
3. Each difference shows where it is (class, property, field) and the left/right values
