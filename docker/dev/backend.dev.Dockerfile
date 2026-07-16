# Dev image for the Rust workspace: toolchain + test/lint/security tools.
# Source is bind-mounted; target/ and the cargo registry live in named volumes.
FROM rust:1.92-slim-bookworm

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates pkg-config make \
    && rm -rf /var/lib/apt/lists/*

# Prebuilt tool binaries (no compilation): nextest, then binstall for the rest.
RUN curl -LsSf https://get.nexte.st/latest/linux | tar zxf - -C /usr/local/cargo/bin \
    && curl -L --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash \
    && cargo binstall -y cargo-watch cargo-audit cargo-deny

WORKDIR /app
CMD ["cargo", "run", "-p", "weft-server"]
