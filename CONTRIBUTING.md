# Contributing to Weft

Thanks for your interest! Weft is early-stage — issues and PRs are welcome.

## Ground rules

- **Everything runs in Docker.** You need Docker and nothing else — no local Rust or Node toolchains. All build/test/lint commands are wrapped in the [Makefile](Makefile).
- **Conventional commits** are required (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`, …). The changelog is generated from them.
- **Tests gate merges.** PRs must pass: `cargo fmt`/`clippy -D warnings`, unit tests (nextest + vitest), integration tests (against dockerized Weaviate), and the security suite (cargo-audit, cargo-deny, Trivy, gitleaks, hadolint).

## Dev loop

```bash
docker compose -f compose.dev.yaml up      # weaviate + seed + backend + frontend
make test                                   # all unit + integration tests
make lint                                   # rust + frontend lint
make security                               # audit/deny/trivy locally
```

## Project layout

- `crates/weft-weaviate` — Rust client for Weaviate REST/GraphQL (keep surface minimal, wiremock-tested)
- `crates/weft-server` — axum API server (aggregator/proxy)
- `crates/weft-core` — shared types/config
- `frontend/` — SolidStart SSR app
- `docs/` — docs site (GitHub Pages)

## Reporting security issues

Please see [SECURITY.md](SECURITY.md) — do not open public issues for vulnerabilities.
