---
title: Upgrading
description: How to upgrade Weft, version pinning advice, and the pre-1.0 compatibility policy.
---

Weft is a **stateless** container: it stores nothing on disk, owns no volumes, and never migrates data. Upgrading is pulling a newer image and recreating the container.

## Upgrade in place

```bash
docker pull ghcr.io/compufreq/weft:latest
docker stop weft && docker rm weft
docker run -d --name weft -p 8080:8080 \
  -e WEAVIATE_URL=http://your-weaviate:8080 \
  ghcr.io/compufreq/weft:latest
```

With Docker Compose:

```bash
docker compose pull weft && docker compose up -d weft
```

Your Weaviate data is untouched — Weft is a read-mostly client of Weaviate's public API.

:::caution[Runtime instances reset on restart]
Instances added through the UI live **in memory** and are gone after the container restarts (upgrade or not). Anything permanent belongs in [`weft.yaml` or environment variables](/weft/configuration/).
:::

## Picking a tag

| Tag | Meaning | Use when |
| --- | --- | --- |
| `0.7.0` | Exact release | Production — deliberate, reviewed upgrades |
| `0.7` | Latest patch of a minor | You want fixes without behavior changes |
| `latest` | Newest release | Trying Weft out, dev environments |

Pre-1.0, **pin at least the minor** (`ghcr.io/compufreq/weft:0.7`) in anything you care about.

## Compatibility policy

- **Versioning is [SemVer](https://semver.org)**. Pre-1.0, each feature phase lands as a minor (`0.x.0`) and fixes as patches (`0.x.y`); minors may contain breaking changes, and every one is called out in the [release notes](https://github.com/compufreq/weft/releases).
- **The HTTP API is versioned under `/api/v1`.** From v1.0.0 it is a stability commitment: endpoints and response shapes only gain fields, never lose or change them, within a major.
- **Weaviate support:** the latest two Weaviate minor lines are tested in CI; older versions (back to 1.30) work best-effort — features a given Weaviate can't serve (e.g. backup listing pre-1.31) degrade gracefully instead of erroring.

## Checking what you run

The container image label and the GitHub Release carry the version. From a running deployment:

```bash
docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' weft
```

## Downgrading

Because Weft is stateless, downgrading is the same operation with an older tag. The only caveat: a page introduced in a newer version obviously disappears again, and session cookies are re-prompted if the auth token changed.
