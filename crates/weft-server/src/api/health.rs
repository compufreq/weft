//! Liveness and readiness probes.

use axum::http::StatusCode;

/// Liveness: the process is up.
pub async fn healthz() -> &'static str {
    "ok"
}

/// Readiness: the server can serve traffic.
///
/// Deliberately does NOT depend on Weaviate being reachable — Weft should be
/// able to render its UI (with error states) even when Weaviate is down.
pub async fn readyz() -> StatusCode {
    StatusCode::OK
}
