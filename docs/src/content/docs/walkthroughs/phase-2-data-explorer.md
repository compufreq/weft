---
title: "v0.3 — Data explorer"
description: Browse objects, run BM25/vector/hybrid search, and export NDJSON.
---

v0.3.0 opens up the data itself: every collection gets an object browser and a search panel.

## Browse objects

From a collection's detail page, hit **Browse objects →**:

- **Cursor pagination** — pages use Weaviate's `after` cursor (never offsets), so browsing stays fast at any collection size. "Load more" appends the next page.
- **Object detail** — click any row to inspect the full JSON in a side panel.
- **Multi-tenant collections** — set the tenant in the toolbar; Weft passes it through to every request.

## Search

The **Search** tab runs real Weaviate queries with scores:

| Mode | What it does | Requires |
| --- | --- | --- |
| BM25 | keyword (sparse) search | — |
| Hybrid | fused keyword + vector (`alpha` balances) | optional raw vector |
| nearVector | raw vector similarity | a JSON vector `[0.1, …]` |
| nearText | semantic search | a vectorizer module on the collection |

Results show BM25/hybrid **scores** and vector **distances** per hit. Errors come back readable — e.g. `nearText` on a collection without a vectorizer explains itself instead of failing silently.

## Export NDJSON

**Export NDJSON** streams the entire collection — one JSON object per line — paging through the cursor API server-side with constant memory. Suitable for backups, offline analysis, or piping into `jq`.

```bash
curl "http://localhost:8080/api/v1/instances/local/collections/Article/export.ndjson" | wc -l
```

## API

Everything the UI does is plain HTTP on `/api/v1`:

```bash
# page of objects
curl "…/collections/Article/objects?limit=50"
# search
curl -X POST "…/collections/Article/search" \
  -H 'content-type: application/json' \
  -d '{"kind":"bm25","query":"science","limit":5}'
```
