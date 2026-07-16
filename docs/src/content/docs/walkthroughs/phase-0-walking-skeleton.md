---
title: "v0.1 — Walking skeleton"
description: What shipped in v0.1.0 and how it was verified.
---

The first release proved the whole stack end to end: a dockerized dev environment (Weaviate 1.37 seeded with demo data + Rust API + SolidStart SSR UI), an instances overview, and a server-side-rendered schema browser.

## What shipped

- **Instances page** — every Weaviate instance Weft knows about, as cards
- **Schema browser** — collections with property counts, vectorizer, and multi-tenancy status
- **True SSR** — the schema table is in the raw HTML; no client JS required to see your data
- **CI + security pipelines** — lint, unit, integration (against real Weaviate), cargo-audit/deny, Trivy fs+image, gitleaks, hadolint

## Verification (release gate)

Every Weft release passes a gate before tagging. For v0.1.0:

- **Journeys**: instances overview → instance card → schema table
- **Accessibility**: axe-core scan on every route — zero violations
- **Responsive**: 375 px / 768 px / desktop — no horizontal page overflow
- **SSR sanity**: `curl` of the schema page contains the fully rendered table
- **Tests**: 10 Rust unit + 6 integration (real Weaviate) + 4 frontend component tests
- **Security**: no HIGH/CRITICAL findings across the toolchain
