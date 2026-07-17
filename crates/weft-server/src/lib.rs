//! Weft server library: router assembly and application state.
//!
//! Kept as a library so integration tests can build the exact production
//! router in-process.

pub mod api;
pub mod error;
pub mod proxy;
pub mod state;
pub mod supervisor;

pub use proxy::SsrProxy;
pub use state::AppState;

use axum::routing::{delete, get, post};
use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

/// Build the application router (API only — no SSR proxy).
pub fn app(state: AppState) -> Router {
    app_with_proxy(state, None)
}

/// Build the full router; with a proxy, non-API paths are forwarded to the
/// SolidStart SSR process (the all-in-one image topology).
pub fn app_with_proxy(state: AppState, ssr: Option<SsrProxy>) -> Router {
    let router = Router::new()
        .route("/healthz", get(api::health::healthz))
        .route("/readyz", get(api::health::readyz))
        .route("/api/v1/auth", get(api::auth::status))
        .route(
            "/api/v1/auth/session",
            post(api::auth::session).delete(api::auth::logout),
        )
        .route(
            "/api/v1/instances",
            get(api::instances::list).post(api::instances::add),
        )
        .route("/api/v1/instances/{id}", delete(api::instances::remove))
        .route("/api/v1/instances/{id}/meta", get(api::instances::meta))
        .route(
            "/api/v1/instances/{id}/collections",
            post(api::collections::create),
        )
        .route(
            "/api/v1/instances/{id}/collections/{class}",
            delete(api::collections::delete),
        )
        .route(
            "/api/v1/instances/{id}/collections/{class}/properties",
            post(api::collections::add_property),
        )
        .route(
            "/api/v1/instances/{id}/aliases",
            get(api::aliases::list).post(api::aliases::create),
        )
        .route(
            "/api/v1/instances/{id}/aliases/{alias}",
            axum::routing::put(api::aliases::update).delete(api::aliases::delete),
        )
        .route("/api/v1/instances/{id}/schema", get(api::schema::full))
        .route(
            "/api/v1/instances/{id}/schema/export",
            get(api::schema::export),
        )
        .route(
            "/api/v1/instances/{id}/schema/diff",
            post(api::schema::diff),
        )
        .route(
            "/api/v1/instances/{id}/collections/{class}/objects",
            get(api::objects::list).post(api::objects::create),
        )
        .route(
            "/api/v1/instances/{id}/collections/{class}/objects/{uuid}",
            get(api::objects::get_one)
                .put(api::objects::replace)
                .delete(api::objects::delete_one),
        )
        .route(
            "/api/v1/instances/{id}/collections/{class}/import",
            post(api::objects::import),
        )
        .route(
            "/api/v1/instances/{id}/collections/{class}/search",
            post(api::objects::search),
        )
        .route(
            "/api/v1/instances/{id}/collections/{class}/aggregate",
            post(api::objects::aggregate),
        )
        .route(
            "/api/v1/instances/{id}/graphql",
            post(api::console::graphql),
        )
        .route(
            "/api/v1/instances/{id}/collections/{class}/export.ndjson",
            get(api::objects::export),
        )
        .route(
            "/api/v1/instances/{id}/collections/{class}/tenants",
            get(api::tenants::list)
                .post(api::tenants::create)
                .put(api::tenants::update),
        )
        .route("/api/v1/instances/{id}/nodes", get(api::ops::nodes))
        .route(
            "/api/v1/instances/{id}/statistics",
            get(api::ops::statistics),
        )
        .route("/api/v1/instances/{id}/metrics", get(api::ops::metrics))
        .route("/api/v1/instances/{id}/rbac", get(api::rbac::overview))
        .route(
            "/api/v1/instances/{id}/capabilities",
            get(api::ops::capabilities),
        )
        .route(
            "/api/v1/instances/{id}/backups/{backend}",
            get(api::ops::backups_list).post(api::ops::backups_create),
        )
        .route(
            "/api/v1/instances/{id}/backups/{backend}/{backup_id}",
            get(api::ops::backups_status),
        )
        .route(
            "/api/v1/instances/{id}/backups/{backend}/{backup_id}/restore",
            post(api::ops::backups_restore).get(api::ops::backups_restore_status),
        )
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        // NOTE: no server-side TimeoutLayer needed — upstream calls are already
        // bounded by the reqwest client timeouts (connect 5s, total 30s).
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            api::auth::guard,
        ))
        .with_state(state);

    match ssr {
        Some(proxy) => router.fallback(move |req: axum::extract::Request| {
            let proxy = proxy.clone();
            async move { proxy.forward(req).await }
        }),
        None => router,
    }
}
