---
title: Configuration
description: Environment variables and weft.yaml reference.
---

Weft is zero-config by default: with no configuration at all it registers a single instance pointing at `$WEAVIATE_URL` (falling back to `http://weaviate:8080`).

## Environment variables

| Variable            | Default                 | Purpose                                        |
| ------------------- | ----------------------- | ---------------------------------------------- |
| `WEAVIATE_URL`      | `http://weaviate:8080`  | URL of the default (`local`) instance          |
| `WEAVIATE_API_KEY`  | —                       | Bearer token for the default instance          |
| `WEFT_LISTEN`       | `0.0.0.0:8080`          | Address the server binds                       |
| `RUST_LOG`          | `info`                  | Log level (`tracing` filter syntax)            |

## weft.yaml

For multiple permanent instances, mount a `weft.yaml` next to the binary (in the container: `/app/weft.yaml`):

```yaml
listen: "0.0.0.0:8080"

instances:
  - id: local
    name: Local Weaviate
    url: http://weaviate:8080

  - id: staging
    name: Staging cluster
    url: https://weaviate.staging.example.com
    api_key: "sk-..."
```

Environment variables prefixed `WEFT_` override file values.

## Runtime instances

Instances added through the UI (or `POST /api/v1/instances`) are **in-memory** — they reset when the container restarts. Put permanent instances in `weft.yaml`.

## Security notes

- API keys are held in memory, redacted in every API response (`api_key` never appears), and never logged.
- Weft is designed to run on a trusted network next to Weaviate. It does not add its own authentication yet (optional UI auth token is planned for v0.6) — don't expose it directly to the public internet before then.
