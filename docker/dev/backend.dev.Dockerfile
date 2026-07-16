# Dev image for the Rust workspace: toolchain + test/lint/security tools.
# Source is bind-mounted; target/ and the cargo registry live in named volumes.
FROM rust:1.92-slim-bookworm

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# upgrade pulls Debian security patches (Trivy gate); DL3005 predates that practice.
# hadolint ignore=DL3005,DL3008
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends curl ca-certificates pkg-config make git \
    && rm -rf /var/lib/apt/lists/*

# Prebuilt tool binaries (no compilation): nextest, then binstall for the rest.
RUN curl -LsSf https://get.nexte.st/latest/linux | tar zxf - -C /usr/local/cargo/bin \
    && curl -L --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash \
    && cargo binstall -y cargo-watch cargo-audit cargo-deny

# Non-root user; volume mountpoints pre-created so named volumes inherit ownership.
RUN useradd -m -u 1000 dev \
    && mkdir -p /app/target /usr/local/cargo/registry \
    && chown -R dev:dev /app /usr/local/cargo
USER dev

WORKDIR /app
CMD ["cargo", "run", "-p", "weft-server"]
