---
title: "v0.5 — Ops dashboard"
description: Node and shard health, capabilities, and backups.
---

v0.5.0 gives self-hosted operators the visibility the cloud console keeps for itself.

## Nodes & shards

The **Ops** page (linked from every instance's schema view) shows:

- **Node cards** — status (`HEALTHY`/…), Weaviate version, object and shard totals per node, auto-refreshed every 10 seconds
- **Shard table** — every shard with its collection, object count, and vector indexing status — the first place to look when imports feel slow

## Capabilities

Weft reads `/v1/meta` and shows exactly what this instance can do: version and enabled modules. Features gate themselves — backup backends only appear if the matching module (`backup-filesystem`, `backup-s3`, …) is loaded.

## Backups

- **Create** — one click starts a backup of all collections to the selected backend
- **List** — every backup with its status
- **Restore** — starts an async restore; Weaviate only recreates collections that don't currently exist, and Weft says so before you confirm

Weaviate answers a raw 500 if you target a backend whose module isn't loaded — Weft turns that into a readable "backend not enabled" message instead.

## API

```bash
curl "…/api/v1/instances/local/nodes"
curl "…/api/v1/instances/local/capabilities"
curl -X POST "…/api/v1/instances/local/backups/filesystem" -d '{}' -H 'content-type: application/json'
curl "…/api/v1/instances/local/backups/filesystem"
```
