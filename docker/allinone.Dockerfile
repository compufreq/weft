# Weft all-in-one image — the zero-config deploy:
#   docker run -d -p 8080:8080 -e WEAVIATE_URL=http://your-weaviate:8080 ghcr.io/compufreq/weft
# One container: Rust API (front door) + supervised SolidStart SSR on loopback.

# --- Stage 1: Rust backend (static musl binary) ---
FROM rust:1.92-alpine AS backend
RUN apk add --no-cache musl-dev
WORKDIR /build
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates ./crates
RUN cargo build --release -p weft-server \
    && strip target/release/weft-server

# --- Stage 2: SolidStart SSR build ---
FROM node:26-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend .
RUN npm run build

# --- Final: node runtime + rust binary, tini as PID 1 ---
FROM node:26-alpine
RUN apk add --no-cache --upgrade tini \
    && apk upgrade --no-cache \
    && addgroup -S weft && adduser -S weft -G weft

COPY --from=backend /build/target/release/weft-server /usr/local/bin/weft-server
COPY --from=frontend --chown=weft:weft /build/.output /srv/ssr

ENV WEFT_SSR_COMMAND="node /srv/ssr/server/index.mjs" \
    WEFT_SSR_PROXY="http://127.0.0.1:3000" \
    # The SSR child inherits these: bind loopback only, reach the API locally.
    PORT=3000 \
    HOST=127.0.0.1 \
    WEFT_INTERNAL_API="http://127.0.0.1:8080" \
    NODE_ENV=production

USER weft
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

# tini -g forwards signals to the whole process group, so SIGTERM reaches the
# supervised node child as well as weft-server.
ENTRYPOINT ["/sbin/tini", "-g", "--"]
CMD ["weft-server"]
