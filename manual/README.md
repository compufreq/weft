# Weft user manual — sources

Regenerable, screenshot-accurate PDF manual. Everything runs in Docker.

- `manual.html` — the manual's content and print layout (A4).
- `capture.py` — CDP storyboard that drives a headless Chrome through every
  UI state and saves native screenshots to `shots/` (gitignored).
- Output: `Weft-User-Manual.pdf` at the repo root (gitignored).

## Regenerate against a release

All containers join one network so Chrome can reach the app directly.
Screenshots are taken of the **published release image**, not the dev server
(the Vite dev server rejects non-localhost `Host` headers).

```bash
NET=weft-manual
VERSION=1.0.0
docker network create $NET

# A seeded Weaviate (reuse the dev stack's if you prefer: network weft-dev_default)
docker run -d --name w --network $NET --network-alias weaviate \
  -e AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED=true \
  -e ENABLE_MODULES=backup-filesystem -e BACKUP_FILESYSTEM_PATH=/var/lib/weaviate/backups \
  cr.weaviate.io/semitechnologies/weaviate:1.37.2
# Seed demo data (from the repo): docker compose -f compose.dev.yaml run --rm seed

# The three app states the manual shows
docker run -d --name weftprod      --network $NET -e WEAVIATE_URL=http://weaviate:8080 ghcr.io/compufreq/weft:$VERSION
docker run -d --name weftprod-ro   --network $NET -e WEAVIATE_URL=http://weaviate:8080 -e WEFT_READ_ONLY=true ghcr.io/compufreq/weft:$VERSION
docker run -d --name weftprod-auth --network $NET -e WEAVIATE_URL=http://weaviate:8080 -e WEFT_AUTH_TOKEN=manual-demo-token ghcr.io/compufreq/weft:$VERSION

# Headless Chrome with proper fonts (browserless), CDP on :3000
docker run -d --name chrome --network $NET browserless/chrome:latest

# The demo alias shown on the schema page
docker run --rm --network $NET curlimages/curl -s -X POST \
  -H 'content-type: application/json' -d '{"alias":"ArticlesLive","class":"Article"}' \
  http://weftprod:8080/api/v1/instances/local/aliases

# Capture all states (shots/ fills with PNGs)
docker run --rm --network $NET -v "$PWD:/m" -v "$PWD/shots:/out" python:3.12-alpine \
  sh -c "pip install -q websocket-client; \
         python /m/capture.py phase1   http://weftprod:8080 && \
         python /m/capture.py authgate http://weftprod-auth:8080 && \
         python /m/capture.py readonly http://weftprod-ro:8080"

# Render the PDF
docker run --rm --user root -v "$PWD:/work" zenika/alpine-chrome \
  --headless --no-sandbox --no-pdf-header-footer \
  --print-to-pdf=/work/../Weft-User-Manual.pdf file:///work/manual.html
```

`CHROME_CDP` (default `http://chrome:3000`) points `capture.py` at the CDP
endpoint. Individual states can be re-shot with the mini-phases:
`schema`, `tenants`, `ops`, `diff`.

## Hard-won notes

- **Don't** capture with DOM-serialization libraries (html-to-image etc.):
  they re-evaluate `prefers-color-scheme` media queries against the OS during
  rasterization, producing mixed dark/light output. `capture.py` emulates
  light mode at the protocol level instead.
- **Don't** capture with `zenika/alpine-chrome`: its Chromium crashes on
  certain glyphs depending on which fontconfig fonts are installed.
  browserless/chrome (Debian, full font set) is reliable. (alpine-chrome is
  fine for the final HTML→PDF print, which involves no app pages.)
- Update `manual.html` alongside UI changes; the storyboard asserts key
  elements and fails loudly when the UI drifts.
