# Security Policy

## Supported versions

Pre-1.0: only the latest minor release receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Report vulnerabilities via [GitHub private vulnerability reporting](https://github.com/compufreq/weft/security/advisories/new) on this repository.

You can expect an acknowledgement within 7 days.

## Scope notes

- Weft is designed to run **next to** your Weaviate on a trusted network. It does not add authentication in front of Weaviate by default (optional UI auth token lands in v0.6+). Do not expose Weft directly to the public internet before then.
- Weaviate credentials configured in Weft are held in memory, redacted in API responses, and never logged.
