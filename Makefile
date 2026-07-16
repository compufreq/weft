# Weft — all targets run in Docker; nothing touches the host toolchain.
# Works from PowerShell/cmd/bash as long as `make` and `docker` are on PATH.
# If you don't have make on Windows, copy the commands directly.

COMPOSE := docker compose -f compose.dev.yaml

.PHONY: up down logs seed test test-rust test-int test-frontend lint lint-rust lint-frontend security trivy fmt

up:            ## start the dev stack (weaviate + seed + backend + frontend)
	$(COMPOSE) up -d

down:          ## stop the dev stack
	$(COMPOSE) down

logs:          ## follow logs
	$(COMPOSE) logs -f

seed:          ## (re)seed demo data into weaviate
	$(COMPOSE) run --rm seed

test: test-rust test-int test-frontend  ## run all tests

test-rust:     ## rust unit tests (nextest)
	$(COMPOSE) run --rm backend cargo nextest run --workspace --lib --bins

test-int:      ## rust integration tests against dockerized weaviate
	$(COMPOSE) run --rm backend cargo nextest run --workspace --test '*'

test-frontend: ## frontend unit tests (vitest)
	$(COMPOSE) run --rm frontend npm run test

lint: lint-rust lint-frontend  ## run all linters

lint-rust:
	$(COMPOSE) run --rm backend sh -c "cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings"

lint-frontend:
	$(COMPOSE) run --rm frontend sh -c "npm run lint && npm run typecheck"

fmt:           ## auto-format
	$(COMPOSE) run --rm backend cargo fmt --all
	$(COMPOSE) run --rm frontend npm run format

security:      ## cargo-audit + cargo-deny + trivy fs
	$(COMPOSE) run --rm backend sh -c "cargo audit && cargo deny check"
	$(MAKE) trivy

trivy:         ## trivy filesystem scan (containerized)
	docker run --rm -v "$(CURDIR):/repo" aquasec/trivy:latest fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --exit-code 1 /repo
