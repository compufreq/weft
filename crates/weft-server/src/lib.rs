//! Weft server library: router assembly and application state.
//!
//! Kept as a library so integration tests can build the exact production
//! router in-process.

pub mod api;
pub mod error;
pub mod state;

pub use state::AppState;

use axum::routing::get;
use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

/// Build the full application router.
pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(api::health::healthz))
        .route("/readyz", get(api::health::readyz))
        .route("/api/v1/instances", get(api::instances::list))
        .route("/api/v1/instances/{id}/meta", get(api::instances::meta))
        .route("/api/v1/instances/{id}/schema", get(api::schema::full))
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        // NOTE: no server-side TimeoutLayer needed — upstream calls are already
        // bounded by the reqwest client timeouts (connect 5s, total 30s).
        .with_state(state)
}
