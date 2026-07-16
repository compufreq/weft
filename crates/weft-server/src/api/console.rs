//! Raw GraphQL console passthrough.
//!
//! Weaviate's GraphQL schema is query-only (`Get` / `Aggregate` / `Explore` —
//! mutations happen over REST), so forwarding arbitrary GraphQL is read-safe
//! and allowed even in read-only deployments.

use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;

/// Queries beyond this are rejected (sanity bound, not a security boundary).
const MAX_QUERY_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
pub struct GraphqlRequest {
    pub query: String,
}

/// `POST /api/v1/instances/{id}/graphql` — forward a raw GraphQL query and
/// return Weaviate's envelope (`data` / `errors`) verbatim, so the console
/// can render errors exactly as Weaviate reports them.
pub async fn graphql(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<GraphqlRequest>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;

    if body.query.trim().is_empty() {
        return Err(ApiError::InvalidInput("query must not be empty".into()));
    }
    if body.query.len() > MAX_QUERY_BYTES {
        return Err(ApiError::InvalidInput(format!(
            "query exceeds {MAX_QUERY_BYTES} bytes"
        )));
    }

    let envelope = instance.client.graphql(&body.query).await?;
    Ok(Json(envelope))
}
